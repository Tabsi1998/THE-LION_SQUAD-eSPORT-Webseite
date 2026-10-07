import React from "react";
import { Alert, Text, View } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

// Jahreszeiten IV in der App (#1087-#1092): ein Tippen auf eine Karte lässt nur die Deko an genau dieser Karte
// reagieren - einmal je Tippen, mit Ruhezeit je Karte, höchstens eine große Reaktion gleichzeitig, nichts mit
// „Bewegung reduzieren“. Die Karte selbst tut beim Antippen weiter, was sie tut.

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));
jest.mock("@react-navigation/native", () => ({
  NavigationRouteContext: require("react").createContext({ name: "Dashboard" }),
  NavigationContext: require("react").createContext(undefined),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
const mockSeasonState: Record<string, unknown> = { reducedMotion: false, showToast: jest.fn(), toast: null, weather: null, seasons: [] };
jest.mock("./SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
const mockAuth: { user: Record<string, unknown> | null } = { user: { id: "u1", username: "anna" } };
jest.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
const mockFind = jest.fn();
jest.mock("./easterHunt/api", () => {
  const actual = jest.requireActual("./easterHunt/api");
  return { ...actual, findEgg: (...args: unknown[]) => mockFind(...args) };
});

const { Card } = require("../components/Card");
const { ContentCard } = require("../components/ContentCard");
const { SnowCap, resetSnowShake } = require("./snow/SnowCap");
const { SHAKE } = require("./snow/shake");
const { resetWebTears } = require("./cornerWeb");
const { TEAR } = require("./webTear");
const { FLUTTER_MS, resetBatFlutter } = require("./anchors");
const { TUMBLE_MS, resetEggTumbles } = require("./easterHunt/HuntEgg");
const { clearHunt, setHuntSpots } = require("./easterHunt/store");
const cardLift = require("./cardLift");
const perches = require("./perches");
const flights = require("./flights");
const quiet = require("./quiet");
const motion = require("./motion");

function snow() {
  return { key: "snow", label: "Schnee", phase: "schnee", intensity: "normal", effective: "normal", channels: ["web", "app"], texts: {}, data: { night: false, snowcap_stage: 2 }, starts_at: "2026-11-29T00:00:00+01:00", ends_at: "2027-01-06T23:59:59+01:00", forced: false };
}

/** Ein Tippen auf die Karte: Finger auf, Finger weg - an derselben Stelle. */
async function tap(testID: string) {
  const card = screen.getByTestId(testID);
  await fireEvent(card, "touchStart", { nativeEvent: { pageX: 40, pageY: 80, touches: [{}] } });
  await fireEvent(card, "touchEnd", { nativeEvent: { pageX: 41, pageY: 81, touches: [] } });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    for (let n = 0; n < 6; n += 1) await Promise.resolve();
  });
}

function Cards({ children }: { children?: React.ReactNode }) {
  return (
    <View>
      <Card perch="a" testID="card-a"><Text>A</Text>{children}</Card>
      <Card perch="b" testID="card-b"><Text>B</Text>{children}</Card>
    </View>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSeasonState.reducedMotion = false;
  mockAuth.user = { id: "u1", username: "anna" };
  mockFind.mockReset();
  perches.resetPerches();
  flights.resetFlights();
  quiet.resetQuiet();
  clearHunt();
  cardLift.resetCardLift();
  resetSnowShake();
  resetWebTears();
  resetBatFlutter();
  resetEggTumbles();
  motion.resetMotionScheduler(motion.createMotionScheduler({ unlimited: true, appState: null }));
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => motion.resetMotionScheduler(null));

test("Schnee (#1088): nur die Haube der angetippten Karte rutscht ab, die Flocken fallen und sind weg, sie wächst in 90 s nach", async () => {
  await render(<Cards><SnowCap season={snow()} screen="Dashboard" /></Cards>);
  for (const edge of screen.getAllByTestId("snow-cap")) {
    await fireEvent(edge, "layout", { nativeEvent: { layout: { width: 360, height: 1, x: 0, y: 0 } } });
  }
  await tap("card-a");
  const [capA, capB] = screen.getAllByTestId("snow-cap-shape");
  expect(capA.props["data-shake"]).toBe("drop");
  expect(capB.props["data-shake"]).toBeUndefined();
  expect(screen.getAllByTestId("snow-shake")).toHaveLength(1);
  expect(screen.getByTestId("snow-shake").props["data-flakes"]).toBe(String(SHAKE.max));
  // Höchstens eine große Reaktion gleichzeitig: die Nachbarkarte wartet, bis die Flocken weg sind.
  await tap("card-b");
  expect(screen.getAllByTestId("snow-cap-shape")[1].props["data-shake"]).toBeUndefined();
  await advance(SHAKE.detachMs + 100);
  expect(screen.getAllByTestId("snow-cap-shape")[0].props["data-shake"]).toBe("grow");
  await advance(SHAKE.detachMs + SHAKE.fallMs[1]);
  expect(screen.queryByTestId("snow-shake")).toBeNull();
  // Einmal je Minute je Karte: noch einmal tippen tut nichts - die Nachbarkarte jetzt schon.
  await tap("card-a");
  expect(screen.queryByTestId("snow-shake")).toBeNull();
  await tap("card-b");
  expect(screen.getAllByTestId("snow-cap-shape")[1].props["data-shake"]).toBe("drop");
  // Nachgewachsen und nach der Ruhezeit wieder bereit.
  await advance(SHAKE.regrowMs + 1000);
  expect(screen.getAllByTestId("snow-cap-shape").map((cap) => cap.props["data-shake"])).toEqual([undefined, undefined]);
  await tap("card-a");
  expect(screen.getAllByTestId("snow-cap-shape")[0].props["data-shake"]).toBe("drop");
});

test("Netz (#1089): nur das Netz der angetippten Karte reißt, ist dann weg und wird nach einer Minute Faden für Faden neu gebaut", async () => {
  await render(<Cards />);
  await act(async () => {
    perches.assignWebs([{ perchId: "a", side: "tl", seed: 0.3, radius: 26 }, { perchId: "b", side: "tr", seed: 0.6, radius: 24 }]);
  });
  expect(screen.getAllByTestId("halloween-corner-web")).toHaveLength(2);
  await tap("card-a");
  expect(screen.getByTestId("halloween-corner-web-torn").props["data-side"]).toBe("tl");
  expect(screen.getByTestId("halloween-corner-spider-rappel")).toBeTruthy();
  expect(screen.getAllByTestId("halloween-corner-web")).toHaveLength(1);
  await advance(TEAR.goneAt);
  expect(screen.queryByTestId("halloween-corner-web-torn")).toBeNull();
  expect(screen.getAllByTestId("halloween-corner-web")).toHaveLength(1);
  // Höchstens einmal je Minute je Karte.
  await tap("card-a");
  expect(screen.queryByTestId("halloween-corner-web-torn")).toBeNull();
  await advance(TEAR.rebuildAt - TEAR.goneAt);
  const shownAtStart = Number(screen.getByTestId("halloween-corner-web-building").props["data-shown"]);
  await advance(TEAR.buildMs / 2);
  const shownHalfway = Number(screen.getByTestId("halloween-corner-web-building").props["data-shown"]);
  expect(shownHalfway).toBeGreaterThan(shownAtStart);
  await advance(TEAR.buildMs / 2 + 500);
  expect(screen.queryByTestId("halloween-corner-web-building")).toBeNull();
  expect(screen.getAllByTestId("halloween-corner-web")).toHaveLength(2);
});

test("Fledermaus (#1090): flattert eine Sekunde auf und sitzt wieder an derselben Karte; nicht neben einem Flug, zehn Sekunden Ruhe", async () => {
  await render(<Cards />);
  await act(async () => {
    perches.assign([{ perchId: "a", corner: "tl", pose: "sit", size: 20, temperament: "sleepy" }, { perchId: "b", corner: "bottom", pose: "hang", size: 22, temperament: "sleepy" }]);
  });
  await advance(800);
  await tap("card-a");
  expect(screen.getAllByTestId("halloween-bat-flutter")).toHaveLength(1);
  expect(screen.getByTestId("season-perch-bat-a").props["data-flutter"]).toBe("1");
  expect(screen.getByTestId("season-perch-bat-b").props["data-flutter"]).toBeUndefined();
  await advance(FLUTTER_MS + 60);
  expect(screen.queryByTestId("halloween-bat-flutter")).toBeNull();
  expect(screen.getByTestId("season-perch-bat-a")).toBeTruthy();
  expect(perches.perchSnapshot().assignments.a).toBeTruthy();
  // Zehn Sekunden Ruhe je Karte.
  await tap("card-a");
  expect(screen.queryByTestId("halloween-bat-flutter")).toBeNull();
  // Während eine Fledermaus fliegt, flattert keine auf.
  const flight = flights.startFlight({ screen: "Dashboard", perchId: null, from: { x: 0, y: 0 }, size: 20, path: { p0: { x: 0, y: 0 }, p1: { x: 10, y: 10 }, p2: { x: 20, y: 20 }, p3: { x: 30, y: 30 }, facing: 1 }, durationMs: 1000 });
  await tap("card-b");
  expect(screen.queryByTestId("halloween-bat-flutter")).toBeNull();
  await act(async () => {
    flights.endFlight(flight.id);
  });
  await tap("card-b");
  expect(screen.getByTestId("season-perch-bat-b").props["data-flutter"]).toBe("1");
  await advance(10000);
  await tap("card-a");
  expect(screen.getByTestId("season-perch-bat-a").props["data-flutter"]).toBe("1");
});

function huntSpots(guest = false) {
  const egg = (egg_no: number, pattern: string) => ({ egg_no, token: `${egg_no}.tok`, spot: { kind: "card", index: 0, place: "top-right" }, pattern, found: false });
  setHuntSpots({ screen: "Dashboard", route: "app:Dashboard", guest, total: 12, spots: [
    { egg: egg(3, "dots"), perchId: "a", corner: "tr" },
    { egg: egg(4, "waves"), perchId: "a", corner: "bl" },
    { egg: egg(5, "lion"), perchId: "b", corner: "br" },
  ] });
}

test("Osterei (#1092): ein Ei je Tippen purzelt hervor und zählt als gefunden - einmal je Ei, zehn Sekunden Ruhe je Karte", async () => {
  mockFind.mockResolvedValue({ found: 4, total: 12 });
  await render(<Cards />);
  await act(async () => huntSpots());
  await tap("card-a");
  expect(screen.getByTestId("hunt-egg-3").props["data-tumble"]).toBe("1");
  expect(screen.getByTestId("hunt-egg-4").props["data-tumble"]).toBeUndefined();
  expect(screen.getByTestId("hunt-egg-5").props["data-tumble"]).toBeUndefined();
  expect(mockFind).not.toHaveBeenCalled();
  await advance(TUMBLE_MS);
  expect(mockFind).toHaveBeenCalledTimes(1);
  expect(mockFind).toHaveBeenCalledWith("3.tok");
  // Gefunden wie angetippt: das Ei hebt sich und ist weg.
  await advance(1000);
  expect(screen.queryByTestId("hunt-egg-3")).toBeNull();
  // Zehn Sekunden Ruhe je Karte: das zweite Ei bleibt liegen.
  await tap("card-a");
  expect(screen.getByTestId("hunt-egg-4").props["data-tumble"]).toBeUndefined();
  await advance(10000);
  await tap("card-a");
  expect(screen.getByTestId("hunt-egg-4").props["data-tumble"]).toBe("1");
});

test("Osterei: nie zwei Funde auf einmal; Gäste sehen es nur purzeln - ohne Fund und ohne Einladung", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  let release: (value: unknown) => void = () => {};
  mockFind.mockImplementation(() => new Promise((resolve) => {
    release = resolve;
  }));
  await render(<Cards />);
  await act(async () => huntSpots());
  // Ein Fund läuft schon (das Ei der Nachbarkarte wurde angetippt) - das gepurzelte Ei wartet nicht darauf.
  await fireEvent.press(screen.getByTestId("hunt-egg-5"));
  await tap("card-a");
  await advance(TUMBLE_MS);
  expect(mockFind).toHaveBeenCalledTimes(1);
  expect(mockFind).toHaveBeenCalledWith("5.tok");
  await act(async () => release({ found: 1, total: 12 }));
  await advance(1000);
  expect(screen.queryByTestId("hunt-egg-5")).toBeNull();
  await screen.unmount();

  resetEggTumbles();
  mockFind.mockReset();
  mockAuth.user = null;
  await render(<Cards />);
  await act(async () => huntSpots(true));
  await tap("card-b");
  expect(screen.getByTestId("hunt-egg-5").props["data-tumble"]).toBe("1");
  await advance(TUMBLE_MS + 100);
  expect(mockFind).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  expect(screen.getByTestId("hunt-egg-5")).toBeTruthy();
  alert.mockRestore();
});

test("Deko mit eigener Antwort: wer die Fledermaus antippt, meint sie - die Eier dieser Karte bleiben liegen", async () => {
  mockFind.mockResolvedValue({ found: 4, total: 12 });
  await render(<Cards />);
  await act(async () => {
    perches.assign([{ perchId: "a", corner: "tl", pose: "sit", size: 20, temperament: "sleepy" }]);
    huntSpots();
  });
  await advance(800);
  // Das Ereignis steigt von der Fledermaus zur Karte auf: erst sie, dann die Karte.
  await fireEvent(screen.getByTestId("halloween-bat-perched"), "touchStart", { nativeEvent: { pageX: 40, pageY: 80, touches: [{}] } });
  await tap("card-a");
  await advance(TUMBLE_MS);
  expect(screen.getByTestId("hunt-egg-3").props["data-tumble"]).toBeUndefined();
  expect(screen.queryByTestId("halloween-bat-flutter")).toBeNull();
});

test("„Bewegung reduzieren“: kein Signal - Schnee, Netz, Fledermaus und Ei bleiben, wie sie sind", async () => {
  mockSeasonState.reducedMotion = true;
  await render(<Cards><SnowCap season={snow()} screen="Dashboard" /></Cards>);
  for (const edge of screen.getAllByTestId("snow-cap")) {
    await fireEvent(edge, "layout", { nativeEvent: { layout: { width: 360, height: 1, x: 0, y: 0 } } });
  }
  await act(async () => {
    perches.assignWebs([{ perchId: "b", side: "tl", seed: 0.3, radius: 26 }]);
    perches.assign([{ perchId: "a", corner: "tl", pose: "sit", size: 20, temperament: "sleepy" }]);
    huntSpots();
  });
  await advance(800);
  expect(cardLift.cardLiftListening()).toBe(false);
  await tap("card-a");
  await tap("card-b");
  await fireEvent(screen.getByTestId("card-a"), "touchStart", { nativeEvent: { pageX: 40, pageY: 80, touches: [{}] } });
  await advance(TUMBLE_MS + 500);
  expect(screen.getAllByTestId("snow-cap-shape").map((cap) => cap.props["data-shake"])).toEqual([undefined, undefined]);
  expect(screen.queryByTestId("snow-shake")).toBeNull();
  expect(screen.queryByTestId("halloween-corner-web-torn")).toBeNull();
  expect(screen.queryByTestId("halloween-bat-flutter")).toBeNull();
  expect(screen.getByTestId("hunt-egg-3").props["data-tumble"]).toBeUndefined();
  expect(mockFind).not.toHaveBeenCalled();
});

test("Scrollen über eine Karte löst nichts aus; eine Inhaltskarte öffnet beim Antippen weiter ihren Inhalt", async () => {
  const lifts: string[] = [];
  const stop = cardLift.subscribeCardLift((detail: { key: string }) => lifts.push(detail.key));
  const onPress = jest.fn();
  await render(<ContentCard kind="news" title="Turnier am Samstag" onPress={onPress} perch="news-9" />);
  const card = screen.getByTestId("content-card");
  await fireEvent(card, "touchStart", { nativeEvent: { pageX: 40, pageY: 300, touches: [{}] } });
  await fireEvent(card, "touchMove", { nativeEvent: { pageX: 40, pageY: 240, touches: [{}] } });
  await fireEvent(card, "touchEnd", { nativeEvent: { pageX: 40, pageY: 200, touches: [] } });
  await advance(500);
  expect(lifts).toEqual([]);
  await tap("content-card");
  await fireEvent.press(card);
  expect(lifts).toEqual(["news-9"]);
  expect(onPress).toHaveBeenCalledTimes(1);
  stop();
});
