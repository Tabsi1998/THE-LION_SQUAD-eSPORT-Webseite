import React from "react";
import { Text, View } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

// Abnahme (A5, #719): je Screen-Klasse zeigt die Bühne nur, was die Klasse erlaubt - die Bühne selbst nimmt keine
// Berührung, nur Fledermäuse, Gräber, Spinne und Katze; Reduced Motion und „dezent“ ohne Bewegung; App im
// Hintergrund: keine großen Bewegungen; Saison aus: keine Deko; kleine Netze nur an Karten ohne Fledermaus;
// Nebel je Klasse; Katze nur auf lebendigen Screens; die Netz-Spinne zieht sich beim Antippen zurück.

jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: "light", Medium: "medium" } }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }) }));
const mockRoute = { name: "Dashboard" };
jest.mock("@react-navigation/native", () => ({
  NavigationRouteContext: require("react").createContext(mockRoute),
  createNavigationContainerRef: () => ({ isReady: () => false, getCurrentRoute: () => undefined, addListener: () => () => {} }),
}));
const mockSeasonState: Record<string, unknown> = { reducedMotion: false, showToast: jest.fn(), toast: null };
jest.mock("./SeasonProvider", () => ({ useSeason: () => mockSeasonState }));

const { HalloweenCorners, screenLayout } = require("./halloween");
const { capabilities } = require("./intensity");
const { Card } = require("../components/Card");
const perches = require("./perches");
const flights = require("./flights");
const quiet = require("./quiet");
const motion = require("./motion");

function season(effective = "normal") {
  return { key: "halloween", label: "Halloween", phase: "deko", intensity: "normal", effective, channels: ["app"], texts: {}, data: { night: false } };
}

function Page({ screenName, effective, cards = 4 }: { screenName: string; effective?: string; cards?: number }) {
  mockRoute.name = screenName;
  return (
    <View>
      <HalloweenCorners season={season(effective) as never} screen={screenName} />
      {Array.from({ length: cards }, (_, index) => <Card key={index} perch={`${screenName}-${index}`}><Text>Karte {index}</Text></Card>)}
    </View>
  );
}

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
  perches.resetPerches();
  flights.resetFlights();
  quiet.resetQuiet();
  motion.resetMotionScheduler(motion.createMotionScheduler({ unlimited: true, appState: null }));
});

afterEach(() => {
  jest.useRealTimers();
  mockSeasonState.reducedMotion = false;
});

afterAll(() => motion.resetMotionScheduler(null));

test("lebendig (Dashboard): Plätze, Netze an Karten ohne Fledermaus, Gräber, naher Nebel, Katze; die Bühne nimmt keine Berührung", async () => {
  await render(<Page screenName="Dashboard" />);
  await act(async () => {
    jest.advanceTimersByTime(50);
  });
  const caps = capabilities("Dashboard", "normal");
  const layout = screenLayout("Dashboard", "normal");
  const seen = counts();
  expect(seen.perchBats + seen.headerBats).toBe(caps.hangingBats);
  expect(seen.headerBats).toBe(layout.hangingBats.length);
  expect(seen.webs).toBe(caps.cornerWebs);
  const batCards = Object.keys(perches.perchSnapshot().assignments);
  const webCards = Object.keys(perches.perchSnapshot().webs);
  expect(webCards.some((id) => batCards.includes(id))).toBe(false);
  expect(seen.graves).toBe(layout.graves.length);
  expect(seen.fog).toBe("near");
  expect(seen.cat).toBe(1);
  expect(seen.bigWeb).toBe(1);
  const stage = screen.getByTestId("halloween-corners");
  expect(stage.props.pointerEvents).toBe("box-none");
  expect(screen.getByTestId("halloween-fog").props.pointerEvents).toBe("none");
  screen.queryAllByTestId("halloween-corner-web").forEach((web) => expect(web.props.pointerEvents).toBe("none"));
});

test("ruhig (TournamentDetail): höchstens eine Fledermaus, kein Ecknetz, keine Spinnen, keine Gräber, keine Katze, ferner Nebel", async () => {
  await render(<Page screenName="TournamentDetail" />);
  await act(async () => {
    jest.advanceTimersByTime(50);
  });
  const seen = counts();
  expect(seen.perchBats + seen.headerBats).toBeLessThanOrEqual(1);
  expect(seen.webs).toBe(0);
  expect(seen.spider).toBe(0);
  expect(seen.rappel).toBe(0);
  expect(seen.graves).toBe(0);
  expect(seen.cat).toBe(0);
  expect(seen.fog).toBe("far");
});

test("still (Consent): nichts außer der Bühne; dezent: nur Netze und ferner Nebel, nichts bewegt sich; Reduced Motion ebenso", async () => {
  await render(<Page screenName="Consent" />);
  await act(async () => {
    jest.advanceTimersByTime(50);
  });
  let seen = counts();
  expect(seen.perchBats + seen.headerBats + seen.webs + seen.graves + seen.spider + seen.rappel + seen.cat + seen.bigWeb).toBe(0);
  expect(seen.fog).toBeNull();
  await screen.unmount();
  perches.resetPerches();
  await render(<Page screenName="Dashboard" effective="subtle" />);
  await act(async () => {
    jest.advanceTimersByTime(50);
  });
  seen = counts();
  expect(seen.perchBats + seen.headerBats + seen.graves + seen.spider + seen.rappel + seen.cat).toBe(0);
  expect(seen.webs).toBe(1);
  expect(seen.fog).toBe("far");
  expect(screen.getByTestId("halloween-web-built")).toBeTruthy();
  await screen.unmount();
  perches.resetPerches();
  mockSeasonState.reducedMotion = true;
  await render(<Page screenName="Dashboard" />);
  await act(async () => {
    jest.advanceTimersByTime(50);
  });
  seen = counts();
  expect(seen.perchBats + seen.headerBats + seen.graves + seen.spider + seen.rappel).toBe(0);
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
  await render(<Page screenName={ready} />);
  await act(async () => {
    jest.advanceTimersByTime(50);
  });
  const hub = screen.getByTestId("halloween-web-spider");
  expect(hub.props["data-hidden"]).toBe("0");
  await fireEvent.press(screen.getByTestId("halloween-web-spider-press"));
  expect(screen.getByTestId("halloween-web-spider").props["data-hidden"]).toBe("1");
  await fireEvent.press(screen.getByTestId("halloween-web-spider-press"));
  expect(screen.getByTestId("halloween-web-spider").props["data-hidden"]).toBe("1");
});

test("Saison aus: keine Bühne", async () => {
  const { SeasonStage } = require("./SeasonStage");
  await render(<SeasonStage />);
  expect(screen.queryByTestId("season-stage")).toBeNull();
});
