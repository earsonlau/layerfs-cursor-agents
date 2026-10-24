import { readFile } from "node:fs/promises";
import { SetupError } from "./errors.mjs";

export const LAYERFS_GIT_URL = "https://github.com/Ephemeral-AI-Lab/layerfs.git";

/**
 * @param {string} text
 * @param {string} [file]
 */
export function parsePin(text, file = "layerfs.json") {
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new SetupError(`${file} is not JSON: ${error.message}`, { step: "pin", cause: error });
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new SetupError(`${file} must be an object with a commit`, { step: "pin" });
  }
  const commit = json.commit;
  if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new SetupError(`${file} commit must be a 40-character lowercase SHA`, { step: "pin" });
  }
  return { commit };
}

/**
 * @param {string} file
 * @param {(file: string) => Promise<string>} [read]
 */
export async function readPin(file, read = async (path) => readFile(path, "utf8")) {
  let text;
  try {
    text = await read(file);
  } catch (error) {
    throw new SetupError(`cannot read ${file}: ${error.message}`, { step: "pin", cause: error });
  }
  return parsePin(text, file);
}
