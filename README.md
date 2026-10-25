# LayerFS for Cursor

Cursor coding agents work on LayerFS Branches and Workspaces instead of git
worktrees. One task gets one Branch. File edits go through `fs.*`. Bash runs
as `workspace.mount`, then `exec`, `commit`, and `unmount`. Each LayerFS call
is attempted once.

Plugin id: `cursor-agents`. Package: `layerfs-cursor-agents` `0.1.0`.
This repository is for Cursor only. It does not install Claude Code skills,
hooks, or configuration, and it does not ship a history dashboard.

The LayerFS commit this version was built against is `commit` in
[`layerfs.json`](layerfs.json): `ad78914e36b258b360daf13aec164b5655814689`
(LayerFS v1.1.0).

## What it adds

- A Cursor skill at [`.cursor/skills/layerfs-agent/SKILL.md`](.cursor/skills/layerfs-agent/SKILL.md).
  The same skill is at [`.agents/skills/layerfs-agent/SKILL.md`](.agents/skills/layerfs-agent/SKILL.md) for agents that look there.
- `layerfs-cursor-setup`, which checks out that LayerFS commit, links the
  official `layerfs` command onto `PATH`, and writes `LAYERFS_*` settings.
- On Linux, Store calls stay in the agent process. On macOS and Windows the
  setup starts the home worker with `@layerfs/runtime` and sets
  `LAYERFS_WORKER_ENDPOINT`.

## Requirements

- Node.js 20 or newer, `git`, and `npm`.
- A LayerFS checkout at the pinned commit. The setup script clones it if you
  do not already have one.
- Linux, for real Store calls: the Rust 1.85.1 toolchain (`rustup toolchain install 1.85.1`), so
  `npm --prefix <checkout>/api run build:native` can build the addon, and
  `LAYERFS_STORE_PATH` pointing at the project's installed Store
  (`global/store.sqlite` on a local filesystem the daemons share).
- Sandboxes (any OS): Docker, `LAYERFS_IMAGE` (`sha256:…`), `LAYERFS_VOLUME`,
  and `LAYERFS_DAEMON`.
- macOS worker: Docker, `LAYERFS_IMAGE`, and a sealed Linux `--bundle`.
- Windows worker: WSL2, Docker inside it, `LAYERFS_IMAGE`, and a sealed Linux
  `--bundle`. The setup process must stay running; it owns the worker.

Default tests do not need Docker, Cargo, or a LayerFS checkout.

## Install

Paste this into a Cursor agent whose workspace is this repository. It stops
on the first error and does not retry.

```text
Install LayerFS for Cursor (plugin id cursor-agents, package layerfs-cursor-agents) in this repository. Cursor only. Do not add Claude Code skills, hooks, or configuration.

1. Check the tools, once each. Stop if either is missing or Node is older than 20.
   node -v
   git --version
2. From the repository root, run setup once.
   On Linux, pass --build-native so the in-process Store addon is built:
   node bin/layerfs-cursor-setup.js --build-native
   On macOS and Windows, do not pass --build-native. Those routes use the worker. The native build throws on Windows, and macOS does not need a Rust toolchain for Store calls. Setup ignores the flag there:
   node bin/layerfs-cursor-setup.js
   Add a flag only when you already know the value:
   --layerfs <checkout>
   --home <LAYERFS_HOME>
   --prefix <directory on PATH>
   --settings-file <file>
   --project <LAYERFS_PROJECT>
   --store-path <installed store.sqlite>
   --image <sha256:...>
   --daemon <layerfs-daemon>
   --volume <docker volume>
   --docker <socket>
   --bundle <sealed linux bundle>
   --container-prefix <prefix>
   --cursor-project <other Cursor project to copy the skill into>
   Use --settings-file for the env file. Node reserves --env-file, so that name never reaches this script.
   On macOS and Windows, --image and --bundle are required or the worker start fails. Stop with that error.
   On Windows the process stays in the foreground to keep the worker alive. Leave it running and use another terminal for the later steps.
3. Source the env file the script writes (by default layerfs.env in this repository) in the shell you will use for LayerFS:
   set -a && source layerfs.env && set +a
   If the script said the shim directory is not on PATH, prepend that directory to PATH in this shell.
4. Check, once each:
   node bin/layerfs-cursor-setup.js check
   layerfs help
   node --test
5. Read .cursor/skills/layerfs-agent/SKILL.md before editing the project. Do not create a git worktree.

Report each command and what it printed. If a command fails, stop and give me the exact error. Do not run it again.
```

What the setup script does, in order:

1. Reads `layerfs.json` and requires a 40-character `commit`.
2. Clones <https://github.com/Ephemeral-AI-Lab/layerfs.git> into `--layerfs`
   (default `../layerfs`, or `LAYERFS_REPO` when that is set) and checks out
   that commit. An existing checkout already on the commit is left as it is.
   A checkout on another commit is updated only when `git status` is clean:
   one `git fetch` of that commit, then one `git checkout`. A dirty tree is
   not touched.
3. Runs `npm --prefix <checkout>/api install` and
   `npm --prefix <checkout>/api/agent/cli install`, once each.
