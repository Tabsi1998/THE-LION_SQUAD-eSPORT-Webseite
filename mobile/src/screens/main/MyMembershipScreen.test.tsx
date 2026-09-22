import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MyMembershipScreen } from "./MyMembershipScreen";

// Meine Mitgliedschaft (#339): Stand aus der Mitgliederverwaltung, Belege als PDF, Zuordnung
// anfragen. Bezahlt wird nicht in der App.

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockOpenInvoice = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
jest.mock("../../lib/memberDocuments", () => ({ openInvoice: (...args: unknown[]) => mockOpenInvoice(...args) }));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" }, accessToken: "tok-1" }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigate = jest.fn();
const navigation = { navigate } as never;
const route = { key: "m", name: "MyMembership" } as never;

const ledByDolibarr = {
  membership: { member_number: "TLS-0007", member_since: "2024-03-01", member_status: "active", membership_type: "ordinary" },
  is_active_member: true,
  dolibarr: {
    connected: true, led_by_dolibarr: true, as_of: "2026-09-22T08:00:00Z", stale: false, member_ref: "M-0007", type_label: "Ordentliches Mitglied",
    paid_until: "2026-12-31", fee: { required: true, status: "paid", amount: 20, currency: "EUR" }, functions: [{ label: "Kassier:in", since: "2026-01-01" }], link: { status: "verified" },
  },
};

const invoices = {
  connected: true, available: true, as_of: "2026-09-22T08:00:00Z", currency: "EUR",
  invoices: [
    { key: "k1", ref: "RE-2026/0007", type: "standard", type_label: "Rechnung", date: "2026-09-01", total: 20, remaining: 20, status: "open", status_label: "offen", overdue: false, is_fee: true, can_pay: true },
    { key: "k0", ref: "RE-2025/0003", type: "standard", type_label: "Rechnung", date: "2025-09-01", total: 20, remaining: 0, status: "paid", status_label: "bezahlt", is_fee: true, can_pay: false },
  ],
  summary: { count: 2, open_count: 1, open_total: 20, overdue_count: 0 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockImplementation((path: string) => {
    if (path === "/membership/me") return Promise.resolve({ data: ledByDolibarr });
    if (path === "/account/invoices") return Promise.resolve({ data: invoices });
    return Promise.reject(new Error("nope"));
  });
  mockOpenInvoice.mockResolvedValue(undefined);
});

test("Beitrag, Nummer, Funktion und Belege; ein Beleg öffnet sich als PDF, bezahlt wird im Web", async () => {
  await render(<MyMembershipScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Aktives Mitglied")).toBeTruthy());

  expect(screen.getByText("M-0007")).toBeTruthy();
  // Beitrag „bezahlt“ und der alte Beleg „bezahlt“
  expect(screen.getAllByText("bezahlt")).toHaveLength(2);
  expect(screen.getByText("Bezahlt bis 31.12.2026")).toBeTruthy();
  expect(screen.getByText(/Funktion: Kassier:in/)).toBeTruthy();
  expect(screen.queryByTestId("membership-link")).toBeNull();

  expect(screen.getByText(/1 offen/)).toBeTruthy();
  expect(screen.getByText("Rechnung RE-2026/0007")).toBeTruthy();
  expect(screen.queryByText(/Jetzt bezahlen/)).toBeNull();
  expect(screen.getByText(/Bezahlen geht auf der Website/)).toBeTruthy();

  await fireEvent.press(screen.getByTestId("invoice-k1"));
  await waitFor(() => expect(mockOpenInvoice).toHaveBeenCalledWith(expect.objectContaining({ key: "k1" }), "tok-1"));

  await fireEvent.press(screen.getByTestId("membership-card-link"));
  expect(navigate).toHaveBeenCalledWith("MemberCard");
});

test("nicht zugeordnet: Zuordnung anfragen, danach „Anfrage eingegangen“", async () => {
  mockGet.mockImplementation((path: string) => {
    if (path === "/membership/me") return Promise.resolve({ data: { membership: null, is_active_member: false, dolibarr: { connected: true, led_by_dolibarr: false, link: null } } });
    if (path === "/account/invoices") return Promise.resolve({ data: { connected: false, available: true, invoices: [], summary: { count: 0, open_count: 0, open_total: 0, overdue_count: 0 } } });
    return Promise.reject(new Error("nope"));
  });
  mockPost.mockResolvedValue({ data: { status: "requested" } });
  await render(<MyMembershipScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("membership-link")).toBeTruthy());
  expect(screen.getByText("Keine Mitgliedschaft")).toBeTruthy();
  expect(screen.getByText(/Belege gibt es, sobald/)).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId("membership-link-ref"), "M-0042");
  await fireEvent.press(screen.getByText("Zuordnung anfragen"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/membership/dolibarr/link-request", { member_ref: "M-0042" }));
  await waitFor(() => expect(screen.getByTestId("membership-link-requested")).toBeTruthy());
});

test("Fehler beim Öffnen eines Belegs steht bei der Liste, nicht als Absturz", async () => {
  mockOpenInvoice.mockRejectedValue(new Error("Der Server antwortet gerade nicht. Bitte später noch einmal."));
  await render(<MyMembershipScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("invoice-k1")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("invoice-k1"));
  await waitFor(() => expect(screen.getByText(/Server antwortet gerade nicht/)).toBeTruthy());
});
