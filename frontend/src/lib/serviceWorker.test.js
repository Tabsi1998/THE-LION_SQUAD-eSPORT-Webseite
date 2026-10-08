// @vitest-environment node
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, test, vi } from "vitest";

const source = readFileSync(new URL("../../public/service-worker.js", import.meta.url), "utf8");

function worker(fetchResult = vi.fn()) {
  const handlers = {};
  const cache = { match: vi.fn(), put: vi.fn(), keys: vi.fn(async () => []), addAll: vi.fn() };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ["tls-static-v1", "tls-static-build-new", "unrelated-cache"]),
    delete: vi.fn(async () => true),
  };
  const self = { location: { origin: "https://club.example" },
    addEventListener: (name, handler) => { handlers[name] = handler; },
    clients: { claim: vi.fn() }, skipWaiting: vi.fn(),
  };
  vm.runInNewContext(source.replace("__TLS_BUILD_ID__", "build-new"), { self, caches, fetch: fetchResult, URL, Response });
  return { handlers, cache, caches, fetchResult };
}

describe("production service worker", () => {
  test("never intercepts authentication API or non-GET requests", () => {
    const runtime = worker();
    for (const request of [
      { url: "https://club.example/api/auth/me", method: "GET", mode: "cors" },
      { url: "https://club.example/verify-email", method: "POST", mode: "navigate" },
    ]) {
      const respondWith = vi.fn();
      runtime.handlers.fetch({ request, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });
  test("verification navigation fetches fresh HTML without persisting token URLs", async () => {
    const runtime = worker(vi.fn(async () => new Response("fresh")));
    const request = { url: "https://club.example/verify-email?token=private", method: "GET", mode: "navigate" };
    let response;
    runtime.handlers.fetch({ request, respondWith: (result) => { response = result; } });
    expect(await (await response).text()).toBe("fresh");
    expect(runtime.fetchResult).toHaveBeenCalledWith(request, { cache: "no-store" });
    expect(runtime.caches.open).not.toHaveBeenCalled();
  });
  test("offline verification displays a connection error instead of stale application HTML", async () => {
    const runtime = worker(vi.fn(async () => { throw new Error("offline"); }));
    let response;
    runtime.handlers.fetch({ request: { url: "https://club.example/verify-email", method: "GET", mode: "navigate" }, respondWith: (result) => { response = result; } });
    expect((await response).status).toBe(503);
    expect(await (await response).text()).toContain("Keine Verbindung");
    expect(runtime.cache.match).not.toHaveBeenCalled();
  });
  test("offline on a member page shows the stored member card image with its date (#1256)", async () => {
    const stored = {
      "/__tls/member-card.json": new Response(JSON.stringify({ saved_at: "2026-10-07T16:05:00.000Z" })),
      "/__tls/member-card.png": new Response("png", { headers: { "Content-Type": "image/png" } }),
    };
    const runtime = worker(vi.fn(async () => { throw new Error("offline"); }));
    runtime.cache.match.mockImplementation(async (key) => stored[key]?.clone());
    let response;
    runtime.handlers.fetch({ request: { url: "https://club.example/members/membership", method: "GET", mode: "navigate" }, respondWith: (result) => { response = result; } });
    const html = await (await response).text();
    expect(html).toContain("Keine Verbindung");
    expect(html).toContain('src="/__tls/member-card.png"');
    expect(html).toContain("Stand: 7.10.2026");
    expect(runtime.caches.open).toHaveBeenCalledWith("tls-member-card");

    let image;
    runtime.handlers.fetch({ request: { url: "https://club.example/__tls/member-card.png", method: "GET", mode: "no-cors", destination: "image" }, respondWith: (result) => { image = result; } });
    expect(await (await image).text()).toBe("png");
  });
  test("offline without a stored card only explains the missing connection", async () => {
    const runtime = worker(vi.fn(async () => { throw new Error("offline"); }));
    runtime.cache.match.mockResolvedValue(undefined);
    let response;
    runtime.handlers.fetch({ request: { url: "https://club.example/members/area", method: "GET", mode: "navigate" }, respondWith: (result) => { response = result; } });
    const html = await (await response).text();
    expect(html).toContain("Keine Verbindung");
    expect(html).not.toContain("member-card.png");
  });
  test("activation deletes only obsolete TLS cache versions", async () => {
    const runtime = worker();
    let activation;
    runtime.handlers.activate({ waitUntil: (result) => { activation = result; } });
    await activation;
    expect(runtime.caches.delete.mock.calls).toEqual([["tls-static-v1"]]);
  });
});
