import assert from "node:assert/strict";
import { test } from "node:test";
import { SetupError } from "../src/errors.mjs";
import { install } from "../src/install.mjs";
import { workerEndpoint } from "../src/worker.mjs";
import { dir, file, memIo } from "./memio.mjs";

const PIN = "ad78914e36b258b360daf13aec164b5655814689";
const ROOT = "/plugin";
const REPO = "/layerfs-src";
const HOME = "/srv/layerfs-home";
const PREFIX = "/opt/bin";
const CLI = `${REPO}/api/agent/cli/src/layerfs.js`;

function baseFs(extra = {}) {
  return {
    [`${ROOT}/layerfs.json`]: file(JSON.stringify({ commit: PIN })),
    [REPO]: dir(),
    [CLI]: file("#!/usr/bin/env node\n"),
    ...extra,
  };
}

function options(io, argv, extras = {}) {
  return {
    argv: ["--layerfs", REPO, "--home", HOME, "--prefix", PREFIX, "--settings-file", `${ROOT}/layerfs.env`, ...argv],
    env: { PATH: "" },
    platform: "linux",
    cwd: "/work",
    homedir: "/Users/agent",
    packageRoot: ROOT,
    nodeVersion: "v22.0.0",
    io,
    ...extras,
  };
}

function scripted(io, { head = PIN, dirty = false, failNpm = false } = {}) {
  io.head = head;
  io.run = async (file, args) => {
    io.calls.push([file, ...args]);
    if (file === "npm" && failNpm) throw new SetupError("npm --prefix install failed (1): boom", { step: "npm" });
    if (file === "git" && args[0] === "clone") {
      io.fs.set(args[2], dir());
      io.head = "0".repeat(40);
      return { stdout: "", stderr: "" };
    }
    if (file === "git" && args.includes("rev-parse")) return { stdout: `${io.head}\n`, stderr: "" };
    if (file === "git" && args.includes("status")) return { stdout: dirty ? " M dirty\n" : "", stderr: "" };
    if (file === "git" && args.includes("checkout")) {
      io.head = args.at(-1);
      return { stdout: "", stderr: "" };
    }
    if (file === "git" && args.includes("fetch")) return { stdout: "", stderr: "" };
    if (file === "npm") return { stdout: "", stderr: "" };
    throw new SetupError(`unexpected ${file} ${args.join(" ")}`, { step: file });
  };
  return io;
}

test("linux install is in-process and does not start a worker", async () => {
  const io = scripted(memIo(baseFs()));
  let runtimeLoads = 0;
  const result = await install(options(io, [], {
    loadRuntime: async () => {
      runtimeLoads += 1;
      throw new Error("runtime loaded");
    },
  }));
  assert.equal(result.route, "in-process");
  assert.equal(result.hold, null);
  assert.equal(runtimeLoads, 0);
  assert.equal(io.calls.some((call) => call[0] === "git" && call[1] === "clone"), false);
  const env = io.fs.get(`${ROOT}/layerfs.env`).data;
  assert.match(env, new RegExp(`LAYERFS_HOME='${HOME}'`));
  assert.match(env, new RegExp(`LAYERFS_REPO='${REPO}'`));
  assert.doesNotMatch(env, /LAYERFS_WORKER_ENDPOINT/);
  assert.match(io.fs.get(`${PREFIX}/layerfs`).data, new RegExp(CLI.replaceAll("/", "\\/")));
  assert.equal(io.fs.get(HOME).mode, 0o700);
  assert.equal(io.fs.get(`${ROOT}/node_modules/@layerfs/agent`).data, `${REPO}/api/agent/sdk`);
  assert.equal(io.fs.get(`${ROOT}/node_modules/@layerfs/runtime`).data, `${REPO}/api/runtime`);
  const checked = await install(options(io, ["check"], { env: { PATH: PREFIX } }));
  assert.equal(checked.pin.commit, PIN);
  assert.equal(checked.onPath, true);
  assert.equal(io.calls.filter((call) => call[0] === "npm").length, 2);
});

test("a dirty checkout at the wrong commit is not modified", async () => {
  const io = scripted(memIo(baseFs({ [REPO]: dir() })), { head: "1".repeat(40), dirty: true });
  await assert.rejects(() => install(options(io, [])), /not clean/);
  assert.equal(io.calls.some((call) => call.includes("fetch")), false);
  assert.equal(io.calls.some((call) => call.includes("checkout")), false);
  assert.equal(io.fs.has(`${ROOT}/layerfs.env`), false);
});

