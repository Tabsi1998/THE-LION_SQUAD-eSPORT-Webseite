import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { HonourList, HonoursCard, honourLine, participationLine, participationsByYear } from "./Honours";

// Ehrungen (#848) in der App - wie im Web: alle eigenen mit Hinweis, der Schalter bringt freigegebene aufs Profil;
// ohne Verbindung zur Akte keine Karte, ohne Fähigkeit der Grund.

const mockGet = jest.fn();
const mockPut = jest.fn();
jest.mock("../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), put: (...args: unknown[]) => mockPut(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));

const HONORARY = { kind: "honorary", kind_label: "Ehrenmitgliedschaft", title: "Ehrenmitglied", years: 0, label: "Aufbau der Jugendarbeit", given_on: "2026-05-01", publishable: true };
const MERIT = { kind: "merit", kind_label: "Verdienstnadel", title: "Verdienstnadel in Silber", years: 0, label: "", given_on: "2026-03-14", publishable: false };

beforeEach(() => {
  jest.clearAllMocks();
});

test("Zeile in Worten", () => {
  expect(honourLine({ ...HONORARY, years: 10 })).toBe("Verliehen am 01.05.2026 · 10 Jahre im Verein");
  expect(honourLine({ ...HONORARY, given_on: "" })).toBe("");
});

test("alle eigenen mit Hinweis; der Schalter bringt sie aufs Profil", async () => {
  mockGet.mockResolvedValue({ data: { available: true, public: false, shown: 0, honours: [HONORARY, MERIT] } });
  mockPut.mockResolvedValue({ data: { available: true, public: true, shown: 1, honours: [HONORARY, MERIT] } });
  await render(<HonoursCard />);
  await waitFor(() => expect(screen.getAllByTestId("honour-card")).toHaveLength(2));
  expect(screen.getByText("Nur für dich – der Verein gibt sie nicht frei")).toBeTruthy();
  await fireEvent(screen.getByTestId("profile-honours-public"), "valueChange", true);
  await waitFor(() => expect(mockPut).toHaveBeenCalledWith("/me/honours/public", { on: true }));
  await waitFor(() => expect(screen.getByText(/Gerade öffentlich: 1\./)).toBeTruthy());
});

test("ohne Verbindung keine Karte, ohne Fähigkeit der Grund; fremde Profile ohne Hinweis", async () => {
  mockGet.mockResolvedValue({ data: { available: false, reason: "not_bound", text: "Erst verbinden.", public: false, honours: [] } });
  const first = await render(<HonoursCard />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId("profile-honours")).toBeNull();
  await first.unmount();

  mockGet.mockResolvedValue({ data: { available: false, reason: "no_capability", text: "Deine Verbindung erlaubt die Mitgliederakte noch nicht.", public: false, honours: [] } });
  const second = await render(<HonoursCard />);
  await waitFor(() => expect(screen.getByTestId("profile-honours-reason")).toBeTruthy());
  await second.unmount();

  await render(<HonourList honours={[HONORARY]} />);
  expect(screen.getByText("Ehrenmitglied")).toBeTruthy();
  expect(screen.queryByText(/Darf aufs Profil/)).toBeNull();
});

// Eigene Teilnahmen (#906) - wie im Web: unter den Ehrungen, je Jahr, mit Herkunft; nur für die Person selbst.
const CUP = { kind: "competition", kind_label: "Wettbewerb", title: "Sommer-Cup", day: "2026-07-12", hours: null, source: "api", source_label: "von der Website gemeldet" };
const SHIFT = { kind: "shift", kind_label: "Helferdienst", title: "Sommerfest – Ausschank", day: "2026-07-04", hours: 3.5, source: "shift", source_label: "Helferdienst" };
const XMAS = { kind: "event", kind_label: "Veranstaltung", title: "Weihnachtsfeier", day: "2025-12-19", hours: 2.5, source: "dolibarr", source_label: "vom Verein eingetragen" };

test("Teilnahme in einer Zeile, Gruppen je Jahr", () => {
  expect(participationLine(SHIFT)).toBe("04.07.2026 · Helferdienst · 3,5 Std. · Helferdienst");
  expect(participationLine(CUP)).toBe("12.07.2026 · Wettbewerb · von der Website gemeldet");
  expect(participationsByYear([CUP, SHIFT, XMAS]).map((group) => [group.year, group.rows.length])).toEqual([["2026", 2], ["2025", 1]]);
});

test("Meine Teilnahmen unter den Ehrungen; scheitert nur dieser Teil, steht der Grund da", async () => {
  mockGet.mockResolvedValue({ data: { available: true, public: false, honours: [HONORARY], participations: [CUP, SHIFT, XMAS], participations_text: "" } });
  const first = await render(<HonoursCard />);
  await waitFor(() => expect(screen.getAllByTestId("participation-row")).toHaveLength(3));
  expect(screen.getByText("2026 · 2 Teilnahmen")).toBeTruthy();
  expect(screen.getByText("19.12.2025 · Veranstaltung · 2,5 Std. · vom Verein eingetragen")).toBeTruthy();
  expect(screen.getAllByTestId("honour-card")).toHaveLength(1);
  await first.unmount();

  mockGet.mockResolvedValue({ data: { available: true, public: false, honours: [], participations: [], participations_text: "Deine Teilnahmen sind gerade nicht lesbar." } });
  const second = await render(<HonoursCard />);
  await waitFor(() => expect(screen.getByTestId("profile-participations-reason")).toBeTruthy());
  await second.unmount();

  mockGet.mockResolvedValue({ data: { available: false, reason: "no_capability", text: "Deine Verbindung erlaubt die Mitgliederakte noch nicht.", public: false, honours: [], participations: [] } });
  await render(<HonoursCard />);
  await waitFor(() => expect(screen.getByTestId("profile-honours-reason")).toBeTruthy());
  expect(screen.queryByTestId("profile-participations")).toBeNull();
});
