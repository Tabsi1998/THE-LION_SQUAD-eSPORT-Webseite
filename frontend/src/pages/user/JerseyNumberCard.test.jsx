import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Meine Nummer (#2034): einmal wählen mit Prüfung und Bestätigung, danach nur über einen Antrag. Die freien Nummern
// stehen als Raster da; geprüft wird per POST (die Nummer gehört nicht in die Adresse).

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
const confirmMock = vi.fn(async () => true);

vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("sonner", () => ({ toast: toastMock }));

const JerseyNumberCard = (await import("./JerseyNumberCard")).default;

const open = { available: true, number: null, can_choose: true, again: false, free_count: 7, free_numbers: [0, 1, 2, 4, 5, 6, 7],
  range: { min: 0, max: 9 }, reserved: [3], dolibarr: null, open_request: null, requests: [] };
const fixed = { ...open, number: 7, can_choose: false, free_count: 6, free_numbers: [0, 1, 2, 4, 5, 6], set_by: "member",
  chosen_at: "2026-10-26T10:00:00+00:00", dolibarr: { state: "ok", text: "Steht auch in der Mitgliederverwaltung." } };

const checkReply = (body) => (body.number === 8
  ? { data: { number: 8, free: false, reason: "taken", text: "Diese Nummer hat schon jemand." } }
  : { data: { number: body.number, free: true, text: "Frei." } });

beforeEach(() => vi.clearAllMocks());

test("ohne Mitgliedschaft gibt es keine Karte", async () => {
  apiMock.get.mockResolvedValue({ data: { available: false, reason: "not_member" } });
  const { container } = render(<JerseyNumberCard />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test("wählen: Raster oder Feld, der Server prüft per POST, das Mitglied bestätigt, dann steht die Nummer groß da", async () => {
  const user = userEvent.setup();
  apiMock.get.mockResolvedValue({ data: open });
  apiMock.post.mockImplementation(async (url, body) => (url.endsWith("/check") ? checkReply(body) : { data: fixed }));
  render(<JerseyNumberCard />);
  const input = await screen.findByTestId("jersey-input");
  expect(screen.getByTestId("jersey-card")).toHaveTextContent("Nicht wählbar: 3.");
  expect(screen.getByTestId("jersey-choose")).toBeDisabled();
  // Raster: freie Nummern antippbar, vergebene und reservierte ausgegraut - ohne Namen.
  expect(screen.getByTestId("jersey-grid")).toHaveTextContent("Frei: 7");
  expect(screen.getByTestId("jersey-grid-3")).toBeDisabled();
  expect(screen.getByTestId("jersey-grid-8")).toBeDisabled();

  await user.type(input, "100");
  expect(screen.getByTestId("jersey-check")).toHaveTextContent("Nur Nummern von 0 bis 9.");
  await user.clear(input);
  await user.type(input, "8");
  await waitFor(() => expect(screen.getByTestId("jersey-check")).toHaveTextContent("Diese Nummer hat schon jemand."));
  expect(apiMock.post).toHaveBeenCalledWith("/membership/me/jersey-number/check", { number: 8 }, expect.anything());
  expect(apiMock.get.mock.calls.some(([url]) => url.includes("check"))).toBe(false);
  expect(screen.getByTestId("jersey-choose")).toBeDisabled();

  await user.click(screen.getByTestId("jersey-grid-7"));
  expect(input).toHaveValue("7");
  expect(screen.getByTestId("jersey-grid-7")).toHaveAttribute("aria-pressed", "true");
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
  apiMock.get.mockResolvedValue({ data: open });
  apiMock.post.mockImplementation(async (url, body) => checkReply(body));
  render(<JerseyNumberCard />);
  await user.click(await screen.findByTestId("jersey-grid-0"));
  await waitFor(() => expect(screen.getByTestId("jersey-choose")).toBeEnabled());
  await user.click(screen.getByTestId("jersey-choose"));
  expect(apiMock.post.mock.calls.filter(([url]) => url === "/membership/me/jersey-number")).toEqual([]);
});

test("alle vergeben: das steht da, statt Feld und Raster anzubieten", async () => {
  apiMock.get.mockResolvedValue({ data: { ...open, free_count: 0, free_numbers: [] } });
  render(<JerseyNumberCard />);
  expect(await screen.findByTestId("jersey-none-left")).toHaveTextContent("Gerade ist keine Nummer frei");
  expect(screen.queryByTestId("jersey-input")).toBeNull();
  expect(screen.queryByTestId("jersey-grid")).toBeNull();
});

test("sehr großer Bereich: kein Raster, nur das Feld", async () => {
  apiMock.get.mockResolvedValue({ data: { ...open, range: { min: 0, max: 999 }, free_count: 990, free_numbers: null } });
  render(<JerseyNumberCard />);
  expect(await screen.findByTestId("jersey-input")).toBeInTheDocument();
  expect(screen.queryByTestId("jersey-grid")).toBeNull();
});

test("festgelegt: nur noch ein Antrag mit Begründung, danach liegt er beim Vorstand", async () => {
  const user = userEvent.setup();
  let view = { ...fixed, dolibarr: { state: "field_missing", text: "Deine Nummer ist hier gesichert." },
    requests: [{ id: "r0", current: 5, wished: 7, status: "applied", status_label: "übernommen", decided_at: "2026-10-01T10:00:00+00:00" }] };
  apiMock.get.mockImplementation(async () => ({ data: view }));
  apiMock.post.mockImplementation(async (url, body) => {
    if (url.endsWith("/check")) return checkReply(body);
    view = { ...view, open_request: { id: "r1", current: 7, wished: 6, status: "received", received_at: "2026-10-26T11:00:00+00:00" } };
    return { data: view.open_request };
  });
  render(<JerseyNumberCard />);
  expect(await screen.findByTestId("jersey-number")).toHaveTextContent("7");
  expect(screen.getByTestId("jersey-sync")).toHaveTextContent("gesichert");
  expect(screen.getByTestId("jersey-requests")).toHaveTextContent("Statt 5: Wunsch 7");
  await user.click(screen.getByTestId("jersey-ask"));
  const send = screen.getByTestId("jersey-request-send");
  expect(send).toBeDisabled();
  await user.click(screen.getByTestId("jersey-wish-grid-6"));
  expect(screen.getByTestId("jersey-wish")).toHaveValue("6");
  await user.type(screen.getByTestId("jersey-reason"), "Die 6 ist meine Glückszahl");
  await waitFor(() => expect(send).toBeEnabled());
  await user.click(send);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/membership/me/jersey-number/requests", { wished: 6, reason: "Die 6 ist meine Glückszahl" }));
  expect(await screen.findByTestId("jersey-open-request")).toHaveTextContent("Statt 7: Wunsch 6");
});
