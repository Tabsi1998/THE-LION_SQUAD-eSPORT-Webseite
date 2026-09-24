import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MyMembershipScreen } from "./MyMembershipScreen";

// Meine Mitgliedschaft (#339): Stand aus der Mitgliederverwaltung, Zuordnung anfragen. Die Belege
// selbst liegen seit #320 unter „Meine Rechnungen“ - hier nur der Stand und der Weg dorthin.

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockOpenInvoice = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args), put: (...args: unknown[]) => mockPut(...args) },
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

test("Beitrag, Nummer, Funktion und der Stand der Belege; der Knopf führt zu „Meine Rechnungen“", async () => {
  await render(<MyMembershipScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Aktives Mitglied")).toBeTruthy());

  expect(screen.getByText("M-0007")).toBeTruthy();
  expect(screen.getByText("bezahlt")).toBeTruthy();
  expect(screen.getByText("Bezahlt bis 31.12.2026")).toBeTruthy();
  expect(screen.getByText(/Funktion: Kassier:in/)).toBeTruthy();
  expect(screen.queryByTestId("membership-link")).toBeNull();

  expect(screen.getByText(/1 offen/)).toBeTruthy();
  expect(screen.queryByText("Rechnung RE-2026/0007")).toBeNull();
  await fireEvent.press(screen.getByTestId("membership-invoices-link"));
  expect(navigate).toHaveBeenCalledWith("MyInvoices");

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
  expect(screen.getByTestId("membership-invoices-link")).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId("membership-link-ref"), "M-0042");
  await fireEvent.press(screen.getByText("Zuordnung anfragen"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/membership/dolibarr/link-request", { member_ref: "M-0042" }));
  await waitFor(() => expect(screen.getByTestId("membership-link-requested")).toBeTruthy());
});

// Vereinsakte (#324 Teil 1) und eigene Daten/Austritt (#329 Teil 2) in der App - dieselben Routen wie im Web.
const SELF = {
  available: true, changeable: ["address", "zip", "town", "country_code", "phone", "phone_mobile", "email"],
  profile: { member_id: 12, ref: "12", firstname: "Paula", lastname: "Beispiel", birth: "1990-05-04", address: "Teststraße 1", zip: "6410", town: "Testdorf", country_code: "AT",
    phone: "", phone_mobile: "+43 660 0000000", email: "paula@example.test", member_type: "Ordentliches Mitglied", status: "active", version: "v1", direct: ["phone", "phone_mobile"], exit: null },
  requests: [{ external_id: "web-change-1", kind: "change", changes: { address: "Neue Gasse 2" }, status: "received", status_label: "beim Vorstand" }],
};

function mockAkte(identity: object | null, self: object | null, website: object | null = null) {
  mockGet.mockImplementation((path: string) => {
    if (path === "/membership/me") return Promise.resolve({ data: ledByDolibarr });
    if (path === "/account/invoices") return Promise.resolve({ data: invoices });
    if (path === "/membership/me/identity") return identity ? Promise.resolve({ data: identity }) : Promise.reject(new Error("nope"));
    if (path === "/membership/me/self-service") return self ? Promise.resolve({ data: self }) : Promise.reject(new Error("nope"));
    if (path === "/membership/me/website-profile") return website ? Promise.resolve({ data: website }) : Promise.reject(new Error("nope"));
    return Promise.reject(new Error("nope"));
  });
}

test("Vereinsakte: ohne Bindung der Code, danach der Stand", async () => {
  mockAkte({ available: true, status: "none", capabilities: [] }, null);
  mockPost.mockResolvedValue({ data: { available: true, status: "bound", capabilities: ["documents"] } });
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  await render(<MyMembershipScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("membership-identity")).toBeTruthy());
  expect(screen.queryByTestId("membership-self")).toBeNull();
  await fireEvent.changeText(screen.getByTestId("membership-identity-code"), " LION-1234 ");
  await fireEvent.press(screen.getByTestId("membership-identity-claim"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/membership/me/identity", { code: "LION-1234" }));
  expect(alert).toHaveBeenCalledWith("Verbunden", expect.stringContaining("Vereinsdokumente"));
  alert.mockRestore();
});

test("Meine Daten: nur Geändertes geht mit dem Stand raus; Eingereichtes steht darunter", async () => {
  mockAkte({ available: true, status: "bound", capabilities: ["documents", "profile"], capability_labels: ["Dokumente", "eigene Daten"], linked_at: "2026-09-24T10:00:00Z" }, SELF);
  mockPost.mockResolvedValue({ data: { status: "applied" } });
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  await render(<MyMembershipScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("membership-self")).toBeTruthy());
  expect(screen.getByTestId("membership-identity-bound")).toBeTruthy();
  expect(screen.getByText(/Paula Beispiel · Ordentliches Mitglied · Nr. 12/)).toBeTruthy();
  expect(screen.getByTestId("membership-self-request-web-change-1")).toBeTruthy();
  expect(screen.getByText("Änderung: Straße und Hausnummer: Neue Gasse 2")).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId("membership-self-field-phone_mobile"), "+43 660 1234567");
  await fireEvent.press(screen.getByTestId("membership-self-save"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/membership/me/self-service/changes", { version: "v1", changes: { phone_mobile: "+43 660 1234567" } }));
  expect(alert).toHaveBeenCalledWith("Übernommen", "Deine Daten sind aktuell.");
  alert.mockRestore();
});

test("Austritt: erst die Rückfrage, dann die Erklärung; geplant heißt nur noch der Stand", async () => {
  mockAkte({ available: true, status: "bound", capabilities: ["profile"] }, SELF);
  mockPost.mockResolvedValue({ data: { kind: "exit", last_day: "2026-12-31", wished_too_early: true } });
  const alert = jest.spyOn(Alert, "alert").mockImplementation((title, message, buttons) => {
    const go = Array.isArray(buttons) ? buttons.find((b) => b.text === "Austritt erklären") : undefined;
    if (go?.onPress) go.onPress();
  });
  await render(<MyMembershipScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("membership-self-exit")).toBeTruthy());
  await fireEvent.changeText(screen.getByTestId("membership-self-exit-date"), "2026-10-01");
  await fireEvent.press(screen.getByTestId("membership-self-exit-button"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/membership/me/self-service/exit", { wished_last_day: "2026-10-01" }));
  expect(alert).toHaveBeenCalledWith("Austritt eingegangen", expect.stringContaining("Wunschdatum lag vor der Kündigungsfrist"));
  alert.mockRestore();

  mockAkte({ available: true, status: "bound", capabilities: ["profile"] }, { ...SELF, profile: { ...SELF.profile, exit: { status: "planned", notice_day: "2026-09-24", last_day: "2026-12-31" } } });
  await render(<MyMembershipScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("membership-self-exit-planned")).toBeTruthy());
  expect(screen.getByText("Austritt geplant: letzter Tag der Mitgliedschaft 31.12.2026 (Eingang 24.09.2026).")).toBeTruthy();
});

test("Mein Website-Profil (#260): nur Geändertes geht raus, der Sichtbarkeitssatz steht dabei", async () => {
  const website = { available: true, consent: "profil", given: true, gamertag: "LionKing", bio: "", games: ["TFT"], platforms: [] };
  mockAkte({ available: true, status: "bound", capabilities: ["documents", "profile"] }, null, website);
  mockPut.mockResolvedValue({ data: { ...website, games: ["TFT", "Rocket League"] } });
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  await render(<MyMembershipScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("membership-website")).toBeTruthy());
  expect(screen.getByTestId("membership-website-state")).toHaveTextContent(/zeigt dieses Profil/);
  await fireEvent.changeText(screen.getByTestId("membership-website-games"), "TFT, Rocket League");
  await fireEvent.press(screen.getByTestId("membership-website-save"));
  await waitFor(() => expect(mockPut).toHaveBeenCalledWith("/membership/me/website-profile", { games: "TFT, Rocket League" }));
  expect(alert).toHaveBeenCalledWith("Gespeichert", expect.any(String));
  alert.mockRestore();
});
