import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Das Innere des Kalender-Fensters (#641, seit #963 kein Seiteninhalt mehr): zu, offen, Gast oder angemeldet; ein Klick
// öffnet, der Flügel schwingt auf, danach erscheint der Inhalt; verschlossene Türchen sagen, wann sie aufgehen. In der
// Vorschau steht der Hinweis, dass nichts zählt.

const hook = { value: null };
const reduced = { value: false };
vi.mock("@/lib/api", () => ({ api: {}, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/hooks/useLiveChanges", () => ({ useReducedMotion: () => reduced.value }));
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ hasConsent: () => false, openSettings: () => {} }) }));
vi.mock("@/advent/useAdventCalendar", async () => {
  const actual = await vi.importActual("@/advent/useAdventCalendar");
  return { ...actual, useAdventCalendar: () => hook.value };
});

const { AdventCalendarPanel, Closed, SHOW_AFTER_MS } = await import("./AdventCalendarPanel");
const { doorVariant } = await import("@/advent/doors");

function calendar({ today = 12, opened = [1, 2], extra = {} } = {}) {
  const doors = [];
  for (let day = 1; day <= 24; day += 1) {
    const state = day > today ? "locked" : opened.includes(day) ? "opened" : "available";
    doors.push({ day, opens_at: `2026-12-${String(day).padStart(2, "0")}T06:00:00+01:00`, seed: 31 * day + 5, state, ...(state === "opened" ? { content: { kind: "text", title: `Inhalt ${day}`, body: `Text ${day}`, media_url: null, link: null } } : {}) });
  }
  return { active: true, year: 2026, order: [], doors, catch_up: today > 24, newest_door: Math.min(24, today), opened: opened.length, total: 24, ...extra };
}

function use(overrides = {}) {
  hook.value = { calendar: calendar(), loading: false, error: "", signedIn: true, previewing: false, reload: vi.fn(), open: vi.fn(), answer: vi.fn(), raffle: vi.fn(), ...overrides };
  return hook.value;
}

function show() {
  return render(<MemoryRouter><AdventCalendarPanel /></MemoryRouter>);
}

beforeEach(() => {
  reduced.value = false;
});

afterEach(() => {
  vi.useRealTimers();
});

test("lädt, scheitert, versucht es noch einmal", () => {
  use({ calendar: null, loading: true });
  const first = show();
  expect(screen.getByRole("status")).toHaveTextContent("Lade Adventkalender");
  expect(screen.queryByTestId("advent-board")).toBeNull();
  first.unmount();
  const state = use({ calendar: null, error: "Der Adventkalender lässt sich gerade nicht laden." });
  show();
  expect(screen.getByTestId("advent-error")).toHaveTextContent("Der Adventkalender lässt sich gerade nicht laden.");
  fireEvent.click(screen.getByRole("button", { name: "Noch einmal versuchen" }));
  expect(state.reload).toHaveBeenCalledTimes(1);
});

test("Vorschau (#963): der Hinweis nennt den simulierten Tag, Platzhalter und dass nichts zählt - kein Gast-Hinweis", () => {
  use({ signedIn: false, previewing: true, calendar: calendar({ extra: { now: "2026-12-12T12:00:00+01:00", placeholder: true } }) });
  show();
  expect(screen.getByTestId("advent-page")).toHaveAttribute("data-preview", "1");
  const note = screen.getByTestId("advent-preview-note");
  expect(note).toHaveTextContent("so sieht der Kalender am 12. Dezember aus");
  expect(note).toHaveTextContent("Öffnen zählt nicht");
  expect(note).toHaveTextContent("Platzhalter");
  expect(screen.queryByTestId("advent-guest")).toBeNull();
  expect(screen.getByTestId("advent-board")).toBeInTheDocument();
});

test("der Kalender ist zu: vor dem Advent, kurz davor, am Tag selbst, in der Pause, danach", () => {
  const now = new Date("2026-09-30T10:00:00+02:00");
  const text = (value, at = now) => {
    const view = render(<Closed calendar={value} now={at} />);
    const found = [view.getByRole("heading").textContent, view.getByTestId("advent-closed-text").textContent, view.getByTestId("advent-closed").dataset.reason];
    view.unmount();
    return found;
  };
  expect(text({ active: false, next_start: "2026-12-01T00:00:00+01:00" })).toEqual(["Der Adventkalender ist zu", "Noch 62 Tage: Das erste Türchen geht am 1. Dezember, 6 Uhr auf.", "closed"]);
  expect(text({ active: false, next_start: "2026-12-01T00:00:00+01:00" }, new Date("2026-11-20T10:00:00+01:00"))).toEqual(["Bald ist es so weit", "Noch 11 Tage: Das erste Türchen geht am 1. Dezember, 6 Uhr auf.", "closed"]);
  expect(text({ active: false, next_start: "2026-12-01T00:00:00+01:00" }, new Date("2026-11-30T10:00:00+01:00"))[1]).toBe("Morgen geht das erste Türchen auf – am 1. Dezember, 6 Uhr.");
  expect(text({ active: false, next_start: "2026-12-01T00:00:00+01:00" }, new Date("2026-12-01T00:30:00+01:00"))[1]).toBe("Heute um 6 Uhr geht das erste Türchen auf.");
  expect(text({ active: false, next_start: "2027-12-01T00:00:00+01:00", reason: "empty" })).toEqual(["Der Adventkalender macht Pause", "Heuer sind keine Türchen vorbereitet. Schau im nächsten Advent wieder vorbei.", "empty"]);
  expect(text({ active: false })).toEqual(["Der Adventkalender ist zu", "Bis zum nächsten Advent!", "closed"]);

  use({ calendar: { active: false, next_start: "2026-12-01T00:00:00+01:00" } });
  show();
  expect(screen.getByTestId("advent-title")).toHaveTextContent(/^Adventkalender$/);
  expect(screen.getByTestId("advent-closed")).toBeInTheDocument();
  expect(screen.queryByTestId("advent-progress")).toBeNull();
  expect(screen.queryByTestId("advent-board")).toBeNull();
});

