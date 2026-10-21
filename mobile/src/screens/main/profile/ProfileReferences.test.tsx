import React from "react";
import { Linking, Text } from "react-native";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { ProfileReferences } from "./ProfileReferences";
import type { MemberPlacements } from "../../../lib/memberPlacements";
import type { PersonalReferenceItem } from "../../../types";

// Profil-Reiter „Referenzen“ (#1945, freigegebener Entwurf „AppProfil“ vom 21.10.2026): Kopf ohne Nullen, Liga-Weg zum
// Wischen, Chronik je Jahr mit aufklappbaren Zeilen - die Person in der Aufstellung hervorgehoben, „Saison ansehen“.
// Die eigenen Turniere der Plattform stehen mit ihrem Weg in derselben Chronik. Nur erfundene Namen.

const mockGet = jest.fn();
jest.mock("../../../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const ME = "mp-mira";
const ref = (id: string, title: string, start: string, placement: number, lineup: string[]) => ({
  id, display_title: title, start_date: start, best_placement: placement, game: { name: "Black Ops 6" }, member_profile_ids: [ME],
  entries: [{ id: `${id}-e`, kind: "team", team_name: "Lions Probe", placement, team_count: 8, lineup_members: lineup.map((name) => ({ profile_id: name === "Mira Stahl" ? ME : `p-${name}`, display_name: name })) }],
});
const CLUB: MemberPlacements = {
  profileId: ME,
  references: [
    ref("league-a", "DeSBL · League A", "2025-05-19T18:00:00Z", 4, ["Mira Stahl", "Kai Funke"]),
    ref("liga2", "DeSBL · 2. Liga · S4", "2025-06-18T18:00:00Z", 5, ["Kai Funke", "Mira Stahl"]),
    ref("newcomer", "DeSBL · Newcomer League I · S3", "2026-05-06T18:00:00Z", 6, ["Mira Stahl", "Lea Brandt"]),
  ],
  lineages: [{
    lineage: { slug: "desbl", title: "DeSBL S&D 4vs4", kind: "team_league" },
    seasons: [
      { season: "Mai 2025", tier: "League A", status: "completed", season_slug: "a", reference_ids: ["league-a"] },
      { season: "Season 4", tier: "2. Liga", status: "completed", season_slug: "s4", reference_ids: ["liga2"], season_result: "promoted" },
      { season: "Season 3", tier: "Newcomer League I", status: "active", season_slug: "s3", reference_ids: ["newcomer"] },
    ],
  }],
};
const CUP: PersonalReferenceItem = { id: "tournament:cup", kind: "tournament", title: "FC 26 Cup", subtitle: "EA SPORTS FC 26", rank: 7, date: "2026-03-01T10:00:00Z", target_id: "fc-26-cup", participant_count: 16 };

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: { steps: [{ kind: "duel", label: "Runde 1", result: "2:0", outcome: "win", opponent: "Fremd Eins" }], final: { rank: 7, participant_count: 16 } } });
});

test("Kopf ohne Nullen, Liga-Weg und Chronik je Jahr", async () => {
  await render(<ProfileReferences personal={[CUP]} club={CLUB} username="mira" onOpenSeason={jest.fn()} onOpenPersonal={jest.fn()} empty={<Text>leer</Text>} />);
  const head = screen.getByTestId("profile-references-head");
  expect(within(head).getByText("Bestes Ergebnis")).toBeTruthy();
  expect(within(head).getByText("DeSBL · League A")).toBeTruthy();
  expect(within(head).getByText("Mai 2025 · von 8 Teams")).toBeTruthy();
  expect(within(head).getByText("4")).toBeTruthy();
  expect(within(head).getByText("Teilnahmen")).toBeTruthy();
  expect(within(head).getByText("dabei seit")).toBeTruthy();
  expect(within(head).queryByText("Gold")).toBeNull();

  expect(screen.getByText("Liga-Weg · DeSBL S&D 4vs4")).toBeTruthy();
  expect(screen.getByText("5. · Aufstieg")).toBeTruthy();

  expect(within(screen.getByTestId("profile-references-year-2026")).getByText("2 Teilnahmen")).toBeTruthy();
  expect(within(screen.getByTestId("profile-references-year-2025")).getByText("2 Teilnahmen")).toBeTruthy();
});

