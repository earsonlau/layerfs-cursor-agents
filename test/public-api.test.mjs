import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const repo = process.env.LAYERFS_REPO;
const pin = "9f97a7ec95b662e9cb288704afa165feff132cfa";

test("public SDK over the stand-in binding, one mount attempt", { skip: !repo && "LAYERFS_REPO is unset" }, () => {
  const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" });
  assert.equal(head.status, 0, head.stderr);
  assert.equal(head.stdout.trim(), pin);

  const fake = join(repo, "api/agent/sdk/test/fixture/fake-native.cjs");
  const sdk = join(repo, "api/agent/sdk/src/index.js");
  const dir = mkdtempSync(join(tmpdir(), "layerfs-cursor-"));
  try {
    const workflow = join(dir, "workflow.mjs");
    const log = join(dir, "calls.log");
    writeFileSync(workflow, `
      import { writeFileSync } from "node:fs";
      const { LayerFS, isRefusal } = await import(${JSON.stringify(pathToFileURL(sdk))});
      const layerfs = await LayerFS.open("website");
      try {
        const forked = await layerfs.branch.fork("task");
        const written = await layerfs.fs.write("task", "/note.txt", "hello\\n", "add note");
        const created = await layerfs.sandbox.create();
        const ws = await layerfs.workspace.mount(created.sandbox, "task");
        const run = await layerfs.workspace.exec(ws, "exit 0", "bash");
        const saved = await layerfs.workspace.commit(ws, "step: exit 0");
        await layerfs.workspace.unmount(ws);
        writeFileSync(${JSON.stringify(join(dir, "ok.json"))}, JSON.stringify({
          forked: forked.kind, written: written.kind, sandbox: created.sandbox,
          path: ws.path, exitCode: run.exitCode, saved: saved.kind,
        }));
      } finally {
        await layerfs.close();
      }
    `);
    const ok = spawnSync(process.execPath, [workflow], { encoding: "utf8", env: sdkEnv(fake) });
    assert.equal(ok.status, 0, ok.stderr || ok.stdout);
    const body = JSON.parse(readFileSync(join(dir, "ok.json"), "utf8"));
    assert.equal(body.forked, "Forked");
    assert.equal(body.written, "Committed");
    assert.equal(body.exitCode, 0);
    assert.equal(body.saved, "Committed");
    assert.equal(body.path, "/workspaces/w1");

    const once = join(dir, "once.mjs");
    writeFileSync(once, `
      const { LayerFS, isRefusal } = await import(${JSON.stringify(pathToFileURL(sdk))});
      const layerfs = await LayerFS.open("website");
      try {
        let refusals = 0;
        try {
          await layerfs.workspace.mount("1", "task");
        } catch (error) {
          if (!isRefusal(error, "NoSuchSandbox")) throw error;
          refusals += 1;
        }
        if (refusals !== 1) throw new Error("expected one refusal");
      } finally {
        await layerfs.close();
      }
    `);
    const refused = spawnSync(process.execPath, [once], {
      encoding: "utf8",
      env: { ...sdkEnv(fake), CLI_FAKE_LOG: log, CLI_FAKE_REFUSE: "workspace.mount", CLI_FAKE_CODE: "NoSuchSandbox" },
    });
    assert.equal(refused.status, 0, refused.stderr || refused.stdout);
    const mounts = readFileSync(log, "utf8").split("\n").filter((line) => line.includes('"workspace.mount"'));
    assert.equal(mounts.length, 1);

    const help = spawnSync(process.execPath, [join(repo, "api/agent/cli/src/layerfs.js"), "help"], { encoding: "utf8" });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /branch fork/);

    const example = spawnSync(process.execPath, [new URL("../examples/task-branch.mjs", import.meta.url).pathname, "task"], {
      encoding: "utf8",
      env: { ...sdkEnv(fake), LAYERFS_REPO: repo, LAYERFS_PROJECT: "website" },
    });
    assert.equal(example.status, 0, example.stderr || example.stdout);
    assert.match(example.stdout, /"kind":"Committed"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sdkEnv(fake) {
  return {
    ...process.env,
    LAYERFS_NATIVE: fake,
    LAYERFS_HOME: "/tmp/layerfs-cursor-home",
    LAYERFS_STORE_PATH: "/tmp/layerfs-cursor-store.sqlite",
    LAYERFS_DOCKER: "/tmp/docker.sock",
    LAYERFS_IMAGE: "sha256:fake",
    LAYERFS_VOLUME: "layerfs-cursor-test",
    LAYERFS_DAEMON: "/tmp/layerfs-daemon",
  };
}

function pathToFileURL(file) {
  return `file://${file}`;
}