test("linux stops on the first npm failure", async () => {
  const fs = baseFs();
  delete fs[REPO];
  const io = scripted(memIo(fs), { failNpm: true });
  await assert.rejects(() => install(options(io, [])), /npm --prefix install failed/);
  assert.equal(io.calls.filter((call) => call[0] === "npm").length, 1);
  assert.equal(io.fs.has(`${PREFIX}/layerfs`), false);
});

test("an existing home that is too open stops setup", async () => {
  const io = scripted(memIo(baseFs({ [HOME]: dir(0o755) })));
  await assert.rejects(() => install(options(io, [])), /0700/);
  assert.equal(io.fs.get(HOME).mode, 0o755);
});

test("dry-run prints the linux plan and runs nothing", async () => {
  const io = scripted(memIo(baseFs()));
  const result = await install(options(io, ["--dry-run", "--build-native"]));
  assert.equal(result.dryRun, true);
  assert.match(result.plan.steps.map((step) => step.id).join(" "), /store-route/);
  assert.equal(io.calls.length, 0);
  assert.match(io.logs.join("\n"), /build-native/);
});

test("macOS starts the worker once and records the endpoint", async () => {
  const io = scripted(memIo(baseFs()));
  const events = [];
  const result = await install(options(io, ["--image", "sha256:abc", "--bundle", "/bundle"], {
    platform: "darwin",
    loadRuntime: async () => ({
      LayerFSRuntime: {
        open: async (settings) => {
          events.push(["open", settings.platform, settings.sweep, settings.image]);
          return {
            worker: {
              start: async () => {
                events.push("start");
                await io.writeFile(workerEndpoint(HOME), "{\"port\":9}\n", 0o600);
              },
            },
            close: async () => {
              events.push("close");
            },
          };
        },
      },
    }),
  }));
  assert.deepEqual(events, [["open", "macos", false, "sha256:abc"], "start", "close"]);
  assert.equal(result.hold, null);
  assert.match(io.fs.get(`${ROOT}/layerfs.env`).data, /LAYERFS_WORKER_ENDPOINT='\/srv\/layerfs-home\/worker\/endpoint\.json'/);
  await install(options(io, ["check"], { platform: "darwin", env: { PATH: PREFIX } }));
  assert.equal(events.filter((event) => event === "start").length, 1);
});

test("a refused worker start is not repeated", async () => {
  const io = scripted(memIo(baseFs()));
  const events = [];
  await assert.rejects(() => install(options(io, [], {
    platform: "darwin",
    loadRuntime: async () => ({
      LayerFSRuntime: {
        open: async () => ({
          worker: {
            start: async () => {
              events.push("start");
              const error = new Error("InvalidInput: the macOS worker needs image and bundle");
              error.code = "InvalidInput";
              throw error;
            },
          },
          close: async () => {
            events.push("close");
          },
        }),
      },
    }),
  })), /needs image and bundle/);
  assert.deepEqual(events, ["start", "close"]);
  assert.equal(io.fs.has(`${ROOT}/layerfs.env`), false);
});

test("Windows keeps the runtime open so the worker stays up", async () => {
  const io = scripted(memIo(baseFs({ [HOME]: dir(0o755) })));
  const events = [];
  const result = await install(options(io, ["--bundle", "/bundle"], {
    platform: "win32",
    loadRuntime: async () => ({
      LayerFSRuntime: {
        open: async () => ({
          worker: {
            start: async () => {
              events.push("start");
              await io.writeFile(workerEndpoint(HOME), "{}\n", 0o600);
            },
          },
          close: async () => {
            events.push("close");
          },
        }),
      },
    }),
  }));
  assert.deepEqual(events, ["start"]);
  assert.equal(typeof result.hold.close, "function");
  await result.hold.close();
  assert.deepEqual(events, ["start", "close"]);
});

test("unsupported platforms stop before git", async () => {
  const io = scripted(memIo(baseFs()));
  await assert.rejects(() => install(options(io, [], { platform: "sunos" })), /not sunos/);
  assert.equal(io.calls.length, 0);
});
