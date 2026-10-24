import { SetupError } from "./errors.mjs";

/**
 * Clone or fast-forward a checkout onto `commit`. One fetch and one checkout
 * at most. A dirty tree at the wrong commit is left untouched.
 *
 * @param {{
 *   dest: string,
 *   commit: string,
 *   url: string,
 *   run: (file: string, args: string[]) => Promise<{ stdout: string, stderr: string }>,
 *   stat: (path: string) => Promise<null | { kind: "file" | "dir", mode: number }>,
 * }} input
 */
export async function ensurePinnedCheckout(input) {
  const { dest, commit, url, run, stat } = input;
  const found = await stat(dest);
  if (found?.kind === "file") {
    throw new SetupError(`${dest} exists and is not a directory`, { step: "checkout" });
  }
  if (!found) {
    await run("git", ["clone", url, dest]);
    await run("git", ["-C", dest, "checkout", commit]);
    await assertHead(dest, commit, run);
    return { dest, commit, cloned: true };
  }
  let head;
  try {
    head = stdout(await run("git", ["-C", dest, "rev-parse", "HEAD"]));
  } catch (error) {
    throw new SetupError(`${dest} is not a git checkout: ${error.message}`, { step: "checkout", cause: error });
  }
  if (head === commit) return { dest, commit, cloned: false };
  const dirty = stdout(await run("git", ["-C", dest, "status", "--porcelain"]));
  if (dirty) {
    throw new SetupError(
      `LayerFS checkout ${dest} is ${head}, not ${commit}, and the worktree is not clean. No files were changed.`,
      { step: "checkout" },
    );
  }
  await run("git", ["-C", dest, "fetch", "origin", commit]);
  await run("git", ["-C", dest, "checkout", commit]);
  await assertHead(dest, commit, run);
  return { dest, commit, cloned: false };
}

async function assertHead(dest, commit, run) {
  const head = stdout(await run("git", ["-C", dest, "rev-parse", "HEAD"]));
  if (head !== commit) {
    throw new SetupError(`checkout ${dest} is ${head}, not ${commit}`, { step: "checkout" });
  }
}

function stdout(result) {
  return String(result.stdout ?? "").trim();
}
