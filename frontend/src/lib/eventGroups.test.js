import { buildCards, childSummary, isPast, listMode, mineState, nestUnderEvents, playLabel } from "@/lib/eventGroups";

// Das Event als Klammer (#1182) und „Nur meine“ (#1189): Gruppierung, Filter und Umschalter.

const LAN = { id: "e-lan", name: "Herbst-LAN", start_date: "2099-10-17T10:00:00+02:00", status: "registration_open" };
const FEST = { id: "e-fest", name: "Sommerfest", start_date: "2099-10-05T18:00:00+02:00", status: "scheduled" };
const ROCKET = { id: "t-rocket", title: "Rocket Cup", event_id: "e-lan", start_date: "2099-10-18T14:00:00+02:00", status: "registration_open", team_mode: "team", game: { name: "Rocket League" } };
const KART = { id: "t-kart", title: "Kart Cup", event_id: "e-lan", start_date: "2099-10-17T12:00:00+02:00", status: "registration_open", team_mode: "solo", game: { name: "Mario Kart 8" } };
const ONLINE = { id: "t-online", title: "Online-Cup", start_date: "2099-10-10T19:00:00+02:00", status: "registration_open" };
const LAP = { id: "f-lan", title: "LAN Fast Lap", event_id: "e-lan", start_date: "2099-10-17T10:00:00+02:00", status: "live" };
const MONZA = { id: "f-monza", title: "Fast Lap Monza", start_date: "2099-10-01T10:00:00+02:00", end_date: "2099-10-30T10:00:00+02:00", status: "live" };
const DATA = { events: [LAN, FEST], tournaments: [ROCKET, KART, ONLINE], fastlaps: [LAP, MONZA] };
const keys = (cards) => cards.map((card) => card.key);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2099-09-30T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

test("Variante A: jedes Turnier eines Events steht im Event und nicht doppelt", () => {
  const cards = buildCards(DATA);
  expect(keys(cards).sort()).toEqual(["event-e-fest", "event-e-lan", "fastlap-f-monza", "tournament-t-online"]);
  const lan = cards.find((card) => card.key === "event-e-lan");
  expect(lan.children.map((row) => row.key)).toEqual(["fastlap-f-lan", "tournament-t-kart", "tournament-t-rocket"]);
  expect(cards.find((card) => card.key === "event-e-fest").children).toEqual([]);
  expect(childSummary(lan.children)).toBe("2 Turniere · 1 Fast Lap");
  const all = cards.flatMap((card) => [card.key, ...(card.children || []).map((row) => row.key)]);
  expect(new Set(all).size).toBe(all.length);
});

test("„Zusätzlich einzeln“ zeigt die Turniere des Events auch als eigene Karte, mit Hinweis aufs Event", () => {
  const cards = buildCards(DATA, { mode: "separate" });
  const rocket = cards.find((card) => card.key === "tournament-t-rocket");
  expect(rocket.event).toBe(LAN);
  expect(cards.find((card) => card.key === "event-e-lan").children).toHaveLength(3);
  expect(listMode("separate")).toBe("separate");
  expect(listMode("irgendwas")).toBe("nested");
  expect(listMode(null)).toBe("nested");
});

test("Filter: Events nur als Event-Karten, Turniere und Fast Laps alle einzeln", () => {
  expect(keys(buildCards(DATA, { filter: "events" })).sort()).toEqual(["event-e-fest", "event-e-lan"]);
  expect(keys(buildCards(DATA, { filter: "tournaments" })).sort()).toEqual(["tournament-t-kart", "tournament-t-online", "tournament-t-rocket"]);
  expect(keys(buildCards(DATA, { filter: "fastlaps" })).sort()).toEqual(["fastlap-f-lan", "fastlap-f-monza"]);
});

test("Ein Turnier, dessen Event nicht in der Liste steht, steht für sich", () => {
  const cards = buildCards({ events: [FEST], tournaments: [ROCKET], fastlaps: [] });
  expect(keys(cards).sort()).toEqual(["event-e-fest", "tournament-t-rocket"]);
  expect(cards.find((card) => card.key === "tournament-t-rocket").event).toBeNull();
});

