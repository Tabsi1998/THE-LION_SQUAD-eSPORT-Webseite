import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { HonourList, HonoursCard, honourLine } from "./Honours";

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
