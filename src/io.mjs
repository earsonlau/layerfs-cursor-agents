import { execFile } from "node:child_process";
import { chmod, cp, mkdir, readFile, readlink, stat, symlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { SetupError } from "./errors.mjs";

const execFileAsync = promisify(execFile);

/** Filesystem and process helpers used by install. Tests replace these. */
export function realIo() {
  return {
    log(line) {
      console.log(line);
    },
    async run(file, args) {
      try {
        const result = await execFileAsync(file, args, {
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
        });
        return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
      } catch (error) {
        const stderr = String(error.stderr ?? "");
        const stdout = String(error.stdout ?? "");
        const status = error.code ?? error.status ?? "?";
        throw new SetupError(
          `${file} ${args.join(" ")} failed (${status}): ${stderr || stdout || error.message}`,
          { step: file, cause: error },
        );
      }
    },
    async stat(path) {
      try {
        const info = await stat(path);
        return { kind: info.isDirectory() ? "dir" : "file", mode: info.mode & 0o777 };
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw new SetupError(`cannot stat ${path}: ${error.message}`, { step: "stat", cause: error });
      }
    },
    async mkdir(path, mode) {
      await mkdir(path, { recursive: true, mode });
    },
    async writeFile(path, data, mode) {
      await writeFile(path, data, { mode });
    },
    async readFile(path) {
      return readFile(path, "utf8");
    },
    async chmod(path, mode) {
      await chmod(path, mode);
    },
    async cp(source, dest) {
      await cp(source, dest, { recursive: true, force: true });
    },
    async readlink(path) {
      try {
        return await readlink(path);
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw new SetupError(`${path} is not a symlink: ${error.message}`, { step: "link-packages", cause: error });
      }
    },
    async symlink(target, path) {
      await symlink(target, path);
    },
  };
}
