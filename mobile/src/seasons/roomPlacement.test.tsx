import React from "react";
import { Pressable, Text } from "react-native";
import { act, render, screen } from "@testing-library/react-native";

// Saison-Deko nur, wo Platz ist (#1295): keine Kette und kein Wimpel unter einem Knopf oder in einer Zeile mit Knopf;
// Kette und Wimpel nur mit freiem Band, sonst an der nächsten passenden Karte; Netze und Fledermäuse halten Abstand zu
// Überschriften und Augenbrauen („MITGLIED WERDEN“, „VOM VEREIN“); das große Netz liegt hinter dem Inhalt.

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

const { Card, endsWithControl } = require("../components/Card");
const { Body } = require("../components/Text");
const { Button } = require("../components/Button");
const { ChristmasCorners } = require("./christmas");
const { HalloweenBackdrop, HalloweenCorners, resetHubSpots, tapHubSpider } = require("./halloween");
const { measureRects } = require("./useRoom");
const perches = require("./perches");
const room = require("./room");
const flights = require("./flights");
const quiet = require("./quiet");
const motion = require("./motion");

function christmas() {
  return { key: "christmas", label: "Weihnachten", phase: "gruss", intensity: "normal", effective: "normal", channels: ["app"], texts: {}, data: {}, starts_at: "2026-12-24T00:00:00+01:00", ends_at: "", forced: false };
}
function halloween(effective = "normal") {
  return { key: "halloween", label: "Halloween", phase: "deko", intensity: "normal", effective, channels: ["app"], texts: {}, data: { night: false }, starts_at: "", ends_at: "", forced: false };
}

async function flush(ms: number) {
  for (let step = 0; step < ms; step += 50) {
    await act(async () => {
      jest.advanceTimersByTime(50);
      for (let n = 0; n < 8; n += 1) await Promise.resolve();
    });
  }
}

