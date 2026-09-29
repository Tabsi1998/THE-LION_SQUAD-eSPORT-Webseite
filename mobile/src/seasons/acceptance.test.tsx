import { act, fireEvent, render, screen } from "@testing-library/react-native";

// Abnahme (A5, #719; Seasonal Core C6, #726): die gemeinsamen Prüfungen jeder Saison kommen aus seasonQa.tsx (still
// bleibt still, „dezent“ und Reduced Motion ohne Bewegung, Bühne ohne Berührung, Saison aus = keine Bühne); hier
// stehen nur noch die Halloween-Zahlen je Screen-Klasse, die Netze an Karten ohne Fledermaus, Nebel und Katze je
// Klasse, der Planer im Hintergrund und die Netz-Spinne, die sich beim Antippen zurückzieht.

jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: "light", Medium: "medium" } }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }) }));
const mockRoute = { name: "Dashboard" };
jest.mock("@react-navigation/native", () => ({
  NavigationRouteContext: require("react").createContext(mockRoute),
  createNavigationContainerRef: () => ({ isReady: () => false, getCurrentRoute: () => undefined, addListener: () => () => {} }),
}));
const mockSeasonState: Record<string, unknown> = { reducedMotion: false, showToast: jest.fn(), toast: null };
jest.mock("./SeasonProvider", () => ({ useSeason: () => mockSeasonState }));

const { HalloweenCorners, screenLayout, setYearSalt } = require("./halloween");
const { capabilities } = require("./intensity");
const { Card } = require("../components/Card");
const { SeasonStage } = require("./SeasonStage");
const { SCREEN_OF_CLASS, countTestIds, defineSeasonAcceptance, renderSeasonScreen } = require("./seasonQa");
const perches = require("./perches");
const flights = require("./flights");
const quiet = require("./quiet");
const motion = require("./motion");

// Festes Jahres-Salz (C4): die Anordnung je Screen hängt sonst vom Kalenderjahr ab.
setYearSalt("abnahme");

// Bewegte Teile: bei „dezent“ und Reduced Motion nicht da. Die Katze zählt nicht - sie darf sitzen, nur nicht laufen.
const MOVING = ["halloween-bat-perched", "halloween-bat-hanging", "halloween-grave", /halloween-spider-/, "halloween-rappel", "halloween-crawler", "halloween-bat-flying"];
const PASSIVE = ["halloween-fog", "halloween-corner-web"];

const halloween = {
  key: "halloween",
  label: "Halloween",
  Corners: HalloweenCorners,
  Card,
  setScreen: (name: string) => {
    mockRoute.name = name;
  },
  setReducedMotion: (on: boolean) => {
    mockSeasonState.reducedMotion = on;
  },
  reset: () => {
    perches.resetPerches();
    flights.resetFlights();
    quiet.resetQuiet();
    motion.resetMotionScheduler(motion.createMotionScheduler({ unlimited: true, appState: null }));
  },
  moving: MOVING,
  stage: "halloween-corners",
  passive: PASSIVE,
  Stage: SeasonStage,
  data: { night: false },
};

const counts = () => ({
  perchBats: screen.queryAllByTestId("halloween-bat-perched").length,
  headerBats: screen.queryAllByTestId("halloween-bat-hanging").length,
  webs: screen.queryAllByTestId("halloween-corner-web").length,
  graves: screen.queryAllByTestId("halloween-grave").length,
  spider: screen.queryAllByTestId(/halloween-spider-/).length,
  rappel: screen.queryAllByTestId("halloween-rappel").length,
  fog: screen.queryByTestId("halloween-fog")?.props["data-level"] || null,
  cat: screen.queryAllByTestId("halloween-cat").length,
  bigWeb: screen.queryAllByTestId(/halloween-web-b/).length,
});

beforeEach(() => {
  jest.useFakeTimers();
  halloween.reset();
});

afterEach(() => {
  jest.useRealTimers();
  mockSeasonState.reducedMotion = false;
});

afterAll(() => motion.resetMotionScheduler(null));

// Die gemeinsamen Prüfungen jeder Saison.
defineSeasonAcceptance(halloween);

