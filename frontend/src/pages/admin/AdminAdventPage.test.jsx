import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Adventkalender pflegen (#641): 24 Tage mit Zahlen und Hinweisen, anlegen und leeren, aus dem Vorjahr
// übernehmen, Vorschau, Ziehung und Nachziehen - jede folgenreiche Aktion fragt vorher nach.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() };
const confirm = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "", formatApiError: (detail) => (typeof detail === "string" ? detail : "") }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <main>{children}</main> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirm }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: ({ value, onChange, testId }) => <button type="button" data-testid={testId} onClick={() => onChange("/api/static/uploads/neu.webp")}>{value || "kein Bild"}</button> }));
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ hasConsent: () => false, openSettings: () => {} }) }));

const { default: AdminAdventPage, statsText } = await import("./AdminAdventPage");

const KINDS = [["text", "Text"], ["image", "Bild"], ["video", "Video"], ["clip", "Twitch-Clip"], ["news", "News-Beitrag"], ["event", "Event"], ["member_spotlight", "Mitglied der Woche"], ["sticker", "Sticker"], ["quiz", "Quiz"], ["prize", "Gewinn"]].map(([key, label]) => ({ key, label }));
const PRIZE = { prize_label: "TLS-Hoodie", prize_value: "Größe nach Wahl", winners: 2, audience: "all", closes_at: "2026-12-13T20:00:00+01:00", staff_may_enter: false };
const OPEN_RAFFLE = { id: "r12", label: "TLS-Hoodie", value: "Größe nach Wahl", winners: 2, audience: "all", staff_may_enter: false, closes_at: "2026-12-13T20:00:00+01:00", status: "open", entries: 37, can_draw: true, needs_close_early: true, terms: [], protocol: [] };
const DRAWN_RAFFLE = {
  ...OPEN_RAFFLE, id: "r8", label: "Kinogutschein", status: "drawn", entries: 41, can_draw: false, needs_close_early: false,
  protocol: [{ id: "z1", kind: "draw", drawn_at: "2026-12-09T19:05:00+00:00", drawn_by: "Vorstand", entries: 41, eligible: 39, method: "Zufallsziehung, jede Person ein Los", closed_early: false, replaces: null, winners: [
    { user_id: "u1", name: "Anna Beispiel", pickup_id: "k1", pickup_status: "picked_up", replaced: false, can_redraw: false },
    { user_id: "u2", name: "Bernd Muster", pickup_id: "k2", pickup_status: "expired", replaced: false, can_redraw: true },
  ] }],
};

function view({ year = 2026, years = [2026, 2025], running = true } = {}) {
  const stored = {
    1: { kind: "text", title: "Willkommen im Advent", body: "Schön, dass du da bist." },
    6: { kind: "member_spotlight", title: "Mitglied der Woche", body: "Danke", ref_id: "p1", consent_confirmed: false, copied_from: 2025 },
    8: { kind: "prize", title: "Kinogutscheine", body: "", prize: PRIZE, raffle_id: "r8" },
    12: { kind: "prize", title: "Heute gibt es etwas zu gewinnen", body: "Mach mit!", prize: PRIZE, raffle_id: "r12" },
  };
  const doors = [];
  for (let day = 1; day <= 24; day += 1) {
    const door = stored[day] ? { id: `d${day}`, year, day, copied_from: null, ...stored[day] } : null;
    let problem = door ? null : "Noch nichts eingetragen – an diesem Tag grüßt nur der Löwe.";
    if (day === 6) problem = "Die Einwilligung des Mitglieds ist für dieses Jahr noch nicht bestätigt.";
    doors.push({ day, opens_at: `${year}-12-${String(day).padStart(2, "0")}T06:00:00+01:00`, is_open: day <= 12, seed: day * 7, door, problem, stats: day === 1 ? { opened: 40, same_day: 30, later: 10, views: 95, quiz_done: 0 } : { opened: 0, same_day: 0, later: 0, views: 0, quiz_done: 0 }, raffle: day === 12 ? OPEN_RAFFLE : day === 8 ? DRAWN_RAFFLE : null });
  }
  return { year, kinds: KINDS, door_hour: 6, order: [], doors, filled: 4, total: 24, years, people: 52, running };
}

