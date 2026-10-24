#!/usr/bin/env node
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { install } from "../src/install.mjs";
import { realIo } from "../src/io.mjs";

const io = realIo();
let result;
try {
  result = await install({
    argv: process.argv.slice(2),
    env: process.env,
    platform: process.platform,
    cwd: process.cwd(),
    homedir: homedir(),
    packageRoot: fileURLToPath(new URL("..", import.meta.url)),
    io,
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (result?.hold) await holdUntilSignal(result.hold);

/** One interrupt drains the Windows worker. A second interrupt is not a restart. */
async function holdUntilSignal(hold) {
  await new Promise((resolve, reject) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      hold.close().then(resolve, reject);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
