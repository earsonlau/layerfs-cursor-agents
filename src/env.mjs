import { SetupError } from "./errors.mjs";
import { shellSingle } from "./shell.mjs";

const NAME = /^LAYERFS_[A-Z0-9_]+$/;

/**
 * Shell source of LAYERFS_* assignments. Other names are refused.
 * @param {Record<string, string | undefined | null>} values
 */
export function renderEnv(values) {
  const lines = ["# Written by layerfs-cursor-setup. Source this file. Names are LAYERFS_* only."];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    if (!NAME.test(key)) {
      throw new SetupError(`refusing to write ${key}: settings use LAYERFS_* names only`, { step: "env" });
    }
    lines.push(`export ${key}=${shellSingle(value)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Settings for one route. Linux never receives a worker endpoint.
 * @param {"in-process" | "worker"} route
 * @param {Record<string, string | undefined | null>} values
 */
export function settingsForRoute(route, values) {
  const next = { ...values };
  if (route === "in-process") delete next.LAYERFS_WORKER_ENDPOINT;
  return next;
}

/**
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnv(text) {
  const found = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = /^export ([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) throw new SetupError(`env file has an unreadable line: ${line}`, { step: "env" });
    if (!NAME.test(match[1])) {
      throw new SetupError(`env file sets ${match[1]}, which is not a LAYERFS_* name`, { step: "env" });
    }
    found[match[1]] = unquote(match[2]);
  }
  return found;
}

function unquote(raw) {
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replaceAll("'\\''", "'");
  return raw;
}