const OPTIONS = { news: [{ id: "n1", label: "Wintercup", hint: "4.12.2026" }], events: [], members: [{ id: "p1", label: "Pauli", hint: "Kapitänin" }], stickers: [], audiences: [{ key: "all", label: "alle mit Konto" }, { key: "members", label: "nur Vereinsmitglieder" }], max_winners: 20 };

function show() {
  return render(<MemoryRouter><AdminAdventPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 11, 12, 10), toFake: ["Date"] });
  apiMock.get.mockImplementation((url) => {
    if (url === "/seasonal/advent/admin/options") return Promise.resolve({ data: OPTIONS });
    const year = Number(url.split("/")[4]);
    return Promise.resolve({ data: view({ year, years: [2026, 2025], running: year === 2026 }) });
  });
  apiMock.put.mockResolvedValue({ data: {} });
  apiMock.post.mockResolvedValue({ data: { source: 2025, target: 2026, copied: [2, 3], skipped: [1], reconfirm: [3] } });
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
  confirm.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

test("Zahlen eines Türchens in einem Satz", () => {
  expect(statsText({ opened: 0, views: 0 })).toBe("Noch nicht geöffnet");
  expect(statsText(null)).toBe("Noch nicht geöffnet");
  expect(statsText({ opened: 40, same_day: 30, later: 10, views: 95, quiz_done: 0 }, "text")).toBe("40 Personen mit Konto · 30 am Tag selbst, 10 nachgeholt · 95 Aufrufe insgesamt");
  expect(statsText({ opened: 1, same_day: 1, later: 0, views: 1, quiz_done: 1 }, "quiz")).toBe("1 Person mit Konto · 1 am Tag selbst, 0 nachgeholt · 1 Aufruf insgesamt · 1 beim Quiz dabei");
  expect(statsText({ opened: 0, same_day: 0, later: 0, views: 7, quiz_done: 0 }, "text")).toBe("0 Personen mit Konto · 7 Aufrufe insgesamt");
});

test("die Seite: Jahr, Kacheln, 24 Tage mit Art, Zahlen und Hinweisen", async () => {
  show();
  const days = await screen.findByTestId("advent-admin-days");
  expect(apiMock.get).toHaveBeenCalledWith("/seasonal/advent/admin/2026", { skipInvalidation: true });
  expect(within(days).getAllByRole("listitem").filter((item) => item.dataset.testid?.startsWith("advent-admin-day-"))).toHaveLength(24);
  expect(screen.getByTestId("advent-admin-year")).toHaveValue("2026");
  expect([...screen.getByTestId("advent-admin-year").options].map((option) => option.value)).toEqual(["2027", "2026", "2025"]);
  expect(screen.getByTestId("advent-admin-filled")).toHaveTextContent("Angelegt4 von 24");
  expect(screen.getByTestId("advent-admin-problems")).toHaveTextContent("Hinweise1");
  expect(screen.getByTestId("advent-admin-people")).toHaveTextContent("Personen dabei52");
  expect(screen.getByTestId("advent-admin-state")).toHaveTextContent("Standläuft");

  const first = screen.getByTestId("advent-admin-day-1");
  expect(first).toHaveAttribute("data-filled", "1");
  expect(first).toHaveTextContent("Di, 1. Dezember");
  expect(first).toHaveTextContent("offen");
  expect(first).toHaveTextContent("TextWillkommen im Advent");
  expect(screen.getByTestId("advent-admin-stats-1")).toHaveTextContent("40 Personen mit Konto · 30 am Tag selbst, 10 nachgeholt · 95 Aufrufe insgesamt");
  expect(within(first).getByRole("button", { name: "Bearbeiten" })).toBeInTheDocument();

  const empty = screen.getByTestId("advent-admin-day-13");
  expect(empty).toHaveAttribute("data-filled", "0");
  expect(empty).toHaveTextContent("öffnet 13. Dezember, 6 Uhr");
  expect(empty).toHaveTextContent("Noch nichts eingetragen");
  expect(within(empty).getByRole("button", { name: "Anlegen" })).toBeInTheDocument();
  expect(within(empty).queryByRole("button", { name: /leeren/ })).toBeNull();

  expect(screen.getByTestId("advent-admin-problem-6")).toHaveTextContent("Die Einwilligung des Mitglieds ist für dieses Jahr noch nicht bestätigt.");
  expect(screen.getByTestId("advent-admin-day-6")).toHaveTextContent("Übernommen aus 2025");
  expect(screen.getByRole("link", { name: "Auftritt → Jahreszeiten" })).toHaveAttribute("href", "/admin/settings/jahreszeiten");
  expect(screen.getByTestId("advent-admin-open")).toHaveAttribute("href", "/advent");
});

