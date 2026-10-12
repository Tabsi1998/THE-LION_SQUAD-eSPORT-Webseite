import { EVENT_SECTIONS, eventFacts, stripHeadingEmoji, visibilityChip, whatsOnRows } from "./eventPage";

// Dieselbe Rechnung wie im Web (frontend/src/lib/eventPage.test.js): Reihenfolge, Fakten, Zeilen, Zwischentitel.

test("Reihenfolge und Wörter wie im Web", () => {
  expect(EVENT_SECTIONS).toEqual(["yours", "whatson", "live", "photos", "news", "infos", "sponsors"]);
  expect(visibilityChip("members")).toBe("Nur Mitglieder");
});

test("Fakten: Wann mit Ende, Wo mit Route, Eintritt frei, Mitbringen", () => {
  const rows = eventFacts({ id: "e", title: "LAN", start_date: "2026-10-24T16:00:00Z", end_date: "2026-10-24T21:00:00Z", location: "Vereinsheim",
    map_query: "Bahnhofstraße 1", bring_along: ["Controller"] }, { now: new Date("2026-10-08T10:00:00Z") });
  expect(rows.map((row) => row.key)).toEqual(["when", "where", "entry", "bring"]);
  expect(rows[0].title).toBe("Sa 24. Oktober · 18:00 – 23:00");
  expect(rows[1].route).toContain("google.com/maps/dir/");
  expect(rows[2]).toMatchObject({ title: "frei", free: true });
});

test("Zeilen: eigener Stand mit Team, „Anmelden“ nur offen; Zwischentitel ohne Emoji", () => {
  const rows = whatsOnRows({ tournaments: [
    { id: "t1", slug: "mk", title: "Mario Kart", team_mode: "solo", start_date: "2026-10-24T17:00:00Z", status: "registration_open", public_phase: { state: "registration_open" } },
    { id: "t2", slug: "rl", title: "Rocket", team_mode: "team", start_date: "2026-10-24T18:00:00Z", status: "registration_open", public_phase: { state: "registration_open" },
      my_status: { label: "Du bist dabei", team_name: "Lions Rocket" } },
  ] });
  expect(rows[0]).toMatchObject({ timeLabel: "19:00", mode: "Einzel", action: "register" });
  expect(rows[1]).toMatchObject({ mode: "Team", action: null, mine: { label: "Du bist dabei", team: "Lions Rocket" } });
  expect(stripHeadingEmoji("## 🚀 Highlights\n## 2 Tage")).toBe("## Highlights\n## 2 Tage");
});
