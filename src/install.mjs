import { delimiter, join } from "node:path";
import { HELP, parseArgs } from "./args.mjs";
import { checkInstall } from "./check.mjs";
import { ensurePinnedCheckout } from "./checkout.mjs";
import { renderEnv, settingsForRoute } from "./env.mjs";
import { SetupError } from "./errors.mjs";
import { LAYERFS_GIT_URL, readPin } from "./pin.mjs";
import { absolutePath, buildPlan, formatPlan } from "./plan.mjs";
import { runtimePlatform } from "./platform.mjs";
import { officialCli, shimPath, shimSource } from "./shim.mjs";
import { loadRuntimeFromCheckout, startWorkerOnce, workerEndpoint } from "./worker.mjs";

/**
 * Install or check LayerFS for Cursor. One attempt per external command.
 * `io` performs every side effect so tests can substitute a fake.
 *
 * @param {{
 *   argv?: string[],
 *   env: NodeJS.ProcessEnv,
 *   platform: string,
 *   cwd: string,
 *   homedir: string,
 *   packageRoot: string,
 *   nodeVersion?: string,
 *   loadRuntime?: (layerfsRepo: string) => Promise<{ LayerFSRuntime: { open: Function } }>,
 *   io: object,
 * }} options
 */
export async function install(options) {
  const io = options.io;
  const parsed = parseArgs(options.argv ?? []);
  if (parsed.help) {
    io.log(HELP.trimEnd());
    return { help: true };
  }
  const platform = runtimePlatform(options.platform);
  if (platform.route === "unsupported") {
    throw new SetupError(`LayerFS runs on Linux, macOS, and Windows, not ${options.platform}`, { step: "platform" });
  }

  const cwd = options.cwd;
  const root = options.packageRoot;
  const pinFile = join(root, "layerfs.json");
  const pin = await readPin(pinFile, (file) => io.readFile(file));
  const layerfsRepo = absolutePath(
    parsed.values.layerfs ?? options.env.LAYERFS_REPO ?? join(root, "..", "layerfs"),
    cwd,
    "--layerfs",
  );
  const home = absolutePath(
    parsed.values.home ?? options.env.LAYERFS_HOME ?? join(options.homedir, ".local", "share", "layerfs-cursor-agents", "home"),
    cwd,
    "--home",
  );
  const prefix = absolutePath(parsed.values.prefix ?? join(options.homedir, ".local", "bin"), cwd, "--prefix");
  const envFile = absolutePath(parsed.values["settings-file"] ?? join(root, "layerfs.env"), cwd, "--settings-file");
  const cursorProject = parsed.values["cursor-project"]
    ? absolutePath(parsed.values["cursor-project"], cwd, "--cursor-project")
    : null;
  const shimFile = shimPath(prefix);
  const paths = { pinFile, packageRoot: root, layerfsRepo, home, prefix, envFile, shimFile, cursorProject };

  if (parsed.command === "check") {
    return checkInstall({
      ...paths,
      route: platform.route,
      nodeVersion: options.nodeVersion ?? process.version,
      pathEnv: options.env.PATH ?? "",
      io,
    });
  }

  // The native addon is the Linux in-process Store path. macOS and Windows
  // use the worker. build-native.mjs throws on win32, and macOS does not
  // need a Rust toolchain for the worker route.
  const buildNative = parsed.buildNative && platform.route === "in-process";
  if (parsed.buildNative && !buildNative) {
    io.log("--build-native applies on Linux only; macOS and Windows use the worker and skip the native build");
  }

  const plan = buildPlan({
    route: platform.route,
    runtime: platform.runtime,
    commit: pin.commit,
    layerfsRepo,
    home,
    prefix,
    buildNative,
    cursorProject,
    packageRoot: root,
  });
  if (parsed.dryRun) {
    io.log(formatPlan(plan).trimEnd());
    return { dryRun: true, plan, commit: pin.commit, ...paths, route: platform.route };
  }

  await ensurePinnedCheckout({
    dest: layerfsRepo,
    commit: pin.commit,
    url: LAYERFS_GIT_URL,
    run: io.run,
    stat: io.stat,
  });
  await io.run("npm", ["--prefix", join(layerfsRepo, "api"), "install", "--no-audit", "--no-fund"]);
  await io.run("npm", ["--prefix", join(layerfsRepo, "api", "agent", "cli"), "install", "--no-audit", "--no-fund"]);
  if (buildNative) {
    await io.run("npm", ["--prefix", join(layerfsRepo, "api"), "run", "build:native"]);
  }

  await linkPackages(root, layerfsRepo, io);

  const cli = officialCli(layerfsRepo);
  const cliStat = await io.stat(cli);
  if (!cliStat || cliStat.kind !== "file") {
    throw new SetupError(`official layerfs command is missing at ${cli}`, { step: "link-cli" });
  }
  await io.mkdir(prefix, 0o755);
  await io.writeFile(shimFile, shimSource(cli), 0o755);
  await io.chmod(shimFile, 0o755);

  await ensureHome(home, options.platform, io);

  if (cursorProject) {
    const source = join(root, ".cursor", "skills", "layerfs-agent");
    const dest = join(cursorProject, ".cursor", "skills", "layerfs-agent");
    if (source !== dest) {
      await io.mkdir(join(cursorProject, ".cursor", "skills"), 0o755);
      await io.cp(source, dest);
    }
  }

  const picked = (flag, envName) => parsed.values[flag] ?? options.env[envName];
  let endpoint;
  let hold = null;
  try {
    if (platform.route === "worker") {
      const started = await startWorkerOnce({
        runtimePlatform: platform.runtime,
        home,
        image: picked("image", "LAYERFS_IMAGE"),
        daemon: picked("daemon", "LAYERFS_DAEMON"),
        bundle: picked("bundle", "LAYERFS_BUNDLE"),
        docker: picked("docker", "LAYERFS_DOCKER"),
        containerPrefix: picked("container-prefix", "LAYERFS_CONTAINER_PREFIX"),
        loadRuntime: () => (options.loadRuntime ?? loadRuntimeFromCheckout)(layerfsRepo),
      });
      endpoint = started.endpoint;
      hold = started.hold;
    }

    const native = join(layerfsRepo, "api", "binding", "layerfs.node");
    const nativeStat = await io.stat(native);
    const body = renderEnv(settingsForRoute(platform.route, {
      LAYERFS_HOME: home,
      LAYERFS_REPO: layerfsRepo,
      LAYERFS_PROJECT: picked("project", "LAYERFS_PROJECT"),
      LAYERFS_STORE_PATH: picked("store-path", "LAYERFS_STORE_PATH"),
      LAYERFS_DOCKER: picked("docker", "LAYERFS_DOCKER"),
      LAYERFS_IMAGE: picked("image", "LAYERFS_IMAGE"),
      LAYERFS_VOLUME: picked("volume", "LAYERFS_VOLUME"),
      LAYERFS_DAEMON: picked("daemon", "LAYERFS_DAEMON"),
      LAYERFS_NATIVE: nativeStat?.kind === "file" ? native : undefined,
      LAYERFS_CONTAINER_PREFIX: picked("container-prefix", "LAYERFS_CONTAINER_PREFIX"),
      LAYERFS_WORKER_ENDPOINT: endpoint,
    }));
    await io.writeFile(envFile, body, 0o600);
    await io.chmod(envFile, 0o600);
  } catch (error) {
    if (hold) await closeHold(hold, error);
    throw error;
  }

  io.log(`pinned ${pin.commit}`);
  io.log(`checkout ${layerfsRepo}`);
  io.log(`layerfs ${shimFile}`);
  io.log(`env ${envFile}`);
  io.log(`route ${platform.route}`);
  if (platform.route === "in-process") {
    io.log("Store calls run in this process. Set LAYERFS_STORE_PATH to the installed Store file before fs, branch, or project calls.");
  } else {
    io.log(`worker ${endpoint ?? workerEndpoint(home)}`);
  }
  if (hold) io.log("Windows worker is running in this process. Leave it running. Interrupt once to drain and stop.");
  if (!(options.env.PATH ?? "").split(delimiter).includes(prefix)) {
    io.log(`PATH does not include ${prefix}; prepend it before calling layerfs`);
  }
  return { commit: pin.commit, plan, envFile, shimFile, layerfsRepo, home, hold, route: platform.route };
}