/** Feste Messungen für Plätze (im Test misst niemand). */
function fixPerches(rects: Record<string, { x: number; y: number; width: number; height: number }>) {
  perches.perchesFor("Dashboard").forEach((perch: { id: string }) => {
    if (perch.id in rects) perches.registerPerch({ ...perch, measure: async () => rects[perch.id] });
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  perches.resetPerches();
  room.resetRoom();
  flights.resetFlights();
  quiet.resetQuiet();
  resetHubSpots();
  motion.resetMotionScheduler(motion.createMotionScheduler({ unlimited: true, appState: null }));
  mockSeasonState.reducedMotion = false;
  mockSeasonState.byKey = {};
});

afterEach(() => {
  jest.useRealTimers();
});

afterAll(() => motion.resetMotionScheduler(null));

test("Knopf in der letzten Zeile: Knopf, Zeilen zum Antippen, Kacheln in einer Reihe - Text allein nicht", () => {
  const noop = () => {};
  expect(endsWithControl([<Text key="a">Mehr vom Verein</Text>, <Button key="b" label="Antrag stellen" onPress={noop} />])).toBe(true);
  expect(endsWithControl(["News", "Partner"].map((label) => <Pressable key={label} onPress={noop}><Text>{label}</Text></Pressable>))).toBe(true);
  expect(endsWithControl(<>{[<Text key="t">Kopf</Text>]}<Text>Ende</Text></>)).toBe(false);
  expect(endsWithControl([<Button key="b" label="Oben" onPress={noop} />, <Text key="t">Unten nur Text</Text>])).toBe(false);
  expect(endsWithControl(null)).toBe(false);
});

test("Weihnachten: keine Kette an einer Karte, die mit „Antrag stellen“ endet - die Kette hängt an einer Karte ohne Knopf", async () => {
  await render(
    <>
      <ChristmasCorners season={christmas()} screen="Dashboard" />
      <Card perch="join"><Text>Mehr vom Verein</Text><Button label="Antrag stellen" onPress={() => {}} /></Card>
      <Card perch="club"><Text>Vom Verein</Text></Card>
      <Card perch="news"><Text>News</Text></Card>
    </>,
  );
  await flush(100);
  const deco = perches.perchSnapshot().deco;
  expect(perches.perchesFor("Dashboard").find((perch: { id: string }) => perch.id === "join").bottomControl).toBe(true);
  expect(Object.keys(deco).length).toBeGreaterThanOrEqual(1);
  expect(deco.join).toBeUndefined();
});

test("Weihnachten: ist das Band belegt (darunter direkt eine Karte), zieht die Kette an die nächste passende Karte", async () => {
  room.setRoomProbe(true);
  await render(
    <>
      <ChristmasCorners season={christmas()} screen="Dashboard" />
      <Card perch="a"><Text>Erste Karte</Text></Card>
      <Card perch="b"><Text>Zweite Karte</Text></Card>
    </>,
  );
  fixPerches({ a: { x: 20, y: 100, width: 320, height: 100 }, b: { x: 20, y: 400, width: 320, height: 100 } });
  // Direkt unter der ersten Karte (4 Punkte Abstand) liegt eine andere Karte - dort ist kein Band frei.
  room.registerRoom({ id: "tight", screen: "Dashboard", card: null, kind: "card", measure: async () => [{ x: 20, y: 204, width: 320, height: 80 }] });
  await flush(800);
  const deco = perches.perchSnapshot().deco;
  expect(Object.keys(deco)).toEqual(["b"]);
  const shown = screen.getAllByTestId("season-card-deco");
  expect(shown.length).toBe(1);
  expect(shown[0].props["data-room"]).toBe("1");
});

test("Halloween: ein Netz in der Ecke über „MITGLIED WERDEN“ bleibt unsichtbar und sperrt die Ecke; die Auswahl nimmt dann die andere", async () => {
  room.setRoomProbe(true);
  await render(<Card perch="join"><Text>Mitglied werden</Text></Card>);
  fixPerches({ join: { x: 20, y: 120, width: 360, height: 300 } });
  // Die Augenbraue links oben in der Karte.
  room.registerRoom({ id: "eyebrow", screen: "Dashboard", card: "join", kind: "text", measure: async () => [{ x: 35, y: 135, width: 130, height: 14 }] });
  await act(async () => {
    perches.assignWebs([{ perchId: "join", side: "tl", seed: 0.42, radius: 26 }]);
  });
  await flush(500);
  expect(room.isBlocked("join", "web:tl")).toBe(true);
  expect(screen.getByTestId("halloween-corner-web").props["data-room"]).toBe("0");
  const sidesOf = (perch: { id: string }) => (["tl", "tr"] as const).filter((side) => !room.isBlocked(perch.id, `web:${side}`));
  const chosen = perches.chooseWebPerches(perches.perchesFor("Dashboard"), 1, () => 0.2, [], sidesOf);
  expect(chosen).toEqual([expect.objectContaining({ perchId: "join", side: "tr" })]);
  // Rechts oben ist frei: dort wird das Netz sichtbar.
  await act(async () => {
    perches.assignWebs(chosen);
  });
  await flush(500);
  expect(screen.getByTestId("halloween-corner-web").props["data-side"]).toBe("tr");
  expect(screen.getByTestId("halloween-corner-web").props["data-room"]).toBe("1");
  // Sind beide Ecken belegt, bekommt die Karte kein Netz.
  room.markBlocked("join", "web:tr");
  expect(perches.chooseWebPerches(perches.perchesFor("Dashboard"), 1, () => 0.2, [], sidesOf)).toEqual([]);
});

test("Halloween: eine Fledermaus über „VOM VEREIN“ räumt die Ecke; die nächste freie Ecke ist rechts oben", async () => {
  room.setRoomProbe(true);
  await render(<Card perch="club"><Text>News</Text></Card>);
  fixPerches({ club: { x: 20, y: 300, width: 360, height: 250 } });
  // Die Überschrift der Gruppe steht direkt über der Karte, links.
  room.registerRoom({ id: "group", screen: "Dashboard", card: null, kind: "text", measure: async () => [{ x: 20, y: 278, width: 96, height: 16 }] });
  await act(async () => {
    perches.assign([{ perchId: "club", corner: "tl", pose: "sit", size: 20, temperament: "sleepy" }]);
  });
  await flush(500);
  expect(room.isBlocked("club", "bat:tl")).toBe(true);
  expect(perches.perchSnapshot().assignments.club).toBeUndefined();
  const perch = perches.perchesFor("Dashboard")[0];
  const placement = perches.placementFor(perch, () => 0.1, (corner: string) => room.isBlocked("club", `bat:${corner}`));
  expect(placement).toEqual(expect.objectContaining({ corner: "tr", pose: "sit" }));
  expect(perches.placementFor(perch, () => 0.1, () => true)).toBeNull();
});

test("Halloween: das große Netz liegt hinter dem Inhalt (Backdrop), nicht mehr auf der Bühne; ein Tippfeld schickt die Spinne weg", async () => {
  require("./halloween").setYearSalt("abnahme");
  const name = ["Dashboard", "NewsList", "Gallery", "GalleryAlbum", "SeasonPass"].find((candidate) => !require("./halloween").screenLayout(candidate, "normal").web.build) as string;
  expect(name).toBeTruthy();
  await render(<HalloweenCorners season={halloween()} screen={name} />);
  expect(screen.queryAllByTestId(/halloween-web-b/).length).toBe(0);
  await screen.unmount();
  await render(<HalloweenBackdrop season={halloween()} screen={name} />);
  expect(screen.getAllByTestId(/halloween-web-b/).length).toBeGreaterThanOrEqual(1);
  const corner = require("./halloween").screenLayout(name, "normal").web.corner;
  const spider = screen.getAllByTestId("halloween-web-spider")[0];
  expect(spider.props["data-hidden"]).toBe("0");
  await act(async () => {
    tapHubSpider(`${name}:${corner}`);
  });
  expect(screen.getAllByTestId("halloween-web-spider")[0].props["data-hidden"]).toBe("1");
});

test("Schrift meldet sich nur mit Platzprüfung an; gemessen wird je Zeile", async () => {
  await render(<Body>Vom Verein</Body>);
  expect(room.roomEntries("Dashboard").length).toBe(0);
  await screen.unmount();
  room.setRoomProbe(true);
  await render(<Body>Vom Verein</Body>);
  expect(room.roomEntries("Dashboard").map((entry: { kind: string }) => entry.kind)).toEqual(["text"]);
  const node = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(20, 300, 340, 44) };
  await expect(measureRects(node, [{ x: 0, y: 0, width: 120, height: 22 }, { x: 0, y: 22, width: 60, height: 22 }])).resolves.toEqual([
    { x: 20, y: 300, width: 120, height: 22 },
    { x: 20, y: 322, width: 60, height: 22 },
  ]);
  await expect(measureRects(node, null)).resolves.toEqual([{ x: 20, y: 300, width: 340, height: 44 }]);
  await expect(measureRects(null, null)).resolves.toBeNull();
});
