import { isAbsolute, join, resolve } from "node:path";
import { SetupError } from "./errors.mjs";
import { officialCli, shimPath } from "./shim.mjs";
import { workerEndpoint } from "./worker.mjs";

/**
 * @param {string} value
 * @param {string} cwd
 * @param {string} label
 */
export function absolutePath(value, cwd, label) {
  const resolved = resolve(cwd, value);
  if (!isAbsolute(resolved)) {
    throw new SetupError(`${label} must be an absolute path`, { step: "paths" });
  }
  return resolved;
}

/**
 * The steps install will run, in order. Pure: it does not touch the disk.
 * @param {{
 *   route: "in-process" | "worker",
 *   runtime: string,
 *   commit: string,
 *   layerfsRepo: string,
 *   home: string,
 *   prefix: string,
 *   buildNative: boolean,
 *   cursorProject: string | null,
 *   packageRoot: string,
 * }} input
 */
export function buildPlan(input) {
  const api = join(input.layerfsRepo, "api");
  const cli = join(input.layerfsRepo, "api", "agent", "cli");
  const steps = [
    { id: "checkout", detail: `${input.layerfsRepo} @ ${input.commit}` },
    { id: "npm-api", detail: api },
    { id: "npm-cli", detail: cli },
  ];
  if (input.buildNative) steps.push({ id: "build-native", detail: api });
  steps.push(
    { id: "link-packages", detail: "@layerfs/agent and @layerfs/runtime" },
    { id: "link-cli", detail: `${shimPath(input.prefix)} -> ${officialCli(input.layerfsRepo)}` },
    { id: "home", detail: input.home },
  );
  if (input.cursorProject) {
    steps.push({
      id: "skill",
      detail: `${join(input.packageRoot, ".cursor", "skills", "layerfs-agent")} -> ${join(input.cursorProject, ".cursor", "skills", "layerfs-agent")}`,
    });
  }
  if (input.route === "in-process") {
    steps.push({ id: "store-route", detail: "in-process Store calls; no worker" });
  } else {
    steps.push({
      id: "worker-start",
      detail: `${input.runtime} ${workerEndpoint(input.home)}`,
    });
  }
  steps.push({ id: "env-file", detail: "LAYERFS_* only" });
  return { route: input.route, runtime: input.runtime, steps };
}

export function formatPlan(plan) {
  return `${plan.steps.map((step) => `${step.id}\t${step.detail}`).join("\n")}\n`;
}
