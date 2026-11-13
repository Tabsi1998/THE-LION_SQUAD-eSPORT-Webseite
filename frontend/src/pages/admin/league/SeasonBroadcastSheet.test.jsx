import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Rundnachricht (E.4, Nr. 153): Vorgabe Captains und Vertreter, Kreis wählbar, Vorschau mit Empfängerzahl, Bestätigung vor dem Senden,
// Mail nach Wahl, eine Kennung je Dialog und kein zweiter Versand beim Doppelklick. Erfundene Namen.
const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "") }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
const confirmMock = vi.fn();
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));

const { SeasonBroadcastSheet } = await import("./SeasonBroadcastSheet");

const DIVISIONS = [{ id: "d1", level: 1, label: "Liga 1", status: "active", staffeln: [{ tournament_id: "t1", staffel: "A" }] }];
const PREVIEW = "/admin/leagues/seasons/s1/broadcast/preview";
const SEND = "/admin/leagues/seasons/s1/broadcast";

function renderSheet(props = {}) {
  const onSent = vi.fn();
  render(<SeasonBroadcastSheet seasonId="s1" divisions={DIVISIONS} onClose={vi.fn()} onSent={onSent} {...props} />);
  return { onSent };
}

function fill() {
  fireEvent.change(screen.getByTestId("broadcast-title"), { target: { value: "Spieltag 3" } });
  fireEvent.change(screen.getByTestId("broadcast-text"), { target: { value: "Bitte denkt an den Check-in." } });
}

let release;
beforeEach(() => {
  window.sessionStorage.clear();
  for (const fn of [...Object.values(apiMock), ...Object.values(toastMock), confirmMock]) fn.mockReset();
  confirmMock.mockResolvedValue(true);
  apiMock.post.mockImplementation(async (url, body) => {
    if (url === PREVIEW) return { data: { recipients: body.audience === "players" ? 9 : body.scope === "staffel" ? 2 : 4, scope_label: "x" } };
    await new Promise((resolve) => { release = resolve; });
    return { data: { recipients: 4, replay: false } };
  });
});

test("Vorgabe Captains und Vertreter mit Vorschau, Kreis und Empfänger ändern die Zahl", async () => {
  renderSheet();
  expect(await screen.findByTestId("broadcast-preview")).toHaveTextContent("Geht an 4 Personen");
  expect(apiMock.post).toHaveBeenCalledWith(PREVIEW, { audience: "captains", scope: "season", scope_id: null });
  expect(screen.getByText(/steht in der Glocke nach dem Namen der Season/)).toBeInTheDocument();
  expect(screen.getByTestId("broadcast-mail")).toHaveTextContent("Einstellung „Turnier-Updates“");
  fireEvent.change(screen.getByTestId("broadcast-scope"), { target: { value: "staffel:t1" } });
  await waitFor(() => expect(screen.getByTestId("broadcast-preview")).toHaveTextContent("Geht an 2 Personen"));
  expect(apiMock.post).toHaveBeenLastCalledWith(PREVIEW, { audience: "captains", scope: "staffel", scope_id: "t1" });
  fireEvent.click(screen.getByLabelText(/Alle Spieler/));
  await waitFor(() => expect(screen.getByTestId("broadcast-preview")).toHaveTextContent("Geht an 9 Personen"));
  expect(screen.getByTestId("broadcast-send")).toHaveTextContent("An 9 Personen schicken");
});

