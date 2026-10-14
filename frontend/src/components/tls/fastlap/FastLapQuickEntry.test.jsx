import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Schnelleingabe am Simulator (#1585): Ziffernblock, Gast, „Versuch 2 von 3“ aus der eingestellten Zahl, ungültig mit
// einem Tipp (auch ohne Zeit), „Eintragen & nächster Fahrer“ und „Letzte korrigieren“.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const confirmMock = vi.fn(async () => true);
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock, usePrompt: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { FastLapQuickEntry } = await import("./FastLapQuickEntry");
const { FastLapQueuePanel } = await import("./FastLapQueuePanel");

const CHALLENGE = { id: "c-1", attempt_limit: 3 };
const TRACK = { id: "t-1", name: "Monza" };
const ANNA = { id: "g-1", display_name: "Anna", participant_id: "guest-g-1" };

function quick(props = {}) {
  return render(<FastLapQuickEntry challenge={CHALLENGE} track={TRACK} times={[]} guests={[ANNA]} queue={{ on_track: [], next: [] }} onSaved={vi.fn()} {...props} />);
}

function chooseAnna() {
  fireEvent.click(screen.getByTestId("fl-quick-driver-tab-guest"));
  fireEvent.click(screen.getByTestId("fl-quick-driver-guest-g-1"));
}

function typeKeys(...keys) {
  for (const key of keys) fireEvent.click(screen.getByTestId(`fl-key-${key}`));
}

beforeEach(() => {
  apiMock.post.mockReset();
  apiMock.patch.mockReset();
  apiMock.post.mockImplementation(async (url, body) => ({ data: { id: "lap-1", ...body } }));
  apiMock.patch.mockResolvedValue({ data: {} });
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
  toastMock.error.mockReset();
});

test("ein Gast, Zeit am Ziffernblock, Eintragen - mit Vorschau und dem Versuch aus der eingestellten Zahl", async () => {
  quick({ times: [{ user_id: null, guest_id: "g-1" }] });
  chooseAnna();
  expect(screen.getByTestId("fl-quick-attempt")).toHaveTextContent("Versuch 2 von 3");
  typeKeys("1", "colon", "2", "4", "comma", "5", "8", "7");
  expect(screen.getByTestId("fl-quick-time")).toHaveValue("1:24,587");
  expect(screen.getByText("= 1:24.587")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("fl-quick-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(1));
  const [url, body] = apiMock.post.mock.calls[0];
  expect(url).toBe("/f1/challenges/c-1/times");
  expect(body).toEqual(expect.objectContaining({ guest_id: "g-1", track_id: "t-1", time_ms: 84587, is_invalid: false }));
  expect(body.user_id).toBeUndefined();
  expect(screen.getByTestId("fl-quick-time")).toHaveValue("");
});

test("alle Versuche gefahren: Eintragen ist gesperrt und die Anzeige sagt es", async () => {
  quick({ times: [1, 2, 3].map(() => ({ user_id: null, guest_id: "g-1" })) });
  chooseAnna();
  expect(screen.getByTestId("fl-quick-attempt")).toHaveTextContent("Alle 3 Versuche gefahren");
  typeKeys("8", "4");
  fireEvent.click(screen.getByTestId("fl-quick-save"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Alle 3 Versuche gefahren"));
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("ohne Grenze zählt die Anzeige nur hoch", () => {
  quick({ challenge: { id: "c-1", attempt_limit: null } });
  chooseAnna();
  expect(screen.getByTestId("fl-quick-attempt")).toHaveTextContent("Versuch 1");
});

test("ungültig mit einem Tipp - ohne getippte Zeit als Runde ohne Zeit, mit Grund", async () => {
  quick();
  chooseAnna();
  fireEvent.click(screen.getByTestId("fl-quick-invalid"));
  fireEvent.click(screen.getByRole("button", { name: "Strecke verlassen" }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(1));
  expect(apiMock.post.mock.calls[0][1]).toEqual(expect.objectContaining({ time_ms: 0, is_invalid: true, admin_note: "Strecke verlassen" }));
});

test("eine unplausible Zeit fragt nach - abbrechen schickt nichts", async () => {
  confirmMock.mockResolvedValue(false);
  quick();
  chooseAnna();
  typeKeys("1", "2");
  fireEvent.click(screen.getByTestId("fl-quick-save"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalled());
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("Eintragen & nächster Fahrer: die Zeit, dann übergibt die Liste an der Station", async () => {
  const onTrack = { id: "q-1", user_id: null, guest_id: "g-1", display_name: "Anna", track_id: "t-1", station: "Simulator 1", attempts_used: 0 };
  apiMock.post.mockImplementation(async (url, body) => {
    if (url.endsWith("/queue/next")) return { data: { id: "q-2", user_id: "u-2", guest_id: null, display_name: "Ben", track_id: "t-1", station: "Simulator 1" } };
    return { data: { id: "lap-1", ...body } };
  });
  quick({ queue: { on_track: [onTrack], next: [] } });
  // Fährt genau eine Person auf der Strecke, ist sie schon gewählt.
  expect(await screen.findByTestId("fl-quick-driver-selected")).toHaveTextContent("Anna");
  typeKeys("8", "4", "comma", "5");
  fireEvent.click(screen.getByTestId("fl-quick-save-next"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(2));
  expect(apiMock.post.mock.calls[1]).toEqual(["/f1/challenges/c-1/queue/next", { done_id: "q-1", station: "Simulator 1", track_id: "t-1" }]);
  expect(await screen.findByTestId("fl-quick-driver-selected")).toHaveTextContent("Ben");
});

test("Letzte korrigieren schickt die neue Zeit an die letzte Runde", async () => {
  quick();
  chooseAnna();
  typeKeys("8", "4", "comma", "5");
  fireEvent.click(screen.getByTestId("fl-quick-save"));
  await waitFor(() => expect(screen.getByTestId("fl-quick-correct")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("fl-quick-correct"));
  expect(screen.getByTestId("fl-quick-time")).toHaveValue("1:24,500");
  fireEvent.click(screen.getByTestId("fl-key-back"));
  typeKeys("1");
  fireEvent.click(screen.getByTestId("fl-quick-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/f1/times/lap-1", { time_ms: 84501 }));
});

test("die Tastatur: „/“ wird Doppelpunkt, „+“ trägt ein und holt den Nächsten", async () => {
  quick();
  chooseAnna();
  const input = screen.getByTestId("fl-quick-time");
  fireEvent.change(input, { target: { value: "1" } });
  fireEvent.keyDown(input, { key: "/" });
  expect(input).toHaveValue("1:");
  fireEvent.change(input, { target: { value: "1:24,5" } });
  fireEvent.keyDown(input, { key: "+" });
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/f1/challenges/c-1/queue/next", expect.anything()));
});

// ------------------------------------------------------------------ Am Start / Als Nächstes

const QUEUE = {
  max_attempts: 3,
  stations: ["Simulator 1"],
  on_track: [{ id: "q-1", user_id: "u-1", display_name: "Fahrerin", station: "Simulator 1", attempts_used: 1, track_id: "t-1" }],
  next: [
    { id: "q-2", guest_id: "g-1", is_guest: true, display_name: "Anna", attempts_used: 0, track_id: "t-1" },
    { id: "q-3", user_id: "u-3", display_name: "Ben", attempts_used: 0, track_id: "t-1" },
  ],
};

test("die Liste zeigt Am Start mit Station und Versuch, die Wartenden in Reihenfolge", () => {
  render(<FastLapQueuePanel challenge={CHALLENGE} track={TRACK} queue={QUEUE} guests={[ANNA]} onChanged={vi.fn()} />);
  expect(screen.getByTestId("fl-queue-row-q-1")).toHaveTextContent("Simulator 1 · Versuch 2 von 3");
  expect(screen.getByTestId("fl-queue-next").textContent).toMatch(/Anna.*Ben/);
  expect(screen.getByTestId("fl-queue-row-q-2")).toHaveTextContent("Gast");
});

test("nach oben, nächster Fahrer und hinzufügen rufen die Liste", async () => {
  const onChanged = vi.fn();
  apiMock.post.mockResolvedValue({ data: {} });
  render(<FastLapQueuePanel challenge={CHALLENGE} track={TRACK} queue={QUEUE} guests={[ANNA]} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole("button", { name: "Ben nach oben" }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/f1/queue/q-3/up"));
  fireEvent.click(screen.getByTestId("fl-queue-next-q-1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/f1/challenges/c-1/queue/next", { done_id: "q-1", station: "Simulator 1", track_id: "t-1" }));
  fireEvent.click(screen.getByTestId("fl-queue-driver-tab-guest"));
  fireEvent.click(screen.getByTestId("fl-queue-driver-guest-g-1"));
  fireEvent.change(screen.getByTestId("fl-queue-station"), { target: { value: "Simulator 2" } });
  fireEvent.click(screen.getByTestId("fl-queue-add"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/f1/challenges/c-1/queue", { guest_id: "g-1", track_id: "t-1", station: "Simulator 2" }));
  expect(onChanged).toHaveBeenCalled();
});

test("einen Gast anlegen und gleich wählen", async () => {
  apiMock.post.mockResolvedValue({ data: { id: "g-9", display_name: "Lena 🏎️" } });
  const created = vi.fn();
  quick({ onGuestCreated: created });
  fireEvent.click(screen.getByTestId("fl-quick-driver-tab-guest"));
  fireEvent.change(screen.getByTestId("fl-quick-driver-guest-name"), { target: { value: "Lena 🏎️" } });
  fireEvent.click(screen.getByTestId("fl-quick-driver-guest-create"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/f1/challenges/c-1/guests", { display_name: "Lena 🏎️" }));
  expect(await screen.findByTestId("fl-quick-driver-selected")).toHaveTextContent("Lena 🏎️");
  expect(created).toHaveBeenCalledWith({ id: "g-9", display_name: "Lena 🏎️" });
});
