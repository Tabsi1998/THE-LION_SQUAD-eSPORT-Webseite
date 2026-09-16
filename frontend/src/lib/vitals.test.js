import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushVitals, pendingVitals, queueVital, resetVitals, serializeEntries, startVitals, vitalsRoute } from "./vitals";

// Web Vitals (#265): Routen ohne Kennungen, gesendet am Ende des Besuchs, nie
// bei „Do Not Track“.

describe("vitalsRoute", () => {
  test("ersetzt Kennungen und Slugs, behält feste Seiten", () => {
    expect(vitalsRoute("/")).toBe("/");
    expect(vitalsRoute("/news/halloween-2026?x=1#top")).toBe("/news/:slug");
    expect(vitalsRoute("/tournaments/lion-cup/live")).toBe("/tournaments/:slug/live");
    expect(vitalsRoute("/u/tabsi98")).toBe("/u/:slug");
    expect(vitalsRoute("/members/area")).toBe("/members/area");
    expect(vitalsRoute("/members/lion-boss")).toBe("/members/:slug");
    expect(vitalsRoute("/admin/tournaments/0123456789abcdef/edit")).toBe("/admin/tournaments/:id/edit");
    expect(vitalsRoute("/admin/ops")).toBe("/admin/ops");
    expect(vitalsRoute("/profile/")).toBe("/profile");
    expect(vitalsRoute("/verify/abc123def")).toBe("/verify/:id");
  });
});

describe("Sammeln und Senden", () => {
  let beacon;

  beforeEach(() => {
    resetVitals();
    beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true, writable: true });
  });

  afterEach(() => {
    resetVitals();
    Object.defineProperty(navigator, "doNotTrack", { value: undefined, configurable: true, writable: true });
  });

  test("die Sendung enthält höchstens zwölf Einträge mit Route und Geräteklasse", () => {
    for (let i = 0; i < 5; i += 1) queueVital({ name: "LCP", value: 1000 + i, route: "/news/:slug", device: "mobile" });
    expect(pendingVitals()).toHaveLength(5);
    expect(flushVitals()).toBe(true);
    expect(pendingVitals()).toHaveLength(0);
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toMatch(/\/api\/ops\/vitals$/);
    expect(blob.type).toBe("application/json");
    const fourteen = Array.from({ length: 14 }, (_, i) => ({ name: "CLS", value: i / 100, route: "/", device: "desktop" }));
    expect(JSON.parse(serializeEntries(fourteen)).entries).toHaveLength(12);
  });

  test("startVitals hängt LCP an die Startseite des Besuchs und sendet beim Verbergen", async () => {
    const callbacks = {};
    const fakeModule = {
      onLCP: (cb) => { callbacks.LCP = cb; },
      onCLS: (cb) => { callbacks.CLS = cb; },
      onINP: (cb) => { callbacks.INP = cb; },
      onTTFB: (cb) => { callbacks.TTFB = cb; },
      onFCP: (cb) => { callbacks.FCP = cb; },
    };
    let pathname = "/news/halloween-2026";
    const started = await startVitals({ load: async () => fakeModule, locationRef: () => ({ pathname }) });
    expect(started).toBe(true);

    callbacks.LCP({ name: "LCP", value: 2400 });
    pathname = "/events/lan";
    callbacks.CLS({ name: "CLS", value: 0.03 });
    expect(pendingVitals().map((e) => e.route)).toEqual(["/news/:slug", "/events/:slug"]);

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    window.dispatchEvent(new Event("visibilitychange"));
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(pendingVitals()).toHaveLength(0);

    expect(await startVitals({ load: async () => fakeModule })).toBe(false);
  });

  test("bei Do Not Track wird nichts gestartet", async () => {
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true, writable: true });
    expect(await startVitals({ load: async () => ({}) })).toBe(false);
  });
});
