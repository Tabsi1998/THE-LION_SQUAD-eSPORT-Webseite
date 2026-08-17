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
