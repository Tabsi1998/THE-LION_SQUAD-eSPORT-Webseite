import {
  SUBSCRIBE_GUIDE, agendaBuckets, filterKind, googleSubscribeUrl, kindLabel, ownBadge, personalFeedUrls, presentKinds, subscriptionLine,
  toCalendarItems, whenLabel, type MyCalendarItem,
} from "./myCalendar";

// „Mein Kalender“ (#1788): dieselben Fälle wie im Web (frontend/src/lib/myCalendar.test.js) - Heute, Diese Woche (bis
// Sonntag, Wien), Später; Vergangenes fällt weg, Laufendes ist heute, ganztägig zählt der Wiener Tag.

const NOW = new Date("2099-10-01T10:00:00Z"); // Donnerstag

function item(id: string, start: string, extra: Partial<MyCalendarItem> = {}): MyCalendarItem {
  return { id, kind: "event", title: id, start, end: null, mine: true, ...extra };
}

const ids = (buckets: ReturnType<typeof agendaBuckets>) => buckets.map((bucket) => [bucket.key, bucket.items.map((entry) => entry.id)]);

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
    item("versammlung", "2099-10-02T22:00:00+00:00", { kind: "club", all_day: true, day: "2099-10-03" }),
  ], NOW);
  expect(ids(buckets)).toEqual([["today", ["laeuft"]], ["week", ["versammlung"]]]);
});

test("ganztägig gilt bis zum Ende des Tags in Wien - auch am Tag der Zeitumstellung (25.10.2026)", () => {
  // Versammlung am So 25.10.2026 ohne Uhrzeit: Beginn 00:00 Wien (Sommerzeit) = 24.10. 22:00 UTC, kein Ende.
  const meeting = item("versammlung", "2026-10-24T22:00:00+00:00", { kind: "club", all_day: true, day: "2026-10-25" });
  // Mehrtägig ganztägig mit ausschließlichem Ende: Sa 24. bis Mo 26.10. (Ende 27.10. 00:00 Wien, Winterzeit = 26.10. 23:00 UTC).
  const camp = item("camp", "2026-10-23T22:00:00+00:00", { all_day: true, day: "2026-10-24", end: "2026-10-26T23:00:00+00:00" });

  // So 25.10., 21:00 Wien (Winterzeit) - beide laufen noch: Heute.
  expect(ids(agendaBuckets([meeting, camp], new Date("2026-10-25T20:00:00Z")))).toEqual([["today", ["camp", "versammlung"]]]);
  // So 25.10., 23:59 Wien: die Versammlung zählt noch.
  expect(ids(agendaBuckets([meeting], new Date("2026-10-25T22:59:00Z")))).toEqual([["today", ["versammlung"]]]);
  // Mo 26.10., 00:30 Wien: die Versammlung ist vorbei, das Lager läuft bis Montagabend.
  expect(agendaBuckets([meeting, camp], new Date("2026-10-25T23:30:00Z")).flatMap((bucket) => bucket.items.map((entry) => entry.id))).toEqual(["camp"]);
  // Di 27.10., 00:30 Wien: beide vorbei.
  expect(agendaBuckets([meeting, camp], new Date("2026-10-26T23:30:00Z"))).toEqual([]);
});

test("die Woche endet am Sonntag in Wien - auch über die Zeitumstellung", () => {
  // Mo 19.10.2026: Sonntag ist der 25. (Umstellung), Montag 26. ist schon „Später“.
  const now = new Date("2026-10-19T08:00:00Z");
  const buckets = agendaBuckets([
    item("so-spaet", "2026-10-25T23:30:00+01:00"),
    item("mo-frueh", "2026-10-26T00:15:00+01:00"),
  ], now);
  expect(ids(buckets)).toEqual([["week", ["so-spaet"]], ["later", ["mo-frueh"]]]);
});

