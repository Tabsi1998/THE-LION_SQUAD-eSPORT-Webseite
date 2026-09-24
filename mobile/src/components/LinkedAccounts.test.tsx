import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { LinkedAccountsCard, accountDetail, accountTitle, isVerified, platformColor } from "./LinkedAccounts";

// Verknüpfte Konten (#459, wie im Web): Anzeigename, Plattform, Kennung, „seit …“ und der Link zum
// echten Konto; eine Steam-ID als Name wird zu „Steam-Profil“; das Häkchen kommt nur vom Server.

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

test("Karte: Name, Plattform, seit, Link; Steam-ID wird zu „Steam-Profil“", async () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await render(<LinkedAccountsCard accounts={[
    { platform: "discord", label: "Discord", handle: "paula", display_name: "Paula B.", linked_at: "2026-09-22T20:00:00Z", url: "https://discord.com/users/123" },
    { platform: "steam", label: "Steam", handle: "76561198000000001", display_name: "76561198000000001", linked_at: "2026-09-23T20:00:00Z", url: "https://steamcommunity.com/profiles/76561198000000001" },
  ]} />);
  expect(screen.getByTestId("linked-accounts")).toBeTruthy();
  expect(screen.getByText("Paula B.")).toBeTruthy();
  expect(screen.getByText(/^Discord · paula · seit /)).toBeTruthy();
  expect(screen.getByText("Steam-Profil")).toBeTruthy();
  expect(screen.getByText(/^Steam · 76561198000000001 · seit /)).toBeTruthy();
  fireEvent.press(screen.getByTestId("linked-account-discord"));
  expect(open).toHaveBeenCalledWith("https://discord.com/users/123");
  open.mockRestore();
});

test("Helfer: Farbe je Plattform, verifiziert nur aus der Serverliste, ohne Konten keine Karte", async () => {
  expect(platformColor("twitch")).toBe("#9146FF");
  expect(platformColor("unbekannt")).toBe("#29B6E8");
  expect(isVerified(["twitch"], "Twitch")).toBe(true);
  expect(isVerified(null, "twitch")).toBe(false);
  expect(accountTitle({ platform: "twitch", display_name: "", handle: "paula_racing" })).toBe("paula_racing");
  expect(accountDetail({ platform: "twitch", handle: "paula_racing", display_name: "paula_racing" })).toBe("Twitch");
  await render(<LinkedAccountsCard accounts={[]} />);
  expect(screen.queryByTestId("linked-accounts")).toBeNull();
});
