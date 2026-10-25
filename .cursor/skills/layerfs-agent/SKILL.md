---
name: layerfs-agent
description: >-
  Use in Cursor when a coding task should run on LayerFS Branches and
  Workspaces instead of a git worktree. Fork one Branch per task, edit files
  with fs.*, and run bash as workspace.mount then exec, commit, and unmount.
  Handle Conflict, Busy, and NoSuchSandbox once, with no retry or replay.
  Applies when LAYERFS_PROJECT or layerfs.env is set, when the user mentions
  LayerFS, Branches, Sandboxes, or Workspaces, and when an agent would
  otherwise create a git worktree.
---

# LayerFS for Cursor

This skill is for Cursor. It does not install Claude Code configuration.

The project lives in LayerFS. A git worktree is the wrong place to do the task.
Fork one Branch for the task, change files with `fs.*`, and run bash inside a
Workspace. The host directory you were started in is scratch for scripts and
notes, not the project tree.

Settings come from `layerfs.env` in the plugin repository. Source it before
the first call. Every name is `LAYERFS_*`. The SDK reads those names itself.
Do not pass an options object to `LayerFS.open` or `LayerFS.init`.

```bash
set -a
source layerfs.env
set +a
```

Two ways in, both public:

- Node, many calls, one client: `import { LayerFS, isRefusal } from "@layerfs/agent"`.
  Setup links that package. A script may instead import the pinned checkout at
  `$LAYERFS_REPO/api/agent/sdk/src/index.js`.
- Bash, one call per command: `layerfs`. Setup puts that command on `PATH`.
  It is the official command from `$LAYERFS_REPO/api/agent/cli`. It opens the
  project, makes one SDK call, prints JSON, and exits. It does not retry.

Do not import `@layerfs/agent/internal`. Do not import `@layerfs/backend` or
LayerFS source into a tool. The method reference is
`$LAYERFS_REPO/api/how-to-use/agent.md`.

`LAYERFS_PROJECT` is the project name. `main` is read-only. Read it and fork
from it. `fs.write`, `fs.edit`, `workspace.mount`, and `workspace.commit` on
`main` are refused. Publish to `main` only when the user asks to land the task.

## One Branch per task

Fork before the first edit. One Cursor task gets one Branch. A second agent
gets its own Branch. Do not `git worktree add`, do not `git checkout -b` in
another directory, and do not commit the task with git.

```bash
layerfs branch fork task-name
```

```js
const forked = await layerfs.branch.fork("task-name"); // from main
// forked.kind === "Forked"
```

Name the Branch with lowercase letters, digits, `.`, `_`, and `-`, starting
and ending with a letter or digit, at most 63 characters. `main` is reserved
(`ReservedName`). If fork returns `NameTaken`, the Branch already exists: use
it, or stop and ask. Do not fork the same name again.

`layerfs init <name> <source-dir>` (or `LayerFS.init`) runs once, when the
user wants a new project. If the name is already taken, open it. Do not delete
the home entry and initialize again.

End every script with `await layerfs.close()` in `finally`. A closed client
refuses later calls. Closing does not unmount Workspaces.

## File edits: `fs.*`

Use `fs.*` for reads and for edits your file tools would have made on disk.
Cursor's ApplyPatch, Write, and StrReplace tools edit the host workspace.
Use those only for scratch scripts. Project files go through `fs.*` or `layerfs`.

| Job | Call |
| --- | --- |
| Read a range | `fs.read(ref, path, startLine?, endLine?)` |
| List, search | `fs.list`, `fs.grep`, `fs.glob`, `fs.stat` |
| Diff, blame | `fs.diff_files`, `fs.blame` |
| One file | `fs.write(branch, path, content, message?)` or `fs.edit(branch, path, oldText, newText, message?)` |
| Several related paths, one Commit | `fs.apply(branch, changes, message?)` |
| Folders, copy, move, delete | `fs.mkdir`, `fs.cp`, `fs.mv`, `fs.rm` |

Paths are absolute in the project (`/src/app.js`). `fs.edit` needs exactly one
match of `oldText`. Each write is one Commit. Reads see committed state only,
not an uncommitted Workspace.

