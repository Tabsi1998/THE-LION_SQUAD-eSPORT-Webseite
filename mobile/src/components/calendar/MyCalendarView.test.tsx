import React from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { MyCalendarView } from "./MyCalendarView";

// „Mein Kalender“ (#1788): die eigenen Termine aus GET /calendar/me - gruppiert in Heute, Diese Woche, Später, mit
// Plakette je Stand, Filter nach Art (nur vorkommende), freundlichem leeren Zustand und dem Abo-Kasten darunter. Ein Tipp
// öffnet den Termin. Die Zeilen blenden gestaffelt ein, mit „Bewegung reduzieren“ nicht.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn(), delete: jest.fn() } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));
const mockOpenLink = jest.fn();
jest.mock("../../lib/openLink", () => ({ openLink: (...args: unknown[]) => mockOpenLink(...args) }));
jest.mock("../../navigation/rootNavigation", () => ({ openSignIn: jest.fn() }));

const NOW = new Date("2026-10-21T10:00:00Z"); // Mittwoch, 12:00 in Wien
const ITEMS = [
  { id: "t-cup", kind: "tournament", title: "Rocket Cup", start: "2026-10-21T16:00:00Z", end: null, path: "/tournaments/rocket-cup", own: { state: "approved", label: "Du bist dabei", team_name: "Lions Rocket" }, phase: { label: "Anmeldung offen" } },
  { id: "e-lan", kind: "event", title: "Herbst-LAN", start: "2026-10-24T08:00:00Z", end: "2026-10-24T20:00:00Z", path: "/events/herbst-lan", own: { state: "waitlist", label: "Warteliste" } },
  { id: "m-7", kind: "club", club_kind: "meeting", title: "Generalversammlung", start: "2026-11-04T22:00:00+00:00", all_day: true, day: "2026-11-05", path: "/members/meetings?meeting=7", own: { state: "accepted", label: "Zugesagt" } },
  { id: "f-old", kind: "fastlap", title: "Monza", start: "2026-10-01T10:00:00Z", end: "2026-10-02T10:00:00Z", path: "/fastlap/monza", own: { state: "driven", label: "Du bist gefahren" } },
];

let reduce = false;
let timing: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate", "queueMicrotask", "setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
  reduce = false;
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockImplementation(async () => reduce);
  timing = jest.spyOn(Animated, "timing");
  mockGet.mockImplementation(async (path: string) => {
    if (path === "/calendar/me") return { data: { items: ITEMS, subscription: { active: false }, hint_due: true } };
    if (path === "/calendar/personal") return { data: { active: false } };
    return { data: null };
  });
});

afterEach(() => {
  jest.useRealTimers();
});

async function show(props: Partial<React.ComponentProps<typeof MyCalendarView>> = {}) {
  const onBrowse = jest.fn();
  await render(<MyCalendarView view="list" signedIn onBrowse={onBrowse} {...props} />);
  await act(async () => {
    for (let n = 0; n < 4; n += 1) await Promise.resolve();
  });
  return onBrowse;
}

test("Heute, Diese Woche, Später - Vergangenes fällt weg; Plaketten mit Stand und Team", async () => {
  await show();
  expect(mockGet).toHaveBeenCalledWith("/calendar/me");
  expect(within(screen.getByTestId("my-calendar-bucket-today")).getByText("Rocket Cup")).toBeTruthy();
  expect(within(screen.getByTestId("my-calendar-bucket-week")).getByText("Herbst-LAN")).toBeTruthy();
  expect(within(screen.getByTestId("my-calendar-bucket-later")).getByText("Generalversammlung")).toBeTruthy();
  expect(screen.queryByText("Monza")).toBeNull();

  expect(within(screen.getByTestId("my-calendar-badge-tournament-t-cup")).getByText("DU BIST DABEI · MIT LIONS ROCKET")).toBeTruthy();
  expect(within(screen.getByTestId("my-calendar-badge-event-e-lan")).getByText("WARTELISTE")).toBeTruthy();
  expect(screen.getByText(/^Versammlung · .*5\. Nov.* · ganztägig$/)).toBeTruthy();
  // Darunter der Kasten „Automatisch in deinen Kalender“.
  expect(screen.getByTestId("calendar-personal")).toBeTruthy();
});