test("„Nur meine“: Event-Anmeldung, Turnier mit dem Team, gefahrene Fast Lap - in der Event-Karte nur die eigenen", () => {
  const mine = {
    events: {},
    tournaments: { "t-rocket": { state: "approved", label: "Du bist dabei", team_name: "Lions Rocket" } },
    fastlaps: { "f-monza": { state: "driven", label: "Du bist gefahren" } },
  };
  const cards = buildCards(DATA, { onlyMine: true, mine });
  expect(keys(cards).sort()).toEqual(["event-e-lan", "fastlap-f-monza"]);
  expect(cards.find((card) => card.key === "event-e-lan").children.map((row) => row.key)).toEqual(["tournament-t-rocket"]);
  expect(mineState(mine, "tournament", "t-rocket").team_name).toBe("Lions Rocket");
  expect(mineState(mine, "event", "e-lan")).toBeNull();
  // Event selbst angemeldet: die Karte bleibt, auch ohne eigenes Turnier.
  const eventOnly = buildCards(DATA, { onlyMine: true, mine: { events: { "e-fest": { state: "registered" } } } });
  expect(keys(eventOnly)).toEqual(["event-e-fest"]);
  // Wer bei nichts dabei ist, sieht nichts - und ohne „Nur meine“ keine Etiketten.
  expect(buildCards(DATA, { onlyMine: true, mine: null })).toEqual([]);
  expect(buildCards(DATA).every((card) => card.mine === null)).toBe(true);
});

test("Kommend/Vergangen gilt für einzelne Karten, in der Event-Karte bleiben alle Turniere", () => {
  const done = { ...KART, status: "completed" };
  const cards = buildCards({ events: [LAN], tournaments: [done, { ...ONLINE, status: "completed" }], fastlaps: [] }, { keep: (item) => !isPast(item) });
  expect(keys(cards)).toEqual(["event-e-lan"]);
  expect(cards[0].children.map((row) => row.key)).toEqual(["tournament-t-kart"]);
});

test("isPast: beendet oder letzter Tag vor heute (Wiener Tag)", () => {
  expect(isPast({ status: "completed" })).toBe(true);
  expect(isPast({ status: "live", public_phase: { state: "live" }, start_date: "2099-09-29T10:00:00+02:00", end_date: "2099-10-02T10:00:00+02:00" })).toBe(false);
  expect(isPast({ status: "scheduled", start_date: "2099-09-29T10:00:00+02:00" })).toBe(true);
  expect(isPast({ status: "scheduled", start_date: "2099-09-30T20:00:00+02:00" })).toBe(false);
  expect(isPast({ status: "scheduled" })).toBe(false);
});

test("Spielart: Spiel und Einzel/Team, bei der Fast Lap „Fast Lap“", () => {
  expect(playLabel({ kind: "tournament", item: ROCKET })).toBe("Rocket League · Team");
  expect(playLabel({ kind: "tournament", item: KART })).toBe("Mario Kart 8 · Einzel");
  expect(playLabel({ kind: "fastlap", item: LAP })).toBe("Fast Lap");
});

test("Startseite: ein Event mit seinen Turnieren ist eine Zeile", () => {
  const rows = nestUnderEvents([
    { kind: "event", id: "e-lan", label: "Herbst-LAN" },
    { kind: "tournament", id: "t-rocket", event_id: "e-lan", label: "Rocket Cup" },
    { kind: "fastlap", id: "f-lan", event_id: "e-lan", label: "LAN Fast Lap" },
    { kind: "tournament", id: "t-online", label: "Online-Cup" },
    { kind: "tournament", id: "t-other", event_id: "e-elsewhere", label: "Woanders" },
  ]);
  expect(rows.map((row) => row.id)).toEqual(["e-lan", "t-online", "t-other"]);
  expect(rows[0].children.map((row) => row.id)).toEqual(["t-rocket", "f-lan"]);
});
