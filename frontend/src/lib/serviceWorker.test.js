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

// Browser-Benachrichtigungen (#1163): anzeigen, Tipp öffnet die richtige Seite - nur auf dieser Website, nie als HTML.
function pushWorker({ windows = [], maxActions = 2 } = {}) {
  const handlers = {};
  const shown = [];
  const clients = {
    matchAll: vi.fn(async () => windows),
    openWindow: vi.fn(async (url) => ({ url })),
    claim: vi.fn(),
  };
  const self = {
    location: { origin: "https://club.example" },
    addEventListener: (name, handler) => { handlers[name] = handler; },
    clients,
    skipWaiting: vi.fn(),
    Notification: { maxActions },
    registration: { showNotification: vi.fn(async (title, options) => { shown.push({ title, options }); }) },
  };
  vm.runInNewContext(source.replace("__TLS_BUILD_ID__", "build-new"), { self, caches: {}, clients, fetch: vi.fn(), URL, Response });
  const push = async (data) => {
    let waiting;
    handlers.push({ data: data === undefined ? null : { json: () => (typeof data === "string" ? JSON.parse(data) : data) }, waitUntil: (p) => { waiting = p; } });
    await waiting;
    return shown.at(-1);
  };
  const click = async (notification, action = "") => {
    let waiting;
    const close = vi.fn();
    handlers.notificationclick({ action, notification: { ...notification, close }, waitUntil: (p) => { waiting = p; } });
    await waiting;
    return close;
  };
  return { push, click, clients, shown };
}

describe("Browser-Benachrichtigungen im Service Worker (#1163)", () => {
  test("zeigt Titel, Text, Symbol und merkt sich das Ziel", async () => {
    const runtime = pushWorker();
    const shown = await runtime.push({ title: "Check-in offen", body: "Bis 18:00", url: "/tournaments/cup", tag: "n1",
      actions: [{ action: "checkin", title: "Jetzt einchecken", url: "/tournaments/cup#checkin" }] });
    expect(shown.title).toBe("Check-in offen");
    expect(shown.options.body).toBe("Bis 18:00");
    expect(shown.options.icon).toBe("/assets/brand/tls-favicon.png");
    expect(shown.options.tag).toBe("n1");
    expect(shown.options.data.url).toBe("/tournaments/cup");
    expect(shown.options.actions).toEqual([{ action: "checkin", title: "Jetzt einchecken" }]);
    expect(shown.options.data.actions.checkin).toBe("/tournaments/cup#checkin");
  });

  test("fremde Ziele werden zum Postfach, Text bleibt Text", async () => {
    const runtime = pushWorker();
    const shown = await runtime.push({ title: "<img src=x onerror=alert(1)>", url: "https://evil.example/x",
      actions: [{ action: "go", title: "Los", url: "javascript:alert(1)" }] });
    expect(shown.title).toBe("<img src=x onerror=alert(1)>");
    expect(shown.options.data.url).toBe("/notifications");
    expect(shown.options.data.actions.go).toBe("/notifications");
  });

  test("ohne lesbaren Inhalt kommt eine schlichte Meldung, ohne Knopf-Unterstützung keine Knöpfe", async () => {
    const empty = await pushWorker().push(undefined);
    expect(empty.title).toBe("THE LION SQUAD");
    expect(empty.options.data.url).toBe("/notifications");
    const broken = await pushWorker().push("{kaputt");
    expect(broken.title).toBe("THE LION SQUAD");
    const noButtons = await pushWorker({ maxActions: 0 }).push({ title: "x", url: "/a", actions: [{ action: "a", title: "A", url: "/a" }] });
    expect(noButtons.options.actions).toBeUndefined();
  });

  test("ein Tipp fokussiert den Tab, der die Seite schon zeigt", async () => {
    const tab = { url: "https://club.example/matches/m1", focus: vi.fn(async () => tab) };
    const other = { url: "https://club.example/", focus: vi.fn() };
    const runtime = pushWorker({ windows: [other, tab] });
    const close = await runtime.click({ data: { url: "/matches/m1", actions: {} } });
    expect(close).toHaveBeenCalled();
    expect(tab.focus).toHaveBeenCalled();
    expect(other.focus).not.toHaveBeenCalled();
    expect(runtime.clients.openWindow).not.toHaveBeenCalled();
  });

  test("sonst öffnet ein Tipp die Seite neu; ein Knopf öffnet sein eigenes Ziel", async () => {
    const runtime = pushWorker({ windows: [{ url: "https://club.example/", focus: vi.fn() }] });
    await runtime.click({ data: { url: "/messages/max", actions: {} } });
    expect(runtime.clients.openWindow).toHaveBeenLastCalledWith("https://club.example/messages/max");
    await runtime.click({ data: { url: "/tournaments/cup", actions: { checkin: "/tournaments/cup#checkin" } } }, "checkin");
    expect(runtime.clients.openWindow).toHaveBeenLastCalledWith("https://club.example/tournaments/cup#checkin");
  });

  test("öffnet nie eine fremde Adresse", async () => {
    const runtime = pushWorker();
    await runtime.click({ data: { url: "https://evil.example/", actions: {} } });
    expect(runtime.clients.openWindow).toHaveBeenLastCalledWith("https://club.example/notifications");
  });
});
