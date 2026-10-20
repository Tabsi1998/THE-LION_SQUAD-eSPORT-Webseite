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
      for (const call of String(source).matchAll(/use(?:ApiInvalidation|LiveRefresh)\([^)]*?\[([^\]]*)\]/g)) {
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

// Live-Nachladen je Turnier (#1801): Die Meldung nennt das Turnier (und sein Event), wenn beides öffentlich ist. Eine
// Seite eines Turniers lädt dann nur bei Änderungen dieses Turniers nach - Meldungen ohne Kennung laden wie bisher.
describe("Nachladen nur für das betroffene Turnier", () => {
  const change = (fields = {}) => ({ event_type: "api.changed", resource: "tournaments", path: "/api/tournaments", ...fields });

  test("eigenes Turnier lädt, fremdes nicht", () => {
    expect(invalidationMatches(change({ tournament_id: "t1" }), ["tournaments"], { tournamentId: "t1" })).toBe(true);
    expect(invalidationMatches(change({ tournament_id: "t2" }), ["tournaments"], { tournamentId: "t1" })).toBe(false);
  });

  test("eine Meldung ohne Turnier lädt wie bisher", () => {
    expect(invalidationMatches(change(), ["tournaments"], { tournamentId: "t1" })).toBe(true);
    expect(invalidationMatches(change({ tournament_id: null }), ["tournaments"], { tournamentId: "t1" })).toBe(true);
  });

  test("solange die Seite ihr Turnier noch nicht kennt, lädt jede passende Meldung", () => {
    expect(invalidationMatches(change({ tournament_id: "t2" }), ["tournaments"], { tournamentId: null })).toBe(true);
    expect(invalidationMatches(change({ tournament_id: "t2" }), ["tournaments"], {})).toBe(true);
    expect(invalidationMatches(change({ tournament_id: "t2" }), ["tournaments"])).toBe(true);
  });

  test("ein Reset lädt immer, eine fremde Ressource nie - auch mit eigenem Turnier", () => {
    expect(invalidationMatches({ event_type: "stream.reset" }, ["tournaments"], { tournamentId: "t1" })).toBe(true);
    expect(invalidationMatches(change({ tournament_id: "t1", resource: "news", path: "/api/news" }), ["tournaments"], { tournamentId: "t1" })).toBe(false);
  });

  test("Spiele eines Turniers zählen wie das Turnier", () => {
    const result = { resource: "matches", path: "/api/matches", tournament_id: "t1" };
    expect(invalidationMatches(result, ["tournaments", "matches"], { tournamentId: "t1" })).toBe(true);
    expect(invalidationMatches({ ...result, tournament_id: "t2" }, ["tournaments", "matches"], { tournamentId: "t1" })).toBe(false);
  });

  // Die Turniere eines Events teilen sich Stationen: Wer Stationen zeigt (Spielplan, Live-Warteschlange, TV), lädt auch
  // bei Änderungen der anderen Turniere desselben Events nach.
  describe("Seiten mit Stationen", () => {
    const stations = ["tournaments", "matches-v2", "stations"];

    test("ein anderes Turnier desselben Events lädt, eines eines anderen Events nicht", () => {
      const scope = { tournamentId: "t1", eventId: "e1" };
      expect(invalidationMatches(change({ tournament_id: "t2", parent_event_id: "e1" }), stations, scope)).toBe(true);
      expect(invalidationMatches(change({ tournament_id: "t3", parent_event_id: "e2" }), stations, scope)).toBe(false);
    });

    test("ein anderes Turnier ohne Event teilt keine Station - es lädt nicht", () => {
      expect(invalidationMatches(change({ tournament_id: "t2", parent_event_id: null }), stations, { tournamentId: "t1", eventId: "e1" })).toBe(false);
      expect(invalidationMatches(change({ tournament_id: "t2" }), stations, { tournamentId: "t1" })).toBe(false);
    });

    test("kennt die Seite ihr Event nicht (TV mit Schlüssel), lädt jedes Turnier mit Event", () => {
      expect(invalidationMatches(change({ tournament_id: "t2", parent_event_id: "e9" }), stations, { tournamentId: "t1" })).toBe(true);
      expect(invalidationMatches(change({ tournament_id: "t2", parent_event_id: "e9" }), stations, { tournamentId: "t1", eventId: null })).toBe(true);
    });

    test("Stationen-Meldungen haben kein Turnier und laden immer", () => {
      expect(invalidationMatches({ resource: "stations", path: "/api/stations" }, stations, { tournamentId: "t1", eventId: "e1" })).toBe(true);
    });

    test("Seiten ohne Stationen bleiben beim eigenen Turnier, auch im selben Event", () => {
      expect(invalidationMatches(change({ tournament_id: "t2", parent_event_id: "e1" }), ["tournaments"], { tournamentId: "t1", eventId: "e1" })).toBe(false);
    });
  });
});