test("Zeile aufklappen: Team, Aufstellung mit der Person hervorgehoben und „Saison ansehen“ - immer nur eine offen", async () => {
  const onOpenSeason = jest.fn();
  await render(<ProfileReferences personal={[]} club={CLUB} username="mira" onOpenSeason={onOpenSeason} onOpenPersonal={jest.fn()} empty={null} />);
  const row = screen.getByTestId("profile-reference-club:newcomer");
  expect(row.props.accessibilityState).toEqual({ expanded: false });
  await fireEvent.press(row);
  expect(screen.getByTestId("profile-reference-club:newcomer").props.accessibilityState).toEqual({ expanded: true });
  const detail = screen.getByTestId("profile-reference-detail-club:newcomer");
  expect(within(detail).getByText("Lions Probe · von 8 Teams")).toBeTruthy();
  expect(within(detail).getByTestId("lineup-me").props.accessibilityLabel).toBe("Mira Stahl, du");
  expect(within(detail).getByText("Lea Brandt")).toBeTruthy();
  await fireEvent.press(within(detail).getByText("Saison ansehen"));
  expect(onOpenSeason).toHaveBeenCalledWith({ lineage: "desbl", season: "s3" });

  await fireEvent.press(screen.getByTestId("profile-reference-club:liga2"));
  expect(screen.queryByTestId("profile-reference-detail-club:newcomer")).toBeNull();
  expect(screen.getByTestId("profile-reference-detail-club:liga2")).toBeTruthy();
});

test("Aufstellung mit Einsätzen (#1931): „Aufstellung · 5 von 7 Spielen“, ohne Aufstellung „Einsätze · …“", async () => {
  const withPlayed = {
    ...CLUB,
    references: [
      { ...CLUB.references[2], appearances: { played: 5, of: 7, unit: "matches" } },
      { ...CLUB.references[1], entries: [{ id: "solo", kind: "solo", placement: 5, member_profile_ids: [ME] }], appearances: { played: 3, of: 5, unit: "races" } },
    ],
  };
  await render(<ProfileReferences personal={[]} club={withPlayed} username="mira" onOpenSeason={jest.fn()} onOpenPersonal={jest.fn()} empty={null} />);
  await fireEvent.press(screen.getByTestId("profile-reference-club:newcomer"));
  const detail = screen.getByTestId("profile-reference-detail-club:newcomer");
  expect(within(detail).getByTestId("profile-reference-lineup-club:newcomer").props.accessibilityLabel).toBe("Aufstellung · 5 von 7 Spielen");
  expect(within(detail).getByText("5 von 7 Spielen", { exact: false })).toBeTruthy();

  await fireEvent.press(screen.getByTestId("profile-reference-club:liga2"));
  const solo = screen.getByTestId("profile-reference-detail-club:liga2");
  expect(within(solo).getByText("Einsätze · 3 von 5 Rennen")).toBeTruthy();
});

test("ohne Saison führt die Zeile ins Web", async () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await render(<ProfileReferences personal={[]} club={{ ...CLUB, lineages: [] }} username="mira" onOpenSeason={jest.fn()} onOpenPersonal={jest.fn()} empty={null} />);
  await fireEvent.press(screen.getByTestId("profile-reference-club:liga2"));
  await fireEvent.press(within(screen.getByTestId("profile-reference-detail-club:liga2")).getByText("Im Web öffnen"));
  expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/references\/liga2$/));
  open.mockRestore();
});

test("eigenes Turnier: aufgeklappt mit seinem Weg und dem Weg zum Turnier", async () => {
  const onOpenPersonal = jest.fn();
  await render(<ProfileReferences personal={[CUP]} club={null} username="mira" own onOpenSeason={jest.fn()} onOpenPersonal={onOpenPersonal} empty={null} />);
  expect(mockGet).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId("profile-reference-personal:tournament:cup"));
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/profile/mira/tournaments/fc-26-cup/path", undefined));
  expect(await screen.findByText("Runde 1")).toBeTruthy();
  await fireEvent.press(screen.getByText("Turnier ansehen"));
  expect(onOpenPersonal).toHaveBeenCalledWith(CUP);
  // Zu und wieder auf: kein zweites Laden.
  await fireEvent.press(screen.getByTestId("profile-reference-personal:tournament:cup"));
  await fireEvent.press(screen.getByTestId("profile-reference-personal:tournament:cup"));
  expect(mockGet).toHaveBeenCalledTimes(1);
});

test("mit Podest nur die vorhandenen Medaillen; ohne Einträge der leere Zustand", async () => {
  const first = await render(<ProfileReferences personal={[{ ...CUP, rank: 1 }]} club={null} username="mira" onOpenSeason={jest.fn()} onOpenPersonal={jest.fn()} empty={<Text>leer</Text>} />);
  const head = screen.getByTestId("profile-references-head");
  expect(within(head).getByText("Gold")).toBeTruthy();
  expect(within(head).queryByText("Silber")).toBeNull();
  expect(within(head).queryByText("Bestes Ergebnis")).toBeNull();
  await first.unmount();
  await render(<ProfileReferences personal={[]} club={null} username="mira" onOpenSeason={jest.fn()} onOpenPersonal={jest.fn()} empty={<Text>leer</Text>} />);
  expect(screen.getByText("leer")).toBeTruthy();
  expect(screen.queryByTestId("profile-references-head")).toBeNull();
});
