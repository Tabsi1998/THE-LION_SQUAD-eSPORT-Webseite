import { buildCards, childSummary, listMode, mineState, nestUnderEvents, ownLabel, playLabel } from "./eventGroups";

// Das Event als Klammer (#1182) und „Nur meine“ (#1189) in der App: Gruppierung, Filter und Umschalter - wie im Web.

const LAN = { id: "e-lan", name: "Herbst-LAN", start_date: "2099-10-17T08:00:00Z", status: "registration_open" };
const FEST = { id: "e-fest", name: "Sommerfest", start_date: "2099-10-05T16:00:00Z", status: "scheduled" };
const ROCKET = { id: "t-rocket", title: "Rocket Cup", event_id: "e-lan", start_date: "2099-10-18T12:00:00Z", status: "registration_open" };
const KART = { id: "t-kart", title: "Kart Cup", event_id: "e-lan", start_date: "2099-10-17T10:00:00Z", status: "registration_open" };
const ONLINE = { id: "t-online", title: "Online-Cup", start_date: "2099-10-10T17:00:00Z", status: "registration_open" };
const LAP = { id: "f-lan", title: "LAN Fast Lap", event_id: "e-lan", start_date: "2099-10-17T08:00:00Z", status: "scheduled" };
const MONZA = { id: "f-monza", title: "Fast Lap Monza", start_date: "2099-10-01T08:00:00Z", status: "live" };
const DATA = { events: [LAN, FEST], tournaments: [ROCKET, KART, ONLINE], fastlaps: [LAP, MONZA] };
const keys = (cards: Array<{ key: string }>) => cards.map((card) => card.key).sort();

test("Variante A: Turniere und Fast Laps eines Events stehen nach Beginn in seiner Karte, nicht doppelt", () => {
  const cards = buildCards(DATA);
  expect(keys(cards)).toEqual(["event-e-fest", "event-e-lan", "fastlap-f-monza", "tournament-t-online"]);
  const lan = cards.find((card) => card.key === "event-e-lan");
  expect(lan?.children.map((row) => row.key)).toEqual(["fastlap-f-lan", "tournament-t-kart", "tournament-t-rocket"]);
  expect(childSummary(lan?.children)).toBe("2 Turniere · 1 Fast Lap");
});

test("„Zusätzlich einzeln“ zeigt sie auch als eigene Karte - mit Verweis aufs Event", () => {
  const cards = buildCards(DATA, { mode: "separate" });
  expect(cards.find((card) => card.key === "tournament-t-rocket")?.event).toBe(LAN);
  expect(cards.find((card) => card.key === "event-e-lan")?.children).toHaveLength(3);
  expect(listMode("separate")).toBe("separate");
  expect(listMode(null)).toBe("nested");
});

test("Filter: Events nur Events, Turniere und Fast Laps alle einzeln; ohne Event für sich", () => {
  expect(keys(buildCards(DATA, { filter: "events" }))).toEqual(["event-e-fest", "event-e-lan"]);
  expect(keys(buildCards(DATA, { filter: "tournaments" }))).toEqual(["tournament-t-kart", "tournament-t-online", "tournament-t-rocket"]);
  expect(keys(buildCards(DATA, { filter: "fastlaps" }))).toEqual(["fastlap-f-lan", "fastlap-f-monza"]);
  expect(keys(buildCards({ events: [FEST], tournaments: [ROCKET] }))).toEqual(["event-e-fest", "tournament-t-rocket"]);
});

test("„Nur meine“: eigenes Team-Turnier im Event, gefahrene Fast Lap - sonst nichts", () => {
  const mine = { events: {}, tournaments: { "t-rocket": { state: "approved", label: "Du bist dabei", team_name: "Lions Rocket" } }, fastlaps: { "f-monza": { state: "driven", label: "Du bist gefahren" } } };
  const cards = buildCards(DATA, { onlyMine: true, mine });
  expect(keys(cards)).toEqual(["event-e-lan", "fastlap-f-monza"]);
  expect(cards.find((card) => card.key === "event-e-lan")?.children.map((row) => row.key)).toEqual(["tournament-t-rocket"]);
  expect(ownLabel(mineState(mine, "tournament", "t-rocket"))).toBe("Du bist dabei · Lions Rocket");
  expect(buildCards(DATA, { onlyMine: true, mine: null })).toEqual([]);
  expect(buildCards(DATA).every((card) => card.mine === null)).toBe(true);
});

test("Startseite: ein Event mit seinen Turnieren ist eine Karte", () => {
  const rows = nestUnderEvents([
    { kind: "event", id: "e-lan", title: "Herbst-LAN" },
    { kind: "tournament", id: "t-rocket", eventId: "e-lan", title: "Rocket Cup" },
    { kind: "tournament", id: "t-online", title: "Online-Cup" },
    { kind: "tournament", id: "t-other", eventId: "e-woanders", title: "Woanders" },
  ]);
  expect(rows.map((row) => row.id)).toEqual(["e-lan", "t-online", "t-other"]);
  expect(rows[0].children.map((row) => row.id)).toEqual(["t-rocket"]);
});

test("Spielart: Spiel und Einzel/Team, bei der Fast Lap „Fast Lap“", () => {
  expect(playLabel("tournament", { game: { name: "Rocket League" }, team_mode: "team" })).toBe("Rocket League · Team");
  expect(playLabel("tournament", { game_name: "Mario Kart 8", team_mode: "solo" })).toBe("Mario Kart 8 · Einzel");
  expect(playLabel("fastlap", {})).toBe("Fast Lap");
});

// Abgesagtes Event (#2542, #2127 EV3, Web: eventGroups.js): Ein Turnier, das trotzdem noch läuft, bleibt sichtbar - als eigene Karte mit
// „gehört zu …“, nicht versteckt in der abgesagten. Beendete Turniere bleiben in ihrer Event-Karte.
test("abgesagtes Event: ein laufendes Turnier behält seine eigene Karte, ein beendetes bleibt im Event", () => {
  const cards = buildCards({
    events: [{ id: "e1", status: "cancelled", start_date: "2026-12-01T10:00:00Z" }],
    tournaments: [
      { id: "t-live", event_id: "e1", status: "live", start_date: "2026-12-01T12:00:00Z" },
      { id: "t-done", event_id: "e1", status: "completed", start_date: "2026-12-01T09:00:00Z" },
    ],
  });
  const event = cards.find((card) => card.key === "event-e1");
  expect(event?.children.map((row) => row.key)).toEqual(["tournament-t-done"]);
  const own = cards.find((card) => card.key === "tournament-t-live");
  expect(own?.event?.id).toBe("e1");
  // Gegenprobe: im laufenden Event bleibt das Turnier in der Karte.
  const normal = buildCards({ events: [{ id: "e2", status: "scheduled" }], tournaments: [{ id: "t2", event_id: "e2", status: "live" }] });
  expect(normal.map((card) => card.key)).toEqual(["event-e2"]);
});