test("fragt vor dem Senden nach und schickt nichts ohne Zustimmung", async () => {
  confirmMock.mockResolvedValue(false);
  renderSheet();
  await waitFor(() => expect(screen.getByTestId("broadcast-preview")).toHaveTextContent("Geht an 4 Personen"));
  fill();
  fireEvent.click(screen.getByTestId("broadcast-send"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
  expect(confirmMock.mock.calls[0][0].title).toBe("An 4 Personen schicken?");
  expect(apiMock.post.mock.calls.filter(([url]) => url === SEND)).toHaveLength(0);
});

test("prüft Betreff und Nachricht vor dem Senden", async () => {
  renderSheet();
  await waitFor(() => expect(screen.getByTestId("broadcast-preview")).toHaveTextContent("Geht an 4 Personen"));
  fireEvent.change(screen.getByTestId("broadcast-title"), { target: { value: "ab" } });
  fireEvent.click(screen.getByTestId("broadcast-send"));
  expect(await screen.findByTestId("broadcast-error")).toHaveTextContent("Betreff: mindestens 3 Zeichen");
  expect(confirmMock).not.toHaveBeenCalled();
});

test("schickt einmal mit Mail nach Wahl - ein Doppelklick schickt nicht zweimal", async () => {
  const { onSent } = renderSheet();
  await waitFor(() => expect(screen.getByTestId("broadcast-preview")).toHaveTextContent("Geht an 4 Personen"));
  fill();
  fireEvent.click(screen.getByTestId("broadcast-mail").querySelector("input"));
  fireEvent.click(screen.getByTestId("broadcast-send"));
  await waitFor(() => expect(apiMock.post.mock.calls.filter(([url]) => url === SEND)).toHaveLength(1));
  fireEvent.click(screen.getByTestId("broadcast-send"));
  expect(screen.getByTestId("broadcast-send")).toBeDisabled();
  release();
  await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
  const sends = apiMock.post.mock.calls.filter(([url]) => url === SEND);
  expect(sends).toHaveLength(1);
  expect(sends[0][1]).toMatchObject({ title: "Spieltag 3", text: "Bitte denkt an den Check-in.", audience: "captains", mail: true, scope: "season" });
  expect(sends[0][1].request_id.length).toBeGreaterThanOrEqual(8);
  expect(toastMock.success).toHaveBeenCalledWith("Rundnachricht an 4 Personen verschickt.");
});

test("niemand im Kreis: Senden gesperrt", async () => {
  apiMock.post.mockResolvedValue({ data: { recipients: 0, scope_label: "x" } });
  renderSheet();
  expect(await screen.findByTestId("broadcast-preview")).toHaveTextContent("noch niemanden");
  expect(screen.getByTestId("broadcast-send")).toBeDisabled();
});

test("ein Doppelklick vor der Antwort auf die Rückfrage fragt nur einmal", async () => {
  let answer;
  confirmMock.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
  renderSheet();
  await waitFor(() => expect(screen.getByTestId("broadcast-preview")).toHaveTextContent("Geht an 4 Personen"));
  fill();
  fireEvent.click(screen.getByTestId("broadcast-send"));
  fireEvent.click(screen.getByTestId("broadcast-send"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
  answer(false);
  await waitFor(() => expect(screen.getByTestId("broadcast-send")).not.toBeDisabled());
  expect(confirmMock).toHaveBeenCalledTimes(1);
});

test("der Server verschickt im Hintergrund: der Dialog zeigt den Fortschritt und schließt mit dem Endstand", async () => {
  apiMock.post.mockImplementation(async (url) => (url === PREVIEW ? { data: { recipients: 4 } }
    : { data: { recipients: 4, processed: 0, state: "sending", replay: false } }));
  apiMock.get.mockResolvedValue({ data: { recipients: 4, processed: 4, delivered: 4, state: "sent" } });
  const { onSent } = renderSheet();
  await waitFor(() => expect(screen.getByTestId("broadcast-preview")).toHaveTextContent("Geht an 4 Personen"));
  fill();
  fireEvent.click(screen.getByTestId("broadcast-send"));
  expect(await screen.findByTestId("broadcast-progress")).toHaveTextContent("0 von 4");
  expect(screen.getByTestId("broadcast-send")).toBeDisabled();
  await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1), { timeout: 4000 });
  expect(apiMock.get).toHaveBeenCalledWith(expect.stringMatching(/^\/admin\/leagues\/seasons\/s1\/broadcast\/.{8,}$/));
  expect(toastMock.success).toHaveBeenCalledWith("Rundnachricht an 4 Personen verschickt.");
});

// M-1: Ein hängender Versand bleibt nicht unsichtbar auf „wird verschickt“.
test("hängt der Versand, endet das Nachfragen, und „Fortsetzen“ schickt denselben Aufruf mit Kennung, Betreff und Text", async () => {
  const sends = [];
  apiMock.post.mockImplementation(async (url, body) => {
    if (url === PREVIEW) return { data: { recipients: 4 } };
    sends.push(body);
    return { data: sends.length === 1 ? { recipients: 4, processed: 0, state: "sending" } : { recipients: 4, processed: 1, state: "sending", resumed: true } };
  });
  let stale = true;
  apiMock.get.mockImplementation(async () => ({ data: stale ? { recipients: 4, processed: 1, state: "interrupted", stale: true }
    : { recipients: 4, processed: 4, delivered: 4, state: "sent", stale: false } }));
  const { onSent } = renderSheet();
  await waitFor(() => expect(screen.getByTestId("broadcast-preview")).toHaveTextContent("Geht an 4 Personen"));
  fill();
  fireEvent.click(screen.getByTestId("broadcast-send"));
  await waitFor(() => expect(screen.getByTestId("broadcast-progress")).toHaveAttribute("data-stale", "true"), { timeout: 4000 });
  expect(screen.getByTestId("broadcast-progress")).toHaveTextContent("Versand hängt");
  expect(screen.getByTestId("broadcast-progress")).toHaveTextContent("1 von 4");
  expect(screen.queryByTestId("broadcast-progress-slow")).not.toBeInTheDocument();
  const asked = apiMock.get.mock.calls.length;
  await new Promise((resolve) => { setTimeout(resolve, 1700); });
  expect(apiMock.get.mock.calls.length).toBe(asked);

  stale = false;
  fireEvent.click(screen.getByTestId("broadcast-resume"));
  await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1), { timeout: 4000 });
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
  expect(sends[1]).toMatchObject({ title: "Spieltag 3", text: "Bitte denkt an den Check-in." });
  expect(window.sessionStorage.getItem("tls-broadcast:s1")).toBeNull();
}, 15000);

