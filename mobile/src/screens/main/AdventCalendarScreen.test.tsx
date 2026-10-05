import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { doorVariant, type Calendar, type Door } from "../../advent/doors";
import { AdventCalendarScreen, SHOW_AFTER_MS, closedState } from "./AdventCalendarScreen";

// Der Adventkalender in der App (#641, #642): zu, offen, Gast oder angemeldet; ein Tippen öffnet, der Flügel schwingt
// auf, danach erscheint der Inhalt; verschlossene Türchen sagen, wann sie aufgehen; ein neuer Erfolg wartet, bis das
// Fenster zu ist.

type Hook = { calendar: Calendar | null; loading: boolean; error: string; signedIn: boolean; reload: jest.Mock; open: jest.Mock; answer: jest.Mock; raffle: jest.Mock };
const mockHook: { value: Hook | null; onAwarded?: (count: number) => void; changed?: () => void } = { value: null };
const mockReduced = { value: false };
const mockAnnounce = jest.fn();
const mockOpenLink = jest.fn((_url?: string | null) => "browser");

// Wie der echte Datenabruf meldet der nachgebaute jede Änderung über einen Zustand - sonst zeichnet React nicht neu.
jest.mock("../../advent/useAdventCalendar", () => ({
  useAdventCalendar: (onAwarded?: (count: number) => void) => {
    const [, setTick] = jest.requireActual("react").useState(0);
    mockHook.onAwarded = onAwarded;
    mockHook.changed = () => setTick((tick: number) => tick + 1);
    return mockHook.value;
  },
}));
// Der Bildschirm selbst fragt keine Anmeldung mehr ab; der Rest des Baums (Jahreszeiten) bekommt einen leeren Stand.
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
const mockOpenSignIn = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({ openSignIn: (...args: unknown[]) => mockOpenSignIn(...args) }));
jest.mock("../../components/FadeIn", () => ({ useReduceMotion: () => mockReduced.value }));
jest.mock("../../lib/achievements", () => ({ announceAchievementUnlocked: () => mockAnnounce() }));
jest.mock("../../lib/api", () => ({
  resolveMediaUrl: (value?: string | null) => (value ? `https://lionsquad.at${value}` : ""),
  errorMessage: (error: unknown, fallback: string) => (error as { detail?: string })?.detail || fallback,
}));
jest.mock("../../advent/links", () => ({ openDoorLink: (url?: string | null) => mockOpenLink(url) }));
jest.mock("../../advent/scene", () => ({ sceneSvg: (year: number) => `<svg viewBox="0 0 10 10"><rect width="10" height="10"/><text>${year}</text></svg>` }));
jest.mock("../../seasons/anchors", () => ({ useSeasonOverlay: () => {} }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const props = { navigation: { navigate: jest.fn() }, route: { key: "advent", name: "AdventCalendar" } } as never;

function calendar({ today = 12, opened = [1, 2], extra = {} }: { today?: number; opened?: number[]; extra?: Partial<Calendar> } = {}): Calendar {
  const doors: Door[] = [];
  for (let day = 1; day <= 24; day += 1) {
    const state = day > today ? "locked" : opened.includes(day) ? "opened" : "available";
    doors.push({ day, opens_at: `2026-12-${String(day).padStart(2, "0")}T06:00:00+01:00`, seed: 31 * day + 5, state, ...(state === "opened" ? { content: { kind: "text", title: `Inhalt ${day}`, body: `Text ${day}`, media_url: null, link: day === 2 ? { url: "/news/advent", label: "Zur News" } : null } } : {}) });
  }
  return { active: true, year: 2026, order: [], doors, catch_up: today > 24, newest_door: Math.min(24, today), opened: opened.length, total: 24, ...extra };
}

function use(overrides: Partial<Hook> = {}): Hook {
  mockHook.value = { calendar: calendar(), loading: false, error: "", signedIn: true, reload: jest.fn(async () => null), open: jest.fn(), answer: jest.fn(), raffle: jest.fn(), ...overrides };
  return mockHook.value;
}

async function show() {
  const view = await render(<AdventCalendarScreen {...(props as object as React.ComponentProps<typeof AdventCalendarScreen>)} />);
  if (screen.queryByTestId("advent-board")) {
    await fireEvent(screen.getByTestId("advent-board"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 0 } } });
  }
  return view;
}

