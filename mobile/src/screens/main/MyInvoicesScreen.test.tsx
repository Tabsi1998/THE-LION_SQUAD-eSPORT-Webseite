import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MyInvoicesScreen } from "./MyInvoicesScreen";

// Meine Rechnungen für alle (#320): Belege mit ihrem Vorgang, Filter nach Quelle und Stand, PDF per
// Tipp - und ein Nicht-Mitglied ohne Beleg bekommt eine Erklärung statt einer leeren Seite.

const mockGet = jest.fn();
const mockOpenInvoice = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("../../lib/memberDocuments", () => ({ openInvoice: (...args: unknown[]) => mockOpenInvoice(...args) }));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" }, accessToken: "tok-1" }) }));
jest.mock("../../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => {} }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigation = { navigate: jest.fn() } as never;
const route = { key: "i", name: "MyInvoices" } as never;

const DATA = {
  connected: true, available: true, as_of: "2026-09-23T08:00:00Z", currency: "EUR", member: false,
  sources: { event: 1, tournament: 1 },
  summary: { count: 2, open_count: 1, open_total: 40, overdue_count: 1 },
  invoices: [
    { key: "d-501", ref: "FA2609-0501", type: "standard", type_label: "Rechnung", date: "2026-09-01", total: 40, remaining: 40, status: "overdue", status_label: "überfällig", overdue: true, is_fee: false, can_pay: false, source: "event", source_label: "Weihnachtsfeier", booking: { name: "Weihnachtsfeier", date: "12.12.2026", seats: 2, companions: 1, team: "", players: 0 }, registration_id: "reg1" },
    { key: "d-601", ref: "FA-601", type: "standard", type_label: "Rechnung", date: "2026-08-01", total: 25, remaining: 0, status: "paid", status_label: "bezahlt", is_fee: false, can_pay: false, source: "tournament", source_label: "Startgeld Herbst-Cup – Team Lions", booking: { name: "Herbst-Cup", date: "02.10.2026", seats: 1, companions: 0, team: "Team Lions", players: 5 }, registration_id: "tr1" },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: DATA });
  mockOpenInvoice.mockResolvedValue(undefined);
});

test("Belege mit Vorgang, Filter nach Quelle und Stand, Tippen öffnet das PDF, Überweisungshinweis ohne Online-Zahlung", async () => {
  await render(<MyInvoicesScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("invoice-d-501")).toBeTruthy());
  expect(mockGet).toHaveBeenCalledWith("/account/invoices");
  expect(screen.getByText(/Weihnachtsfeier · 12.12.2026 · 2 Personen/)).toBeTruthy();
  expect(screen.getByText(/Startgeld Herbst-Cup – Team Lions · 02.10.2026 · 5 Spieler/)).toBeTruthy();
  expect(screen.getByTestId("invoices-open")).toHaveTextContent("1 offen · € 40,00 · 1 überfällig");
  expect(screen.getByTestId("invoices-pay-hint")).toHaveTextContent("Bezahlt wird per Überweisung – Bankverbindung und Verwendungszweck stehen auf der Rechnung.");

  await fireEvent.press(screen.getByText("Turniere"));
  expect(screen.queryByTestId("invoice-d-501")).toBeNull();
  expect(screen.getByTestId("invoice-d-601")).toBeTruthy();

  await fireEvent.press(screen.getAllByText("Alle")[0]);
  await fireEvent.press(screen.getByText("Offen"));
  expect(screen.getByTestId("invoice-d-501")).toBeTruthy();
  expect(screen.queryByTestId("invoice-d-601")).toBeNull();

  await fireEvent.press(screen.getByTestId("invoice-d-501"));
  await waitFor(() => expect(mockOpenInvoice).toHaveBeenCalledWith(expect.objectContaining({ key: "d-501" }), "tok-1"));
});

test("ein Nicht-Mitglied ohne Beleg bekommt eine Erklärung, keine leere Seite", async () => {
  mockGet.mockResolvedValue({ data: { connected: false, available: true, invoices: [], summary: { count: 0, open_count: 0, open_total: 0, overdue_count: 0 }, currency: "EUR", member: false, sources: {} } });
  await render(<MyInvoicesScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Keine Rechnungen")).toBeTruthy());
  expect(screen.getByText(/Sobald der Verein dir eine Rechnung stellt/)).toBeTruthy();
  expect(screen.queryByText("Alle")).toBeNull();
});

test("Mitglied mit Online-Zahlung: der Hinweis führt auf die Website; bei Ausfall der letzte Stand", async () => {
  mockGet.mockResolvedValue({ data: { ...DATA, member: true, available: false, invoices: [{ ...DATA.invoices[0], can_pay: true, source: "club", source_label: "Mitgliedsbeitrag", booking: null }], sources: { club: 1 } } });
  await render(<MyInvoicesScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("invoice-d-501")).toBeTruthy());
  expect(screen.getByText(/antwortet gerade nicht/)).toBeTruthy();
  expect(screen.getByText(/Mitgliedsbeitrag/)).toBeTruthy();
  expect(screen.getByTestId("invoices-pay-hint")).toHaveTextContent(/auf der Website/);
});
