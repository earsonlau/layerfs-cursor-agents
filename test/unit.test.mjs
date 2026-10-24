import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { HELP, parseArgs } from "../src/args.mjs";
import { runtimePlatform } from "../src/platform.mjs";
import { renderEnv, settingsForRoute, parseEnv } from "../src/env.mjs";
import { refusalPlan } from "../src/refusals.mjs";
import { shimSource } from "../src/shim.mjs";
import { buildPlan, formatPlan } from "../src/plan.mjs";

test("package.json is the Cursor plugin", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, "layerfs-cursor-agents");
  assert.equal(pkg.version, "0.1.0");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.engines.node, ">=20");
  assert.equal(pkg.bin["layerfs-cursor-setup"], "./bin/layerfs-cursor-setup.js");
});

test("platforms route Store calls", () => {
  assert.deepEqual(runtimePlatform("linux"), { node: "linux", runtime: "linux", route: "in-process" });
  assert.equal(runtimePlatform("darwin").route, "worker");
  assert.equal(runtimePlatform("darwin").runtime, "macos");
  assert.equal(runtimePlatform("win32").runtime, "windows");
  assert.equal(runtimePlatform("sunos").route, "unsupported");
});

test("env file is LAYERFS_* only and Linux drops the worker endpoint", () => {
  const body = renderEnv(settingsForRoute("in-process", {
    LAYERFS_HOME: "/h",
    LAYERFS_REPO: "/r",
    LAYERFS_WORKER_ENDPOINT: "/should/not/appear",
    LAYERFS_PROJECT: "",
  }));
  assert.match(body, /export LAYERFS_HOME='\/h'/);
  assert.doesNotMatch(body, /LAYERFS_WORKER_ENDPOINT/);
  assert.deepEqual(parseEnv(body), { LAYERFS_HOME: "/h", LAYERFS_REPO: "/r" });
  const quoted = renderEnv({ LAYERFS_HOME: "/tmp/it's" });
  assert.equal(parseEnv(quoted).LAYERFS_HOME, "/tmp/it's");
  assert.throws(() => renderEnv({ PATH: "/bin" }), /LAYERFS_\*/);
});

test("worker env keeps the endpoint", () => {
  const values = settingsForRoute("worker", { LAYERFS_HOME: "/h", LAYERFS_WORKER_ENDPOINT: "/h/worker/endpoint.json" });
  assert.equal(values.LAYERFS_WORKER_ENDPOINT, "/h/worker/endpoint.json");
});

test("refusals are one handling and never a replay", () => {
  for (const code of ["Conflict", "Busy", "NoSuchSandbox", "HeadMoved", "Unknown", "Failed", "NoSuchPath"]) {
    const plan = refusalPlan({ code, message: "m", detail: null });
    assert.equal(plan.retry, false);
    assert.equal(plan.replay, false);
    assert.equal(plan.code, code);
  }
  const gone = refusalPlan({ code: "NoSuchSandbox", detail: { containerGone: true } });
  assert.equal(gone.action, "stop");
  const closed = refusalPlan({ code: "NoSuchSandbox", detail: {} });
  assert.equal(closed.action, "create-once");
  assert.match(closed.steps.join(" "), /sandbox.create/);
  assert.match(refusalPlan({ code: "Busy" }).steps.join(" "), /Do not call it again/);
  assert.match(refusalPlan({ code: "Conflict" }).steps.join(" "), /Do not send the refused call again/);
});

test("the shim runs the official command and nothing else", () => {
  const source = shimSource("/opt/layerfs/api/agent/cli/src/layerfs.js");
  assert.match(source, /\/opt\/layerfs\/api\/agent\/cli\/src\/layerfs\.js/);
  assert.doesNotMatch(source, /@layerfs\/agent\/internal/);
  assert.doesNotMatch(source, /retry/);
});

test("the plan is in-process on Linux and one worker start elsewhere", () => {
  const input = {
    route: "in-process",
    runtime: "linux",
    commit: "abc",
    layerfsRepo: "/repo",
    home: "/home",
    prefix: "/bin",
    buildNative: false,
    cursorProject: null,
    packageRoot: "/plugin",
  };
  const linux = buildPlan(input);
  const text = formatPlan(linux);
  assert.match(text, /store-route/);
  assert.doesNotMatch(text, /worker-start/);
  const linuxNative = buildPlan({ ...input, buildNative: true });
  assert.match(formatPlan(linuxNative), /build-native/);
  const mac = buildPlan({ ...input, route: "worker", runtime: "macos", buildNative: false, cursorProject: "/proj" });
  const macText = formatPlan(mac);
  assert.equal(mac.steps.filter((step) => step.id === "worker-start").length, 1);
  assert.doesNotMatch(macText, /build-native/);
  assert.match(macText, /endpoint\.json/);
});

test("args reject unknowns and missing values", () => {
  assert.equal(parseArgs(["--dry-run"]).dryRun, true);
  assert.equal(parseArgs(["check"]).command, "check");
  assert.equal(parseArgs(["--build-native"]).buildNative, true);
  assert.throws(() => parseArgs(["--nope"]), /unknown option/);
  assert.throws(() => parseArgs(["--home"]), /needs a value/);
  assert.throws(() => parseArgs(["--home", "/a", "--home", "/b"]), /twice/);
  assert.match(HELP, /Ignored on macOS and Windows/);
});
