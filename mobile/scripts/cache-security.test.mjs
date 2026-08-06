import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCacheKey,
  clearAllCache,
  getStaleCache,
  setCached,
} from "../src/lib/cache.ts";


test("cache keys isolate accounts and include canonical query parameters", () => {
  const first = buildCacheKey("/mobile/dashboard", { page: 1, filter: "open" }, "user:first");
  const reordered = buildCacheKey("/mobile/dashboard", { filter: "open", page: 1 }, "user:first");
  const second = buildCacheKey("/mobile/dashboard", { page: 1, filter: "open" }, "user:second");

  assert.equal(first, reordered);
  assert.notEqual(first, second);
});


test("clearing a session removes every cached account response", async () => {
  const url = "/mobile/profile";
  const first = buildCacheKey(url, undefined, "user:first");
  const second = buildCacheKey(url, undefined, "user:second");
  await setCached(first, url, { owner: "first" });
  await setCached(second, url, { owner: "second" });

  assert.deepEqual(await getStaleCache(first, url), { owner: "first" });
  assert.deepEqual(await getStaleCache(second, url), { owner: "second" });

  await clearAllCache();
  assert.equal(await getStaleCache(first, url), null);
  assert.equal(await getStaleCache(second, url), null);
});