test("ein anderes Jahr lädt neu; ohne Türchen keine Vorschau", async () => {
  show();
  await screen.findByTestId("advent-admin-days");
  apiMock.get.mockImplementation((url) => (url.endsWith("options") ? Promise.resolve({ data: OPTIONS }) : Promise.resolve({ data: { ...view({ year: 2027, running: false }), filled: 0, doors: view({ year: 2027 }).doors.map((item) => ({ ...item, door: null, raffle: null })) } })));
  fireEvent.change(screen.getByTestId("advent-admin-year"), { target: { value: "2027" } });
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/seasonal/advent/admin/2027", { skipInvalidation: true }));
  await waitFor(() => expect(screen.getByTestId("advent-admin-state")).toHaveTextContent("leer"));
  expect(screen.getByTestId("advent-admin-preview")).toBeDisabled();
  expect(screen.getByText("Die Vorschau gibt es ab dem ersten Türchen.")).toBeInTheDocument();
  expect(screen.queryByTestId("advent-admin-open")).toBeNull();
});

test("laden scheitert: ein Satz statt einer leeren Seite", async () => {
  apiMock.get.mockImplementation((url) => (url.endsWith("options") ? Promise.resolve({ data: OPTIONS }) : Promise.reject({ response: { data: { detail: "Dieses Jahr gibt es im Kalender nicht." } } })));
  show();
  expect(await screen.findByTestId("advent-admin-error")).toHaveTextContent("Dieses Jahr gibt es im Kalender nicht.");
  expect(screen.queryByTestId("advent-admin-days")).toBeNull();
});

