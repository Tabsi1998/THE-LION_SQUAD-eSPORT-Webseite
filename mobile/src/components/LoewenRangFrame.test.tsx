import React from "react";
import { AccessibilityInfo, Dimensions, PixelRatio, StyleSheet, Text } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { auditTree, findingLines, type A11yNode } from "../a11y/audit";
import { LoewenRangFrame } from "./LoewenRangFrame";
import { frameImage } from "./loewenRangImages";
import { ascentMoment } from "../lib/loewenAufstieg";

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

test("„Bewegung reduzieren“ gilt sofort (#1969): auch bevor das Handy antwortet, bewegt sich nichts", async () => {
  const reanimated = jest.requireMock("react-native-reanimated");
  const startValue = jest.spyOn(reanimated, "useReducedMotion").mockReturnValue(true);
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(new Promise<boolean>(() => undefined));
  frameCallbacks.clear();
  await render(<LoewenRangFrame level={9} size="profile" />);
  await settle();
  expect(screen.queryByTestId("loewen-rang-signature")).toBeNull();
  expect(frameCallbacks.size).toBe(0);
  startValue.mockRestore();
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

test("Liste und Podest: nur die Grafik - ohne Schild, ohne Bewegung, nur Schmuck für Vorleser, Platz für den Überstand", async () => {
  reduceMotion(false);
  frameCallbacks.clear();
  await render(
    <>
      <LoewenRangFrame level={27} prestige={2} size="list" testID="row" />
      <LoewenRangFrame level={12} size="mini" testID="podium" />
      <LoewenRangFrame level={27} size="list" decorative={false} testID="named" />
    </>,
  );
  await settle();
  const row = screen.getByTestId("row", { includeHiddenElements: true });
  expect(row.props.style).toMatchObject({ width: 92, height: 92, marginTop: 7, marginBottom: 0 });
  // In einer antippbaren Zeile: kein eigener Halt - der Name der Zeile trägt Level und Rang.
  expect(row.props).toMatchObject({ accessible: false, importantForAccessibility: "no-hide-descendants", accessibilityElementsHidden: true });
  expect(row.props.accessibilityLabel).toBeUndefined();
  expect(screen.getByTestId("podium", { includeHiddenElements: true }).props.style).toMatchObject({ width: 64, height: 64, marginTop: 5 });
  expect(screen.getByTestId("named").props.accessibilityLabel).toBe("Level 27, Rang Goldmähne");
  expect(screen.queryByTestId("loewen-rang-plate", { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByTestId("loewen-rang-signature", { includeHiddenElements: true })).toBeNull();
  expect(frameCallbacks.size).toBe(0);
});

test("Ruhe: in Glanz-Pausen und ohne Teilchen wird kein neues Bild aufgezeichnet", async () => {
  reduceMotion(false);
  frameCallbacks.clear();
  jest.spyOn(skia, "useImage").mockReturnValue({ width: () => 640, height: () => 640 });
  const recorder = jest.spyOn(skia.Skia, "PictureRecorder");
  // Level 5: erstes Level im Rang - nur der Glanz, keine Teilchen.
  await render(<LoewenRangFrame level={5} size="profile" />);
  await settle();
  const [entry] = [...frameCallbacks];
  entry.callback({ timeSinceFirstFrame: 1000 });
  expect(recorder).toHaveBeenCalledTimes(1);
  // Glanz-Pause (2,5 … 5,5 s): kein Bild, auch nicht über viele Takte.
  for (let ms = 3000; ms < 5400; ms += 40) entry.callback({ timeSinceFirstFrame: ms });
  expect(recorder).toHaveBeenCalledTimes(1);
  // Nächster Durchgang: es wird wieder gezeichnet.
  entry.callback({ timeSinceFirstFrame: 5600 });
  expect(recorder).toHaveBeenCalledTimes(2);
});

test("Blitz zeichnet nur, wenn es blitzt", async () => {
  reduceMotion(false);
  frameCallbacks.clear();
  const recorder = jest.spyOn(skia.Skia, "PictureRecorder");
  // Level 39: Rang 8 (Brüller) voll - Blitz; ohne geladene Grafik kein Glanz.
  await render(<LoewenRangFrame level={39} size="profile" />);
  await settle();
  const [entry] = [...frameCallbacks];
  entry.callback({ timeSinceFirstFrame: 2600 });
  expect(recorder).toHaveBeenCalledTimes(1);
  // Ein kurzer Nachblitz (2,86 … 2,94 s), danach dunkel bis zum nächsten Schlag bei 5,2 s.
  for (let ms = 2700; ms < 5150; ms += 40) entry.callback({ timeSinceFirstFrame: ms });
  expect(recorder).toHaveBeenCalledTimes(3);
});

test("große Schrift: das Schild passt in die Fläche und bleibt lesbar", async () => {
  reduceMotion(true);
  jest.spyOn(PixelRatio, "getFontScale").mockReturnValue(2);
  Dimensions.set({ window: { ...WINDOW, width: 390, fontScale: 2 } });
  await render(<LoewenRangFrame level={60} prestige={5} size="card" testID="frame" />);
  await settle();
  const tag = screen.getByTestId("loewen-rang-tag");
  expect(tag.props).toMatchObject({ numberOfLines: 1, adjustsFontSizeToFit: true, maxFontSizeMultiplier: 1.3 });
  expect(screen.getByTestId("loewen-rang-stars").props).toMatchObject({ numberOfLines: 1, adjustsFontSizeToFit: true });
  const tagBox = StyleSheet.flatten(tag.parent?.props.style) as { maxWidth?: number };
  expect(tagBox.maxWidth).toBe(150 - 16);
  // Die Prüfung aus screens.a11y.test.tsx findet nichts.
  expect(findingLines(auditTree(screen.root as unknown as A11yNode))).toEqual([]);
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

test("Aufstiegs-Moment (#1456): einmal nach dem Einrasten, danach steht die Bildschleife; keine Dauer-Signatur", async () => {
  reduceMotion(false);
  frameCallbacks.clear();
  const moment = ascentMoment({ level: 25, previous: 24 });
  await render(<LoewenRangFrame level={25} size="card" ascent={moment} />);
  await settle();
  expect(screen.getByTestId("loewen-ascent-burst")).toBeTruthy();
  expect(screen.getByTestId("loewen-ascent-old")).toBeTruthy();
  expect(screen.queryByTestId("loewen-rang-signature")).toBeNull();
  expect(frameCallbacks.size).toBe(1);
  const [entry] = [...frameCallbacks];
  const before = skia.__skiaDraws.circles;
  // Vor dem Einrasten (hold + out) zeichnet der Moment nichts.
  await act(async () => { entry.callback({ timeSinceFirstFrame: 300 }); });
  expect(skia.__skiaDraws.circles).toBe(before);
  await act(async () => { entry.callback({ timeSinceFirstFrame: 1100 }); });
  expect(skia.__skiaDraws.circles).toBeGreaterThan(before);
  // Nach dem Moment: leeres Bild, die Schleife hält an.
  await act(async () => { entry.callback({ timeSinceFirstFrame: 3000 }); });
  await settle();
  const [after] = [...frameCallbacks];
  expect((after as unknown as { handle: { isActive: boolean } }).handle.isActive).toBe(false);
});

test("Aufstiegs-Moment (#1456) mit reduzierter Bewegung: nur Aus- und Einblenden, keine Zeichenfläche", async () => {
  reduceMotion(true);
  frameCallbacks.clear();
  await render(<LoewenRangFrame level={13} size="card" ascent={ascentMoment({ level: 13, previous: 11 }, { reduced: true })} />);
  await settle();
  expect(screen.queryByTestId("loewen-ascent-burst")).toBeNull();
  expect(screen.queryAllByTestId("loewen-rang-pip-pop")).toHaveLength(0);
  expect(screen.getAllByTestId("loewen-rang-pip-on")).toHaveLength(3);
  expect(frameCallbacks.size).toBe(0);
});

test("Profil-Signatur ruht, solange eine Zeremonie oder ein Dialog darüber liegt (#1456)", async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const quiet = require("../seasons/quiet");
  reduceMotion(false);
  frameCallbacks.clear();
  await render(<LoewenRangFrame level={9} size="profile" />);
  await settle();
  const [entry] = [...frameCallbacks] as unknown as Array<{ handle: { isActive: boolean } }>;
  expect(entry.handle.isActive).toBe(true);
  await act(async () => { quiet.setOverlay("achievement-ceremony", true); });
  expect(entry.handle.isActive).toBe(false);
  await act(async () => { quiet.setOverlay("achievement-ceremony", false); });
  expect(entry.handle.isActive).toBe(true);
});
