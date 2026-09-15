import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MoreScreen, socialIcon } from "./MoreScreen";

// "Mehr": Die Vereinskanäle kommen aus den Einstellungen, nicht aus dem Code.
// Der fest eingebaute Discord-Link war falsch (#214).

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
}));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1", username: "tabsi", is_club_member: true } }) }));
jest.mock("../../live", () => ({ isGuestUser: () => false }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const navigate = jest.fn();
const navigation = { navigate } as never;
const route = { key: "more", name: "MoreHub" } as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({
    data: {
      social_links: [
        { platform: "discord", label: "Discord", url: "https://discord.com/invite/thelionsquadesports", enabled: true },
        { platform: "instagram", label: "Instagram", url: "https://instagram.com/thelionsquadesports", enabled: true },
        { platform: "facebook", label: "Facebook", url: "https://facebook.com/x", enabled: false },
      ],
    },
  });
});

test("die Vereinskanäle kommen aus den Einstellungen, abgeschaltete fehlen", async () => {
  const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await render(<MoreScreen navigation={navigation} route={route} />);

  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/settings/public"));
  await waitFor(() => expect(screen.getByLabelText("Discord")).toBeTruthy());
  expect(screen.getByLabelText("Instagram")).toBeTruthy();
  expect(screen.queryByLabelText("Facebook")).toBeNull();

  await fireEvent.press(screen.getByLabelText("Discord"));
  expect(openUrl).toHaveBeenCalledWith("https://discord.com/invite/thelionsquadesports");
});

test("Zeilen statt Karten: jedes Ziel einmal, Mitgliedervorteile nur für Mitglieder", async () => {
  await render(<MoreScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());

  for (const title of ["Nachrichten", "Benachrichtigungen", "Öffentliches Profil", "Jahreswertung", "Spielerprofile", "News", "Mitgliedervorteile", "Sponsoren", "Partner"]) {
    expect(screen.getAllByText(title)).toHaveLength(1);
  }
  expect(screen.queryByText("Bereich öffnen")).toBeNull();
  // Fast Laps haben den Events-Tab und den Schnellzugriff auf der Startseite (#242).
  expect(screen.queryByText("Fast Laps")).toBeNull();

  await fireEvent.press(screen.getByText("Sponsoren"));
  expect(navigate).toHaveBeenCalledWith("InfoCenter", { section: "sponsors" });
});

test("Symbole je Kanal, Unbekanntes als Link", () => {
  expect(socialIcon("discord")).toBe("logo-discord");
  expect(socialIcon("TikTok")).toBe("logo-tiktok");
  expect(socialIcon("kununu")).toBe("link-outline");
});