/** Das Öffnen am Server: danach kennt der Kalender das Türchen als geöffnet. */
function opening(day: number, awarded = 0) {
  return jest.fn(async () => {
    const current = mockHook.value as Hook;
    const before = current.calendar as Calendar;
    const opened = (before.doors || []).filter((door) => door.state === "opened").map((door) => door.day);
    if (awarded > 0) mockHook.onAwarded?.(awarded);
    mockHook.value = { ...current, calendar: { ...calendar({ opened: [...opened, day] }), opened: opened.length + 1 } };
    mockHook.changed?.();
    return { day, year: 2026, counted: true, first: true, opened: opened.length + 1, newly_awarded: awarded, content: { kind: "text", title: `Inhalt ${day}` } };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReduced.value = false;
  mockOpenLink.mockReturnValue("browser");
});

afterEach(() => {
  jest.useRealTimers();
});

test("lädt, scheitert, versucht es noch einmal", async () => {
  use({ calendar: null, loading: true });
  const first = await show();
  expect(screen.getByTestId("advent-loading")).toBeTruthy();
  expect(screen.getByText("Lade Adventkalender")).toBeTruthy();
  expect(screen.queryByTestId("advent-board")).toBeNull();
  expect(screen.queryByTestId("advent-progress")).toBeNull();
  await first.unmount();

  const state = use({ calendar: null, error: "Der Adventkalender lässt sich gerade nicht laden." });
  await show();
  expect(screen.getByText("Der Adventkalender lässt sich gerade nicht laden.")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("advent-retry"));
  expect(state.reload).toHaveBeenCalledTimes(1);
});

test("der Kalender ist zu: vor dem Advent, kurz davor, am Tag selbst, in der Pause, danach", async () => {
  const now = new Date("2026-09-30T10:00:00+02:00");
  const start = "2026-12-01T00:00:00+01:00";
  expect(closedState({ next_start: start }, now)).toEqual({ title: "Der Adventkalender ist zu", text: "Noch 62 Tage: Das erste Türchen geht am 1. Dezember, 6 Uhr auf.", paused: false, year: 2026 });
  expect(closedState({ next_start: start }, new Date("2026-11-20T10:00:00+01:00"))).toMatchObject({ title: "Bald ist es so weit", text: "Noch 11 Tage: Das erste Türchen geht am 1. Dezember, 6 Uhr auf." });
  expect(closedState({ next_start: start }, new Date("2026-11-30T10:00:00+01:00")).text).toBe("Morgen geht das erste Türchen auf – am 1. Dezember, 6 Uhr.");
  expect(closedState({ next_start: start }, new Date("2026-12-01T00:30:00+01:00")).text).toBe("Heute um 6 Uhr geht das erste Türchen auf.");
  expect(closedState({ next_start: "2027-12-01T00:00:00+01:00", reason: "empty" }, now)).toEqual({ title: "Der Adventkalender macht Pause", text: "Heuer sind keine Türchen vorbereitet. Schau im nächsten Advent wieder vorbei.", paused: true, year: 2027 });
  expect(closedState({}, now)).toEqual({ title: "Der Adventkalender ist zu", text: "Bis zum nächsten Advent!", paused: false, year: 2026 });
  expect(closedState(null, new Date("2026-12-31T23:30:00Z")).year).toBe(2027);

  use({ calendar: { active: false, next_start: "2027-12-01T00:00:00+01:00", reason: "empty" } });
  await show();
  expect(screen.getByTestId("advent-title").props.children).toEqual(["Adventkalender", ""]);
  expect(screen.getByTestId("advent-closed")).toBeTruthy();
  expect(screen.getByText("Der Adventkalender macht Pause")).toBeTruthy();
  expect(screen.getByTestId("advent-closed-text").props.children).toBe("Heuer sind keine Türchen vorbereitet. Schau im nächsten Advent wieder vorbei.");
  expect(screen.queryByTestId("advent-board")).toBeNull();
  expect(screen.queryByTestId("advent-progress")).toBeNull();
});

test("angemeldet: Jahr, gesammelt, Brett", async () => {
  use();
  await show();
  expect(screen.getByTestId("advent-title").props.children).toEqual(["Adventkalender", " 2026"]);
  expect(screen.getByText("GESAMMELT")).toBeTruthy();
  expect(screen.getByTestId("advent-count").props.children).toEqual([2, " von ", 24]);
  expect(screen.getByLabelText("Geöffnete Türchen").props.accessibilityValue).toEqual({ min: 0, max: 24, now: 2 });
  expect(screen.getByText(/Jeden Tag um 6 Uhr geht ein neues Türchen auf\./)).toBeTruthy();
  expect(screen.getAllByTestId(/^advent-door-\d+$/)).toHaveLength(24);
  expect(screen.queryByTestId("advent-guest")).toBeNull();
  expect(screen.queryByTestId("advent-complete")).toBeNull();
  expect(screen.queryByTestId("advent-sheet")).toBeNull();
});

test("Gast: geöffnet statt gesammelt, mit dem Weg zur Anmeldung", async () => {
  use({ signedIn: false });
  await show();
  expect(screen.getByText("GEÖFFNET")).toBeTruthy();
  expect(screen.getByText(/Du schaust als Gast\. Gesammelt wird mit Konto/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId("advent-login"));
  expect(mockOpenSignIn).toHaveBeenCalledTimes(1);
});

test("alle 24 offen: Glückwunsch, beim Nachholen ein anderer Satz", async () => {
  const all = Array.from({ length: 24 }, (_, index) => index + 1);
  use({ signedIn: false, calendar: calendar({ today: 30, opened: all }) });
  await show();
  expect(screen.getByTestId("advent-complete").props.children).toBe("Alle Türchen geöffnet – frohe Weihnachten!");
  expect(screen.queryByTestId("advent-guest")).toBeNull();
  expect(screen.getByText("Alle 24 Türchen sind offen. Nachholen kannst du noch bis 6. Jänner.")).toBeTruthy();
});

test("öffnen: erst schwingt der Flügel, dann erscheint der Inhalt", async () => {
  jest.useFakeTimers();
  const state = use({ open: opening(12) });
  await show();
  await fireEvent.press(screen.getByTestId("advent-door-button-12"));
  // Die Antwort des Servers ankommen lassen - die Uhr bleibt dabei stehen.
  await act(async () => {});
  expect(state.open).toHaveBeenCalledWith(12);
  expect(screen.getByLabelText("Türchen 12 – geöffnet: Inhalt 12")).toBeTruthy();
  expect(screen.getByTestId("advent-count").props.children).toEqual([3, " von ", 24]);
  const wait = doorVariant(31 * 12 + 5).swing + SHOW_AFTER_MS;
  await act(async () => {
    jest.advanceTimersByTime(wait - 1);
  });
  expect(screen.queryByTestId("advent-sheet")).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(screen.getByTestId("advent-sheet-title").props.children).toBe("Inhalt 12");
});

test("„Bewegung reduzieren“: der Inhalt erscheint sofort", async () => {
  jest.useFakeTimers();
  mockReduced.value = true;
  use({ open: opening(12) });
  await show();
  await fireEvent.press(screen.getByTestId("advent-door-button-12"));
  await act(async () => {
    jest.advanceTimersByTime(0);
  });
  expect(screen.getByTestId("advent-sheet-title").props.children).toBe("Inhalt 12");
});

test("geöffnetes Türchen: der Inhalt kommt gleich, schließen geht auch", async () => {
  const state = use();
  await show();
  await fireEvent.press(screen.getByTestId("advent-door-button-2"));
  expect(screen.getByTestId("advent-sheet-title").props.children).toBe("Inhalt 2");
  expect(screen.getByTestId("advent-text").props.children).toBe("Text 2");
  expect(state.open).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId("advent-sheet-close"));
  expect(screen.queryByTestId("advent-sheet")).toBeNull();
  expect(mockAnnounce).not.toHaveBeenCalled();
});

test("verschlossen: der Screen sagt, wann es so weit ist - geöffnet wird nichts", async () => {
  const state = use();
  await show();
  expect(screen.getByTestId("advent-note").props.children).toBe("");
  await fireEvent.press(screen.getByTestId("advent-door-button-20"));
  expect(screen.getByTestId("advent-note").props.children).toBe("Türchen 20 öffnet sich am 20. Dezember, 6 Uhr.");
  expect(state.open).not.toHaveBeenCalled();
  expect(screen.queryByTestId("advent-sheet")).toBeNull();
  // Der Hinweis verschwindet, sobald die Person etwas anderes ansieht.
  await fireEvent.press(screen.getByTestId("advent-door-button-1"));
  expect(screen.getByTestId("advent-note").props.children).toBe("");
});

test("öffnen scheitert: der Satz des Servers steht da, bei „zu“ oder „noch nicht“ wird neu geladen", async () => {
  const state = use({ open: jest.fn().mockRejectedValueOnce({ detail: "Dieses Türchen ist noch zu.", response: { status: 409 } }).mockRejectedValueOnce({ detail: "" }).mockRejectedValueOnce({ detail: "Der Adventkalender ist zu.", response: { status: 404 } }) });
  await show();
  await fireEvent.press(screen.getByTestId("advent-door-button-12"));
  expect(screen.getByTestId("advent-note").props.children).toBe("Dieses Türchen ist noch zu.");
  expect(state.reload).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId("advent-door-button-11"));
  expect(screen.getByTestId("advent-note").props.children).toBe("Türchen 11 lässt sich gerade nicht öffnen. Versuch es noch einmal.");
  expect(state.reload).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId("advent-door-button-10"));
  expect(state.reload).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId("advent-sheet")).toBeNull();
  // Nach dem Fehler lässt sich wieder ein Türchen öffnen.
  expect(screen.getByTestId("advent-door-button-12").props.accessibilityState?.disabled).not.toBe(true);
});

