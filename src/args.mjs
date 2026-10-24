import { SetupError } from "./errors.mjs";

const OPTIONS = new Set([
  "--layerfs",
  "--home",
  "--prefix",
  "--project",
  "--store-path",
  "--image",
  "--daemon",
  "--volume",
  "--docker",
  "--bundle",
  "--container-prefix",
  "--cursor-project",
  "--settings-file",
]);

const FLAGS = new Set(["--build-native", "--dry-run", "--help"]);

/**
 * @param {string[]} argv
 * @returns {{
 *   command: "install" | "check",
 *   help: boolean,
 *   dryRun: boolean,
 *   buildNative: boolean,
 *   values: Record<string, string>,
 * }}
 */
export function parseArgs(argv) {
  const values = {};
  let command = "install";
  let help = false;
  let dryRun = false;
  let buildNative = false;
  let seenCommand = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "check") {
      if (seenCommand) throw new SetupError("only one command is accepted", { step: "args" });
      command = "check";
      seenCommand = true;
      continue;
    }
    if (token.startsWith("-") && !OPTIONS.has(token) && !FLAGS.has(token)) {
      throw new SetupError(`unknown option ${token}`, { step: "args" });
    }
    if (FLAGS.has(token)) {
      if (token === "--help") help = true;
      if (token === "--dry-run") dryRun = true;
      if (token === "--build-native") buildNative = true;
      continue;
    }
    if (OPTIONS.has(token)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new SetupError(`${token} needs a value`, { step: "args" });
      }
      const name = token.slice(2);
      if (Object.hasOwn(values, name)) throw new SetupError(`${token} was given twice`, { step: "args" });
      values[name] = value;
      i += 1;
      continue;
    }
    throw new SetupError(`unexpected argument ${token}`, { step: "args" });
  }
  return { command, help, dryRun, buildNative, values };
}

export const HELP = `layerfs-cursor-setup [check] [options]

Install LayerFS for Cursor at the commit recorded in layerfs.json.
Cursor only. Each command runs once; a failure is not retried.

Commands:
  (default)   Check out LayerFS, link the layerfs command, write LAYERFS_* settings
  check       Verify the pin, checkout, shim, and env file. Does not start a worker

Options:
  --layerfs <dir>            LayerFS checkout (default: ../layerfs, or LAYERFS_REPO)
  --home <dir>               LAYERFS_HOME
  --prefix <dir>             Directory for the layerfs shim (default: ~/.local/bin)
  --settings-file <file>     Shell file to write (default: layerfs.env in this repo)
  --project <name>           LAYERFS_PROJECT
  --store-path <file>        LAYERFS_STORE_PATH for in-process Store calls
  --image <digest>           LAYERFS_IMAGE
  --daemon <path>            LAYERFS_DAEMON
  --volume <name>            LAYERFS_VOLUME
  --docker <socket>          LAYERFS_DOCKER
  --bundle <dir>             Sealed Linux bundle (required to start the macOS/Windows worker)
  --container-prefix <text>  LAYERFS_CONTAINER_PREFIX
  --cursor-project <dir>     Copy .cursor/skills/layerfs-agent into this project
  --build-native             On Linux, run npm --prefix <checkout>/api run build:native once. Ignored on macOS and Windows
  --dry-run                  Print the plan and write nothing
  --help                     Show this help

Linux runs Store calls in-process and does not start a worker.
macOS and Windows start the worker once with @layerfs/runtime and set
LAYERFS_WORKER_ENDPOINT to <home>/worker/endpoint.json.
On Windows this process stays in the foreground; the worker ends when it exits.
`;
