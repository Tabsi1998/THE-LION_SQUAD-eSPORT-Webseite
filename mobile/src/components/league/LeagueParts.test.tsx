import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { createCeremonyQueue } from "../../achievements/ceremony/queue";
import { StandingsTables } from "../tournament/StandingsTables";
import { standingsTables } from "../../lib/tournamentView";
import { LeagueApplicationsCard } from "./LeagueApplicationsCard";
import { LeagueSeasonHistory } from "./LeagueSeasonHistory";
import { RewardChip, RewardCollection } from "./RewardCollection";
import { RewardMomentHost, UNSEEN_THROTTLE_MS } from "./RewardMomentHost";

// Liga an Team, Profil und Tabelle (#2173): Anmeldestatus mit „Abmelden“, Season-Historie, Belohnungen mit Titel, Zeremonie und
// Zonen in der Tabelle - wie im Web (SquadApplicationStatus, LeagueSeasonHistory, RewardCollection, RewardWatcher, StaffelTable).

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
  resolveMediaUrl: (url: string) => url,
}));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
jest.mock("../../lib/openLink", () => ({ openLink: jest.fn(() => "browser") }));
jest.mock("../MediaImage", () => ({ MediaImage: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ data: {} });
});

test("Liga-Anmeldung am Team: nur die eigenen Co-Teams, Stand im Klartext, übernommene abmelden mit Rückfrage", async () => {
  mockGet.mockResolvedValue({ data: { items: [
    { id: "a1", squad_id: "s1", title: "CoD-Liga · Season 2", url: "/liga/cod/season-2", status: "accepted", staffel: null, can_withdraw: true,
      carry_over: { from_season_name: "Season 1", from_label: "Liga 2", division_label: "Liga 1", movement: "up" } },
    { id: "a2", squad_id: "s2", title: "CoD-Liga · Season 2", status: "waitlist", decision_reason: "Alle Plätze belegt" },
    { id: "x", squad_id: "fremd", title: "Andere", status: "submitted" },
  ] } });
  const alert = jest.spyOn(Alert, "alert").mockImplementation((_title, _text, buttons) => { void buttons?.[1]?.onPress?.(); });
  await render(<LeagueApplicationsCard squadIds={["s1", "s2"]} />);
  await waitFor(() => expect(screen.getByTestId("team-league-applications")).toBeTruthy());
  expect(screen.getByTestId("squad-application-state-a1")).toHaveTextContent("Angemeldet – Zuteilung folgt");
  expect(screen.getByTestId("squad-application-state-a2")).toHaveTextContent("Warteliste");
  expect(screen.getByTestId("squad-application-carry-a1")).toHaveTextContent("Übernommen aus Season 1: Liga 1 (Aufstieg aus Liga 2).");
  expect(screen.getByText("Grund: Alle Plätze belegt")).toBeTruthy();
  expect(screen.queryByTestId("squad-application-x")).toBeNull();
  expect(screen.queryByTestId("squad-application-withdraw-a2")).toBeNull();
  await fireEvent.press(screen.getByTestId("squad-application-withdraw-a1"));
  expect(alert).toHaveBeenCalled();
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/me/league-applications/a1/withdraw", {}));
  await waitFor(() => expect(screen.getByText("Abgemeldet. Der Platz ist frei.")).toBeTruthy());
  alert.mockRestore();
});