test("anlegen: das Formular schickt, was zur Art gehört - und sagt vorher, was fehlt", async () => {
  show();
  await screen.findByTestId("advent-admin-days");
  fireEvent.click(screen.getByTestId("advent-admin-edit-13"));
  const editor = screen.getByTestId("advent-editor");
  expect(editor).toHaveAccessibleName("Türchen 13");
  expect(editor).toHaveTextContent("Adventkalender 2026 · So, 13. Dezember");
  expect(within(screen.getByTestId("advent-editor-kinds")).getAllByRole("radio")).toHaveLength(10);

  fireEvent.click(screen.getByTestId("advent-editor-save"));
  expect(screen.getByTestId("advent-editor-problem")).toHaveTextContent("Das Türchen braucht einen Titel.");
  expect(apiMock.put).not.toHaveBeenCalled();

  fireEvent.change(screen.getByTestId("advent-editor-title"), { target: { value: "Kranz-Quiz" } });
  fireEvent.click(screen.getByTestId("advent-editor-kind-quiz"));
  expect(screen.getByTestId("advent-editor-kind-quiz")).toHaveAttribute("aria-checked", "true");
  fireEvent.change(screen.getByTestId("advent-editor-quiz-question"), { target: { value: "Wie viele Kerzen hat der Adventkranz?" } });
  ["Drei", "Vier", "Fünf"].forEach((answer, index) => fireEvent.change(screen.getByTestId(`advent-editor-quiz-answer-${index}`), { target: { value: answer } }));
  fireEvent.click(screen.getByTestId("advent-editor-save"));
  expect(screen.getByTestId("advent-editor-problem")).toHaveTextContent("Bitte die richtige Antwort markieren.");
  fireEvent.click(screen.getByTestId("advent-editor-quiz-correct-1"));
  expect(screen.queryByTestId("advent-editor-problem")).toBeNull();
  // Die Vorschau zeigt sofort, was Besucher sehen werden.
  expect(within(screen.getByTestId("advent-editor-preview")).getByTestId("advent-quiz")).toHaveTextContent("Wie viele Kerzen hat der Adventkranz?");

  fireEvent.click(screen.getByTestId("advent-editor-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledTimes(1));
  expect(apiMock.put).toHaveBeenCalledWith("/seasonal/advent/admin/2026/13", { kind: "quiz", title: "Kranz-Quiz", body: "", quiz: { question: "Wie viele Kerzen hat der Adventkranz?", answers: ["Drei", "Vier", "Fünf"], correct: 1, explanation: "" } });
  await waitFor(() => expect(screen.queryByTestId("advent-editor")).toBeNull());
  expect(toast.success).toHaveBeenCalledWith("Türchen 13 gespeichert.");
});

test("speichern scheitert: der Satz des Servers steht im Formular, es bleibt offen", async () => {
  apiMock.put.mockRejectedValueOnce({ response: { data: { detail: "Das Video muss eine YouTube-Adresse sein." } } });
  show();
  await screen.findByTestId("advent-admin-days");
  fireEvent.click(screen.getByTestId("advent-admin-edit-13"));
  fireEvent.change(screen.getByTestId("advent-editor-title"), { target: { value: "Film" } });
  fireEvent.click(screen.getByTestId("advent-editor-kind-video"));
  fireEvent.change(screen.getByTestId("advent-editor-video"), { target: { value: "https://vimeo.com/1" } });
  fireEvent.click(screen.getByTestId("advent-editor-save"));
  expect(await screen.findByTestId("advent-editor-problem")).toHaveTextContent("Das Video muss eine YouTube-Adresse sein.");
  expect(screen.getByTestId("advent-editor")).toBeInTheDocument();
  expect(toast.error).toHaveBeenCalledWith("Das Video muss eine YouTube-Adresse sein.");
});

test("bearbeiten: Mitglied der Woche braucht den Haken, der Gewinn zeigt seine Felder", async () => {
  show();
  await screen.findByTestId("advent-admin-days");
  fireEvent.click(screen.getByTestId("advent-admin-edit-6"));
  expect(screen.getByTestId("advent-editor-ref")).toHaveValue("p1");
  expect([...screen.getByTestId("advent-editor-ref").options].map((option) => option.textContent)).toEqual(["Bitte wählen …", "Pauli (Kapitänin)"]);
  expect(screen.getByTestId("advent-editor-consent")).not.toBeChecked();
  fireEvent.click(screen.getByTestId("advent-editor-save"));
  expect(screen.getByTestId("advent-editor-problem")).toHaveTextContent("Bitte bestätigen, dass das Mitglied einverstanden ist.");
  fireEvent.click(screen.getByTestId("advent-editor-consent"));
  fireEvent.click(screen.getByTestId("advent-editor-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/seasonal/advent/admin/2026/6", { kind: "member_spotlight", title: "Mitglied der Woche", body: "Danke", ref_id: "p1", consent_confirmed: true }));
  await waitFor(() => expect(screen.queryByTestId("advent-editor")).toBeNull());

  fireEvent.click(screen.getByTestId("advent-admin-edit-12"));
  expect(screen.getByTestId("advent-editor-prize-label")).toHaveValue("TLS-Hoodie");
  expect(screen.getByTestId("advent-editor-prize-winners")).toHaveValue(2);
  expect(screen.getByTestId("advent-editor-prize-closes")).toHaveValue("2026-12-13T20:00");
  expect(screen.getByTestId("advent-editor-prize-label")).not.toBeDisabled();
  fireEvent.click(screen.getByTestId("advent-editor-cancel"));

  // Nach der Ziehung steht der Gewinn fest.
  fireEvent.click(screen.getByTestId("advent-admin-edit-8"));
  for (const field of ["label", "value", "winners", "audience", "closes", "staff"]) expect(screen.getByTestId(`advent-editor-prize-${field}`)).toBeDisabled();
  expect(screen.getByTestId("advent-editor-title")).not.toBeDisabled();
});

test("leeren fragt nach - und sagt, was mit schon geöffneten Türchen passiert", async () => {
  show();
  await screen.findByTestId("advent-admin-days");
  confirm.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByTestId("advent-admin-delete-1"));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(confirm.mock.calls[0][0]).toMatchObject({ title: "Türchen 1 leeren?", confirmLabel: "Leeren" });
  expect(confirm.mock.calls[0][0].description).toContain("40 Personen haben das Türchen schon geöffnet");
  expect(apiMock.delete).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTestId("advent-admin-delete-6"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/seasonal/advent/admin/2026/6"));
  expect(confirm.mock.calls[1][0].description).toBe("„Mitglied der Woche“ wird entfernt. An diesem Tag grüßt dann nur der Löwe.");
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Türchen 6 ist leer."));
});

test("aus dem Vorjahr übernehmen: fragt nach und sagt, was neu zu bestätigen ist", async () => {
  show();
  await screen.findByTestId("advent-admin-days");
  fireEvent.click(screen.getByTestId("advent-admin-copy"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/seasonal/advent/admin/2026/copy", { source_year: 2025 }));
  expect(confirm.mock.calls[0][0].title).toBe("Türchen aus 2025 übernehmen?");
  expect(confirm.mock.calls[0][0].description).toContain("Übernommen wird nur in leere Tage");
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("2 Türchen übernommen, 1 schon belegt – bitte neu bestätigen: 3."));
});

test("Verlosung: offen mit Ziehen, gezogen mit Protokoll und Nachziehen", async () => {
  show();
  await screen.findByTestId("advent-admin-days");
  const open = screen.getByTestId("advent-raffle-12");
  expect(open).toHaveAttribute("data-status", "open");
  expect(screen.getByTestId("advent-raffle-status-12")).toHaveTextContent("Teilnahme läuft");
  expect(screen.getByTestId("advent-raffle-entries-12")).toHaveTextContent("37 Teilnahmen");
  expect(open).toHaveTextContent("Teilnahme bis 13. Dezember, 20 Uhr");
  expect(screen.queryByTestId("advent-raffle-protocol-12")).toBeNull();

  fireEvent.click(screen.getByTestId("advent-raffle-draw-12"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/seasonal/advent/admin/2026/12/draw", { close_early: true }));
  expect(confirm.mock.calls[0][0]).toMatchObject({ title: "Verlosung zu Türchen 12 ziehen?", confirmLabel: "Jetzt ziehen" });
  expect(confirm.mock.calls[0][0].description).toBe("Unter 37 Teilnahmen werden 2 Gewinne gezogen. Wer gewinnt, bekommt sofort eine Nachricht. Die Teilnahme läuft noch bis 13. Dezember, 20 Uhr – mit der Ziehung endet sie jetzt. Die Ziehung lässt sich nicht wiederholen.");
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Türchen 12: gezogen. Die Gewinner sind benachrichtigt."));

  const drawn = screen.getByTestId("advent-raffle-8");
  expect(screen.getByTestId("advent-raffle-status-8")).toHaveTextContent("Gezogen");
  expect(within(drawn).queryByTestId("advent-raffle-draw-8")).toBeNull();
  const record = screen.getByTestId("advent-raffle-record-z1");
  expect(record).toHaveTextContent("Gezogen am 9.12.2026, 20:05 Uhr von Vorstand");
  expect(record).toHaveTextContent("41 Lose, 39 konnten gewinnen · Zufallsziehung, jede Person ein Los");
  expect(record).toHaveTextContent("Anna BeispielGewinn übergeben");
  expect(record).toHaveTextContent("Bernd MusterGewinn verfallen");
  expect(screen.queryByTestId("advent-raffle-redraw-k1")).toBeNull();
  expect(screen.getByTestId("advent-raffle-prizes-8")).toHaveAttribute("href", "/admin/prizes?source=season");

  fireEvent.click(screen.getByTestId("advent-raffle-redraw-k2"));
  await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith("/seasonal/advent/admin/2026/8/redraw", { pickup_id: "k2" }));
  expect(confirm.mock.calls[1][0].description).toContain("Der Gewinn von Bernd Muster ist verfallen.");
});

test("Ziehung abgelehnt oder gescheitert: nichts passiert ohne Ja, der Satz des Servers kommt an", async () => {
  show();
  await screen.findByTestId("advent-admin-days");
  confirm.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByTestId("advent-raffle-draw-12"));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(apiMock.post).not.toHaveBeenCalled();

  apiMock.post.mockRejectedValueOnce({ response: { data: { detail: "Niemand kann gewinnen: es hat niemand mitgemacht, der teilnehmen darf." } } });
  fireEvent.click(screen.getByTestId("advent-raffle-draw-12"));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Niemand kann gewinnen: es hat niemand mitgemacht, der teilnehmen darf."));
});
