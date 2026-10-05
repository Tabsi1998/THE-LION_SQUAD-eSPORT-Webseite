import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { MoreScreen, moreGroups, socialIcon } from "./MoreScreen";

// "Mehr": Die Vereinskanäle kommen aus den Einstellungen, nicht aus dem Code.
// Der fest eingebaute Discord-Link war falsch (#214).

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args) },
}));
const mockUser = { id: "u-1", username: "tabsi", is_club_member: true };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
const mockGuest = { value: false };
jest.mock("../../live", () => ({ isGuestUser: () => mockGuest.value }));
const mockOpenSignIn = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({ openSignIn: (...args: unknown[]) => mockOpenSignIn(...args) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
const mockOpenWhatsNew = jest.fn();
jest.mock("../../update/AppUpdateProvider", () => ({ useAppUpdate: () => ({ openWhatsNew: mockOpenWhatsNew, info: null, check: jest.fn() }) }));

// Adventkalender (#641): die Zeile steht nur da, solange der Kalender läuft.
const mockAdvent: { value: { door: number } | null } = { value: null };
jest.mock("../../advent/entry", () => ({ useAdventEntry: () => mockAdvent.value }));

const navigate = jest.fn();
const navigation = { navigate } as never;
const route = { key: "more", name: "MoreHub" } as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockAdvent.value = null;
  mockGuest.value = false;
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

test("Zeilen statt Karten: jedes Ziel einmal; Mitglieder sehen die goldene Karte zum Mitgliederbereich", async () => {
  await render(<MoreScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());

  for (const title of ["Nachrichten", "Benachrichtigungen", "Meine Mitgliedschaft", "Meine Rechnungen", "Öffentliches Profil", "Jahreswertung", "Achievements", "Spielerprofile", "News", "Sponsoren", "Partner"]) {
    expect(screen.getAllByText(title)).toHaveLength(1);
  }
  // Dieselbe Reihenfolge wie im Web-Benutzermenü (#516): Mitgliedschaft vor den Rechnungen.
  await fireEvent.press(screen.getByText("Meine Mitgliedschaft"));
  expect(navigate).toHaveBeenCalledWith("MyMembership");
  // Mitgliedervorteile liegen im Mitgliederbereich (#340).
  expect(screen.queryByText("Mitgliedervorteile")).toBeNull();
  await fireEvent.press(screen.getByTestId("more-member-area"));
  expect(navigate).toHaveBeenCalledWith("MemberArea");
  expect(screen.queryByTestId("more-join")).toBeNull();
  expect(screen.queryByText("Bereich öffnen")).toBeNull();
  // Fast Laps haben den Events-Tab und den Schnellzugriff auf der Startseite (#242).
  expect(screen.queryByText("Fast Laps")).toBeNull();

  await fireEvent.press(screen.getByText("Sponsoren"));
  expect(navigate).toHaveBeenCalledWith("InfoCenter", { section: "sponsors" });
});

test("wer kein Mitglied ist, sieht „Mitglied werden“ mit Link zur Beitrittsseite", async () => {
  mockUser.is_club_member = false;
  const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  try {
    await render(<MoreScreen navigation={navigation} route={route} />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByTestId("more-member-area")).toBeNull();
    await fireEvent.press(screen.getByTestId("more-join"));
    expect(openUrl).toHaveBeenCalledWith(expect.stringMatching(/\/membership\/join$/));
  } finally {
    mockUser.is_club_member = true;
  }
});

test("Adventkalender: die Zeile steht nur da, solange der Kalender läuft - als erste unter „Verein“", async () => {
  const first = await render(<MoreScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  expect(screen.queryByText("Adventkalender")).toBeNull();
  expect(screen.queryByTestId("more-advent")).toBeNull();
  await first.unmount();

  mockAdvent.value = { door: 12 };
  await render(<MoreScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("more-advent")).toBeTruthy());
  expect(screen.getAllByText("Adventkalender")).toHaveLength(1);
  await fireEvent.press(screen.getByTestId("more-advent"));
  expect(navigate).toHaveBeenCalledWith("AdventCalendar");

  const titles = (advent: boolean) => moreGroups(advent).map((group) => [group.title, group.entries.map((entry) => entry.title)]);
  expect(titles(true)).toEqual([["Gaming", ["Jahreswertung", "Achievements", "Spielerprofile"]], ["Verein", ["Adventkalender", "News", "Galerie", "Referenzen", "Sponsoren", "Partner"]]]);
  expect(titles(false)).toEqual([["Gaming", ["Jahreswertung", "Achievements", "Spielerprofile"]], ["Verein", ["News", "Galerie", "Referenzen", "Sponsoren", "Partner"]]]);
});

// Gast zuerst (#918): wo sonst der Mitgliederbereich steht, geht es zum Anmelden; „Konto“ gibt es erst mit Konto.
test("als Gast: oben „Anmelden oder registrieren“, kein Konto-Block - alles Öffentliche bleibt", async () => {
  mockGuest.value = true;
  await render(<MoreScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());

  expect(screen.getByText("Anmelden oder registrieren")).toBeTruthy();
  expect(screen.queryByTestId("more-member-area")).toBeNull();
  expect(screen.queryByTestId("more-join")).toBeNull();
  for (const title of ["Konto", "Nachrichten", "Benachrichtigungen", "Meine Rechnungen", "Öffentliches Profil"]) {
    expect(screen.queryByText(title)).toBeNull();
  }
  for (const title of ["Jahreswertung", "Achievements", "News", "Galerie", "Sponsoren"]) {
    expect(screen.getAllByText(title)).toHaveLength(1);
  }
  await fireEvent.press(screen.getByTestId("more-sign-in"));
  expect(mockOpenSignIn).toHaveBeenCalledTimes(1);
});

test("Symbole je Kanal, Unbekanntes als Link", () => {
  expect(socialIcon("discord")).toBe("logo-discord");
  expect(socialIcon("TikTok")).toBe("logo-tiktok");
  expect(socialIcon("kununu")).toBe("link-outline");
});

test("unten bei der Version steht „Was ist neu“ und öffnet die Karte", async () => {
  await render(<MoreScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText(/LionsAPP v0\.5\.0-beta · Build 63/)).toBeTruthy());
  await fireEvent.press(screen.getByTestId("more-whats-new"));
  expect(mockOpenWhatsNew).toHaveBeenCalledTimes(1);
});

// Dieselben Plattformen wie im Web: jeder Schlüssel aus der Auswahl hat ein Symbol, Unbekanntes den Kettenlink.
test("socialIcon kennt X, Threads, Bluesky, Mastodon, Telegram, Kick, LinkedIn, Steam", () => {
  for (const key of ["x", "threads", "bluesky", "mastodon", "telegram", "kick", "linkedin", "steam", "github", "email"]) {
    expect(socialIcon(key)).not.toBe("link-outline");
  }
  expect(socialIcon("X")).toBe("logo-twitter");
  expect(socialIcon("gibt-es-nicht")).toBe("link-outline");
});
