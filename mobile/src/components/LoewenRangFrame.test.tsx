import React from "react";
import { AccessibilityInfo, Dimensions, Text } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { LoewenRangFrame } from "./LoewenRangFrame";
import { frameImage } from "./loewenRangImages";

// Löwen-Rang in der App (#1457): Rahmen, Schild mit Rauten und Prestige-Sternen; Glanz und Signatur nur im Profil und
// nie bei „Bewegung reduzieren“, Listen ganz ruhig.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const reanimated = require("react-native-reanimated");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const skia = require("@shopify/react-native-skia");
const frameCallbacks: Set<{ callback: (frame: { timeSinceFirstFrame: number }) => void }> = reanimated.__frameCallbacks;

async function settle() {
  await act(async () => {
    for (let n = 0; n < 3; n += 1) await Promise.resolve();
  });
}

function reduceMotion(value: boolean) {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(value);
}

// Ein Handy mit 390 Punkten Breite (Jest rechnet sonst mit 750 - das wäre ein Tablet).
const WINDOW = Dimensions.get("window");
beforeEach(() => {
  Dimensions.set({ window: { ...WINDOW, width: 390 } });
});
afterEach(() => {
  jest.restoreAllMocks();
  Dimensions.set({ window: WINDOW });
});

test("Profil: Rahmen mit Namen, Schild mit „LVL“ und gefüllten Rauten", async () => {
  reduceMotion(true);
  await render(<LoewenRangFrame level={7} rankName="Fährte" size="profile" testID="frame"><Text>Foto</Text></LoewenRangFrame>);
  await settle();
  const frame = screen.getByTestId("frame");
  expect(frame.props.accessibilityLabel).toBe("Level 7, Rang Fährte");
  expect(frame.props.accessibilityRole).toBe("image");
  expect(frame.props.style).toMatchObject({ width: 220, height: 220, marginBottom: 26 });
  expect(screen.getByText("LVL 7")).toBeTruthy();
  expect(screen.getAllByTestId("loewen-rang-pip-on")).toHaveLength(2);
  expect(screen.getAllByTestId("loewen-rang-pip")).toHaveLength(2);
  expect(screen.queryByTestId("loewen-rang-stars")).toBeNull();
  expect(screen.getByText("Foto")).toBeTruthy();
  // Rang 2 in passender Breite: 220er Fläche, Grafik ~190 Punkte - bei zweifacher Dichte die 640er.
  expect(screen.getByTestId("loewen-rang-art").props.source).toBe(frameImage("02", 640));
});

test("Rangname vom Server, Prestige-Sterne und MAX bei Level 60", async () => {
  reduceMotion(true);
  await render(<LoewenRangFrame level={60} prestige={3} rankName="Löwenkönig" size="profile" testID="frame" />);
  await settle();
  expect(screen.getByTestId("frame").props.accessibilityLabel).toBe("Level 60, Rang Löwenkönig, Prestige 3");
  expect(screen.getByTestId("frame").props.style).toMatchObject({ marginBottom: 41 });
  expect(screen.getByTestId("loewen-rang-stars", { includeHiddenElements: true })).toHaveTextContent("★★★");
  expect(screen.getByText("LVL 60 · MAX")).toBeTruthy();
  expect(screen.getAllByTestId("loewen-rang-pip-on")).toHaveLength(5);
  expect(screen.queryAllByTestId("loewen-rang-pip")).toHaveLength(0);
});

test("„Bewegung reduzieren“: kein Glanz, keine Signatur, kein Bild-Takt", async () => {
  reduceMotion(true);
  frameCallbacks.clear();
  await render(<LoewenRangFrame level={9} size="profile" />);
  await settle();
  expect(screen.queryByTestId("loewen-rang-signature")).toBeNull();
  expect(frameCallbacks.size).toBe(0);
  expect(screen.getByTestId("loewen-rang-art")).toBeTruthy();
});

test("solange das Handy nicht geantwortet hat, bewegt sich nichts", async () => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(new Promise<boolean>(() => undefined));
  frameCallbacks.clear();
  await render(<LoewenRangFrame level={9} size="profile" />);
  await settle();
  expect(screen.queryByTestId("loewen-rang-signature")).toBeNull();
  expect(frameCallbacks.size).toBe(0);
});

