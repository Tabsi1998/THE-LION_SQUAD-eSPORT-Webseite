import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { AchievementGroupCard } from "./AchievementGroupCard";
import type { AchievementGroup } from "../lib/achievements";

// Erfolgsgruppe im Profil (#218, Erfolge II E13 #623): zugeklappt das Abzeichen der höchsten Stufe mit
// Material und der Weg zur nächsten, aufgeklappt jede Stufe mit Abzeichen, Material und Status.

jest.mock("@expo/vector-icons", () => {
  const { Text } = require("react-native");
  return { Ionicons: ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text> };
});

const group: AchievementGroup = {
  code: "wins", name: "Turniersiege", category: "tournament", icon: "trophy", art: "champion", accent_color: "#FFD700",
  description: "Gewinne Turniere.",
  tiers: [
    { code: "t1", name: "Erster Sieg", level: 1, material: "wood", rank: 1, earned: true, points: 50 },
    { code: "t2", name: "Seriensieger", level: 1, material: "iron", rank: 2, earned: false, current: 3, target: 10, percent: 30, points: 150, how_to: "Gewinne zehn Turniere." },
  ],
};

test("zugeklappt: Abzeichen der höchsten Stufe, ihr Material und der Weg zur nächsten", async () => {
  await render(<AchievementGroupCard group={group} open={false} onToggle={() => {}} />);
  expect(screen.getByTestId("achievement-badge-wins").props.accessibilityLabel).toBe("Holz I");
  expect(screen.getByText("Holz")).toBeTruthy();
  expect(screen.getByText("3 von 10 · nächste Stufe: Seriensieger")).toBeTruthy();
  expect(screen.queryByText("Erster Sieg")).toBeNull();
  expect(screen.getByTestId("achievement-group-wins").props.accessibilityLabel).toBe("Turniersiege, 3 von 10, Stufe Holz");
});

test("aufgeklappt: jede Stufe mit Abzeichen, Material, Status, „So schaffst du es“, Fortschritt und Punkten", async () => {
  const onToggle = jest.fn();
  await render(<AchievementGroupCard group={group} open onToggle={onToggle} />);
  expect(screen.getByText("Holz · Freigeschaltet")).toBeTruthy();
  expect(screen.getByText("Eisen · Gesperrt")).toBeTruthy();
  expect(screen.getByText("So schaffst du es: Gewinne zehn Turniere.")).toBeTruthy();
  expect(screen.getByText("3 von 10")).toBeTruthy();
  expect(screen.getByText("+150")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("achievement-group-wins"));
  expect(onToggle).toHaveBeenCalledTimes(1);
});

test("alte Stufen ohne Material zeigen den Namen zum Level", async () => {
  const legacy = { ...group, tiers: [{ code: "t1", name: "Erster Sieg", level: 1, earned: true, points: 50 }, { code: "t2", name: "Seriensieger", level: 2, earned: false, current: 3, target: 10, percent: 30 }] };
  await render(<AchievementGroupCard group={legacy} open onToggle={() => {}} />);
  expect(screen.getByText("Bronze · Freigeschaltet")).toBeTruthy();
  expect(screen.getByText("Silber · Gesperrt")).toBeTruthy();
});

test("noch nichts erreicht: Silhouette der nächsten Stufe mit Ring, kein Material genannt", async () => {
  await render(<AchievementGroupCard group={{ ...group, tiers: [{ code: "t2", name: "Seriensieger", material: "iron", rank: 2, earned: false, current: 2, target: 10, percent: 20 }] }} open={false} onToggle={() => {}} />);
  expect(screen.getByTestId("achievement-badge-wins").props.accessibilityLabel).toBe("Eisen II, noch nicht erreicht");
  expect(screen.queryByText("Eisen")).toBeNull();
  expect(screen.getByText("2 von 10 · nächste Stufe: Seriensieger")).toBeTruthy();
});
