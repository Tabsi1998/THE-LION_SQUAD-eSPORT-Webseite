import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Die eigene Event-Anmeldung ändern (#2113, L-A3): nur mit `can_edit`, nur die geänderten Felder gehen an den Server,
// ein Fehler steht im Formular. Erfundene Daten.

const apiMock = { patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (error, fallback) => error?.response?.data?.detail || fallback }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { EventRegistrationEdit } = await import("./EventRegistrationEdit");

const EVENT = { id: "e-1", allow_companions: true, max_companions_per_registration: 3 };

beforeEach(() => apiMock.patch.mockReset());

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
