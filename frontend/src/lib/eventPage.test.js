import { EVENT_SECTIONS, descriptionEchoesTitle, eventFacts, eventTabs, routeUrl, stripHeadingEmoji, visibilityChip, whatsOnRows } from "./eventPage";

// Event-Seite als Startpunkt (#1183), Kopf (#1273) und Fakten-Kasten (#1346): Fakten ein- und mehrtägig, frei oder mit
// Preis, ohne Ort; die Zeilen „Was läuft“ (angemeldet, Team, Gast, ein- und mehrtägig); Emoji-Zwischentitel; Warnung.

const NOW = new Date("2026-10-08T10:00:00Z");
const offer = { enabled: true, currency: "EUR", positions: [{ key: "ticket", label: "Eintritt", amount_cents: 500, basis: "per_person", optional: false }] };

test("die Reihenfolge der Abschnitte steht fest (wie in der App)", () => {
  expect(EVENT_SECTIONS).toEqual(["yours", "whatson", "live", "photos", "news", "infos", "sponsors"]);
});

test("Fakten eintägig: Wann mit Ende, Wo mit Route, Eintritt frei, Mitbringen", () => {
  const rows = eventFacts({
    start_date: "2026-10-24T16:00:00Z", end_date: "2026-10-24T21:00:00Z", location: "Vereinsheim", address: "Bahnhofstraße 1", postal_code: "6410", city: "Telfs",
    map_query: "Bahnhofstraße 1, 6410 Telfs", bring_along: ["eigener Controller", "Kopfhörer"],
  }, { now: NOW });
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
  expect(rows.map((row) => row.key)).toEqual(["when", "where", "entry", "bring"]);
  expect(byKey.when.title).toBe("Sa 24. Oktober · 18:00 – 23:00");
  expect(byKey.where.title).toBe("Vereinsheim");
  expect(byKey.where.lines).toEqual(["Bahnhofstraße 1, 6410 Telfs"]);
  expect(byKey.where.route).toBe(routeUrl("Bahnhofstraße 1, 6410 Telfs"));
  expect(byKey.where.route).toContain("google.com/maps/dir/?api=1&destination=");
  expect(byKey.entry).toMatchObject({ title: "frei", free: true });
  expect(byKey.bring).toMatchObject({ title: "eigener Controller", lines: ["Kopfhörer"] });
});

test("Fakten mehrtägig mit Preis, ohne Ort und ohne Mitbringen", () => {
  const rows = eventFacts({
    start_date: "2026-11-13T16:00:00Z", offer,
    schedule: { multi_day: true, label: "3 Tage · Fr 13.11. – So 15.11.", range_label: "Fr 13.11. – So 15.11.", days: [
      { index: 1, label: "Fr 13.11.", time_label: "17:00–23:00" }, { index: 2, label: "Sa 14.11.", time_label: "10:00–23:00" },
    ] },
  }, { now: NOW });
  expect(rows.map((row) => row.key)).toEqual(["when", "entry"]);
  expect(rows[0].title).toBe("Fr 13.11. – So 15.11.");
  expect(rows[0].lines).toEqual(["Fr 13.11. · 17:00–23:00", "Sa 14.11. · 10:00–23:00"]);
  expect(rows[1]).toMatchObject({ title: "5,00 € je Person", free: false });
  expect(eventFacts({ is_online: true, start_date: "2026-11-13T16:00:00Z" }, { now: NOW }).find((row) => row.key === "where").title).toBe("Online");
  expect(eventFacts({ locations: [{ name: "Halle A" }, { name: "Halle B" }] }).find((row) => row.key === "where")).toMatchObject({ title: "2 Standorte", lines: ["Halle A", "Halle B"] });
});

