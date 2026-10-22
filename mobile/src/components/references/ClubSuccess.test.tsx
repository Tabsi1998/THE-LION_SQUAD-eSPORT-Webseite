import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { ClubSuccess } from "./ClubSuccess";
import type { ClubReference } from "../../lib/references";

// Verein › Erfolge (#1945, freigegebener Entwurf AppErfolge vom 21.10.2026): Ehrentafel nur mit Werten über null,
// „Läuft gerade“, Vitrine (Hauptkarte nach derselben Regel wie im Web), Serien und Ligen mit Liga-Weg und die Chronik mit
// Spiel-Filter. Alte Server ohne Bilanz, Spuren oder laufende Saisons: die Abschnitte fehlen, nichts stürzt ab.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const items: ClubReference[] = [
  { id: "winter", display_title: "Rocket League Winterliga", start_date: "2026-02-14T18:00:00Z", best_placement: 1, game: { id: "rl", name: "Rocket League" }, entries: [{ id: "w", kind: "team", team_name: "Team Lions A", placement: 1, team_count: 12, placement_label: "Meister" }] },
  { id: "desbl-s5", display_title: "DeSBL · 1. Liga · S5", start_date: "2025-08-20T18:00:00Z", best_placement: 5, game: { id: "cod", name: "Black Ops 6" }, entries: [] },
  { id: "lan", display_title: "LAN-Cup Wien · Sommer", start_date: "2025-07-12T10:00:00Z", best_placement: 2, game: { id: "cod", name: "Black Ops 6" }, entries: [] },
];
const running = [{
  lineage: { title: "Probe Racing League", slug: "prl", kind: "racing", game_name: "F1 26" },
  series: { season: "2026", title: "PRL 35 · Season 2026", season_slug: "2026" },
  progress: { total: 24, scored: 11 },
  next: { code: "R12", state: "today", time: "20:00", club_day: "2026-10-21", country_code: "nl" },
  today: true,
  club: { rank: 4, of: 20 },
}];
const lineages = [{
  lineage: { title: "DeSBL S&D 4vs4", slug: "desbl", kind: "team_league" },
  seasons: [
    { season: "Season 4", tier: "2. Liga", status: "completed", season_slug: "s4", club: { rank: 5, of: 9 }, season_result: "promoted", reference_ids: [] },
    { season: "Season 5", tier: "1. Liga", status: "completed", season_slug: "s5", club: { rank: 5, of: 10 }, reference_ids: ["desbl-s5"] },
  ],
}];

function answer(path: string) {
  if (path === "/reference-series/public/running") return Promise.resolve({ data: { items: running } });
  if (path === "/reference-series/public/lineages") return Promise.resolve({ data: { items: lineages } });
  return Promise.reject(new Error(`unerwartet: ${path}`));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation(answer);
  // Flaggen (#1925) kommen von der Website - im Test ohne Netz: dann steht der Ländercode da.
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => { throw new Error("offline"); });
});

test("Ehrentafel nur mit Werten über null, darunter Teilnahmen, Spiele und „seit“", async () => {
  await render(<ClubSuccess items={items} summary={{ total: 27, gold: 3, silver: 0, bronze: 2, games: 6 }} showcase={null} onOpenSeason={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId("club-success-honor")).toBeTruthy());
  const honor = screen.getByTestId("club-success-honor");
  expect(within(honor).getByText("Siege")).toBeTruthy();
  expect(within(honor).getByText("Dritte")).toBeTruthy();
  expect(within(honor).queryByText("Zweite")).toBeNull();
  expect(screen.getByText("27 Teilnahmen · 6 Spiele · seit 2025")).toBeTruthy();
});

