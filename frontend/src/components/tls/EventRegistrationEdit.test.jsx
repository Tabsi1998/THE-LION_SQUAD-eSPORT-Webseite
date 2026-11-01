import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Die eigene Event-Anmeldung ändern (#2113, L-A3): nur mit `can_edit`, nur die geänderten Felder gehen an den Server,
// ein Fehler steht im Formular. Erfundene Daten.

const apiMock = { patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (error, fallback) => error?.response?.data?.detail || fallback }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { EventRegistrationEdit } = await import("./EventRegistrationEdit");

const EVENT = { id: "e-1", allow_companions: true, max_companions_per_registration: 3 };

beforeEach(() => {
  apiMock.patch.mockReset();
});

test("ohne `can_edit` kein Link", () => {
  const { container } = render(<EventRegistrationEdit event={EVENT} own={{ status: "registered", can_edit: false }} />);
  expect(container).toBeEmptyDOMElement();
});

test("ändern schickt nur, was sich geändert hat, und lädt danach neu", async () => {
  apiMock.patch.mockResolvedValue({ data: {} });
  const onSaved = vi.fn();
  render(<EventRegistrationEdit event={EVENT} own={{ status: "registered", can_edit: true, companion_count: 0, note: "komme mit dem Zug" }} onSaved={onSaved} />);
  fireEvent.click(screen.getByTestId("event-edit-link"));
  expect(screen.getByTestId("event-edit-note")).toHaveValue("komme mit dem Zug");
  fireEvent.change(screen.getByTestId("event-edit-companions"), { target: { value: "2" } });
  fireEvent.click(screen.getByTestId("event-edit-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/events/e-1/registrations/me", { companion_count: 2 }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId("event-edit-form")).toBeNull();
});

const OFFER = { enabled: true, currency: "EUR", positions: [
  { key: "beitrag", label: "Beitrag", amount_cents: 2000, basis: "per_person" },
  { key: "shirt", label: "Shirt", amount_cents: 1500, basis: "per_registration", optional: true },
] };

test("neue Summe vor dem Speichern: mit dem gewählten Zusatz - ohne bisherigen Preis keine Summe", () => {
  const paid = { status: "registered", can_edit: true, companion_count: 0, note: null, price: { total_cents: 3500, currency: "EUR", positions: [{ key: "beitrag" }, { key: "shirt", optional: true }] } };
  const { unmount } = render(<EventRegistrationEdit event={{ ...EVENT, offer: OFFER }} own={paid} />);
  fireEvent.click(screen.getByTestId("event-edit-link"));
  expect(screen.queryByTestId("event-edit-quote")).toBeNull();
  fireEvent.change(screen.getByTestId("event-edit-companions"), { target: { value: "2" } });
  expect(screen.getByTestId("event-edit-quote")).toHaveTextContent("Neue Summe für 3 Personen");
  expect(screen.getByTestId("event-edit-quote").textContent.replace(/\s/g, " ")).toContain("75,00");
  unmount();
  render(<EventRegistrationEdit event={{ ...EVENT, offer: OFFER }} own={{ status: "registered", can_edit: true, companion_count: 0 }} />);
  fireEvent.click(screen.getByTestId("event-edit-link"));
  fireEvent.change(screen.getByTestId("event-edit-companions"), { target: { value: "2" } });
  expect(screen.queryByTestId("event-edit-quote")).toBeNull();
});

test("ohne Begleitpersonen am Event nur der Hinweis; ein Fehler bleibt im Formular stehen", async () => {
  apiMock.patch.mockRejectedValue(Object.assign(new Error("409"), { response: { status: 409, data: { detail: "Das Event hat schon begonnen – ändern geht jetzt nur über die Turnierleitung." } } }));
  render(<EventRegistrationEdit event={{ id: "e-1", allow_companions: false }} own={{ status: "registered", can_edit: true, companion_count: 0, note: null }} />);
  fireEvent.click(screen.getByTestId("event-edit-link"));
  expect(screen.queryByTestId("event-edit-companions")).toBeNull();
  fireEvent.change(screen.getByTestId("event-edit-note"), { target: { value: "vegetarisch" } });
  fireEvent.click(screen.getByTestId("event-edit-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/events/e-1/registrations/me", { note: "vegetarisch" }));
  await waitFor(() => expect(screen.getByTestId("event-edit-form")).toHaveTextContent("schon begonnen"));
  expect(screen.getByTestId("event-edit-form")).toBeInTheDocument();
});