test("ohne eigene Anträge (oder für Außenstehende) steht nichts da", async () => {
  mockGet.mockResolvedValue({ data: { items: [] } });
  await render(<LeagueApplicationsCard squadIds={["s1"]} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/me/league-applications"));
  expect(screen.queryByTestId("team-league-applications")).toBeNull();
  mockGet.mockClear();
  await render(<LeagueApplicationsCard squadIds={["s1"]} enabled={false} />);
  expect(mockGet).not.toHaveBeenCalled();
});

test("Season-Historie: Meister, Platz von wie vielen, Auf- und Abstieg", async () => {
  await render(<LeagueSeasonHistory showTeam rows={[
    { season_id: "s1", league_name: "CoD-Liga", season_name: "Season 1", division_label: "Liga 1", staffel: "A", display_name: "Löwen", rank: 1, of: 8, champion: true, zone: null },
    { season_id: "s0", league_name: "CoD-Liga", season_name: "Season 0", division_label: "Liga 2", staffel: "B", display_name: "Löwen", rank: 1, of: 6, zone: "promotion" },
  ]} />);
  expect(screen.getByTestId("league-season-history-champion-s1")).toHaveTextContent("Meister");
  expect(screen.getByText("Platz 1 von 8")).toBeTruthy();
  expect(screen.getByText("Aufstieg")).toBeTruthy();
  expect(screen.getByText("Liga 2 · Staffel B · Löwen")).toBeTruthy();
  await render(<LeagueSeasonHistory rows={[]} />);
  expect(screen.queryByTestId("league-season-history")).toBeNull();
});

const reward = (id: string, kind: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, kind: "trophy", rank: 1, rank_label: "1. Platz", updated_at: "2026-11-12", league: { season_id: "s1", division_label: "Liga 1", staffel: "A" },
  reward: { kind, kind_label: kind === "title" ? "Titel" : "Medaille", name, art: { season: "Season 1", league: "CoD-Liga", place: "1. Platz", metal: "gold" } }, ...extra,
});

test("Belohnungen je Season, Titel wählen nur bei der Art „Titel“ und nur für Besitzer", async () => {
  const onTitle = jest.fn();
  const awards = [reward("m", "medal", "Goldmedaille"), reward("t", "title", "Meister Season 1")] as never;
  await render(<RewardCollection awards={awards} titleId={null} onTitle={onTitle} />);
  expect(screen.getByText("Season 1")).toBeTruthy();
  expect(screen.getByText("Goldmedaille")).toBeTruthy();
  expect(screen.queryByTestId("reward-title-m")).toBeNull();
  await fireEvent.press(screen.getByTestId("reward-title-t"));
  expect(onTitle).toHaveBeenCalledWith("t");
  await render(<RewardCollection awards={awards} titleId="t" onTitle={onTitle} />);
  expect(screen.getByTestId("reward-title-t")).toHaveTextContent("Titel ✓");
  await fireEvent.press(screen.getByTestId("reward-title-t"));
  expect(onTitle).toHaveBeenLastCalledWith(null);
  // Fremdes Profil: ohne Auswahl.
  await render(<RewardCollection awards={awards} />);
  expect(screen.queryByTestId("reward-title-t")).toBeNull();
  await render(<RewardChip award={reward("t", "title", "Meister Season 1") as never} />);
  expect(screen.getByTestId("featured-title")).toHaveTextContent("Meister Season 1");
});

test("Zeremonie: je Staffel ein Paket, nach dem Schließen gesehen - und nie über einer Erfolgs-Zeremonie", async () => {
  mockGet.mockResolvedValue({ data: { rewards: [
    { ...reward("a", "medal", "Gold"), tournament: { id: "t1" } },
    { ...reward("b", "title", "Meister"), tournament: { id: "t1" } },
    { ...reward("c", "banner", "Banner"), tournament: { id: "t2" } },
  ] } });
  const queue = createCeremonyQueue();
  await render(<RewardMomentHost queue={queue} />);
  await waitFor(() => expect(screen.getByTestId("reward-moment-title")).toHaveTextContent("2 neue Belohnungen"));
  await fireEvent.press(screen.getByTestId("reward-moment-close"));
  expect(mockPost).toHaveBeenCalledWith("/me/rewards/seen", { ids: ["a", "b"] });
  await waitFor(() => expect(screen.getByTestId("reward-moment-title")).toHaveTextContent("Neue Belohnung"));
  await fireEvent.press(screen.getByTestId("reward-moment-close"));
  expect(mockPost).toHaveBeenLastCalledWith("/me/rewards/seen", { ids: ["c"] });
  expect(screen.queryByTestId("reward-moment")).toBeNull();
});

