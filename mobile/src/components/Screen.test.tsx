import React from "react";
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";

// Unterseiten mit Kopfzeile: die Kopfzeile hält schon Abstand zur Statusleiste - der Screen darunter nicht noch einmal
// (unter Android begann sonst jede Unterseite mit einer leeren Fläche). Screens ohne Kopfzeile (Tabs) behalten ihn.

const mockEdges: unknown[] = [];
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return {
    SafeAreaView: ({ edges, children }: { edges: unknown; children: React.ReactNode }) => {
      mockEdges.push(edges);
      return <View testID="safe-area">{children}</View>;
    },
  };
});
jest.mock("../seasons/SeasonStage", () => ({ SeasonBackdropSlot: () => null }));

const { Screen, UnderHeaderContext, screenEdges } = require("./Screen");

beforeEach(() => {
  mockEdges.length = 0;
});

test("ohne Kopfzeile: Abstand oben, links, rechts - unten nur auf Wunsch", () => {
  expect(screenEdges(false, false)).toEqual(["top", "left", "right"]);
  expect(screenEdges(false, true)).toEqual(["top", "left", "right", "bottom"]);
});

test("unter einer Kopfzeile: kein zweiter Abstand oben", () => {
  expect(screenEdges(true, false)).toEqual(["left", "right"]);
  expect(screenEdges(true, true)).toEqual(["left", "right", "bottom"]);
});

test("der Screen liest, ob er unter einer Kopfzeile liegt", async () => {
  await render(<Screen><Text>Tab</Text></Screen>);
  expect(mockEdges.at(-1)).toEqual(["top", "left", "right"]);
  await render(
    <UnderHeaderContext.Provider value>
      <Screen bottomSafe><Text>Unterseite</Text></Screen>
    </UnderHeaderContext.Provider>,
  );
  expect(mockEdges.at(-1)).toEqual(["left", "right", "bottom"]);
  expect(screen.getByText("Unterseite")).toBeTruthy();
});
