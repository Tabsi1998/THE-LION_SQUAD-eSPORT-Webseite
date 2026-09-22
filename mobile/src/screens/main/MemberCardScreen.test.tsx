import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MemberCardScreen } from "./MemberCardScreen";

// Mitgliedskarte (#346): Karte mit QR-Code aus dem Prüflink; ohne Mitgliedschaft ein Hinweis.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigation = { navigate: jest.fn() } as never;
const route = { key: "card", name: "MemberCard" } as never;

const card = {
  status: "valid", club_name: "THE LION SQUAD", name: "Paula", member_number: "TLS-0007", type_label: "Ordentliches Mitglied",
  member_since: "2024-03-01", valid_until: "2026-12-31", verify_url: "https://lionsquad.at/karte/pruefen/abcDEF123456xyz0",
  token_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), accent_color: "#FFD700",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: card });
});

test("zeigt Karte, QR-Code und holt auf Tipp einen frischen Code", async () => {
  await render(<MemberCardScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("member-card")).toBeTruthy());
  expect(screen.getByText("Paula")).toBeTruthy();
  expect(screen.getByText("TLS-0007")).toBeTruthy();
  expect(screen.getByText("Ordentliches Mitglied")).toBeTruthy();
  expect(screen.getByText("Gültig bis 31.12.2026")).toBeTruthy();
  expect(screen.getByTestId("member-card-qr")).toBeTruthy();
  expect(mockGet).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByTestId("member-card-refresh"));
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  expect(mockGet).toHaveBeenCalledWith("/account/member-card");
});

test("ohne aktive Mitgliedschaft keine Karte, sondern ein Hinweis", async () => {
  mockGet.mockResolvedValue({ data: { status: "none", club_name: "THE LION SQUAD" } });
  await render(<MemberCardScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Keine Mitgliedskarte")).toBeTruthy());
  expect(screen.queryByTestId("member-card-qr")).toBeNull();

  mockGet.mockResolvedValue({ data: { status: "ended", club_name: "THE LION SQUAD" } });
  await render(<MemberCardScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Mitgliedschaft beendet")).toBeTruthy());
});
