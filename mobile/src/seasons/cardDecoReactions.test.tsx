import React from "react";
import { Text, View } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

// Jahreszeiten IV, Variante B (#1091-#1094) in der App: Lichterkette, Osterei, Luftschlange und Wimpelkette reagieren,
// wenn ihre Karte angetippt wird - an der Begrüßungskarte und an einigen weiteren Karten, nie an jeder. Nur die Deko der
// angetippten Karte, einmal je Tippen, zehn Sekunden Ruhe je Karte; Scrollen löst nichts aus, „Bewegung reduzieren“
// auch nicht. Dieselben Regeln und Zeiten wie im Web.

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
const mockSeasonState: Record<string, unknown> = { reducedMotion: false, showToast: jest.fn(), toast: null, weather: null, seasons: [], byKey: {} };
jest.mock("./SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
jest.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }) }));
jest.mock("../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => true, getCurrentRoute: () => ({ name: "Dashboard" }), addListener: () => () => {} } }));

const { Card } = require("../components/Card");
const { ChristmasCorners, ChristmasEdge } = require("./christmas");
const { resetChainSwing } = require("./christmas/LightChain");
const { SWING } = require("./christmas/swing");
const { EasterCorners, EasterEdge, EDGE_ROLL_ROOM } = require("./easter");
const { resetEggRolls } = require("./easter/cardEgg");
const { ROLL } = require("./easter/roll");
const { BirthdayCorners, BirthdayEdge, resetBirthdayState } = require("./birthday");
const { resetGarlandFlutter } = require("./birthday/garlandView");
const { PENNANT_FLUTTER } = require("./birthday/garland");
const { CarnivalCorners, resetCarnivalState } = require("./carnival");
const { resetStreamerFlutter } = require("./carnival/streamerOnCard");
const { CARD_STREAMER } = require("./carnival/cardStreamer");
const { cardDecoCount } = require("./cardDeco");
const cardLift = require("./cardLift");
const perches = require("./perches");
const quiet = require("./quiet");
const motion = require("./motion");

/** Die Kette ist für Bildschirmleser verborgen - ihre Teile findet der Test nur mit diesem Schalter. */
const HIDDEN = { includeHiddenElements: true };

function season(key: string, extra: Record<string, unknown> = {}) {
  return { key, label: key, phase: "deko", intensity: "normal", effective: "normal", channels: ["web", "app"], texts: {}, data: {}, starts_at: "2027-03-01T00:00:00+01:00", ends_at: "", forced: false, ...extra };
}
const christmas = () => season("christmas", { phase: "gruss", starts_at: "2026-12-24T00:00:00+01:00" });
const easter = () => season("easter", { starts_at: "2027-03-21T00:00:00+01:00", data: { quiet: false, sunday: "2027-03-28" } });
const birthday = () => season("club_birthday", { phase: "feier", data: { years: 8 } });
const carnival = () => season("carnival", { starts_at: "2027-02-09T00:00:00+01:00" });

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

/** Alle Kanten und Deko-Ebenen einer Breite messen lassen (onLayout). */
async function layout(testIDs: string[], width = 340) {
  for (const id of testIDs) {
    for (const node of screen.queryAllByTestId(id)) {
      await fireEvent(node, "layout", { nativeEvent: { layout: { width, height: 16, x: 0, y: 0 } } });
    }
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSeasonState.reducedMotion = false;
  mockSeasonState.byKey = {};
  perches.resetPerches();
  quiet.resetQuiet();
  cardLift.resetCardLift();
  resetChainSwing();
  resetEggRolls();
  resetGarlandFlutter();
  resetStreamerFlutter();
  resetBirthdayState();
  resetCarnivalState();
  motion.resetMotionScheduler(motion.createMotionScheduler({ unlimited: true, appState: null }));
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => motion.resetMotionScheduler(null));

test("wie viele Karten Deko tragen: wie im Web nach den Ecken des Screens, nie mehr als vier von zehn", () => {
  expect(cardDecoCount("Dashboard", "normal", 390, 844, 10)).toBe(2);
  expect(cardDecoCount("NewsList", "full", 390, 844, 3)).toBe(1);
  expect(cardDecoCount("Teams", "normal", 390, 844, 10)).toBe(1);
  expect(cardDecoCount("Profile", "normal", 390, 844, 10)).toBe(0);
  expect(cardDecoCount("Settings", "full", 390, 844, 10)).toBe(0);
  expect(cardDecoCount("Dashboard", "subtle", 390, 844, 10)).toBe(1);
  expect(cardDecoCount("Dashboard", "normal", 320, 568, 10)).toBe(0);
  expect(cardDecoCount("Dashboard", "normal", 390, 844, 0)).toBe(0);
});

test("Lichterkette an der Begrüßungskarte (#1091): nur die angetippte schwingt nach, ein Licht flackert; zehn Sekunden Ruhe", async () => {
  await render(
    <View>
      <Card perch="a" testID="card-a"><Text>A</Text><ChristmasEdge season={christmas()} screen="Dashboard" /></Card>
      <Card perch="b" testID="card-b"><Text>B</Text><ChristmasEdge season={christmas()} screen="Dashboard" /></Card>
    </View>,
  );
  await layout(["christmas-edge"]);
  expect(screen.queryAllByTestId("christmas-chain-swing", HIDDEN)).toHaveLength(0);
  await tap("card-a");
  expect(screen.getAllByTestId("christmas-chain-swing", HIDDEN)).toHaveLength(1);
  expect(screen.getAllByTestId("christmas-bulb", HIDDEN).filter((bulb) => bulb.props["data-blink"] === "1")).toHaveLength(1);
  await advance(SWING.ms + 100);
  expect(screen.queryAllByTestId("christmas-chain-swing", HIDDEN)).toHaveLength(0);
  // Zehn Sekunden Ruhe je Karte - die andere Karte darf sofort.
  await tap("card-a");
  expect(screen.queryAllByTestId("christmas-chain-swing", HIDDEN)).toHaveLength(0);
  await tap("card-b");
  expect(screen.getAllByTestId("christmas-chain-swing", HIDDEN)).toHaveLength(1);
  await advance(10000);
  await tap("card-a");
  expect(screen.getAllByTestId("christmas-chain-swing", HIDDEN).length).toBeGreaterThanOrEqual(1);
});

test("Eier an der Begrüßungskarte (#1092): alle wackeln, das äußerste rollt je Tippen höchstens sechs Punkte zur Ecke", async () => {
  await render(<Card perch="dashboard-hero" perchKind="hero" testID="hero"><Text>Hallo</Text><EasterEdge season={easter()} screen="Dashboard" /></Card>);
  const offsets: number[] = [];
  for (let n = 0; n < 5; n += 1) {
    await tap("hero");
    const eggs = screen.getAllByTestId("easter-edge-egg");
    if (n === 0) expect(eggs.every((egg) => egg.props["data-roll"] === "1")).toBe(true);
    offsets.push(Number(eggs[eggs.length - 1].props["data-offset"]));
    await advance(ROLL.ms + 100);
    expect(screen.getAllByTestId("easter-edge-egg").some((egg) => egg.props["data-roll"] === "1")).toBe(false);
    await advance(10000);
  }
  expect(offsets).toEqual([6, 12, EDGE_ROLL_ROOM, EDGE_ROLL_ROOM, EDGE_ROLL_ROOM]);
});

test("Wimpel an der Begrüßungskarte (#1094): flattern einmal durch, eine Sekunde", async () => {
  await render(<Card perch="dashboard-hero" perchKind="hero" testID="hero"><Text>Hallo</Text><BirthdayEdge season={birthday()} screen="Dashboard" /></Card>);
  await layout(["birthday-edge"]);
  await tap("hero");
  expect(screen.getByTestId("birthday-edge").props["data-flutter"]).toBe("1");
  await advance(PENNANT_FLUTTER.ms + 100);
  expect(screen.getByTestId("birthday-edge").props["data-flutter"]).toBeUndefined();
});

function Cards({ count = 5, clip = false }: { count?: number; clip?: boolean }) {
  return (
    <View>
      <Card perch="dashboard-hero" perchKind="hero" testID="hero"><Text>Hallo</Text></Card>
      {Array.from({ length: count }, (_, n) => <Card key={n} perch={`card-${n}`} testID={`card-${n}`} perchClip={clip}><Text>{`Karte ${n}`}</Text></Card>)}
    </View>
  );
}

/** Welche Karten Deko einer Art tragen (nach der Zuteilung). */
function decorated(kind: string): string[] {
  return Object.values(perches.perchSnapshot().deco as Record<string, { perchId: string; kind: string }>).filter((entry) => entry.kind === kind).map((entry) => entry.perchId);
}

test("Ketten an Karten (#1091): an zwei von fünf, nie an der Begrüßungskarte, nie an Karten, die abschneiden", async () => {
  mockSeasonState.byKey = { christmas: christmas() };
  await render(<><Cards /><ChristmasCorners season={christmas()} screen="Dashboard" /></>);
  const chosen = decorated("chain");
  expect(chosen).toHaveLength(2);
  expect(chosen).not.toContain("dashboard-hero");
  await layout(["christmas-card-chain"]);
  expect(screen.getAllByTestId("christmas-card-chain")).toHaveLength(2);
  const [first] = chosen;
  const plain = ["card-0", "card-1", "card-2", "card-3", "card-4"].find((id) => !chosen.includes(id)) as string;
  await tap(plain);
  expect(screen.queryAllByTestId("christmas-chain-swing", HIDDEN)).toHaveLength(0);
  await tap(first);
  expect(screen.getAllByTestId("christmas-chain-swing", HIDDEN)).toHaveLength(1);
  expect(screen.getAllByTestId("christmas-card-chain").filter((chain) => chain.props["data-swing"] === "1")).toHaveLength(1);
  await screen.unmount();
  expect(decorated("chain")).toEqual([]);
  // Karten, die abschneiden, tragen keine Deko - sie ragt über die Kanten.
  await render(<><Cards clip /><ChristmasCorners season={christmas()} screen="Dashboard" /></>);
  expect(decorated("chain")).toEqual([]);
});

test("Eier an Karten (#1092): rollen je Tippen höchstens sechs Punkte zur Ecke, bleiben dort - auch nach neuem Zeichnen", async () => {
  mockSeasonState.byKey = { easter: easter() };
  await render(<><Cards /><EasterCorners season={easter()} screen="Dashboard" /></>);
  const [first] = decorated("egg");
  expect(decorated("egg")).toHaveLength(2);
  await layout(["easter-card-egg"]);
  await tap(first);
  const egg = () => screen.getAllByTestId("easter-card-egg").find((node) => node.props["data-roll"] === "1" || Number(node.props["data-offset"]) !== 0);
  expect(egg()?.props["data-roll"]).toBe("1");
  const offset = Number(egg()?.props["data-offset"]);
  expect(Math.abs(offset)).toBe(ROLL.maxPx);
  await advance(ROLL.ms + 100);
  expect(Number(egg()?.props["data-offset"])).toBe(offset);
  // Zehn Sekunden Ruhe.
  await tap(first);
  expect(egg()?.props["data-roll"]).toBeUndefined();
  // Neu gezeichnet (der Screen kommt zurück): das Ei liegt noch dort, wohin es gerollt ist.
  await screen.unmount();
  await render(<><Cards /><EasterCorners season={easter()} screen="Dashboard" /></>);
  await layout(["easter-card-egg"]);
  expect(screen.getAllByTestId("easter-card-egg").map((node) => Number(node.props["data-offset"]))).toContain(offset);
});

test("Luftschlangen an Karten (#1093): flattern einmal durch, nur an der angetippten", async () => {
  mockSeasonState.byKey = { carnival: carnival() };
  await render(<><Cards /><CarnivalCorners season={carnival()} screen="Dashboard" /></>);
  await advance(10);
  const chosen = decorated("streamer");
  expect(chosen).toHaveLength(2);
  await layout(["carnival-card-streamer"]);
  expect(screen.getAllByTestId("carnival-card-streamer-loop").length).toBeGreaterThanOrEqual(4);
  await tap(chosen[0]);
  const fluttering = screen.getAllByTestId("carnival-card-streamer").filter((node) => node.props["data-flutter"] === "1");
  expect(fluttering).toHaveLength(1);
  await advance(CARD_STREAMER.ms + 100);
  expect(screen.getAllByTestId("carnival-card-streamer").filter((node) => node.props["data-flutter"] === "1")).toHaveLength(0);
});

test("Wimpelketten an Karten (#1094): flattern einmal durch, nur an der angetippten", async () => {
  mockSeasonState.byKey = { club_birthday: birthday() };
  await render(<><Cards /><BirthdayCorners season={birthday()} screen="Dashboard" /></>);
  const chosen = decorated("garland");
  expect(chosen).toHaveLength(2);
  await layout(["birthday-card-garland"]);
  expect(screen.getAllByTestId("birthday-card-pennant").length).toBeGreaterThan(20);
  await tap(chosen[1]);
  expect(screen.getAllByTestId("birthday-card-garland").filter((node) => node.props["data-flutter"] === "1")).toHaveLength(1);
});

test("Scrollen löst nichts aus, „Bewegung reduzieren“ auch nicht - die Deko hängt trotzdem", async () => {
  mockSeasonState.byKey = { christmas: christmas() };
  await render(<><Cards /><ChristmasCorners season={christmas()} screen="Dashboard" /></>);
  await layout(["christmas-card-chain"]);
  const [first] = decorated("chain");
  const card = screen.getByTestId(first);
  await fireEvent(card, "touchStart", { nativeEvent: { pageX: 40, pageY: 300, touches: [{}] } });
  await fireEvent(card, "touchMove", { nativeEvent: { pageX: 40, pageY: 240, touches: [{}] } });
  await fireEvent(card, "touchEnd", { nativeEvent: { pageX: 40, pageY: 200, touches: [] } });
  await advance(500);
  expect(screen.queryAllByTestId("christmas-chain-swing", HIDDEN)).toHaveLength(0);
  await screen.unmount();
  mockSeasonState.reducedMotion = true;
  cardLift.resetCardLift();
  await render(<><Cards /><ChristmasCorners season={christmas()} screen="Dashboard" /></>);
  await layout(["christmas-card-chain"]);
  expect(screen.getAllByTestId("christmas-card-chain")).toHaveLength(2);
  expect(cardLift.cardLiftListening()).toBe(false);
  for (const id of decorated("chain")) await tap(id);
  await advance(500);
  expect(screen.queryAllByTestId("christmas-chain-swing", HIDDEN)).toHaveLength(0);
});
