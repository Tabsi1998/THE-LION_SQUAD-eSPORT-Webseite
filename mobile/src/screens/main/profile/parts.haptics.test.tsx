import React from "react";
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { MatrixToggle, Toggle } from "./parts";

// Umschalten (#1677): ein leises Klicken in der Hand. Unter iOS gibt der Schalter selbst schon eins - dort nicht doppelt.

const os = Platform.OS;
afterEach(() => {
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => os });
  jest.clearAllMocks();
});

test.each([["android", 1], ["ios", 0]] as const)("%s: Schalter klicken %i-mal selbst", async (system, count) => {
  Object.defineProperty(Platform, "OS", { configurable: true, get: () => system });
  const change = jest.fn();
  await render(<><Toggle label="Öffentliches Profil" detail="d" value={false} onValueChange={change} testID="t" /><MatrixToggle label="Push" value={false} onValueChange={change} /></>);
  await fireEvent(screen.getByLabelText("Öffentliches Profil"), "valueChange", true);
  expect(change).toHaveBeenCalledWith(true);
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(count);
});
