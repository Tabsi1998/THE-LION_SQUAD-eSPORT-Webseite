import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mitglied werden über Dolibarr (#328): das Formular fragt, was die Mitgliederverwaltung verlangt
// (Pflichtfelder, eigene Felder, Mitgliedsarten mit Beitrag, Einwilligungstexte) und schickt genau
// das; die Stände „in Übermittlung“, „in Prüfung“, „abgelehnt mit Grund“ und „zurückgezogen“ haben
// eine eigene Karte. Ohne Anbindung bleibt der Website-Antrag mit Motivation.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/tls/GermanDateField", () => ({
  GermanDateField: ({ label, value, onChange, testId }) => <label>{label}<input data-testid={testId} value={value || ""} onChange={(e) => onChange(e.target.value)} /></label>,
}));
// Ein stabiles Konto-Objekt: die Seite lädt neu, sobald sich `user` ändert - wie in der App selbst.
const AUTH = { user: { id: "u1", username: "amelie", display_name: "Amelie Beispiel" } };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => AUTH }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: MembershipApplyPage, feeLine, splitDisplayName } = await import("./MembershipApplyPage");

const SETUP = {
  coupled: true, available: true, account: { email: "amelie@example.test", display_name: "Amelie Beispiel" },
  form: { required: ["lastname", "firstname", "address", "zip", "town", "email"], fields: [{ code: "gamertag", label: "Gamertag", required: true }] },
  fees: [
    { id: 2, label: "Ordentliches Mitglied", description: "Mit Stimmrecht", amount: 50, currency: "EUR", period_label: "je Jahr", subscription_required: true, admission_fee: 0, prorated: true },
    { id: 3, label: "Jugend", description: "", amount: 20, currency: "EUR", period_label: "je Jahr", subscription_required: true, admission_fee: 10, prorated: false },
  ],
  consents: [{ code: "fotos", label: "Fotos auf der Website", version: 2, text: "Fotos von Veranstaltungen dürfen erscheinen." }],
};

function mockApi({ setup = SETUP, existing = null } = {}) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/membership/apply/form") return { data: setup };
    if (url === "/membership/apply/me") return { data: existing };
    return { data: null };
  });
}