test("ein neuer Erfolg wird gefeiert, sobald das Fenster zu ist", async () => {
  jest.useFakeTimers();
  use({ open: opening(12, 2) });
  await show();
  await fireEvent.press(screen.getByTestId("advent-door-button-12"));
  await act(async () => {
    jest.advanceTimersByTime(doorVariant(31 * 12 + 5).swing + SHOW_AFTER_MS);
  });
  expect(screen.getByTestId("advent-sheet")).toBeTruthy();
  expect(mockAnnounce).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId("advent-sheet-close"));
  expect(mockAnnounce).toHaveBeenCalledTimes(1);
  // Einmal gefeiert ist gefeiert.
  await fireEvent.press(screen.getByTestId("advent-door-button-2"));
  await fireEvent.press(screen.getByTestId("advent-sheet-close"));
  expect(mockAnnounce).toHaveBeenCalledTimes(1);
});

test("nachgeholte Türchen bringen den Erfolg sofort - außer ein Fenster ist offen", async () => {
  use();
  const view = await show();
  await act(async () => {
    mockHook.onAwarded?.(1);
  });
  expect(mockAnnounce).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByTestId("advent-door-button-2"));
  await act(async () => {
    mockHook.onAwarded?.(1);
  });
  expect(mockAnnounce).toHaveBeenCalledTimes(1);
  // Verlässt die Person den Screen, bevor das Fenster zu ist, geht die Feier nicht verloren.
  await view.unmount();
  expect(mockAnnounce).toHaveBeenCalledTimes(2);
});

test("ein Link in einen Screen der App schließt das Fenster, der Browser lässt es offen", async () => {
  use();
  await show();
  await fireEvent.press(screen.getByTestId("advent-door-button-2"));
  await fireEvent.press(screen.getByTestId("advent-link"));
  expect(mockOpenLink).toHaveBeenCalledWith("/news/advent");
  expect(screen.getByTestId("advent-sheet")).toBeTruthy();

  mockOpenLink.mockReturnValue("screen");
  await fireEvent.press(screen.getByTestId("advent-link"));
  expect(screen.queryByTestId("advent-sheet")).toBeNull();
});

test("nach unten ziehen lädt neu und räumt den Hinweis weg", async () => {
  const state = use();
  await show();
  await fireEvent.press(screen.getByTestId("advent-door-button-20"));
  expect(screen.getByTestId("advent-note").props.children).not.toBe("");
  await act(async () => {
    await screen.getByTestId("advent-screen").props.refreshControl.props.onRefresh();
  });
  expect(state.reload).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("advent-note").props.children).toBe("");
});
