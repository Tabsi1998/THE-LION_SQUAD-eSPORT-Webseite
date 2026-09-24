import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccountsCard, LinkedAccountsCard, PlatformLinkRows, accountDetail, accountGroups, accountTitle, isVerified, linkButtonLabel, platformColor } from "./LinkedAccounts";

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


// Konten einmal sauber (#527): verknüpft schlägt getippt, Socials und Spielkonten getrennt, Haken nur bei bestätigten.
test("accountGroups und AccountsCard: jedes Konto genau einmal, gruppiert, mit Haken", async () => {
  const groups = accountGroups({
    discord_name: "paula#0001", youtube_handle: "@paula", psn_id: "paula_psn", steam_id: "76561198000000001",
    verified_platforms: ["discord", "steam"],
    linked_accounts: [
      { platform: "discord", handle: "paula", display_name: "Paula B.", linked_at: "2026-09-22T20:00:00Z", url: "https://discord.com/users/123" },
      { platform: "steam", handle: "76561198000000001", display_name: "76561198000000001", linked_at: "2026-09-23T20:00:00Z", url: "https://steamcommunity.com/profiles/76561198000000001" },
    ],
    socials: [{ platform: "Discord", value: "paula#0001" }],
  });
  expect(groups.socials.map((entry) => entry.platform)).toEqual(["discord", "youtube"]);
  expect(groups.games.map((entry) => entry.platform)).toEqual(["steam", "psn"]);
  expect(groups.socials[0]).toMatchObject({ title: "Paula B.", verified: true });
  expect(groups.games[0]).toMatchObject({ title: "Steam-Profil", verified: true });
  expect(groups.games[1]).toMatchObject({ title: "paula_psn", label: "PlayStation", url: "", verified: false });
  expect(groups.verifiedCount).toBe(2);

  await render(<AccountsCard groups={groups} />);
  expect(screen.getByTestId("public-profile-accounts")).toBeTruthy();
  expect(screen.getByTestId("profile-account-discord-verified")).toBeTruthy();
  expect(screen.queryByTestId("profile-account-psn-verified")).toBeNull();
  expect(screen.getByText("Spielkonten")).toBeTruthy();
  expect(screen.getAllByText("Paula B.").length).toBe(1);
});


// Konten verknüpfen (#521): verknüpft → Name, Haken, „lösen“; eingerichtet → offizieller Knopf; sonst nur der Hinweis.
test("PlatformLinkRows: Knopf nur, wo die Website eingerichtet ist; verknüpft nur lösen", async () => {
  const onLink = jest.fn();
  const onUnlink = jest.fn();
  await render(<PlatformLinkRows
    links={[{ platform: "discord", handle: "paula", display_name: "Paula B.", linked_at: "2026-09-22T20:00:00Z", url: "https://discord.com/users/123" }]}
    available={{ discord: true, twitch: true, riot: false }}
    onLink={onLink}
    onUnlink={onUnlink}
  />);
  expect(screen.getByTestId("profile-link-discord-verified")).toBeTruthy();
  expect(screen.queryByTestId("profile-link-discord-link")).toBeNull();
  await fireEvent.press(screen.getByTestId("profile-link-discord-unlink"));
  expect(onUnlink).toHaveBeenCalledWith("discord");
  await fireEvent.press(screen.getByTestId("profile-link-twitch-link"));
  expect(onLink).toHaveBeenCalledWith("twitch");
  expect(screen.getByText("Mit Twitch verknüpfen")).toBeTruthy();
  expect(screen.queryByTestId("profile-link-riot-link")).toBeNull();
  expect(screen.getAllByText("auf der Website noch nicht eingerichtet").length).toBeGreaterThan(0);
  expect(linkButtonLabel("steam")).toBe("Mit Steam anmelden");
});