async function linkPackages(packageRoot, layerfsRepo, io) {
  const scope = join(packageRoot, "node_modules", "@layerfs");
  await io.mkdir(scope, 0o755);
  await ensureLink(io, join(layerfsRepo, "api", "agent", "sdk"), join(scope, "agent"));
  await ensureLink(io, join(layerfsRepo, "api", "runtime"), join(scope, "runtime"));
}

async function ensureLink(io, target, linkPath) {
  const current = await io.readlink(linkPath);
  if (current === null) {
    await io.symlink(target, linkPath);
    return;
  }
  if (current !== target) {
    throw new SetupError(`${linkPath} points at ${current}, not ${target}. Nothing was replaced.`, { step: "link-packages" });
  }
}

async function ensureHome(home, nodePlatform, io) {
  const found = await io.stat(home);
  if (!found) {
    await io.mkdir(home, 0o700);
    await io.chmod(home, 0o700);
    return;
  }
  if (found.kind !== "dir") throw new SetupError(`LAYERFS_HOME ${home} is not a directory`, { step: "home" });
  if (nodePlatform !== "win32" && (found.mode & 0o077) !== 0) {
    throw new SetupError(
      `LAYERFS_HOME ${home} mode ${found.mode.toString(8)} allows group or other access. Set it to 0700 yourself. Nothing was changed.`,
      { step: "home" },
    );
  }
}

async function closeHold(hold, original) {
  try {
    await hold.close();
  } catch (error) {
    original.message = `${original.message}\nclosing the runtime also failed: ${error.message}`;
  }
}
