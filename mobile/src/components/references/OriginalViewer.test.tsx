import React from "react";
import { AccessibilityInfo, Linking } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { OriginalsButton } from "./OriginalViewer";

// „Original ansehen“ (#1933): Knopf nur mit Bildern, Vollbild mit Bild, Art, Zähler, Blättern (Pfeile, Vorschau),
// Vorleser-Ansage, Quellen-Link nur als https, Schließen. Bilder kommen nur von der eigenen öffentlichen Adresse.

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../lib/api", () => ({ resolveMediaUrl: (url: string) => (url ? `https://server.test${url}` : "") }));

const base = "/api/reference-series/public/prl/2026/originals";
const ITEMS = [
  { id: "o1", kind: "qualifying", url: `${base}/o1`, width: 2400, height: 1350, source_url: "https://veranstalter.example/quali", label: "Qualifying" },
  { id: "o2", kind: "race", url: `${base}/o2`, width: 1200, height: 800, source_url: "http://veranstalter.example/rennen", label: "Sprint · Rennen" },
  { id: "o3", kind: "scoreboard", map: 2, url: `${base}/o3`, width: 1200, height: 800, source_url: null, label: "Scoreboard · Map 2" },
];

// Das Bild im Vollbild (ZoomableImage) - gefunden an seiner Beschriftung für den Vorleser.
function slideImage(label: string) {
  return screen.getByLabelText(`Original des Veranstalters: ${label}`, { includeHiddenElements: true });
}

async function layoutStage() {
  await fireEvent(screen.getByTestId("original-viewer-stage"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 600 } } });
}

afterEach(() => jest.restoreAllMocks());

test("ohne Bilder (alter Server) kein Knopf", async () => {
  await render(<OriginalsButton items={[]} />);
  expect(screen.queryByTestId("originals-open")).toBeNull();
  await render(<OriginalsButton items={undefined} />);
  expect(screen.queryByTestId("originals-open")).toBeNull();
});

test("öffnet das Vollbild: Bild, Art, Zähler, Blättern, Vorleser, Quelle nur https, Schließen", async () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
  await render(<OriginalsButton items={ITEMS} title="R3 · Baku" />);
  const button = screen.getByTestId("originals-open");
  expect(button.props.accessibilityLabel).toBe("Original ansehen, 3 Bilder");
  expect(screen.getByText("Original ansehen (3)")).toBeTruthy();

  await fireEvent.press(button);
  expect(screen.getByTestId("original-viewer")).toBeTruthy();
  await layoutStage();
  expect(screen.getByText("R3 · Baku")).toBeTruthy();
  expect(screen.getByTestId("original-viewer-label")).toHaveTextContent("Qualifying");
  expect(screen.getByTestId("original-viewer-count")).toHaveTextContent("1 / 3");
  expect(announce).toHaveBeenLastCalledWith("Bild 1 von 3: Qualifying");
  // Großes Bild: das Vorschaubild mit 1600 Pixeln, vom eigenen Server.
  const image = slideImage("Qualifying");
  expect(image.props.source).toEqual({ uri: `https://server.test${base}/o1?w=1600` });

  // Quelle als https: öffnet im Browser.
  await fireEvent.press(screen.getByTestId("original-viewer-source"));
  expect(open).toHaveBeenCalledWith("https://veranstalter.example/quali");

  // Weiter: zweites Bild - seine Quelle ist nur http, also kein Link.
  await fireEvent.press(screen.getByTestId("original-viewer-next"));
  expect(screen.getByTestId("original-viewer-label")).toHaveTextContent("Sprint · Rennen");
  expect(screen.getByTestId("original-viewer-count")).toHaveTextContent("2 / 3");
  expect(announce).toHaveBeenLastCalledWith("Bild 2 von 3: Sprint · Rennen");
  expect(screen.queryByTestId("original-viewer-source")).toBeNull();
  expect(slideImage("Sprint · Rennen").props.source).toEqual({ uri: `https://server.test${base}/o2` });

  // Zurück vom ersten springt ans Ende; die Vorschau springt direkt.
  await fireEvent.press(screen.getByTestId("original-viewer-thumb-0"));
  expect(screen.getByTestId("original-viewer-count")).toHaveTextContent("1 / 3");
  expect(screen.getByTestId("original-viewer-thumb-0").props.accessibilityState).toEqual({ selected: true });
  await fireEvent.press(screen.getByTestId("original-viewer-prev"));
  expect(screen.getByTestId("original-viewer-label")).toHaveTextContent("Scoreboard · Map 2");
  expect(screen.getByTestId("original-viewer-thumb-2").props.accessibilityLabel).toBe("Bild 3: Scoreboard · Map 2");

  await fireEvent.press(screen.getByTestId("original-viewer-close"));
  expect(screen.queryByTestId("original-viewer")).toBeNull();
  expect(screen.getByTestId("originals-open")).toBeTruthy();
});

test("ein Bild: ohne Zähler, Pfeile und Vorschauleiste", async () => {
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
  await render(<OriginalsButton items={[ITEMS[2]]} />);
  expect(screen.getByTestId("originals-open").props.accessibilityLabel).toBe("Original ansehen");
  await fireEvent.press(screen.getByTestId("originals-open"));
  await layoutStage();
  expect(screen.getByTestId("original-viewer-label")).toHaveTextContent("Scoreboard · Map 2");
  expect(screen.queryByTestId("original-viewer-count")).toBeNull();
  expect(screen.queryByTestId("original-viewer-next")).toBeNull();
  expect(screen.queryByTestId("original-viewer-thumbs")).toBeNull();
});