test("angemeldet: Jahr, gesammelt, Brett", () => {
  use();
  show();
  expect(screen.getByTestId("advent-title")).toHaveTextContent("Adventkalender 2026");
  expect(screen.getByTestId("advent-progress")).toHaveTextContent("Gesammelt2 von 24");
  expect(screen.getByRole("progressbar", { name: "Geöffnete Türchen" })).toHaveAttribute("aria-valuenow", "2");
  expect(screen.getByTestId("advent-board")).toBeInTheDocument();
  expect(screen.queryByTestId("advent-guest")).toBeNull();
  expect(screen.getByTestId("advent-page")).toHaveTextContent("Jeden Tag um 6 Uhr geht ein neues Türchen auf.");
});

test("Gast: geöffnet statt gesammelt, mit dem Weg zur Anmeldung", () => {
  use({ signedIn: false });
  show();
  expect(screen.getByTestId("advent-progress")).toHaveTextContent("Geöffnet2 von 24");
  expect(screen.getByTestId("advent-guest")).toHaveTextContent("Du schaust als Gast.");
  expect(screen.getByRole("link", { name: "Anmelden" })).toHaveAttribute("href", "/login");
});

test("alle 24 offen: Glückwunsch, beim Nachholen ein anderer Satz", () => {
  use({ calendar: calendar({ today: 30, opened: Array.from({ length: 24 }, (_, index) => index + 1) }), signedIn: false });
  show();
  expect(screen.getByTestId("advent-complete")).toHaveTextContent("Alle Türchen geöffnet – frohe Weihnachten!");
  expect(screen.queryByTestId("advent-guest")).toBeNull();
  expect(screen.getByTestId("advent-page")).toHaveTextContent("Alle 24 Türchen sind offen. Nachholen kannst du noch bis 6. Jänner.");
});

test("öffnen: erst schwingt der Flügel, dann erscheint der Inhalt", async () => {
  vi.useFakeTimers();
  const state = use();
  state.open.mockImplementation(async (day) => {
    hook.value = { ...hook.value, calendar: calendar({ opened: [1, 2, day] }) };
    return { day };
  });
  const view = show();
  await act(async () => { fireEvent.click(screen.getByTestId("advent-door-button-12")); });
  expect(state.open).toHaveBeenCalledWith(12);
  view.rerender(<MemoryRouter><AdventCalendarPanel /></MemoryRouter>);
  expect(screen.getByTestId("advent-door-12")).toHaveAttribute("data-state", "opened");
  const wait = doorVariant(31 * 12 + 5).swing + SHOW_AFTER_MS;
  await act(async () => { vi.advanceTimersByTime(wait - 1); });
  expect(screen.queryByTestId("advent-dialog")).toBeNull();
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(screen.getByRole("dialog", { name: "Inhalt 12" })).toHaveTextContent("Text 12");
});

test("„Bewegung reduzieren“: der Inhalt erscheint sofort", async () => {
  vi.useFakeTimers();
  reduced.value = true;
  const state = use();
  state.open.mockImplementation(async (day) => {
    hook.value = { ...hook.value, calendar: calendar({ opened: [1, 2, day] }) };
    return { day };
  });
  const view = show();
  await act(async () => { fireEvent.click(screen.getByTestId("advent-door-button-11")); });
  view.rerender(<MemoryRouter><AdventCalendarPanel /></MemoryRouter>);
  await act(async () => { vi.advanceTimersByTime(0); });
  expect(screen.getByRole("dialog", { name: "Inhalt 11" })).toBeInTheDocument();
});

test("geöffnetes Türchen: der Inhalt kommt gleich, schließen geht auch", async () => {
  use();
  show();
  fireEvent.click(screen.getByTestId("advent-door-button-2"));
  expect(screen.getByRole("dialog", { name: "Inhalt 2" })).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("advent-dialog-close"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("verschlossen: die Seite sagt, wann es so weit ist - geöffnet wird nichts", () => {
  const state = use();
  show();
  expect(screen.getByTestId("advent-note")).toHaveTextContent("");
  fireEvent.click(screen.getByTestId("advent-door-button-20"));
  expect(screen.getByTestId("advent-note")).toHaveTextContent("Türchen 20 öffnet sich am 20. Dezember, 6 Uhr.");
  expect(screen.getByTestId("advent-note")).toHaveAttribute("aria-live", "polite");
  expect(state.open).not.toHaveBeenCalled();
});

test("öffnen scheitert: der Satz des Servers steht da, bei „zu“ oder „noch nicht“ wird neu geladen", async () => {
  const state = use();
  state.open.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Dieses Türchen öffnet sich am 12. Dezember um 6 Uhr." } } });
  show();
  await act(async () => { fireEvent.click(screen.getByTestId("advent-door-button-12")); });
  expect(screen.getByTestId("advent-note")).toHaveTextContent("Dieses Türchen öffnet sich am 12. Dezember um 6 Uhr.");
  expect(state.reload).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByTestId("advent-door-12")).toHaveAttribute("data-busy", "0");

  state.open.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { fireEvent.click(screen.getByTestId("advent-door-button-11")); });
  expect(screen.getByTestId("advent-note")).toHaveTextContent("Türchen 11 lässt sich gerade nicht öffnen. Versuch es noch einmal.");
  expect(state.reload).toHaveBeenCalledTimes(1);
});
