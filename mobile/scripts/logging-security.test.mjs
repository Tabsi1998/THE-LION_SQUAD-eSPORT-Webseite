import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";


test("remote mobile logs never include local stack traces", async () => {
  const sourceUrl = new URL("../src/lib/mobileLog.ts", import.meta.url);
  const source = await readFile(sourceUrl, "utf8");

  assert.doesNotMatch(source, /error\.stack/);
  assert.doesNotMatch(source, /console\.(?:warn|error)\s*=/);
  assert.match(source, /if \(!clientLoggingEnabled\) return/);
});
