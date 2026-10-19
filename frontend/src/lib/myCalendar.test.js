import { SUBSCRIBE_GUIDE, agendaBuckets, googleSubscribeUrl, ownBadge, subscriptionLine } from "@/lib/myCalendar";

// „Mein Kalender“ (#1788): Heute, Diese Woche (bis Sonntag, Wien), Später - Vergangenes fällt weg, Laufendes ist heute.

const NOW = new Date("2099-10-01T10:00:00Z"); // Donnerstag

function item(id, start, extra = {}) {
  return { id, kind: "event", title: id, start, end: null, mine: true, ...extra };
}

test("Heute, Diese Woche bis Sonntag, Später - leere Abschnitte gibt es nicht", () => {
  const buckets = agendaBuckets([
    item("heute", "2099-10-01T18:00:00+02:00"),
    item("sonntag", "2099-10-04T21:30:00+02:00"),
    item("montag", "2099-10-05T00:30:00+02:00"),
    item("vorbei", "2099-09-20T18:00:00+02:00"),
  ], NOW);
  expect(buckets.map((bucket) => [bucket.label, bucket.items.map((entry) => entry.id)])).toEqual([
    ["Heute", ["heute"]],
    ["Diese Woche", ["sonntag"]],
    ["Später", ["montag"]],
  ]);
  expect(agendaBuckets([item("vorbei", "2099-09-20T18:00:00+02:00")], NOW)).toEqual([]);
});

test("was gestern begann und noch läuft, steht unter Heute; ganztägig zählt der Tag", () => {
  const buckets = agendaBuckets([
    item("laeuft", "2099-09-30T10:00:00+02:00", { kind: "fastlap", end: "2099-10-03T22:00:00+02:00" }),
    { ...item("versammlung", "2099-10-02T22:00:00+00:00", { kind: "club" }), all_day: true, day: "2099-10-03" },
  ], NOW);
  expect(buckets[0].items.map((entry) => entry.id)).toEqual(["laeuft"]);
  expect(buckets[1].items.map((entry) => entry.id)).toEqual(["versammlung"]);
});

test("die Tage eines Events sind eine Zeile", () => {
  const days = [1, 2].map((n) => item(`e-lan-tag-${n}`, `2099-10-1${n}T10:00:00+02:00`, { end: `2099-10-1${n}T22:00:00+02:00`, marker: "event_day", event_id: "e-lan", event_name: "Herbst-LAN" }));
  const [later] = agendaBuckets(days, NOW);
  expect(later.items).toHaveLength(1);
  expect(later.items[0].title).toBe("Herbst-LAN");
});

test("Plakette: Stand vom Server, mit Team; Warteliste wartet, Gefahrenes ist erledigt, Verein in Gold", () => {
  expect(ownBadge({ kind: "tournament", own: { state: "approved", label: "Du bist dabei", team_name: "Lions Rocket" } })).toEqual({ label: "Du bist dabei · mit Lions Rocket", tone: "mine" });
  expect(ownBadge({ kind: "event", own: { state: "waitlist", label: "Warteliste" } }).tone).toBe("wait");
  expect(ownBadge({ kind: "fastlap", own: { state: "driven", label: "Du bist gefahren" } }).tone).toBe("done");
  expect(ownBadge({ kind: "club", own: { state: "accepted", label: "Zugesagt" } }).tone).toBe("club");
  expect(ownBadge({ kind: "event", mine: true })).toBeNull();
});

test("Abo-Stand in einem Satz, Anleitung und Google-Weg", () => {
  const format = (value) => `[${value}]`;
  expect(subscriptionLine({ active: false }, format)).toBe("");
  expect(subscriptionLine({ active: true, created_at: "a", last_used_at: null }, format)).toBe("Aktiv seit [a], noch von keinem Kalender abgerufen.");
  expect(subscriptionLine({ active: true, created_at: "a", last_used_at: "b" }, format)).toBe("Aktiv seit [a], zuletzt abgerufen [b].");
  expect(SUBSCRIBE_GUIDE.map((entry) => entry.key)).toEqual(["google", "apple", "outlook"]);
  expect(googleSubscribeUrl("webcal://x.at/a b")).toBe("https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fx.at%2Fa%20b");
});
