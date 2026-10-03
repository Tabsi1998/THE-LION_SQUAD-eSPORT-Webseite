import React from "react";
import { render, screen, within } from "@testing-library/react-native";
import { AchievementUnlockModal, hapticKind, topTier, unlockLook } from "./AchievementUnlock";

// Freischalt-Fenster (Erfolge II E13, #623): das höchste Material trägt das Fenster als großes Abzeichen,
// jede Stufe steht mit ihrem Abzeichen und Material darunter; Haptik je Material.

jest.mock("@expo/vector-icons", () => {
  const { Text } = require("react-native");
  return { Ionicons: ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text> };
});

const tiers = [
  { code: "a", name: "Spielmacher I", material: "wood", rank: 1, points: 5, art: "crossed-swords", group_name: "Spielmacher" },
  { code: "b", name: "Saison-MVP I", material: "legendary", rank: 8, points: 250, group_art: "mvp", group_name: "Saison-MVP" },
];

test("das höchste Material trägt das Fenster, jede Stufe mit Material und Gruppe", async () => {
  await render(<AchievementUnlockModal tiers={tiers} onClose={() => {}} />);
  const hero = within(screen.getByTestId("achievement-unlock-badge"));
  expect(hero.getByLabelText("Legendär")).toBeTruthy();
  expect(screen.getByText("Legendär freigeschaltet")).toBeTruthy();
  expect(screen.getByText("2 neue Achievements!")).toBeTruthy();
  expect(within(screen.getByTestId("unlock-tier-a")).getByText("Holz · Spielmacher")).toBeTruthy();
  expect(within(screen.getByTestId("unlock-tier-a")).getByLabelText("Holz I")).toBeTruthy();
  expect(screen.getByText("+255 Punkte insgesamt")).toBeTruthy();
});

test("alte Meldungen ohne Material: das Level entscheidet", () => {
  expect(unlockLook({ level: 3 }).key).toBe("gold");
  expect(topTier([{ level: 1 }, { level: 4 }, { level: 2 }])?.level).toBe(4);
  expect(topTier([])).toBeNull();
});

test("Haptik: leicht bis schwer nach Material, Legendär als Muster", () => {
  expect(hapticKind(unlockLook({ material: "wood" }))).toBe("light");
  expect(hapticKind(unlockLook({ material: "bronze" }))).toBe("light");
  expect(hapticKind(unlockLook({ material: "gold" }))).toBe("medium");
  expect(hapticKind(unlockLook({ material: "diamond" }))).toBe("heavy");
  expect(hapticKind(unlockLook({ material: "legendary" }))).toBe("pattern");
  expect(hapticKind(unlockLook({ material: "hidden" }))).toBe("medium");
});
