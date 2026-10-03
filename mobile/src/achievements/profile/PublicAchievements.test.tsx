import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { PinnedAwardsCard, PublicAchievementsTab } from "./PublicAchievements";

// Erfolge einer anderen Person in der App (E13, #623) - wie im öffentlichen Profil im Web (#619): Angeheftete in der
// Reihenfolge der Person, privat heißt nur der Hinweis, sonst Kategorien mit Erreichtem, gefundene Geheime und nur
// erreichte Stufen.

jest.mock("@expo/vector-icons", () => {
  const { Text } = require("react-native");
  return { Ionicons: ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text> };
});

const tier = (code: string, rank: number, name: string, extra: Record<string, unknown> = {}) => ({ code, rank, level: 1, name, points: 5, material: "wood", material_name: "Holz", earned: false, ...extra });
const GROUPS = [
  { code: "matches_played", name: "Spielmacher", category: "match", icon: "swords", tiers: [tier("matches_played_1", 1, "Spielmacher I", { earned: true }), tier("matches_played_2", 2, "Spielmacher II", { material: "iron", material_name: "Eisen" })] },
  { code: "lap_hunter", name: "Rundenjäger", category: "fastlap", icon: "flag", tiers: [tier("lap_hunter_1", 1, "Rundenjäger I")] },
  { code: "oops", name: "Hoppla", category: "negative", is_negative: true, tiers: [tier("oops_1", 1, "Hoppla I", { earned: true })] },
];
const PINNED = [
  { code: "matches_played_1", name: "Spielmacher I", group_name: "Spielmacher", material: "wood", material_name: "Holz", rank: 1, level: 1 },
  { code: "konami_1", name: "Konami I", group_name: "Konami", material: "hidden", material_name: "Geheim", rank: 1, level: 1 },
];

test("Angeheftete in der Reihenfolge der Person - „Alle ansehen“ führt in den Reiter", async () => {
  const onShowAll = jest.fn();
  await render(<PinnedAwardsCard pinned={PINNED} onShowAll={onShowAll} />);
  const rows = screen.getAllByTestId(/^profile-pinned-(?!awards|all)/).map((node) => node.props.testID);
  expect(rows).toEqual(["profile-pinned-matches_played_1", "profile-pinned-konami_1"]);
  expect(screen.getByTestId("profile-pinned-konami_1")).toHaveTextContent("Geheim", { exact: false });
  await fireEvent.press(screen.getByTestId("profile-pinned-all"));
  expect(onShowAll).toHaveBeenCalledTimes(1);
});

test("ohne Angeheftete gibt es keine Karte", async () => {
  await render(<PinnedAwardsCard pinned={[]} />);
  expect(screen.queryByTestId("profile-pinned-awards")).toBeNull();
});

test("privat: nur der Hinweis, keine Gruppen", async () => {
  await render(<PublicAchievementsTab data={{ achievements_hidden: true, groups: GROUPS }} displayName="Ben" />);
  expect(screen.getByTestId("profile-achievements-private")).toHaveTextContent("Erfolge sind privat", { exact: false });
  expect(screen.getByTestId("profile-achievements-private")).toHaveTextContent("Ben zeigt Erfolge nicht öffentlich.", { exact: false });
  expect(screen.queryByTestId("achievement-group-matches_played")).toBeNull();
});

test("öffentlich: Kategorien mit Erreichtem, gefundene Geheime und nur erreichte Stufen", async () => {
  await render(<PublicAchievementsTab data={{ groups: GROUPS, hidden: { total: 13, earned: 2 } }} displayName="Ben" />);
  expect(screen.getByTestId("profile-category-bar-match")).toHaveTextContent("1 von 2", { exact: false });
  expect(screen.queryByTestId("profile-category-bar-fastlap")).toBeNull();
  expect(screen.getByTestId("profile-hidden-found")).toHaveTextContent("2 geheime Erfolge gefunden", { exact: false });
  expect(await screen.findByTestId("achievement-group-matches_played")).toBeTruthy();
  // Fremdes Profil: Stand der Stufen, keine Fortschrittszahlen zur nächsten.
  expect(screen.getByText("1 von 2 Stufen")).toBeTruthy();
  expect(screen.queryByTestId("achievement-group-lap_hunter")).toBeNull();
  expect(await screen.findByTestId("achievement-group-oops")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("achievement-group-matches_played"));
  expect(screen.getByTestId("achievement-tier-matches_played_1")).toBeTruthy();
  expect(screen.queryByTestId("achievement-tier-matches_played_2")).toBeNull();
});

test("noch nichts erreicht: der leere Hinweis", async () => {
  await render(<PublicAchievementsTab data={{ groups: [GROUPS[1]] }} displayName="Ben" />);
  expect(screen.getByText("Noch keine Erfolge")).toBeTruthy();
});
