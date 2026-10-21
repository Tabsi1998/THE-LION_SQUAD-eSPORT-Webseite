import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { GalleryViewerScreen } from "./GalleryViewerScreen";

// Großansicht (#1910): Der Bildrahmen ist so hoch wie der freie Bereich zwischen Kopf und Bildtext. Früher war er so hoch
// wie das ganze Fenster und reichte unter Bildtext und Reiterleiste.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
  resolveMediaUrl: (value: string) => value,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-file-system/legacy", () => ({ cacheDirectory: "file:///cache/", downloadAsync: jest.fn() }));

const navigation = { navigate: jest.fn(), setOptions: jest.fn() } as never;
const route = { key: "viewer", name: "GalleryViewer", params: { albumId: "lan", index: 0 } } as never;
const album = { id: "lan", slug: "lan", title: "LAN", photos: [{ id: "p1", url: "/p1.jpg", media_type: "image", caption: "Siegerehrung" }] };

const layout = (width: number, height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: album });
});

test("Bildrahmen endet über dem Bildtext, nicht am Fensterrand", async () => {
  await render(<GalleryViewerScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("gallery-viewer")).toBeTruthy());
  // Freier Bereich unter dem Kopf und über der Reiterleiste: 360 × 560; Bildtext und Knopf brauchen 120.
  await act(async () => fireEvent(screen.getByTestId("gallery-viewer"), "layout", layout(360, 560)));
  await act(async () => fireEvent(screen.getByTestId("gallery-chrome"), "layout", layout(360, 120)));
  const frame = screen.getByTestId("gallery-slide-p1");
  const style = Object.assign({}, ...[frame.props.style].flat(3).filter(Boolean));
  expect(style.height).toBe(440);
  expect(style.width).toBe(360);
});

test("Ausgeblendeter Bildtext: der Rahmen bleibt stehen, damit Zoom und Lage nicht springen", async () => {
  await render(<GalleryViewerScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("gallery-viewer")).toBeTruthy());
  await act(async () => fireEvent(screen.getByTestId("gallery-viewer"), "layout", layout(360, 560)));
  await act(async () => fireEvent(screen.getByTestId("gallery-chrome"), "layout", layout(360, 120)));
  await act(async () => fireEvent.press(screen.getByLabelText("Siegerehrung")));
  expect(screen.queryByTestId("gallery-chrome")).toBeNull();
  const style = Object.assign({}, ...[screen.getByTestId("gallery-slide-p1").props.style].flat(3).filter(Boolean));
  expect(style.height).toBe(440);
});
