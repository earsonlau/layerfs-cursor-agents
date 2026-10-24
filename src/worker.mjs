import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SetupError } from "./errors.mjs";

/** `<LAYERFS_HOME>/worker/endpoint.json`, the file @layerfs/runtime writes. */
export function workerEndpoint(home) {
  return join(home, "worker", "endpoint.json");
}

/**
 * Public entry of @layerfs/runtime in a pinned checkout.
 * The plugin does not import @layerfs/agent/internal.
 * @param {string} layerfsRepo
 */
export async function loadRuntimeFromCheckout(layerfsRepo) {
  const href = pathToFileURL(join(layerfsRepo, "api", "runtime", "src", "index.js")).href;
  return import(href);
}

/**
 * Start the home worker once.
 * Linux must not call this. macOS closes the runtime after start (the container
 * keeps running). Windows returns the open runtime; closing it ends the worker.
 *
 * @param {{
 *   runtimePlatform: "macos" | "windows",
 *   home: string,
 *   image?: string,
 *   daemon?: string,
 *   bundle?: string,
 *   docker?: string,
 *   containerPrefix?: string,
 *   loadRuntime: () => Promise<{ LayerFSRuntime: { open: (settings: object) => Promise<Runtime> } }>,
 * }} input
 * @typedef {{ worker: { start: () => Promise<unknown> }, close: () => Promise<void> }} Runtime
 */
export async function startWorkerOnce(input) {
  if (input.runtimePlatform !== "macos" && input.runtimePlatform !== "windows") {
    throw new SetupError("the worker starts on macOS and Windows only; Linux runs Store calls in-process", { step: "worker" });
  }
  const { LayerFSRuntime } = await input.loadRuntime();
  const settings = {
    home: input.home,
    sweep: false,
    platform: input.runtimePlatform,
  };
  if (input.image) settings.image = input.image;
  if (input.daemon) settings.daemon = input.daemon;
  if (input.bundle) settings.bundle = input.bundle;
  if (input.docker) settings.docker = input.docker;
  if (input.containerPrefix) settings.containerPrefix = input.containerPrefix;

  const runtime = await LayerFSRuntime.open(settings);
  try {
    await runtime.worker.start();
  } catch (error) {
    await closeOnce(runtime, error);
    throw error;
  }
  const endpoint = workerEndpoint(input.home);
  if (input.runtimePlatform === "windows") return { endpoint, hold: runtime };
  await runtime.close();
  return { endpoint, hold: null };
}

async function closeOnce(runtime, original) {
  try {
    await runtime.close();
  } catch (error) {
    original.message = `${original.message}\nclosing the runtime also failed: ${error.message}`;
  }
}
