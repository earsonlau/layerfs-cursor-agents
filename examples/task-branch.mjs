import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.env.LAYERFS_REPO;
const project = process.env.LAYERFS_PROJECT;
const branch = process.argv[2];
if (!repo || !project || !branch) {
  console.error("usage: LAYERFS_REPO=<checkout> LAYERFS_PROJECT=<name> node examples/task-branch.mjs <branch>");
  process.exit(2);
}

// Public package entry of the pinned checkout.
const { LayerFS, isRefusal } = await import(
  pathToFileURL(join(repo, "api", "agent", "sdk", "src", "index.js")).href
);

const layerfs = await LayerFS.open(project);
try {
  try {
    await layerfs.branch.fork(branch);
  } catch (error) {
    if (!isRefusal(error, "NameTaken")) throw error;
  }
  const written = await layerfs.fs.write(branch, "/.layerfs-cursor", `${branch}\n`, `note ${branch}`);
  console.log(JSON.stringify({ branch, kind: written.kind }));
} finally {
  await layerfs.close();
}
