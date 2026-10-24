/**
 * Where Store calls run for a Node `process.platform` value.
 * Linux is in-process. macOS and Windows use the LayerFS home worker.
 * @param {string} nodePlatform
 * @returns {{ node: string, runtime: "linux" | "macos" | "windows" | null, route: "in-process" | "worker" | "unsupported" }}
 */
export function runtimePlatform(nodePlatform) {
  if (nodePlatform === "linux") return { node: nodePlatform, runtime: "linux", route: "in-process" };
  if (nodePlatform === "darwin") return { node: nodePlatform, runtime: "macos", route: "worker" };
  if (nodePlatform === "win32") return { node: nodePlatform, runtime: "windows", route: "worker" };
  return { node: nodePlatform, runtime: null, route: "unsupported" };
}
