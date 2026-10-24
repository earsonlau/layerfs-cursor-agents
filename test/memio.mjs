import { SetupError } from "../src/errors.mjs";

/** In-memory filesystem and command log for setup tests. */
export function memIo(entries = {}) {
  const fs = new Map();
  for (const [path, item] of Object.entries(entries)) fs.set(path, { ...item });
  const calls = [];
  const logs = [];
  return {
    calls,
    logs,
    fs,
    log(line) {
      logs.push(line);
    },
    async run(file, args) {
      calls.push([file, ...args]);
      return { stdout: "", stderr: "" };
    },
    async stat(path) {
      const item = fs.get(path);
      if (!item || item.kind === "link") return item ? { kind: "file", mode: item.mode ?? 0o755 } : null;
      return { kind: item.kind, mode: item.mode };
    },
    async mkdir(path, mode) {
      if (!fs.has(path)) fs.set(path, { kind: "dir", mode, data: "" });
    },
    async writeFile(path, data, mode) {
      fs.set(path, { kind: "file", mode, data: String(data) });
    },
    async readFile(path) {
      const item = fs.get(path);
      if (!item || item.kind !== "file") {
        const error = new Error(`ENOENT: ${path}`);
        error.code = "ENOENT";
        throw error;
      }
      return item.data;
    },
    async chmod(path, mode) {
      const item = fs.get(path);
      if (!item) throw new SetupError(`chmod missing ${path}`, { step: "chmod" });
      item.mode = mode;
    },
    async cp(source, dest) {
      calls.push(["cp", source, dest]);
      fs.set(dest, { kind: "dir", mode: 0o755, data: source });
    },
    async readlink(path) {
      const item = fs.get(path);
      if (!item) return null;
      if (item.kind !== "link") throw new SetupError(`${path} is not a symlink`, { step: "link-packages" });
      return item.data;
    },
    async symlink(target, path) {
      fs.set(path, { kind: "link", mode: 0o777, data: target });
    },
  };
}

export function file(data, mode = 0o644) {
  return { kind: "file", mode, data };
}

export function dir(mode = 0o755) {
  return { kind: "dir", mode, data: "" };
}