test("Läuft gerade, Vitrine, Serien und Ligen führen zur Saison in der App", async () => {
  const onOpenSeason = jest.fn();
  await render(<ClubSuccess items={items} summary={{ total: 3, gold: 1, silver: 1 }} showcase={null} onOpenSeason={onOpenSeason} />);
  await waitFor(() => expect(screen.getByTestId("running-card-prl/2026")).toBeTruthy());
  const card = screen.getByTestId("running-card-prl/2026");
  expect(within(card).getByText("Rennliga · F1 26")).toBeTruthy();
  expect(within(card).getByText("PRL 35 · Season 2026")).toBeTruthy();
  expect(within(card).getByText("Heute · R12 · 20:00")).toBeTruthy();
  // Die Flagge des nächsten Termins (#1925) - ohne Netz als Ländercode.
  await waitFor(() => expect(within(card).getByText("NL")).toBeTruthy());
  expect(within(card).getByLabelText("Niederlande")).toBeTruthy();
  expect(within(card).getByText("Bester Vereinsfahrer: P4 von 20")).toBeTruthy();
  expect(screen.getByTestId("reference-pulse")).toBeTruthy();
  await fireEvent.press(card);
  expect(onOpenSeason).toHaveBeenLastCalledWith({ lineage: "prl", season: "2026" });

  // Vitrine: der höchste Platz (automatisch), mit Zusatz und Monat.
  const showcase = screen.getByTestId("club-success-showcase");
  expect(within(showcase).getByText("1. Platz · Meister")).toBeTruthy();
  expect(within(showcase).getByText("Team Lions A · von 12 Teams · Februar 2026")).toBeTruthy();

  // Serien und Ligen: Liga-Weg mit Vermerk, die Karte führt zur neuesten Saison.
  const lineage = screen.getByTestId("club-success-lineage-desbl");
  expect(within(lineage).getByText("2 Saisons · 1 Aufstieg")).toBeTruthy();
  expect(within(lineage).getByText("5. · Aufstieg")).toBeTruthy();
  await fireEvent.press(lineage);
  expect(onOpenSeason).toHaveBeenLastCalledWith({ lineage: "desbl", season: "s5" });
});

test("Vitrine fest gewählt: die gewählte Referenz ist die Hauptkarte", async () => {
  await render(<ClubSuccess items={items} summary={null} showcase={{ mode: "pinned", reference_id: "lan" }} onOpenSeason={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId("club-success-showcase")).toBeTruthy());
  expect(within(screen.getByTestId("club-success-showcase")).getByText("LAN-Cup Wien · Sommer")).toBeTruthy();
});

test("Chronik mit Spiel-Filter: neueste zuerst, eine Saison öffnet in der App, sonst die Referenz im Web", async () => {
  const onOpenSeason = jest.fn();
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await render(<ClubSuccess items={items} summary={null} showcase={null} onOpenSeason={onOpenSeason} />);
  await waitFor(() => expect(screen.getByTestId("club-success-chronicle")).toBeTruthy());
  const list = () => screen.getAllByTestId(/^club-success-row-/).map((row) => row.props.testID);
  expect(list()).toEqual(["club-success-row-winter", "club-success-row-desbl-s5", "club-success-row-lan"]);
  await fireEvent.press(screen.getByTestId("club-success-game-cod"));
  expect(list()).toEqual(["club-success-row-desbl-s5", "club-success-row-lan"]);
  expect(screen.getByTestId("club-success-game-cod").props.accessibilityState).toEqual({ selected: true });
  await fireEvent.press(screen.getByTestId("club-success-row-desbl-s5"));
  expect(onOpenSeason).toHaveBeenLastCalledWith({ lineage: "desbl", season: "s5" });
  await fireEvent.press(screen.getByTestId("club-success-row-lan"));
  expect(open).toHaveBeenLastCalledWith(expect.stringMatching(/\/references\/lan$/));
  open.mockRestore();
});

const probeCups = (count: number): ClubReference[] => Array.from({ length: count }, (_, index) => ({
  id: `r${index}`, display_title: `Probe-Cup ${index}`, best_placement: (index % 12) + 1,
  start_date: new Date(Date.UTC(2026, 0, 1) - index * 86400000).toISOString(),
  game: index % 2 ? { id: "rl", name: "Rocket League" } : { id: "mk", name: "Mario Kart 8" },
}));

test("lange Chronik: von 1000 Einträgen zuerst 20, „Mehr anzeigen“ holt je 20 dazu - ein Spiel-Filter beginnt wieder oben", async () => {
  const many = probeCups(1000);
  mockGet.mockResolvedValue({ data: { items: [] } });
  await render(<ClubSuccess items={many} summary={{ total: 1000 }} showcase={null} onOpenSeason={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId("club-success-chronicle")).toBeTruthy());
  const rows = () => screen.queryAllByTestId(/^club-success-row-/);
  expect(rows()).toHaveLength(20);
  expect(screen.getByText("Mehr anzeigen (980 weitere)")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("club-success-more"));
  expect(rows()).toHaveLength(40);
  expect(screen.getByText("Mehr anzeigen (960 weitere)")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("club-success-game-rl"));
  expect(rows()).toHaveLength(20);
  expect(rows()[0].props.testID).toBe("club-success-row-r1");
});