test("lebendig (Dashboard): Plätze nach Klasse, Netze nur an Karten ohne Fledermaus, Gräber, naher Nebel, Katze, großes Netz", async () => {
  await renderSeasonScreen(halloween, SCREEN_OF_CLASS.lively);
  const caps = capabilities("Dashboard", "normal");
  const layout = screenLayout("Dashboard", "normal");
  const seen = counts();
  expect(seen.perchBats + seen.headerBats).toBe(caps.hangingBats);
  expect(seen.headerBats).toBe(layout.hangingBats.length);
  expect(seen.webs).toBe(caps.cornerWebs);
  const batCards = Object.keys(perches.perchSnapshot().assignments);
  const webCards = Object.keys(perches.perchSnapshot().webs);
  expect(webCards.some((id: string) => batCards.includes(id))).toBe(false);
  expect(seen.graves).toBe(layout.graves.length);
  expect(seen.fog).toBe("near");
  expect(seen.cat).toBe(1);
  expect(seen.bigWeb).toBe(1);
});

test("ruhig (TournamentDetail): höchstens eine Fledermaus, kein Ecknetz, keine Spinnen, keine Gräber, keine Katze, ferner Nebel", async () => {
  await renderSeasonScreen(halloween, SCREEN_OF_CLASS.calm);
  const seen = counts();
  expect(seen.perchBats + seen.headerBats).toBeLessThanOrEqual(1);
  expect(seen.webs).toBe(0);
  expect(seen.spider).toBe(0);
  expect(seen.rappel).toBe(0);
  expect(seen.graves).toBe(0);
  expect(seen.cat).toBe(0);
  expect(seen.fog).toBe("far");
});

test("dezent: ein Netz und ferner Nebel bleiben, das große Netz steht fertig; Reduced Motion: Katze sitzt still", async () => {
  await renderSeasonScreen(halloween, SCREEN_OF_CLASS.lively, "subtle");
  expect(counts().webs).toBe(1);
  expect(counts().fog).toBe("far");
  expect(screen.getByTestId("halloween-web-built")).toBeTruthy();
  expect(countTestIds(MOVING)).toBe(0);
  expect(counts().cat).toBe(0);
  await screen.unmount();
  halloween.reset();
  mockSeasonState.reducedMotion = true;
  await renderSeasonScreen(halloween, SCREEN_OF_CLASS.lively);
  expect(screen.getByTestId("halloween-web-built")).toBeTruthy();
  expect(screen.getByTestId("halloween-cat").props["data-walking"]).toBe("0");
});

test("App im Hintergrund: der Planer gibt nichts frei; Antippen der Netz-Spinne zieht sie zurück, ein zweites Antippen tut nichts", async () => {
  const scheduler = motion.createMotionScheduler({ appState: null, initialDelayMs: 0 });
  motion.resetMotionScheduler(scheduler);
  scheduler.setHidden(true);
  expect(scheduler.request("flock")).toBeNull();
  expect(scheduler.lastReason()).toBe("hidden");
  scheduler.setHidden(false);
  motion.resetMotionScheduler(motion.createMotionScheduler({ unlimited: true, appState: null }));
  // Ein lebendiger Screen, dessen Netz fertig dasteht (kein Bau) - dort sitzt die Spinne sofort in der Nabe.
  const ready = ["Dashboard", "NewsList", "Gallery", "GalleryAlbum", "SeasonPass"].find((name) => !screenLayout(name, "normal").web.build) as string;
  expect(ready).toBeTruthy();
  await renderSeasonScreen(halloween, ready);
  const hub = screen.getByTestId("halloween-web-spider");
  expect(hub.props["data-hidden"]).toBe("0");
  await fireEvent.press(screen.getByTestId("halloween-web-spider-press"));
  expect(screen.getByTestId("halloween-web-spider").props["data-hidden"]).toBe("1");
  await fireEvent.press(screen.getByTestId("halloween-web-spider-press"));
  expect(screen.getByTestId("halloween-web-spider").props["data-hidden"]).toBe("1");
});

test("Saison aus: keine Bühne (auch direkt)", async () => {
  await render(<SeasonStage />);
  expect(screen.queryByTestId("season-stage")).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(10);
  });
});