beforeEach(() => {
  apiMock.post.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

test("mit Dolibarr: Formular aus der Mitgliederverwaltung, Prüfung in Worten, Antrag mit Einwilligungsversion", async () => {
  mockApi();
  apiMock.post.mockResolvedValue({ data: { id: "a1", status: "pending", coupled: true, created_at: "2026-09-23T10:00:00Z", dolibarr: { application_status: "received", external_id: "web-a1" } } });
  render(<MemoryRouter><MembershipApplyPage /></MemoryRouter>);
  expect(await screen.findByTestId("apply-fees")).toHaveTextContent("Ordentliches Mitglied");
  expect(screen.getByTestId("apply-fees")).toHaveTextContent("50,00 € je Jahr · Eintritt unterm Jahr anteilig");
  expect(screen.getByTestId("apply-fees")).toHaveTextContent("einmalig 10,00 € Aufnahme");
  expect(screen.getByTestId("apply-fee-2")).toBeChecked();
  expect(screen.getByTestId("apply-firstname")).toHaveValue("Amelie");
  expect(screen.getByTestId("apply-lastname")).toHaveValue("Beispiel");
  expect(screen.getByTestId("apply-email")).toHaveValue("amelie@example.test");
  expect(screen.getByTestId("apply-consents")).toHaveTextContent("Fotos von Veranstaltungen dürfen erscheinen.");
  expect(screen.getByTestId("apply-consent-fotos")).not.toBeChecked();
  expect(screen.queryByTestId("apply-contribution")).toBeNull();

  fireEvent.click(screen.getByTestId("apply-submit"));
  expect(screen.getByText("Straße und Hausnummer fehlt.")).toBeInTheDocument();
  expect(screen.getByText("Gamertag fehlt.")).toBeInTheDocument();
  expect(apiMock.post).not.toHaveBeenCalled();

  fireEvent.change(screen.getByTestId("apply-address"), { target: { value: "Hauptplatz 1" } });
  fireEvent.change(screen.getByTestId("apply-zip"), { target: { value: "6020" } });
  fireEvent.change(screen.getByTestId("apply-town"), { target: { value: "Innsbruck" } });
  fireEvent.change(screen.getByTestId("apply-field-gamertag"), { target: { value: "Ami" } });
  fireEvent.click(screen.getByTestId("apply-fee-3"));
  fireEvent.click(screen.getByTestId("apply-consent-fotos"));
  fireEvent.click(screen.getByTestId("apply-statutes"));
  fireEvent.click(screen.getByTestId("apply-privacy"));
  fireEvent.click(screen.getByTestId("apply-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(1));
  const [url, payload] = apiMock.post.mock.calls[0];
  expect(url).toBe("/membership/apply");
  expect(payload).toEqual(expect.objectContaining({ type_id: 3, firstname: "Amelie", lastname: "Beispiel", address: "Hauptplatz 1", zip: "6020", town: "Innsbruck", country_code: "AT", fields: { gamertag: "Ami" }, consents: [{ code: "fotos", version: 2 }] }));
  expect(payload.motivation).toBeNull();
  expect(payload.notes).toBeNull();
  expect(await screen.findByTestId("apply-pending")).toHaveTextContent("Antrag eingegangen");
  expect(screen.getByTestId("apply-withdraw")).toBeInTheDocument();
});

test("Stände: in Übermittlung, in Prüfung, abgelehnt mit Grund, zurückgezogen mit neuem Antrag", async () => {
  mockApi({ existing: { id: "a1", status: "submitting", coupled: true, created_at: "2026-09-23T10:00:00Z", dolibarr: { error: "unavailable", next_try_at: "2026-09-23T10:05:00Z" } } });
  const { unmount } = render(<MemoryRouter><MembershipApplyPage /></MemoryRouter>);
  expect(await screen.findByTestId("apply-submitting")).toHaveTextContent("automatisch weiter");
  unmount();

  mockApi({ existing: { id: "a1", status: "pending", coupled: true, created_at: "2026-09-23T10:00:00Z", dolibarr: { application_status: "in_review" } } });
  const second = render(<MemoryRouter><MembershipApplyPage /></MemoryRouter>);
  expect(await screen.findByTestId("apply-pending")).toHaveTextContent("Antrag in Prüfung");
  apiMock.post.mockResolvedValue({ data: { id: "a1", status: "withdrawn", coupled: true, created_at: "2026-09-23T10:00:00Z" } });
  fireEvent.click(screen.getByTestId("apply-withdraw"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/membership/apply/withdraw"));
  expect(await screen.findByTestId("apply-withdrawn")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("apply-renew"));
  expect(await screen.findByTestId("apply-form")).toBeInTheDocument();
  second.unmount();

  mockApi({ existing: { id: "a1", status: "rejected", coupled: true, created_at: "2026-09-23T10:00:00Z", decision_note: "Bitte erst zwei Vereinsabende besuchen.", dolibarr: { application_status: "rejected" } } });
  render(<MemoryRouter><MembershipApplyPage /></MemoryRouter>);
  expect(await screen.findByTestId("apply-rejected")).toHaveTextContent("Bitte erst zwei Vereinsabende besuchen.");
  expect(screen.getByTestId("apply-renew")).toBeInTheDocument();
});

test("ohne Anbindung (oder wenn die Abfrage scheitert) bleibt der Website-Antrag mit Motivation", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/membership/apply/form") throw new Error("offline");
    return { data: null };
  });
  apiMock.post.mockResolvedValue({ data: { id: "a1", status: "pending", created_at: "2026-09-23T10:00:00Z" } });
  render(<MemoryRouter><MembershipApplyPage /></MemoryRouter>);
  expect(await screen.findByTestId("apply-form")).toBeInTheDocument();
  expect(screen.getByTestId("apply-contribution")).toBeInTheDocument();
  expect(screen.queryByTestId("apply-fees")).toBeNull();
  fireEvent.click(screen.getByTestId("apply-submit"));
  expect(screen.getByText("Bitte beschreibe deine Motivation mit mindestens 20 Zeichen.")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("apply-motivation"), { target: { value: "Ich möchte den Verein langfristig aktiv unterstützen." } });
  fireEvent.click(screen.getByTestId("apply-statutes"));
  fireEvent.click(screen.getByTestId("apply-privacy"));
  fireEvent.click(screen.getByTestId("apply-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/membership/apply", expect.objectContaining({ motivation: "Ich möchte den Verein langfristig aktiv unterstützen.", contribution_pref: "full" })));
  expect(await screen.findByTestId("apply-pending")).toHaveTextContent("Bewerbung eingegangen");
});

test("Hilfsfunktionen", () => {
  expect(feeLine({ subscription_required: false })).toBe("Ohne Beitrag");
  expect(feeLine({ subscription_required: true, amount: 75, currency: "EUR", period_label: "je Jahr" })).toBe("75,00 € je Jahr");
  expect(splitDisplayName("Amelie Beispiel")).toEqual({ firstname: "Amelie", lastname: "Beispiel" });
  expect(splitDisplayName("amelie")).toEqual({ firstname: "", lastname: "" });
});