test("ein Tipp öffnet den Termin über seinen Weg", async () => {
  await show();
  await fireEvent.press(screen.getByTestId("my-calendar-item-tournament-t-cup"));
  expect(mockOpenLink).toHaveBeenCalledWith("/tournaments/rocket-cup");
  await fireEvent.press(screen.getByTestId("my-calendar-item-club-m-7"));
  expect(mockOpenLink).toHaveBeenLastCalledWith("/members/meetings?meeting=7");
});

test("Filter nach Art: nur vorkommende Arten", async () => {
  await show();
  expect(screen.getByRole("tab", { name: "Verein" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Fast Laps" })).toBeTruthy();
  await fireEvent.press(screen.getByRole("tab", { name: "Verein" }));
  expect(screen.getByText("Generalversammlung")).toBeTruthy();
  expect(screen.queryByText("Rocket Cup")).toBeNull();
  // Nur Vergangenes in der Art: freundlich, mit Hinweis auf den Monat.
  await fireEvent.press(screen.getByRole("tab", { name: "Fast Laps" }));
  expect(screen.getByTestId("my-calendar-nothing")).toBeTruthy();
});

test("die Zeilen blenden gestaffelt ein - mit „Bewegung reduzieren“ nicht", async () => {
  await show();
  const delays = timing.mock.calls.map(([, config]) => config).filter((config) => config.duration === 240 && config.toValue === 1).map((config) => config.delay);
  expect(delays).toEqual([0, 210, 420]);

  timing.mockClear();
  reduce = true;
  await screen.unmount();
  await show();
  expect(timing.mock.calls.filter(([, config]) => config.duration === 240)).toHaveLength(0);
});

test("ohne Termine: freundlich, mit Weg zu Turnieren und Events", async () => {
  mockGet.mockImplementation(async (path: string) => ({ data: path === "/calendar/me" ? { items: [], subscription: { active: false } } : { active: false } }));
  const onBrowse = await show();
  expect(screen.getByText("Noch keine Termine")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("my-calendar-browse-tournaments"));
  expect(onBrowse).toHaveBeenCalledWith("tournaments");
  await fireEvent.press(screen.getByTestId("my-calendar-browse-events"));
  expect(onBrowse).toHaveBeenLastCalledWith("events");
});

test("Monat: eigene Termine im Raster, ein Tag zeigt seine Termine", async () => {
  await show({ view: "calendar" });
  expect(screen.getByTestId("month-calendar")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("calendar-today"));
  expect(within(screen.getByTestId("my-calendar-day")).getByText("Rocket Cup")).toBeTruthy();
});

test("ohne Konto (401) oder als Gast: Bitte um das Login statt eines Fehlers", async () => {
  await show({ signedIn: false });
  expect(screen.getByTestId("my-calendar-login")).toBeTruthy();
  expect(mockGet).not.toHaveBeenCalled();

  await screen.unmount();
  mockGet.mockRejectedValue({ response: { status: 401 } });
  await show();
  expect(screen.getByTestId("my-calendar-login")).toBeTruthy();
});

test("Fehler beim Laden: Hinweis und erneut versuchen", async () => {
  mockGet.mockRejectedValueOnce(new Error("Netz"));
  await show();
  expect(screen.getByTestId("my-calendar-failed")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("my-calendar-retry"));
  await act(async () => {
    for (let n = 0; n < 4; n += 1) await Promise.resolve();
  });
  expect(screen.getByText("Rocket Cup")).toBeTruthy();
});
