import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { AchievementGroupCard } from "./AchievementGroupCard";
import type { AchievementGroup } from "../lib/achievements";

// Erfolgsgruppe im Profil (#218): zugeklappt sieht man Stufe und Fortschritt, aufgeklappt jede Stufe.

jest.mock("@expo/vector-icons", () => {
  const { Text } = require("react-native");
  return { Ionicons: ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text> };
});

const group: AchievementGroup = {
  code: "wins", name: "Turniersiege", category: "tournament", icon: "trophy", accent_color: "#FFD700",
  description: "Gewinne Turniere.",
  tiers: [
    { code: "t1", name: "Erster Sieg", level: 1, earned: true, points: 50 },
    { code: "t2", name: "Seriensieger", level: 2, earned: false, current: 3, target: 10, percent: 30, points: 150 },
  ],
};

test("zugeklappt: Symbol, erreichte Stufe und der Weg zur nächsten", async () => {
  await render(<AchievementGroupCard group={group} open={false} onToggle={() => {}} />);
  expect(screen.getByText("icon:trophy")).toBeTruthy();
  expect(screen.getByText("Bronze")).toBeTruthy();
  expect(screen.getByText("3 von 10 · nächste Stufe: Seriensieger")).toBeTruthy();
  expect(screen.queryByText("Erster Sieg")).toBeNull();
  expect(screen.getByTestId("achievement-group-wins").props.accessibilityLabel).toBe("Turniersiege, 3 von 10, Stufe Bronze");
});

test("aufgeklappt: jede Stufe mit Status, Fortschritt und Punkten; Antippen meldet sich", async () => {
  const onToggle = jest.fn();
  await render(<AchievementGroupCard group={group} open onToggle={onToggle} />);
  expect(screen.getByText("Bronze · Freigeschaltet")).toBeTruthy();
  expect(screen.getByText("Silber · Gesperrt")).toBeTruthy();
  expect(screen.getByText("3 von 10")).toBeTruthy();
  expect(screen.getByText("+150")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("achievement-group-wins"));
  expect(onToggle).toHaveBeenCalledTimes(1);
});

test("noch nichts erreicht: graues Symbol, keine Stufe", async () => {
  await render(<AchievementGroupCard group={{ ...group, tiers: [{ code: "t2", name: "Seriensieger", level: 2, earned: false, current: 0, target: 10, percent: 0 }] }} open={false} onToggle={() => {}} />);
  expect(screen.queryByText("Bronze")).toBeNull();
  expect(screen.getByText("0 von 10 · nächste Stufe: Seriensieger")).toBeTruthy();
});