`fs.write` and `fs.apply` read bodies from the call. For bash, `layerfs fs write`
reads stdin or `--from <file>`, and `layerfs fs edit` takes `--old` and `--new`.

A write refused `HeadMoved` was not stored. Do not send that write again. Read
the file once, then make one new edit if the task still needs it. If the new
edit is refused, stop. See [refusals](references/refusals.md).

## Bash: mount, exec, commit, unmount

A command that builds, tests, installs, or rewrites a tree runs in a Workspace.
Default is one Workspace per command. Mounting does not copy the tree.

```js
const { sandbox } = await layerfs.sandbox.create();
const ws = await layerfs.workspace.mount(sandbox, "task-name");
let conflict = false;
try {
  const run = await layerfs.workspace.exec(ws, "npm test", "step: npm test");
  // A non-zero exitCode is the command's result, not a LayerFS refusal.
  try {
    await layerfs.workspace.commit(ws, `step: npm test (exit ${run.exitCode})`);
  } catch (error) {
    if (!isRefusal(error, "Conflict")) throw error;
    conflict = true;
  }
} finally {
  // A Conflict leaves this Workspace mounted. Markers exist only here.
  if (!conflict) await layerfs.workspace.unmount(ws);
}
```

The same sequence with the command. `commit` exits 0 on `Committed` and on
`UpToDate`. It exits 125 when LayerFS refuses the call. A `Conflict` (that
125, with `"code":"Conflict"`) must not be followed by `unmount`:

```bash
layerfs sandbox create
layerfs workspace mount <sandbox> task-name
layerfs workspace exec <sandbox>:/workspaces/N "npm test" -m "step: npm test" --stream
if layerfs workspace commit <sandbox>:/workspaces/N -m "step: npm test (exit N)"; then
  layerfs workspace unmount <sandbox>:/workspaces/N
fi
```

`workspace mount` prints `ws` as `<sandbox>:<path>`. Pass that string to the
later commands. `exec` starts in the Workspace root: use `npm test`, not the
mount path. Keep each command under two minutes (`timeout 110 npm test`).
`exec` itself has no timeout.

Commit after the command, including a failing one, so the Branch records the
step. `commit` returns `UpToDate` when the command changed nothing; that is
not a failure. Unmount in `finally` only when `commit` did not refuse
`Conflict`. On a `Conflict` from `commit`, leave the Workspace mounted until
you have resolved it or decided to discard it with
`workspace.unmount(ws, true)` (`layerfs workspace unmount <ws> --discard`).
A new mount is a new Workspace and does not have the conflict markers.

`sandbox.create()` is the only call that starts a Sandbox. Mount never does.
A Sandbox holds 16 Workspaces. `NoSuchSandbox` and `Capacity` are handled in
[refusals](references/refusals.md). `sandbox.close(sandbox)` stops one you
started, after its Workspaces are unmounted.

Store calls (`fs`, `branch`, `project.list_branches`) run in this process on
Linux when `LAYERFS_STORE_PATH` is the installed Store file. On macOS and
Windows they go to the worker at `LAYERFS_WORKER_ENDPOINT`. Do not start a
worker yourself on Linux. Workspace calls still need a Sandbox, which needs
Docker, `LAYERFS_IMAGE`, `LAYERFS_VOLUME`, and `LAYERFS_DAEMON`.

## One attempt

Every SDK call is attempted once. A refusal throws `LayerFSError` (`code`,
`message`, `detail`). `isRefusal(error, "Conflict")` tests one code. The
`layerfs` command prints the same refusal on stderr and exits 125.

Do not retry. Do not replay the same arguments. Handle `Conflict`, `Busy`,
and `NoSuchSandbox` once, as [refusals](references/refusals.md) says, then
stop if that handling is refused. `Unknown` and `Failed` mean the outcome is
uncertain: look once with `branch.list_commits` and `fs.read`, report, and
do not redo the operation.

## What you leave alone

- Git worktrees, git commits, and a second checkout of the same task.
- `main`, until the user asks you to `branch.publish`.
- The LayerFS checkout at `LAYERFS_REPO`. Read it. Do not edit it.
- Docker, Store files, and daemon logs, unless the user asked you to diagnose
  a refusal. The SDK is the way in.
