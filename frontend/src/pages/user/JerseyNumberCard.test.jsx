import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Meine Nummer (#2034): einmal wählen mit Live-Prüfung und Bestätigung, danach nur über einen Antrag.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
const confirmMock = vi.fn(async () => true);

vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("sonner", () => ({ toast: toastMock }));

const JerseyNumberCard = (await import("./JerseyNumberCard")).default;

const open = { available: true, number: null, can_choose: true, again: false, free_count: 97, range: { min: 0, max: 99 }, reserved: [13],
  dolibarr: null, open_request: null, requests: [] };
const fixed = { ...open, number: 7, can_choose: false, free_count: null, set_by: "member", chosen_at: "2026-10-26T10:00:00+00:00",
  dolibarr: { state: "ok", text: "Steht auch in der Mitgliederverwaltung." } };

beforeEach(() => vi.clearAllMocks());

test("ohne Mitgliedschaft gibt es keine Karte", async () => {
  apiMock.get.mockResolvedValue({ data: { available: false, reason: "not_member" } });
  const { container } = render(<JerseyNumberCard />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test("wählen: erst prüft der Server, dann bestätigt das Mitglied, dann steht die Nummer groß da", async () => {
  const user = userEvent.setup();
  apiMock.get.mockImplementation(async (url, config) => {
    if (url.endsWith("/check")) {
      const number = Number(config.params.number);
      return { data: number === 8 ? { number, free: false, reason: "taken", text: "Diese Nummer hat schon jemand." } : { number, free: true, text: "Frei." } };
    }
    return { data: open };
  });
  apiMock.post.mockResolvedValue({ data: fixed });
  render(<JerseyNumberCard />);
  const input = await screen.findByTestId("jersey-input");
  expect(screen.getByTestId("jersey-card")).toHaveTextContent("Nicht wählbar: 13.");
  expect(screen.getByTestId("jersey-choose")).toBeDisabled();

  await user.type(input, "100");
  expect(screen.getByTestId("jersey-check")).toHaveTextContent("Nur Nummern von 0 bis 99.");
  await user.clear(input);
  await user.type(input, "8");
  await waitFor(() => expect(screen.getByTestId("jersey-check")).toHaveTextContent("Diese Nummer hat schon jemand."));
  expect(screen.getByTestId("jersey-choose")).toBeDisabled();

  await user.clear(input);
  await user.type(input, "7");
  await waitFor(() => expect(screen.getByTestId("jersey-check")).toHaveTextContent("Frei"));
  await user.click(screen.getByTestId("jersey-choose"));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Die 7 als deine Nummer festlegen?" }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/membership/me/jersey-number", { number: 7, confirmed: true }));
  const shown = await screen.findByTestId("jersey-number");
  expect(shown).toHaveTextContent("7");
  expect(shown).toHaveAttribute("data-fresh", "1");
  expect(screen.queryByTestId("jersey-input")).toBeNull();
});

test("abgebrochene Bestätigung schickt nichts", async () => {
  const user = userEvent.setup();
  confirmMock.mockResolvedValueOnce(false);
  apiMock.get.mockImplementation(async (url) => ({ data: url.endsWith("/check") ? { number: 0, free: true } : open }));
  render(<JerseyNumberCard />);
  await user.type(await screen.findByTestId("jersey-input"), "0");
  await waitFor(() => expect(screen.getByTestId("jersey-choose")).toBeEnabled());
  await user.click(screen.getByTestId("jersey-choose"));
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("alle vergeben: das steht da, statt ein Feld anzubieten", async () => {
  apiMock.get.mockResolvedValue({ data: { ...open, free_count: 0 } });
  render(<JerseyNumberCard />);
  expect(await screen.findByTestId("jersey-none-left")).toHaveTextContent("Gerade ist keine Nummer frei");
  expect(screen.queryByTestId("jersey-input")).toBeNull();
});

test("festgelegt: nur noch ein Antrag mit Begründung, danach liegt er beim Vorstand", async () => {
  const user = userEvent.setup();
  let view = { ...fixed, dolibarr: { state: "field_missing", text: "Deine Nummer ist hier gesichert." },
    requests: [{ id: "r0", current: 5, wished: 7, status: "applied", status_label: "übernommen", decided_at: "2026-10-01T10:00:00+00:00" }] };
  apiMock.get.mockImplementation(async (url, config) => (url.endsWith("/check") ? { data: { number: Number(config.params.number), free: true } } : { data: view }));
  apiMock.post.mockImplementation(async () => {
    view = { ...view, open_request: { id: "r1", current: 7, wished: 9, status: "received", received_at: "2026-10-26T11:00:00+00:00" } };
    return { data: view.open_request };
  });
  render(<JerseyNumberCard />);
  expect(await screen.findByTestId("jersey-number")).toHaveTextContent("7");
  expect(screen.getByTestId("jersey-sync")).toHaveTextContent("gesichert");
  expect(screen.getByTestId("jersey-requests")).toHaveTextContent("Statt 5: Wunsch 7");
  await user.click(screen.getByTestId("jersey-ask"));
  const send = screen.getByTestId("jersey-request-send");
  expect(send).toBeDisabled();
  await user.type(screen.getByTestId("jersey-wish"), "9");
  await user.type(screen.getByTestId("jersey-reason"), "Die 9 ist meine Glückszahl");
  await waitFor(() => expect(send).toBeEnabled());
  await user.click(send);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/membership/me/jersey-number/requests", { wished: 9, reason: "Die 9 ist meine Glückszahl" }));
  expect(await screen.findByTestId("jersey-open-request")).toHaveTextContent("Statt 7: Wunsch 9");
});
