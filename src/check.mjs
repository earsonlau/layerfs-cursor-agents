import { delimiter, join } from "node:path";
import { SetupError } from "./errors.mjs";
import { parseEnv } from "./env.mjs";
import { readPin } from "./pin.mjs";
import { officialCli } from "./shim.mjs";

/**
 * Verify a finished install. Does not clone, build, or start a worker.
 * @param {{
 *   pinFile: string,
 *   packageRoot: string,
 *   layerfsRepo: string,
 *   prefix: string,
 *   shimFile: string,
 *   envFile: string,
 *   route: "in-process" | "worker",
 *   nodeVersion: string,
 *   pathEnv: string,
 *   io: {
 *     stat: (path: string) => Promise<null | { kind: string, mode: number }>,
 *     readFile: (path: string) => Promise<string>,
 *     readlink: (path: string) => Promise<string | null>,
 *     run: (file: string, args: string[]) => Promise<{ stdout: string, stderr: string }>,
 *     log: (line: string) => void,
 *   },
 * }} input
 */
export async function checkInstall(input) {
  const major = Number(/^v?(\d+)/.exec(input.nodeVersion)?.[1]);
  if (!Number.isInteger(major) || major < 20) {
    throw new SetupError(`Node.js 20 or newer is required (found ${input.nodeVersion})`, { step: "check" });
  }
  const pin = await readPin(input.pinFile, input.io.readFile);
  const checkout = await input.io.stat(input.layerfsRepo);
  if (!checkout || checkout.kind !== "dir") {
    throw new SetupError(`LayerFS checkout is missing at ${input.layerfsRepo}`, { step: "check" });
  }
  const head = String((await input.io.run("git", ["-C", input.layerfsRepo, "rev-parse", "HEAD"])).stdout).trim();
  if (head !== pin.commit) {
    throw new SetupError(`LayerFS checkout ${input.layerfsRepo} is ${head}, not ${pin.commit}`, { step: "check" });
  }
  await expectLink(input.io, join(input.packageRoot, "node_modules", "@layerfs", "agent"), join(input.layerfsRepo, "api", "agent"));
  await expectLink(input.io, join(input.packageRoot, "node_modules", "@layerfs", "runtime"), join(input.layerfsRepo, "api", "runtime"));
  const cli = officialCli(input.layerfsRepo);
  const cliStat = await input.io.stat(cli);
  if (!cliStat || cliStat.kind !== "file") {
    throw new SetupError(`official layerfs command is missing at ${cli}`, { step: "check" });
  }
  const shimStat = await input.io.stat(input.shimFile);
  if (!shimStat || shimStat.kind !== "file") {
    throw new SetupError(`layerfs is not installed at ${input.shimFile}`, { step: "check" });
  }
  const shim = await input.io.readFile(input.shimFile);
  if (!shim.includes(cli)) {
    throw new SetupError(`${input.shimFile} does not run ${cli}`, { step: "check" });
  }
  const envStat = await input.io.stat(input.envFile);
  if (!envStat || envStat.kind !== "file") {
    throw new SetupError(`env file is missing at ${input.envFile}`, { step: "check" });
  }
  const env = parseEnv(await input.io.readFile(input.envFile));
  if (input.route === "in-process" && env.LAYERFS_WORKER_ENDPOINT) {
    throw new SetupError("Linux Store calls run in-process; LAYERFS_WORKER_ENDPOINT must be unset", { step: "check" });
  }
  if (input.route === "worker") {
    if (!env.LAYERFS_WORKER_ENDPOINT) {
      throw new SetupError("LAYERFS_WORKER_ENDPOINT is unset; the worker was not recorded", { step: "check" });
    }
    const endpoint = await input.io.stat(env.LAYERFS_WORKER_ENDPOINT);
    if (!endpoint || endpoint.kind !== "file") {
      throw new SetupError(`worker endpoint file is missing at ${env.LAYERFS_WORKER_ENDPOINT}`, { step: "check" });
    }
  }
  const pathDirs = input.pathEnv.split(delimiter);
  const onPath = pathDirs.includes(input.prefix);
  input.io.log(`pin ${pin.commit}`);
  input.io.log(`checkout ${input.layerfsRepo}`);
  input.io.log(`layerfs ${input.shimFile}`);
  input.io.log(`route ${input.route}`);
  if (!onPath) input.io.log(`PATH does not include ${input.prefix}; prepend it before calling layerfs`);
  return { pin, env, onPath };
}

async function expectLink(io, linkPath, target) {
  const current = await io.readlink(linkPath);
  if (current === null) throw new SetupError(`missing package link ${linkPath}`, { step: "check" });
  if (current !== target) throw new SetupError(`${linkPath} points at ${current}, not ${target}`, { step: "check" });
}