test("Profil mit Bewegung: Signatur auf dem UI-Thread, wenige Teilchen", async () => {
  reduceMotion(false);
  frameCallbacks.clear();
  await render(<LoewenRangFrame level={9} size="profile" />);
  await settle();
  expect(screen.getByTestId("loewen-rang-signature")).toBeTruthy();
  expect(frameCallbacks.size).toBe(1);
  const [entry] = [...frameCallbacks];
  const before = skia.__skiaDraws.circles;
  // Level 9 = Rang 2 voll: Funken, sechs Teilchen mit Hof und Kern - höchstens zwölf Kreise je Bild.
  entry.callback({ timeSinceFirstFrame: 1200 });
  const drawn = skia.__skiaDraws.circles - before;
  expect(drawn).toBeGreaterThan(0);
  expect(drawn).toBeLessThanOrEqual(12);
  // Zu schnell hintereinander: das Bild wird übersprungen (höchstens ~30 je Sekunde).
  entry.callback({ timeSinceFirstFrame: 1210 });
  expect(skia.__skiaDraws.circles - before).toBe(drawn);
});

test("Glanz: läuft 45 % von 5,5 s über das Metall (die Grafik ist die Maske), dann Pause", async () => {
  reduceMotion(false);
  frameCallbacks.clear();
  jest.spyOn(skia, "useImage").mockReturnValue({ width: () => 640, height: () => 640 });
  await render(<LoewenRangFrame level={5} size="profile" />);
  await settle();
  const [entry] = [...frameCallbacks];
  const draws = skia.__skiaDraws;
  const before = { images: draws.images, rects: draws.rects, circles: draws.circles };
  entry.callback({ timeSinceFirstFrame: 1000 });
  expect([draws.images - before.images, draws.rects - before.rects]).toEqual([1, 1]);
  // Level 5 = erstes Level im Rang: Glanz ja, Teilchen noch keine.
  expect(draws.circles).toBe(before.circles);
  entry.callback({ timeSinceFirstFrame: 4000 });
  expect([draws.images - before.images, draws.rects - before.rects]).toEqual([1, 1]);
});

test("Liste und Podest: nur die Grafik - ohne Schild, ohne Bewegung", async () => {
  reduceMotion(false);
  frameCallbacks.clear();
  await render(
    <>
      <LoewenRangFrame level={27} prestige={2} size="list" testID="row" />
      <LoewenRangFrame level={12} size="mini" testID="podium" />
    </>,
  );
  await settle();
  expect(screen.getByTestId("row").props.style).toMatchObject({ width: 92, height: 92, marginBottom: 0 });
  expect(screen.getByTestId("row").props.accessibilityLabel).toBe("Level 27, Rang Goldmähne, Prestige 2");
  expect(screen.getByTestId("podium").props.style).toMatchObject({ width: 64, height: 64 });
  expect(screen.queryByTestId("loewen-rang-plate")).toBeNull();
  expect(screen.queryByTestId("loewen-rang-signature")).toBeNull();
  expect(frameCallbacks.size).toBe(0);
});

test("Tablet: das Profil wie am Desktop mit 285", async () => {
  reduceMotion(true);
  Dimensions.set({ window: { ...WINDOW, width: 800 } });
  await render(<LoewenRangFrame level={3} size="profile" testID="frame" />);
  await settle();
  expect(screen.getByTestId("frame").props.style).toMatchObject({ width: 285, height: 285 });
});

test("Karte: Schild in klein, aber keine Bewegung", async () => {
  reduceMotion(false);
  await render(<LoewenRangFrame level={14} prestige={1} size="card" testID="card" />);
  await settle();
  expect(screen.getByTestId("card").props.style).toMatchObject({ width: 150, height: 150, marginBottom: 35 });
  expect(screen.getByText("LVL 14")).toBeTruthy();
  expect(screen.queryByTestId("loewen-rang-signature")).toBeNull();
});
