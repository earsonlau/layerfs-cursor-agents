import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const enabled = process.env.LAYERFS_CURSOR_E2E === "1";

test("docker workspace round trip", { skip: !enabled && "set LAYERFS_CURSOR_E2E=1 to run the Docker end-to-end test" }, async () => {
  const required = ["LAYERFS_REPO", "LAYERFS_HOME", "LAYERFS_STORE_PATH", "LAYERFS_IMAGE", "LAYERFS_VOLUME", "LAYERFS_DAEMON", "LAYERFS_PROJECT"];
  const missing = required.filter((name) => !process.env[name]);
  assert.equal(missing.length, 0, `missing ${missing.join(", ")}`);
  const repo = process.env.LAYERFS_REPO;
  const { LayerFS } = await import(pathToFileURL(join(repo, "api", "agent", "sdk", "src", "index.js")).href);
  const branch = `e2e-${Date.now().toString(36)}`;
  const layerfs = await LayerFS.open(process.env.LAYERFS_PROJECT);
  let sandbox;
  let ws;
  const dir = mkdtempSync(join(tmpdir(), "layerfs-cursor-e2e-"));
  try {
    await layerfs.branch.fork(branch);
    const created = await layerfs.sandbox.create();
    sandbox = created.sandbox;
    ws = await layerfs.workspace.mount(sandbox, branch);
    const run = await layerfs.workspace.exec(ws, "true", "step: true");
    assert.equal(run.exitCode, 0);
    const saved = await layerfs.workspace.commit(ws, "step: true");
    assert.ok(saved.kind === "Committed" || saved.kind === "UpToDate");
    writeFileSync(join(dir, "marker.txt"), saved.kind);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    let cleanup;
    if (ws) {
      const mounted = ws;
      ws = null;
      try {
        await layerfs.workspace.unmount(mounted);
      } catch (error) {
        cleanup = error;
      }
    }
    if (sandbox) {
      const id = sandbox;
      sandbox = null;
      try {
        await layerfs.sandbox.close(id);
      } catch (error) {
        cleanup ??= error;
      }
    }
    await layerfs.close();
    if (cleanup) throw cleanup;
  }
});
