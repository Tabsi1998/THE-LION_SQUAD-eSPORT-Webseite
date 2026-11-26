import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { LeagueSeasonCard } from "./LeagueSeasonCard";

// Mit Co-Team anmelden (#2542, docs/LIGA.md B.4, Web: LeagueApplicationPanel.jsx): Auf der Seite der Staffel steht bei offenem Fenster
// „Mit Co-Team anmelden“ - nur für angemeldete Captains und Vertreter mit einem Co-Team, das sich anmelden kann.

const mockGet = jest.fn();
let mockUser: Record<string, unknown> | null = { id: "u1", username: "kapitaen" };
jest.mock("../../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("../../live", () => ({ isGuestUser: (user: { id?: string } | null) => !user || user.id === "guest" }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const PAGE = { application: { state: "open", closes_at: "2027-01-19T22:59:00Z" } };
const VIEW = (squads: unknown[]) => ({ application: { state: "open" }, season_problems: [], squads });

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: "u1", username: "kapitaen" };
});

function serve(view: unknown) {
  mockGet.mockImplementation(async (path: string) => ({ data: path.endsWith("/application") ? view : PAGE }));
}

test("Captain mit freiem Co-Team: „Mit Co-Team anmelden“ öffnet die Schritte", async () => {
  serve(VIEW([{ squad_id: "s1", can_apply: true, state: "none" }]));
  const onApply = jest.fn();
  await render(<LeagueSeasonCard publicPath="/liga/cod/season-3" title="CoD-Liga · Season 3" onOpenOverall={jest.fn()} onApply={onApply} />);
  await waitFor(() => expect(screen.getByTestId("league-season-card-apply")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith("/leagues/cod/season-3/application");
  await fireEvent.press(screen.getByTestId("league-season-card-apply"));
  expect(onApply).toHaveBeenCalledWith({ league: "cod", season: "season-3" });
});

test("kein freies Co-Team (schon angemeldet, nicht Captain) oder als Gast: kein Knopf", async () => {
  serve(VIEW([{ squad_id: "s1", can_apply: true, state: "submitted" }, { squad_id: "s2", can_apply: false, state: "none" }]));
  await render(<LeagueSeasonCard publicPath="/liga/cod/season-3" onOpenOverall={jest.fn()} onApply={jest.fn()} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/leagues/cod/season-3/application"));
  await waitFor(() => expect(screen.getByTestId("league-season-card-window")).toBeTruthy());
  expect(screen.queryByTestId("league-season-card-apply")).toBeNull();

  mockGet.mockClear();
  mockUser = { id: "guest" };
  serve(VIEW([{ squad_id: "s1", can_apply: true, state: "none" }]));
  await render(<LeagueSeasonCard publicPath="/liga/cod/season-3" onOpenOverall={jest.fn()} onApply={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId("league-season-card-window")).toBeTruthy());
  expect(mockGet).not.toHaveBeenCalledWith("/leagues/cod/season-3/application");
  expect(screen.queryByTestId("league-season-card-apply")).toBeNull();
});