test("am Ende der Chronik verschwindet „Mehr anzeigen“", async () => {
  mockGet.mockResolvedValue({ data: { items: [] } });
  await render(<ClubSuccess items={probeCups(45)} summary={{ total: 45 }} showcase={null} onOpenSeason={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId("club-success-chronicle")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("club-success-more"));
  expect(screen.getByText("Mehr anzeigen (5 weitere)")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("club-success-more"));
  expect(screen.queryAllByTestId(/^club-success-row-/)).toHaveLength(45);
  expect(screen.queryByTestId("club-success-more")).toBeNull();
});

test("alter Server: ohne Bilanz, Spuren und laufende Saisons nur Vitrine und Chronik - keine Nullen", async () => {
  mockGet.mockRejectedValue(new Error("404"));
  await render(<ClubSuccess items={[{ id: "alt", title: "Herbst-Cup", placement: 3, start_date: "2024-10-01" }]} summary={null} showcase={undefined} onOpenSeason={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId("club-success-chronicle")).toBeTruthy());
  expect(screen.queryByTestId("club-success-honor")).toBeNull();
  expect(screen.queryByTestId("club-success-running")).toBeNull();
  expect(screen.queryByTestId("club-success-series")).toBeNull();
  expect(screen.queryByText(/^0 /)).toBeNull();
  expect(within(screen.getByTestId("club-success-showcase")).getByText("Herbst-Cup")).toBeTruthy();
  // Nur ein Spiel: keine Filter-Chips.
  expect(screen.queryByTestId("club-success-game-all")).toBeNull();
});

test("ohne Referenzen und ohne laufende Saison: ein leerer Zustand statt leerer Abschnitte", async () => {
  mockGet.mockResolvedValue({ data: { items: [] } });
  await render(<ClubSuccess items={[]} summary={{ total: 0 }} showcase={null} onOpenSeason={jest.fn()} />);
  await waitFor(() => expect(screen.getByText("Noch keine Referenzen")).toBeTruthy());
});

test("Läuft gerade mit Läufen (#1930) und Veranstalter (#1934): Lauf-Chips, Partner-Abzeichen an Karte und Spur", async () => {
  mockGet.mockImplementation((path: string) => {
    if (path === "/reference-series/public/running") return Promise.resolve({ data: { items: [{
      ...running[0],
      today: false,
      next: { code: "R13", session: "Qualifying", state: "planned", time: "19:30", club_day: "2026-10-29", sessions: [
        { session: "Qualifying", club_day: "2026-10-29", time: "19:30", state: "planned", next: true },
        { session: "Rennen", club_day: "2026-10-29", time: "20:30", state: "planned", next: false },
      ] },
      organizers: [{ id: "p1", slug: "probe-ananas", name: "Probe Ananas", logo_url: null }],
    }] } });
    if (path === "/reference-series/public/lineages") return Promise.resolve({ data: { items: [{ ...lineages[0], lineage: { ...lineages[0].lineage, organizers: [{ id: "p2", name: "Probe Kokos" }] } }] } });
    return Promise.reject(new Error(`unerwartet: ${path}`));
  });
  await render(<ClubSuccess items={items} summary={{ total: 3 }} showcase={null} onOpenSeason={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId("running-card-prl/2026")).toBeTruthy());
  const card = screen.getByTestId("running-card-prl/2026");
  expect(within(card).getByText("Nächstes Rennen · Do 29.10. · 19:30 · R13 · Qualifying")).toBeTruthy();
  const chips = within(card).getByTestId("running-card-sessions-prl/2026");
  expect(within(chips).getByText("Quali")).toBeTruthy();
  expect(within(chips).getByText("20:30")).toBeTruthy();
  expect(within(card).getByLabelText("Veranstaltet von Probe Ananas, Partner des Vereins")).toBeTruthy();
  expect(within(screen.getByTestId("club-success-lineage-desbl")).getByLabelText("Veranstaltet von Probe Kokos, Partner des Vereins")).toBeTruthy();
});