test("die Belohnung wartet, solange eine Erfolgs-Zeremonie läuft", async () => {
  mockGet.mockResolvedValue({ data: { rewards: [{ ...reward("a", "medal", "Gold"), tournament: { id: "t1" } }] } });
  const queue = createCeremonyQueue();
  queue.enqueue({ tiers: [{ code: "erfolg", rank: 1 }] } as never);
  await render(<RewardMomentHost queue={queue} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/me/rewards/unseen"));
  expect(screen.queryByTestId("reward-moment")).toBeNull();
});

test("Tabelle einer Liga-Staffel: Zonen je Zeile mit Legende, Endstand darüber", async () => {
  const rows = [
    { registration_id: "r1", display_name: "Löwen", rank: 1, points: 9, zone: "promotion" },
    { registration_id: "r2", display_name: "Falken", rank: 2, points: 6, zone: null },
    { registration_id: "r3", display_name: "Bären", rank: 3, points: 0, zone: "relegation" },
  ];
  const tables = standingsTables(rows, "round_robin", null);
  expect(tables[0].rows.map((row) => row.zone)).toEqual(["promotion", null, "relegation"]);
  await render(<StandingsTables tables={tables} empty="leer" finalNote="Endstand · abgeschlossen am 12.11.2026" />);
  expect(screen.getByTestId("standings-final")).toHaveTextContent("Endstand · abgeschlossen am 12.11.2026");
  expect(screen.getByTestId("standings-zones-all")).toHaveTextContent("AufstiegAbstieg");
  expect(screen.getByTestId("standings-row-all-1").props.accessibilityLabel).toContain("Aufstieg");
  // Gegenprobe: ein Turnier ohne Zonen bleibt wie vorher.
  await render(<StandingsTables tables={standingsTables(rows.map((row) => ({ ...row, zone: null })), "round_robin", null)} empty="leer" />);
  expect(screen.queryByTestId("standings-zones-all")).toBeNull();
  expect(screen.queryByTestId("standings-final")).toBeNull();
});

test("Tippflächen mindestens 44 Punkte: „Als Titel“ mit Namen der Belohnung für den Vorleser", async () => {
  const { StyleSheet } = jest.requireActual("react-native");
  await render(<RewardCollection awards={[reward("t", "title", "Meister Season 1")] as never} titleId={null} onTitle={jest.fn()} />);
  const button = screen.getByTestId("reward-title-t");
  expect(button.props.accessibilityLabel).toBe("Als Titel wählen: Meister Season 1");
  expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44);
  expect(StyleSheet.flatten(button.props.style).minWidth).toBeGreaterThanOrEqual(44);
  await render(<RewardCollection awards={[reward("t", "title", "Meister Season 1")] as never} titleId="t" onTitle={jest.fn()} />);
  expect(screen.getByTestId("reward-title-t").props.accessibilityLabel).toBe("Titel entfernen: Meister Season 1");
});

test("Zeremonie: beim Zurückkommen in den Vordergrund neu nachfragen - gedrosselt, nichts doppelt; die Liste scrollt", async () => {
  const { AppState } = jest.requireActual("react-native");
  let onChange: ((state: string) => void) | null = null;
  const subscription = jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, handler: (state: string) => void) => {
    onChange = handler;
    return { remove: jest.fn() };
  }) as never);
  const now = jest.spyOn(Date, "now");
  let clock = Date.parse("2026-11-15T19:00:00Z");
  now.mockImplementation(() => clock);
  mockGet.mockResolvedValue({ data: { rewards: [] } });
  await render(<RewardMomentHost queue={createCeremonyQueue()} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
  // Kurz weg und wieder da: kein neuer Abruf.
  clock += 60 * 1000;
  onChange?.("active");
  expect(mockGet).toHaveBeenCalledTimes(1);
  // Nach der Drossel: neuer Abruf, die neue Belohnung wird gefeiert.
  clock += UNSEEN_THROTTLE_MS;
  mockGet.mockResolvedValue({ data: { rewards: [{ ...reward("n", "medal", "Neu"), tournament: { id: "t9" } }] } });
  onChange?.("active");
  await waitFor(() => expect(screen.getByTestId("reward-moment-title")).toHaveTextContent("Neue Belohnung"));
  expect(mockGet).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("reward-moment-scroll")).toBeTruthy();
  // Dieselbe Belohnung beim nächsten Abruf: nicht noch einmal eingereiht.
  clock += UNSEEN_THROTTLE_MS;
  onChange?.("active");
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3));
  await fireEvent.press(screen.getByTestId("reward-moment-close"));
  await waitFor(() => expect(screen.queryByTestId("reward-moment")).toBeNull());
  now.mockRestore();
  subscription.mockRestore();
});
