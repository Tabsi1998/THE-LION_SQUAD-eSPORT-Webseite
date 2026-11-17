import React from "react";
import { act, render, screen } from "@testing-library/react-native";

// Turniertag (#1169): Auf stillen Screens und solange das eigene Spiel aufgerufen ist oder läuft, bleibt die Bühne
// leer - nach dem Ergebnis kommt die Deko zurück. Der Reiter „Baum“ hält sie still, solange er offen ist.

const mockSeasonState: Record<string, unknown> = { ready: true, seasons: [], byKey: {}, preference: "on", setPreference: jest.fn(async () => {}), reducedMotion: false, reload: jest.fn(), toast: null, showToast: jest.fn() };
jest.mock("./SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }) }));
const mockRoute = { name: "Dashboard" };
jest.mock("../navigation/rootNavigation", () => ({
  navigationRef: { isReady: () => true, getCurrentRoute: () => mockRoute, addListener: () => () => {}, navigate: jest.fn() },
  openTab: jest.fn(),
  openDetail: jest.fn(),
}));

const { SeasonStage, SeasonWidgetSlot } = require("./SeasonStage");
const { clearOwnMatches, clearStillHolds, noteOwnMatches, setStillHold } = require("./matchPause");

const halloween = () => ({ key: "halloween", label: "Halloween", phase: "deko", intensity: "normal", effective: "normal", channels: ["app"], texts: {}, data: {} });

beforeEach(() => {
  mockSeasonState.seasons = [halloween()];
  mockRoute.name = "Dashboard";
  clearOwnMatches();
  clearStillHolds();
});

test("Gegenprobe: auf dem Dashboard ist die Deko da", async () => {
  await render(<><SeasonStage /><SeasonWidgetSlot /></>);
  expect(screen.getByTestId("season-stage")).toBeTruthy();
  expect(screen.getByTestId("season-widget-slot")).toBeTruthy();
});

test.each(["MatchDetail", "TournamentLead"])("%s bleibt ganz ohne Deko", async (name) => {
  mockRoute.name = name;
  await render(<SeasonStage />);
  expect(screen.queryByTestId("season-stage")).toBeNull();
});

test("Gegenprobe: die Turnierseite selbst bleibt ruhig, nicht still", async () => {
  mockRoute.name = "TournamentDetail";
  await render(<SeasonStage />);
  expect(screen.getByTestId("season-stage")).toBeTruthy();
});

test("Reiter „Baum“ hält die Bühne still, danach kommt sie zurück", async () => {
  mockRoute.name = "TournamentDetail";
  await render(<SeasonStage />);
  await act(async () => setStillHold("bracket-t-1", "TournamentBracket", true));
  expect(screen.queryByTestId("season-stage")).toBeNull();
  await act(async () => setStillHold("bracket-t-1", "TournamentBracket", false));
  expect(screen.getByTestId("season-stage")).toBeTruthy();
});

test("eigenes Spiel aufgerufen oder laufend: Pause überall, nach dem Ergebnis kommt die Deko zurück", async () => {
  await render(<><SeasonStage /><SeasonWidgetSlot /></>);
  await act(async () => noteOwnMatches([{ id: "m-1", status: "ready", live_state: "called" }], "dashboard"));
  expect(screen.queryByTestId("season-stage")).toBeNull();
  expect(screen.queryByTestId("season-widget-slot")).toBeNull();
  await act(async () => noteOwnMatches([{ id: "m-1", status: "in_progress" }], "match"));
  expect(screen.queryByTestId("season-stage")).toBeNull();
  await act(async () => noteOwnMatches([{ id: "m-1", status: "completed" }], "match"));
  expect(screen.getByTestId("season-stage")).toBeTruthy();
  expect(screen.getByTestId("season-widget-slot")).toBeTruthy();
});

test("Gegenprobe: ein geplantes eigenes Spiel pausiert nichts", async () => {
  await render(<SeasonStage />);
  await act(async () => noteOwnMatches([{ id: "m-1", status: "scheduled" }], "dashboard"));
  expect(screen.getByTestId("season-stage")).toBeTruthy();
});
