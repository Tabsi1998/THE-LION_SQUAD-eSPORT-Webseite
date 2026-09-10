import {
  emitApiInvalidation,
  invalidationMatches,
  subscribeApiInvalidation,
} from "./apiInvalidation";

describe("API invalidation stream", () => {
  test("a stream reset invalidates every selected resource", () => {
    expect(invalidationMatches({ event_type: "stream.reset" }, ["tournaments"])).toBe(true);
    expect(invalidationMatches({ reset: true }, ["admin/settings"])).toBe(true);
  });

  test("a redacted public resource still matches its live view", () => {
    const event = {
      event_type: "api.changed",
      entity_type: "tournaments",
      path: "/api/tournaments",
      resource: "tournaments",
    };

    expect(invalidationMatches(event, ["tournaments", "matches"])).toBe(true);
    expect(invalidationMatches(event, ["news"])).toBe(false);
  });

  // Der Server leitet die Ressource aus dem Pfad ab: /api/matches-v2/... wird
  // zu "matches-v2" mit Bindestrich. Drei Ansichten filterten auf
  // "matches_v2" mit Unterstrich - eine Zeichenkette, die nie zutreffen kann.
  // Gerettet hat sie nur, dass sie zusaetzlich "matches" auffuehrten; eine
  // Ansicht, die allein darauf gesetzt haette, waere nie aktualisiert worden.
  test("a v2 match change reaches the views that ask for it", () => {
    const event = { path: "/api/matches-v2/m-1/result", resource: "matches-v2" };

    expect(invalidationMatches(event, ["matches-v2"])).toBe(true);
    expect(invalidationMatches(event, ["matches"])).toBe(true);
    expect(invalidationMatches(event, ["tournaments"])).toBe(true);
    expect(invalidationMatches(event, ["matches_v2"])).toBe(false);
  });

  test("no view filters on a resource key the server never emits", async () => {
    const modules = import.meta.glob("../pages/**/*.jsx", { query: "?raw", import: "default", eager: true });
    const used = new Set();
    for (const source of Object.values(modules)) {
      for (const call of String(source).matchAll(/useApiInvalidation\([^)]*?\[([^\]]*)\]/g)) {
        for (const part of call[1].split(",")) {
          const name = part.trim().replace(/^["'`]|["'`]$/g, "");
          if (name) used.add(name);
        }
      }
    }
    expect(used.size).toBeGreaterThan(10);

    // Unterstriche gibt es in keinem API-Pfad; sie sind das verlaessliche
    // Kennzeichen einer Zeichenkette, die nie zutrifft.
    const impossible = [...used].filter((name) => name.includes("_"));
    expect(impossible).toEqual([]);
  });

  test("the same server event is emitted only once", () => {
    const received = [];
    const unsubscribe = subscribeApiInvalidation((event) => received.push(event));
    const eventId = `dedupe-${Date.now()}-${Math.random()}`;

    expect(emitApiInvalidation({ event_id: eventId, source: "server", resource: "matches" })).toBe(true);
    expect(emitApiInvalidation({ event_id: eventId, source: "server", resource: "matches" })).toBe(false);

    unsubscribe();
    expect(received).toHaveLength(1);
    expect(received[0].clientVersion).toEqual(expect.any(Number));
  });

  test("server sequence is preserved separately from the client sequence", () => {
    const received = [];
    const unsubscribe = subscribeApiInvalidation((event) => received.push(event));
    const eventId = `version-${Date.now()}-${Math.random()}`;

    emitApiInvalidation({
      event_id: eventId,
      source: "server",
      resource: "events",
      version: 42,
    });

    unsubscribe();
    expect(received[0].version).toBe(42);
    expect(received[0].clientVersion).toEqual(expect.any(Number));
  });
});