test("die Tage eines Events sind eine Zeile", () => {
  const days = [1, 2].map((n) => item(`e-lan-tag-${n}`, `2099-10-1${n}T10:00:00+02:00`, { end: `2099-10-1${n}T22:00:00+02:00`, marker: "event_day", event_id: "e-lan", event_name: "Herbst-LAN" }));
  const [later] = agendaBuckets(days, NOW);
  expect(later.items).toHaveLength(1);
  expect(later.items[0].title).toBe("Herbst-LAN");
  expect(later.items[0].end).toBe("2099-10-12T22:00:00+02:00");
  // Im Monat teilen sich die Tage die Kennung des Events - dann werden sie ein Balken.
  expect(toCalendarItems(days).map((entry) => [entry.id, entry.title, entry.mine])).toEqual([["e-lan", "Herbst-LAN", true], ["e-lan", "Herbst-LAN", true]]);
});

test("Plakette: Stand vom Server, mit Team; Warteliste wartet, Gefahrenes ist erledigt, Verein in Gold", () => {
  expect(ownBadge({ kind: "tournament", own: { state: "approved", label: "Du bist dabei", team_name: "Lions Rocket" } })).toEqual({ label: "Du bist dabei · mit Lions Rocket", tone: "mine" });
  expect(ownBadge({ kind: "event", own: { state: "waitlist", label: "Warteliste" } })?.tone).toBe("wait");
  expect(ownBadge({ kind: "event", own: { state: "checked_in", label: "Eingecheckt" } })?.tone).toBe("done");
  expect(ownBadge({ kind: "fastlap", own: { state: "driven", label: "Du bist gefahren" } })?.tone).toBe("done");
  expect(ownBadge({ kind: "club", own: { state: "accepted", label: "Zugesagt" } })?.tone).toBe("club");
  expect(ownBadge({ kind: "event" })).toBeNull();
  expect(ownBadge(null)).toBeNull();
});

test("Abo-Stand in einem Satz, Anleitung und Google-Weg", () => {
  const format = (value: string) => `[${value}]`;
  expect(subscriptionLine({ active: false }, format)).toBe("");
  expect(subscriptionLine({ active: true, created_at: "a", last_used_at: null }, format)).toBe("Aktiv seit [a], noch von keinem Kalender abgerufen.");
  expect(subscriptionLine({ active: true, created_at: "a", last_used_at: "b" }, format)).toBe("Aktiv seit [a], zuletzt abgerufen [b].");
  expect(SUBSCRIBE_GUIDE.map((entry) => entry.key)).toEqual(["google", "apple", "outlook"]);
  expect(googleSubscribeUrl("webcal://x.at/a b")).toBe("https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fx.at%2Fa%20b");
  expect(personalFeedUrls("https://lionsquad.at/", "/api/calendar/personal/abc.ics")).toEqual({
    https: "https://lionsquad.at/api/calendar/personal/abc.ics",
    webcal: "webcal://lionsquad.at/api/calendar/personal/abc.ics",
    google: "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Flionsquad.at%2Fapi%2Fcalendar%2Fpersonal%2Fabc.ics",
  });
});

test("Filter nach Art: nur vorkommende Arten, in fester Reihenfolge", () => {
  const list = [item("c", "2099-10-02T10:00:00Z", { kind: "club", club_kind: "shift" }), item("t", "2099-10-02T10:00:00Z", { kind: "tournament" }), item("e", "2099-10-02T10:00:00Z")];
  expect(presentKinds(list)).toEqual(["event", "tournament", "club"]);
  expect(filterKind(list, "club").map((entry) => entry.id)).toEqual(["c"]);
  expect(filterKind(list, "all")).toHaveLength(3);
  expect(kindLabel(list[0])).toBe("Helferschicht");
  expect(kindLabel({ kind: "club", club_kind: "meeting" })).toBe("Versammlung");
  expect(kindLabel({ kind: "tournament" })).toBe("Turnier");
});

test("Wann: Wiener Uhr, ganztägig ohne Uhrzeit, mehrtägig als Spanne", () => {
  expect(whenLabel(item("a", "2026-10-24T16:00:00Z"))).toMatch(/24\. Okt.* · 18:00$/);
  expect(whenLabel(item("b", "2026-10-24T22:00:00+00:00", { all_day: true, day: "2026-10-25" }))).toMatch(/25\. Okt.* · ganztägig$/);
  expect(whenLabel(item("c", "2026-10-24T08:00:00Z", { end: "2026-10-26T20:00:00Z" }))).toMatch(/24\. Okt.* – .*26\. Okt/);
});
