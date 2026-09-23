import React from "react";
import { Text } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { AwardCard } from "./AwardCard";
import type { Award } from "../lib/awards";

// Auszeichnung als Karte (#230): Platz mit Farbe, Turnier, Zeilen, Bilanz; Bild dahinter; Tippen öffnet.

jest.mock("../lib/api", () => ({ resolveMediaUrl: (url?: string | null) => (url ? `https://app.example${url}` : "") }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const cup: Award = { id: "a1", kind: "trophy", rank: 1, rank_label: "1. Platz", participants: 12, record: "4 Siege · 0 Niederlagen", tournament: { id: "t1", title: "Herbst-Cup" }, game: { name: "FIFA 26" }, season: { name: "Saison 2026" }, image_url: "/api/static/uploads/gold.png", date: "2026-10-02T17:00:00+02:00" };

test("Trophäe mit Gold, Bilanz, Zeilen und Bild; Tippen öffnet, die Aktion steht daneben", async () => {
  const onPress = jest.fn();
  await render(<AwardCard award={cup} onPress={onPress} action={<Text>Als Profilbanner</Text>} />);
  expect(screen.getByTestId("award-rank-a1")).toHaveTextContent("1. Platz");
  expect(screen.getByText("Gold")).toBeTruthy();
  expect(screen.getByText("Herbst-Cup")).toBeTruthy();
  expect(screen.getByText("FIFA 26 · 2.10.2026 · 12 Teilnehmer · Saison 2026")).toBeTruthy();
  expect(screen.getByTestId("award-record-a1")).toHaveTextContent("4 Siege · 0 Niederlagen");
  expect(screen.getByText("Als Profilbanner")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("award-a1"));
  expect(onPress).toHaveBeenCalled();
});

test("Teilnahme-Banner mit Team, ohne Farbe und ohne Bilanz", async () => {
  await render(<AwardCard award={{ ...cup, id: "a2", kind: "banner", rank: null, rank_label: "Teilnahme", record: "", image_url: null, team: { name: "Team Lions" } }} />);
  expect(screen.getByTestId("award-rank-a2")).toHaveTextContent("Teilnahme");
  expect(screen.queryByText("Gold")).toBeNull();
  expect(screen.getByText("Team Lions")).toBeTruthy();
  expect(screen.queryByTestId("award-record-a2")).toBeNull();
});