test("Was läuft: eintägig nur Uhrzeit; eigener Stand, Team und „Anmelden“ nur offen und ohne Stand", () => {
  const rows = whatsOnRows({
    tournaments: [
      { id: "t2", slug: "rl", title: "Rocket League 2v2", team_mode: "team", start_date: "2026-10-24T15:00:00Z", status: "registration_open", public_phase: { state: "registration_open" },
        my_status: { state: "approved", label: "Du bist dabei", team_name: "Lions Rocket" } },
      { id: "t1", slug: "mk", title: "Mario Kart", team_mode: "solo", start_date: "2026-10-24T12:00:00Z", game_name: "Mario Kart 8", status: "registration_open", public_phase: { state: "registration_open" } },
      { id: "t3", slug: "fc", title: "FC 26 Cup", start_date: "2026-10-24T13:00:00Z", status: "live", public_phase: { state: "live" } },
    ],
    f1_challenges: [{ id: "f1", slug: "spa", title: "Fast Lap Spa", my_status: { label: "Du bist gefahren" } }],
  });
  expect(rows.map((row) => row.id)).toEqual(["t1", "t3", "t2", "f1"]);
  expect(rows[0]).toMatchObject({ timeLabel: "14:00", dayLabel: "", mode: "Einzel", detail: "Mario Kart 8", action: "register", mine: null, path: "/tournaments/mk" });
  expect(rows[1]).toMatchObject({ action: null, mine: null });
  expect(rows[2]).toMatchObject({ mode: "Team", action: null, mine: { label: "Du bist dabei", team: "Lions Rocket" } });
  expect(rows[3]).toMatchObject({ mode: "Bestzeit fahren", path: "/fastlap/spa", timeLabel: "", mine: { label: "Du bist gefahren", team: null } });
});

test("Was läuft mehrtägig: Tag-Etikett und Wochentag mit Uhrzeit", () => {
  const rows = whatsOnRows({
    schedule: { multi_day: true },
    tournaments: [{ id: "t1", title: "Samstags-Cup", start_date: "2026-10-17T11:00:00Z", event_day: { index: 2, count: 3 } }],
  });
  expect(rows[0]).toMatchObject({ dayLabel: "Tag 2", timeLabel: "Sa 13:00" });
});

test("Reiter: Live nur mit Turnieren oder Fast Laps und nur vor dem Ende", () => {
  expect(eventTabs({ tournaments: [] }).map((tab) => tab.key)).toEqual(["overview"]);
  expect(eventTabs({ tournaments: [{ id: "t1" }] }).map((tab) => tab.key)).toEqual(["overview", "live"]);
  expect(eventTabs({ f1_challenges: [{ id: "f1" }] }, { over: true }).map((tab) => tab.key)).toEqual(["overview"]);
});

test("Zwischentitel ohne Emoji; Ziffern bleiben", () => {
  expect(stripHeadingEmoji("## 🚀 NOCH MEHR HIGHLIGHTS\nText 🎮 bleibt\n### 🎮🕹️ Nintendo Switch\n## 2 Tage voller Spaß"))
    .toBe("## NOCH MEHR HIGHLIGHTS\nText 🎮 bleibt\n### Nintendo Switch\n## 2 Tage voller Spaß");
});

test("Warnung: die Beschreibung beginnt mit dem Titel", () => {
  expect(descriptionEchoesTitle("Herbst-LAN 2026", "## 🎮 HERBST-LAN 2026\nDieses Jahr …")).toBe(true);
  expect(descriptionEchoesTitle("Herbst-LAN 2026", "**Herbst-LAN 2026** wird groß")).toBe(true);
  expect(descriptionEchoesTitle("Herbst-LAN 2026", "Drei Tage zocken in der Halle")).toBe(false);
  expect(descriptionEchoesTitle("", "egal")).toBe(false);
});

test("Schilder auf Deutsch", () => {
  expect(visibilityChip("public")).toBe("Öffentlich");
  expect(visibilityChip("members")).toBe("Nur Mitglieder");
  expect(visibilityChip(undefined)).toBe("Öffentlich");
});
