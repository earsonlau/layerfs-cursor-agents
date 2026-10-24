# Refusals

A refused call throws once. Report `code`, `message`, and `detail`. Do not
send that call again with the same arguments.

| Code | What happened | What you do, once |
| --- | --- | --- |
| `Conflict` | A merge found overlapping edits. Nothing from the refused call was published as a clean Commit. | Inspect, resolve, then make one new call. If that call is refused, stop. |
| `Busy` | A lock or an existing worker is held. The call already waited. | Stop and report. |
| `NoSuchSandbox` | The Sandbox is not running, or its container is gone. | Do not use that sandbox id again. Follow the row below. |

`HeadMoved` on `fs.write` or `fs.edit` means nothing was written. Read the file
once and, if the task still needs a change, make one new edit. `Unknown` and
`Failed` mean you do not know whether the call landed. Check with
`branch.list_commits` and `fs.read` once each, then report. Do not redo it.

Other codes (`NameTaken`, `ReservedName`, `InvalidInput`, `NoSuchPath`,
`Capacity`, `MountsActive`) also stop the automatic path. Read the message,
and make a different call only when this page says to.

## Conflict

`workspace.commit` can refuse `Conflict` when the Branch moved after mount and
both sides changed the same lines. Markers are in **that** Workspace
(`detail.conflicts`, `detail.base`, `detail.head`, `detail.markers`). Other
clean changes from the new head are installed there too. Do not mount again
to inspect: a new mount does not have the markers.

1. Read `detail` once.
2. Read the other side with `fs.diff_files(detail.base, path, detail.head, path)` and the marker file with `workspace.exec` (`cat`) in this Workspace.
3. Edit the file in this Workspace until the markers are gone.
4. `workspace.commit` once. If it is refused, stop and report. Do not force unless you have read the other side and the user wants this Workspace to win (`workspace.commit(ws, message, true)` only before markers are written).

`branch.merge` can refuse `Conflict` and writes nothing. `detail.sources` and
`detail.mergeBase` are the inputs. Keep those Branches. Fork a working Branch
from each, write the same resolution onto both forks with `fs.write` or
`fs.edit`, and `branch.merge` the forks once. If that merge is refused, stop.

While a marker block remains, Commit stays `Conflict` with `detail.markers`
true, including a forced Commit. Resolving means editing the file, not sending
the old Commit again.

## Busy

Stop. The SDK waited for the lock (up to 60 seconds) before this refusal.
Calling the same method again is a retry. Tell the user what is busy. A
Windows worker that is already running is also `Busy`: do not start another.

Unmounting a Workspace you still hold, in a `finally` that was going to run
anyway, is cleanup. It is not a second attempt of the call that returned `Busy`.

## NoSuchSandbox

Do not `mount`, `exec`, `commit`, or `unmount` that sandbox id again.

- `detail.containerGone` or `detail.containerStopped`: the container and every Workspace in it are gone. Stop and report. Do not `sandbox.create` unless the user asks.
- Otherwise the Sandbox is not running (it may have closed itself). `sandbox.create()` once. If that is refused, stop. `workspace.mount` the **new** id once. If that mount is refused, stop.

`Capacity` is not `NoSuchSandbox`. The message tells you the Sandbox is full.
List its Workspaces once and unmount ones you are finished with, or
`sandbox.create()` once and mount the new id once. If that is refused, stop.

## Commands

`layerfs` exits 125 and prints one JSON object, `{"code","message","detail"}`,
on stderr. Exit 2 means the command line was wrong and nothing was called.
Fix the command line; do not run the same line again. Exit 0 with a JSON
`exitCode` inside means `workspace exec` finished. With `--stream`, the
process exit code is the command's own code, and 125 is still LayerFS.
