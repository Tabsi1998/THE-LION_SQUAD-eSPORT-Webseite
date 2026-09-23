import React from "react";
import { PixelRatio, Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { MediaImage, widthForLayout } from "./MediaImage";

// Bilder in passender Breite (#219): die Hülle misst sich, lädt die kleinste Fassung, die die
// Fläche in Gerätepixeln füllt, und lässt fremde oder schon bemessene Adressen in Ruhe.

jest.mock("../lib/api", () => ({
  resolveMediaUrl: (url?: string | null) => (!url ? "" : /^https?:/.test(url) ? url : `https://app.example${url}`),
}));

async function layout(width: number) {
  await fireEvent(screen.getByTestId("media-image-shell"), "layout", { nativeEvent: { layout: { width, height: 100, x: 0, y: 0 } } });
}

beforeEach(() => {
  jest.spyOn(PixelRatio, "get").mockReturnValue(2);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("die kleinste Fassung, die die Fläche in Gerätepixeln füllt", () => {
  expect(widthForLayout(100, 3)).toBe(400);
  expect(widthForLayout(200, 2)).toBe(400);
  expect(widthForLayout(300, 2)).toBe(800);
  expect(widthForLayout(400, 3)).toBe(1600);
});

test("vor dem Messen der Rückfall, danach die Fassung zur Breite", async () => {
  await render(<MediaImage uri="/api/static/uploads/foto.webp" fallback={<Text>Rückfall</Text>} />);
  expect(screen.getByText("Rückfall")).toBeTruthy();
  expect(screen.queryByTestId("media-image")).toBeNull();

  await layout(300);
  expect(screen.getByTestId("media-image").props.source).toEqual({ uri: "https://app.example/api/static/uploads/foto.webp?w=800" });

  // Ein späteres Umbrechen lädt nicht neu.
  await layout(600);
  expect(screen.getByTestId("media-image").props.source.uri).toMatch(/w=800$/);
});

test("mit fester Breite sofort, fremde und schon bemessene Adressen unverändert", async () => {
  await render(<MediaImage uri="/api/static/uploads/foto.jpg" width={400} />);
  expect(screen.getByTestId("media-image").props.source.uri).toMatch(/foto\.jpg\?w=400$/);

  await render(<MediaImage uri="https://cdn.example/bild.png" width={400} />);
  expect(screen.getByTestId("media-image").props.source).toEqual({ uri: "https://cdn.example/bild.png" });

  await render(<MediaImage uri="/api/static/uploads/foto.webp?w=400" width={1600} />);
  expect(screen.getByTestId("media-image").props.source.uri).toMatch(/foto\.webp\?w=400$/);
});

test("lädt das Bild nicht, steht der Rückfall da", async () => {
  await render(<MediaImage uri="/api/static/uploads/weg.webp" width={800} fallback={<Text>Kein Bild</Text>} />);
  await fireEvent(screen.getByTestId("media-image"), "error");
  expect(screen.getByText("Kein Bild")).toBeTruthy();
});
