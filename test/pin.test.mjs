import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parsePin, readPin } from "../src/pin.mjs";

const PIN = "4b5276216a2e9f780194a554ef9f0c33f9b6ba6d";

test("layerfs.json pins LayerFS v1.1.0", async () => {
  const pin = await readPin(new URL("../layerfs.json", import.meta.url));
  assert.deepEqual(pin, { commit: PIN });
  const raw = JSON.parse(await readFile(new URL("../layerfs.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(raw), ["commit"]);
});

test("parsePin rejects a short commit and extra shapes", () => {
  assert.throws(() => parsePin("{}"), /40-character/);
  assert.throws(() => parsePin("[]"), /object/);
  assert.equal(parsePin(JSON.stringify({ commit: PIN, note: "ignored" })).commit, PIN);
});