test("geschlossen während des Versands: wieder geöffnet zeigt der Dialog den Stand und setzt mit derselben Kennung fort", async () => {
  window.sessionStorage.setItem("tls-broadcast:s1", JSON.stringify({ request_id: "kennung-123456", title: "Spieltag 3", text: "Bitte denkt an den Check-in.",
    audience: "players", scope: "season:", mail: true }));
  apiMock.get.mockResolvedValue({ data: { recipients: 9, processed: 3, state: "sending", stale: true } });
  renderSheet();
  await waitFor(() => expect(screen.getByTestId("broadcast-progress")).toHaveTextContent("Versand hängt"));
  expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s1/broadcast/kennung-123456");
  expect(screen.getByTestId("broadcast-title")).toHaveValue("Spieltag 3");
  expect(screen.getByTestId("broadcast-send")).toBeDisabled();
  fireEvent.click(screen.getByTestId("broadcast-resume"));
  await waitFor(() => expect(apiMock.post.mock.calls.filter(([url]) => url === SEND)).toHaveLength(1));
  expect(apiMock.post.mock.calls.find(([url]) => url === SEND)[1]).toMatchObject({ request_id: "kennung-123456", audience: "players", mail: true });
});

test("wieder geöffnet nach fertigem Versand: neu beginnen, nichts fortsetzen", async () => {
  window.sessionStorage.setItem("tls-broadcast:s1", JSON.stringify({ request_id: "kennung-123456", title: "Alt", text: "Alter Text hier.", audience: "captains", scope: "season:" }));
  apiMock.get.mockResolvedValue({ data: { recipients: 4, processed: 4, state: "sent" } });
  renderSheet();
  await waitFor(() => expect(window.sessionStorage.getItem("tls-broadcast:s1")).toBeNull());
  expect(screen.getByTestId("broadcast-title")).toHaveValue("");
  expect(screen.queryByTestId("broadcast-progress")).not.toBeInTheDocument();
});
