import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { LeagueApplicationsCard } from "./LeagueApplicationsCard";

// Startrechte am Team (#1627, docs/LIGA.md F.2a, Web: StartRightBlock.jsx und SquadApplicationStatus.jsx): Mit offener Zusage steht
// dort nicht mehr „Angemeldet“, sondern der Stand mit Frist - und Captain und Vertreter sagen in der App zu oder lehnen das Nachrücken ab.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("../../lib/openLink", () => ({ openLink: jest.fn(() => "browser") }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const UNTIL = "2026-12-15T17:00:00Z";
const application = (start_right: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: "a1", squad_id: "s1", title: "CoD-Liga · Season 3", url: "/liga/cod/season-3", status: "accepted", staffel: null, can_withdraw: true,
  carry_over: { from_season_name: "Season 2", from_label: "Liga 2", division_label: "Liga 1", movement: "up", start_right },
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ data: { ok: true } });
});

test("offene Zusage: Abzeichen und Satz mit Frist statt „Angemeldet“, Zusage geht an den Server und lädt neu", async () => {
  mockGet.mockResolvedValueOnce({ data: { items: [application({ state: "offered", accept_until: UNTIL, can_accept: true })], start_rights: [] } })
    .mockResolvedValueOnce({ data: { items: [application({ state: "accepted" })], start_rights: [] } });
  await render(<LeagueApplicationsCard squadIds={["s1"]} />);
  await waitFor(() => expect(screen.getByTestId("squad-application-state-a1")).toHaveTextContent("Startrecht – Zusage offen"));
  expect(screen.getByTestId("squad-start-right-line-a1")).toHaveTextContent("Startrecht für Liga 1: bitte bis 15.12.2026, 18:00 Uhr zusagen. Ohne Zusage verfällt es.");
  expect(screen.queryByTestId("squad-start-right-decline-a1")).toBeNull();
  await fireEvent.press(screen.getByTestId("squad-start-right-accept-a1"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/me/league-applications/a1/start-right", { action: "accept" }));
  await waitFor(() => expect(screen.getByTestId("team-league-applications-message")).toHaveTextContent("Zugesagt für Liga 1. Die Staffel teilt die Liga-Leitung noch zu."));
  await waitFor(() => expect(screen.getByTestId("squad-application-state-a1")).toHaveTextContent("Zugesagt – Zuteilung folgt"));
  expect(mockGet).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId("squad-start-right-accept-a1")).toBeNull();
});

test("Nachrücken ablehnen: Rückfrage mit dem, was dann gilt, danach Ablehnen beim Server", async () => {
  mockGet.mockResolvedValue({ data: { items: [application({ state: "offered", accept_until: UNTIL, can_accept: true, can_decline: true,
    fills: { from_label: "Liga 2", own_open: true, rest_days: 3 } })] } });
  const alert = jest.spyOn(Alert, "alert").mockImplementation((_title, _text, buttons) => { void buttons?.[1]?.onPress?.(); });
  await render(<LeagueApplicationsCard squadIds={["s1"]} />);
  await waitFor(() => expect(screen.getByTestId("squad-start-right-decline-a1")).toBeTruthy());
  expect(screen.getByTestId("squad-start-right-line-a1")).toHaveTextContent(/Ablehnen gilt als Zusage für Liga 2\./);
  await fireEvent.press(screen.getByTestId("squad-start-right-decline-a1"));
  expect(alert).toHaveBeenCalledWith("Nachrücken ablehnen?",
    "Ihr bleibt in Liga 2 – das gilt zugleich als eure Zusage für Liga 2. Der Platz in Liga 1 geht an das nächste Team, zurück geht das nicht.", expect.any(Array));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/me/league-applications/a1/start-right", { action: "decline" }));
  await waitFor(() => expect(screen.getByText("Abgelehnt. Ihr bleibt in Liga 2 – das gilt als eure Zusage dort.")).toBeTruthy());
  alert.mockRestore();
});

test("abgebrochene Rückfrage schickt nichts", async () => {
  mockGet.mockResolvedValue({ data: { items: [application({ state: "offered", can_decline: true, fills: { from_label: "Liga 2" } })] } });
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await render(<LeagueApplicationsCard squadIds={["s1"]} />);
  await waitFor(() => expect(screen.getByTestId("squad-start-right-decline-a1")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("squad-start-right-decline-a1"));
  expect(alert).toHaveBeenCalled();
  expect(mockPost).not.toHaveBeenCalled();
  alert.mockRestore();
});

test("Frist vorbei: der Server sagt nein - seine Meldung steht da, der Stand kommt frisch", async () => {
  mockGet.mockResolvedValue({ data: { items: [application({ state: "offered", accept_until: UNTIL, can_accept: true })] } });
  mockPost.mockRejectedValue(new Error("Die Frist für die Zusage ist vorbei."));
  await render(<LeagueApplicationsCard squadIds={["s1"]} />);
  await waitFor(() => expect(screen.getByTestId("squad-start-right-accept-a1")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("squad-start-right-accept-a1"));
  await waitFor(() => expect(screen.getByText("Die Frist für die Zusage ist vorbei.")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledTimes(2);
});

test("Leitung entscheidet und Frist ruht: ohne Knopf, wo der Server nichts erlaubt", async () => {
  mockGet.mockResolvedValue({ data: { items: [
    application({ state: "offered", accept_until: UNTIL, waits_for_lead: true }),
    application({ state: "offered", accept_until: null, paused: true, can_accept: true }, { id: "a2", squad_id: "s2" }),
  ] } });
  await render(<LeagueApplicationsCard squadIds={["s1", "s2"]} />);
  await waitFor(() => expect(screen.getByTestId("squad-application-state-a1")).toHaveTextContent("Startrecht – Leitung entscheidet"));
  expect(screen.getByTestId("squad-start-right-line-a1")).toHaveTextContent(/Jetzt entscheidet die Liga-Leitung – meldet euch dort\./);
  expect(screen.queryByTestId("squad-start-right-accept-a1")).toBeNull();
  expect(screen.getByTestId("squad-start-right-line-a2")).toHaveTextContent(/Die Frist ruht, solange der Endstand der Vorgänger-Season geprüft wird/);
  expect(screen.getByTestId("squad-start-right-accept-a2")).toBeTruthy();
});

test("vor der Folge-Season: Prognose und bestätigtes Startrecht der eigenen Co-Teams, ohne Knopf", async () => {
  mockGet.mockResolvedValue({ data: { items: [], start_rights: [
    { squad_id: "s1", season_id: "se2", title: "CoD-Liga · Season 2", url: "/liga/cod/season-2", state: "confirmed", movement: "up", division_label: "Liga 1" },
    { squad_id: "s2", season_id: "se2", title: "CoD-Liga · Season 2", state: "forecast", movement: "down", rank: 7, division_label: null },
    { squad_id: "fremd", season_id: "se2", title: "Andere", state: "forecast", movement: "up" },
  ] } });
  await render(<LeagueApplicationsCard squadIds={["s1", "s2"]} />);
  await waitFor(() => expect(screen.getByTestId("squad-start-right-outlook-s1-se2")).toBeTruthy());
  expect(screen.getByTestId("squad-start-right-outlook-s1-se2-state")).toHaveTextContent("Startrecht bestätigt");
  expect(screen.getByText("Bestätigt: Startrecht für Liga 1 in der nächsten Season (Aufstieg). Zusagen geht, sobald die neue Season angelegt ist.")).toBeTruthy();
  expect(screen.getByTestId("squad-start-right-outlook-s2-se2-state")).toHaveTextContent("Prognose");
  expect(screen.getByText("Prognose nach der laufenden Tabelle: Abstieg (Platz 7). Fest ist das erst, wenn die Season abgeschlossen ist.")).toBeTruthy();
  expect(screen.queryByTestId("squad-start-right-outlook-fremd-se2")).toBeNull();
});

test("Season ohne Startrechte: alles wie bisher", async () => {
  mockGet.mockResolvedValue({ data: { items: [{ id: "a1", squad_id: "s1", title: "CoD-Liga · Season 2", status: "accepted", staffel: null,
    carry_over: { from_season_name: "Season 1", from_label: "Liga 2", division_label: "Liga 1", movement: "up" } }] } });
  await render(<LeagueApplicationsCard squadIds={["s1"]} />);
  await waitFor(() => expect(screen.getByTestId("squad-application-state-a1")).toHaveTextContent("Angemeldet – Zuteilung folgt"));
  expect(screen.queryByTestId("squad-start-right-a1")).toBeNull();
});
