import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url);

test("logo is a square svg under 64 KB and not the template mark", async () => {
  const bytes = await readFile(new URL("../logo.svg", import.meta.url));
  assert.ok(bytes.length < 64 * 1024);
  const text = bytes.toString("utf8");
  assert.match(text, /viewBox="0 0 64 64"/);
  assert.doesNotMatch(text, /stroke-dasharray/);
  assert.doesNotMatch(text, />logo</);
});

test("Cursor and agents skills match", async () => {
  const cursor = await filesUnder(fileURL(root, ".cursor/skills/layerfs-agent"));
  const agents = await filesUnder(fileURL(root, ".agents/skills/layerfs-agent"));
  assert.deepEqual(cursor, agents);
});

test("the skill teaches the Cursor workflow", async () => {
  const skill = await readFile(new URL("../.cursor/skills/layerfs-agent/SKILL.md", import.meta.url), "utf8");
  const refusals = await readFile(new URL("../.cursor/skills/layerfs-agent/references/refusals.md", import.meta.url), "utf8");
  for (const phrase of [
    "git worktree",
    "branch.fork",
    "fs.write",
    "fs.edit",
    "workspace.mount",
    "workspace.exec",
    "workspace.commit",
    "workspace.unmount",
    "LAYERFS_",
    "@layerfs/agent",
    "layerfs",
    "Cursor",
    "main",
    "NameTaken",
  ]) {
    assert.match(skill, new RegExp(phrase.replaceAll(".", "\\.")), phrase);
  }
  assert.match(skill, /does not install Claude Code/);
  assert.doesNotMatch(skill, /\.claude/);
  for (const code of ["Conflict", "Busy", "NoSuchSandbox"]) {
    assert.match(skill, new RegExp(code));
    assert.match(refusals, new RegExp(code));
  }
  assert.match(refusals, /Do not\s+send that call again/);
  assert.match(refusals, /containerGone/);
});

test("plugin source does not import LayerFS internals or backend", async () => {
  const files = await walk(fileURL(root, ""));
  const source = files.filter((file) => /\.(mjs|js)$/.test(file) && !file.includes(`${join("node_modules")}`));
  assert.ok(source.length > 0);
  for (const file of source) {
    const text = await readFile(file, "utf8");
    assert.doesNotMatch(text, /["']@layerfs\/agent\/internal["']/, file);
    assert.doesNotMatch(text, /["']@layerfs\/backend["']/, file);
  }
});

test("the example script parses", () => {
  const file = fileURL(root, "examples/task-branch.mjs");
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

function fileURL(base, path) {
  return new URL(path, base).pathname;
}

async function filesUnder(dir) {
  const found = [];
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name);
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const child of await filesUnder(path)) found.push(join(name, child));
    } else {
      found.push(`${name}\n${await readFile(path, "utf8")}`);
    }
  }
  return found;
}

async function walk(dir) {
  const found = [];
  for (const name of await readdir(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const path = join(dir, name);
    const info = await stat(path);
    if (info.isDirectory()) found.push(...await walk(path));
    else found.push(path);
  }
  return found;
}