4. On Linux, with `--build-native`, runs `npm --prefix <checkout>/api run build:native` once.
   On macOS and Windows the flag is ignored. Store calls use the worker, and the native addon is not built.
5. Links `@layerfs/agent` and `@layerfs/runtime` into this repo's
   `node_modules` (symlinks to the checkout, not copies of LayerFS source).
6. Writes a `layerfs` shim into `--prefix` (default `~/.local/bin`) that runs
   `<checkout>/api/agent/cli/src/layerfs.js`. That is the official command.
7. Creates `LAYERFS_HOME` as mode `0700` when it is missing (default
   `~/.local/share/layerfs-cursor-agents/home`). An existing home that is
   group- or world-accessible is left unchanged and setup stops.
8. On Linux, does not start a worker. Store calls run in-process and need
   `LAYERFS_STORE_PATH`.
9. On macOS and Windows, opens `@layerfs/runtime` with `sweep: false` and
   calls `worker.start()` once. It sets `LAYERFS_WORKER_ENDPOINT` to
   `<LAYERFS_HOME>/worker/endpoint.json`. macOS then closes the runtime
   object; the worker container keeps running. Windows keeps this process
   alive because the runtime owns the worker on stdin. One interrupt drains
   it and exits. A second start is not attempted.
10. Writes `--settings-file` (default `layerfs.env`) with `LAYERFS_*` names only,
    mode `0600`.

`node bin/layerfs-cursor-setup.js --dry-run` prints the plan and writes nothing.
`node bin/layerfs-cursor-setup.js --help` lists the flags.
`node bin/layerfs-cursor-setup.js check` reads the pin, checkout, package
links, shim, and env file. It does not clone, build, or start a worker.

Copy the skill into another Cursor project with
`--cursor-project <path>`. That overwrites
`<path>/.cursor/skills/layerfs-agent` when you run setup again.

## How agents work

The skill is the procedure. Short form:

1. Source `layerfs.env`. Use `layerfs` or `LayerFS.open(process.env.LAYERFS_PROJECT)`.
2. `branch.fork` one Branch for the task. Do not add a git worktree.
3. Edit with `fs.write`, `fs.edit`, `fs.apply`, and the other `fs.*` calls.
4. Run bash as `sandbox.create` (when you need a Sandbox), then
   `workspace.mount` → `workspace.exec` → `workspace.commit` → `workspace.unmount`.
   Unmount in `finally`. On `Conflict`, stay in that Workspace until you
   resolve it or discard it.
5. On `Conflict`, `Busy`, or `NoSuchSandbox`, follow
   [`.cursor/skills/layerfs-agent/references/refusals.md`](.cursor/skills/layerfs-agent/references/refusals.md)
   once. Do not replay the refused call.

`examples/task-branch.mjs` forks a Branch (or keeps it if the name is taken)
and writes one file. It imports the public SDK from `LAYERFS_REPO`.

## Tests

```bash
node --test
```

That suite uses no Docker, no Store, and no daemon. It checks the pin, the
skill, refusal handling, and the setup plan with a fake filesystem.

When `LAYERFS_REPO` points at the pinned checkout, the same command also
imports the public `@layerfs/agent` entry over LayerFS's stand-in native
binding and runs `layerfs help`. Still no Docker.

```bash
LAYERFS_CURSOR_E2E=1 node --test test/e2e.test.mjs
```

The end-to-end test is skipped unless that variable is `1`. It then needs
Docker and `LAYERFS_REPO`, `LAYERFS_HOME`, `LAYERFS_STORE_PATH`,
`LAYERFS_IMAGE`, `LAYERFS_VOLUME`, `LAYERFS_DAEMON`, and `LAYERFS_PROJECT`,
and it runs one mount → exec → commit → unmount. A missing value or a refused
call fails the test. It does not retry.

## Limits

- Cursor only. No Claude Code, DSH, Pi, or `@layerfs/backend` UI.
- Packages used here are the public `@layerfs/agent` and `@layerfs/runtime`
  APIs. Nothing imports `@layerfs/agent/internal`.
- Settings written for agents are `LAYERFS_*` names. The SDK does not take
  an options object.
- One attempt per call. Setup does not retry a failed git, npm, or worker
  start. Agents do not retry a refused SDK call.
- Linux has no worker. `worker.start` on Linux is `InvalidInput` in
  `@layerfs/runtime`, and this setup does not call it.
- macOS and Windows need a sealed bundle and an image digest before the
  worker can start. This plugin does not build that image or the bundle.
- The Windows worker dies when the setup process exits.
- `main` changes only through `branch.publish`.
- This repo does not modify the LayerFS checkout except for the setup
  script's clone, checkout, `npm install`, and optional native build.
- Listing this plugin on layerfs.ai is a later pull request against
  LayerFS, not part of this repository.
- Conflict markers from `workspace.commit` exist only in the Workspace that
  hit the conflict.
- The `layerfs` command starts a new process per call. A long loop belongs
  in one Node script.

## License

MIT. See [LICENSE](LICENSE).
