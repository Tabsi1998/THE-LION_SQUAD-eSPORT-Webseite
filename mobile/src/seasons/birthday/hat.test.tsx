import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";

// Die Geburtstagsmütze in der App (#856): die Zahl der Jahre vorne, ab drei Ziffern ein Stern; im Kopf antippbar
// (wippen, Tippen, Konfetti - höchstens alle zehn Sekunden), bei „dezent“ und „Bewegung reduzieren“ nur ein Bild.

const mockSeasonState: Record<string, unknown> = { reducedMotion: false };
jest.mock("../SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
jest.mock("../../components/BrandLogo", () => ({ BrandLogo: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }) }));

const { BirthdayHatArt, BirthdayHatTabIcon, BirthdayHatWidget, HAT_COOLDOWN_MS, hatNumber } = require("./hat");

function birthday(overrides: Record<string, unknown> = {}) {
  return { key: "club_birthday", label: "Vereinsgeburtstag", phase: "feier", intensity: "normal", effective: "normal", channels: ["web", "app"], texts: {}, data: { years: 8 }, starts_at: "2027-03-01T00:00:00+01:00", ends_at: "2027-03-01T23:59:59+01:00", forced: false, ...overrides };
}

beforeEach(() => {
  mockSeasonState.reducedMotion = false;
  (Haptics.impactAsync as jest.Mock).mockClear();
});

test("die Zahl auf der Mütze: bis zwei Ziffern, sonst ein Stern (wie im Web)", async () => {
  expect(hatNumber(8)).toBe("8");
  expect(hatNumber(12)).toBe("12");
  expect(hatNumber(105)).toBe("");
  expect(hatNumber(null)).toBe("");
  await render(<BirthdayHatArt years={8} />);
  expect(screen.getByTestId("birthday-hat-number", { includeHiddenElements: true })).toBeTruthy();
  await render(<BirthdayHatArt years={null} />);
  expect(screen.queryByTestId("birthday-hat-number", { includeHiddenElements: true })).toBeNull();
});

test("im Kopf: antippen wippt und tippt - aber höchstens alle zehn Sekunden", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2027, 2, 1, 11, 0));
  await render(<BirthdayHatWidget season={birthday()} screen="Dashboard" />);
  const button = screen.getByTestId("birthday-hat-widget");
  expect(button.props.accessibilityLabel).toBe("Geburtstagsmütze – Konfetti werfen");
  await act(async () => {
    fireEvent.press(button);
  });
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  await act(async () => {
    fireEvent.press(button);
  });
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  jest.setSystemTime(new Date(Date.now() + HAT_COOLDOWN_MS + 10));
  await act(async () => {
    fireEvent.press(button);
  });
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(2);
  jest.useRealTimers();
});

test("„dezent“ und „Bewegung reduzieren“: nur ein Bild, kein Knopf; das Tab-Symbol ist die Mütze", async () => {
  const view = await render(<BirthdayHatWidget season={birthday({ effective: "subtle" })} screen="Dashboard" />);
  expect(screen.getByTestId("birthday-hat-widget", { includeHiddenElements: true }).props.accessibilityRole).toBeUndefined();
  await view.unmount();
  mockSeasonState.reducedMotion = true;
  await render(<BirthdayHatWidget season={birthday()} screen="Dashboard" />);
  expect(screen.getByTestId("birthday-hat-widget", { includeHiddenElements: true }).props.accessibilityRole).toBeUndefined();
  await render(<BirthdayHatTabIcon size={24} />);
  expect(screen.getByTestId("birthday-tab-hat", { includeHiddenElements: true })).toBeTruthy();
});
