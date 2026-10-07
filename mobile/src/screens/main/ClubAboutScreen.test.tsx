import React from "react";
import { Linking, Share } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ClubAboutScreen } from "./ClubAboutScreen";
import { aboutNumbers, firstParagraph, pillarList } from "../../lib/clubAbout";
import { targetFromUrl } from "../../navigation/rootNavigation";

// Über uns in der App (#1024): ein paar Sätze, Zahlen, Vorstand mit Bild und Aufgabe, Werte, Kontakt zum Kopieren
// und „Mitglied werden“; lange Seiten öffnen die Website. Erfundene Daten.

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
const mockAuth: { user: Record<string, unknown> | null } = { user: null };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../components/BrandLogo", () => ({ BrandLogo: () => null }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));
const mockOpenLink = jest.fn();
jest.mock("../../lib/openLink", () => ({ openLink: (...args: unknown[]) => mockOpenLink(...args) }));

const navigate = jest.fn();
const navigation = { navigate } as never;
const route = { key: "about", name: "ClubAbout" } as never;

const ABOUT = {
  texts: {
    hero_eyebrow: "eSports-Verein", hero_title: "The Lion Squad",
    hero_text: "Wir sind ein Verein für alle, die gern gemeinsam spielen: LAN-Partys, Turniere für Einsteiger und Profis.\n\nZweiter Absatz, der nur auf der Website steht.",
    values_title: "Was uns ausmacht", values_text: "Fairplay und Zusammenhalt zuerst.", pillars: ["Rudel", "Fairplay", ""],
  },
  organization: { name: "Verein Beispiel" },
  numbers: { members: 64, tournaments_completed: 12, events: 4, prizes: 0 },
  numbers_shown: ["members", "tournaments_completed", "events", "prizes"],
};
const BOARD = [
  { id: "b1", display_title: "Obfrau", user: { display_name: "LöwenMara", username: "loewenmara" } },
  { id: "b2", display_title: "Kassier", user: { display_name: "Bitbauer", username: "bitbauer" } },
  { id: "b3", display_title: "Schriftführerin", user: null },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = null;
  mockGet.mockImplementation((path: string) => Promise.resolve({ data: path === "/home/about" ? ABOUT : path === "/board" ? BOARD : { contact_email: "verein@example.test" } }));
});

test("Helfer: erster Absatz, höchstens drei Zahlen ohne Nullen, Säulen ohne Leeres", () => {
  expect(firstParagraph(ABOUT.texts.hero_text)).toBe("Wir sind ein Verein für alle, die gern gemeinsam spielen: LAN-Partys, Turniere für Einsteiger und Profis.");
  expect(aboutNumbers(ABOUT).map((n) => [n.label, n.value])).toEqual([["Mitglieder", 64], ["Turniere gespielt", 12], ["Events", 4]]);
  expect(pillarList(ABOUT)).toEqual(["Rudel", "Fairplay"]);
  expect(targetFromUrl("/about")).toEqual({ kind: "detail", screen: "ClubAbout", params: undefined });
  expect(targetFromUrl("/board")).toEqual({ kind: "detail", screen: "ClubAbout", params: undefined });
});

test("Gast: Sätze, Zahlen, Vorstand mit Aufgabe, Werte, Kontakt zum Teilen und Mitglied werden", async () => {
  const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
  const mail = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
  await render(<ClubAboutScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("club-about-intro")).toBeTruthy());
  expect(screen.getByText("The Lion Squad")).toBeTruthy();
  expect(screen.queryByText(/Zweiter Absatz/)).toBeNull();
  expect(screen.getByText("64")).toBeTruthy();
  expect(screen.getByText("Turniere gespielt")).toBeTruthy();
  expect(screen.getByText("LöwenMara")).toBeTruthy();
  expect(screen.getByText("Obfrau")).toBeTruthy();
  // Unbesetzte Posten bleiben weg.
  expect(screen.queryByText("Schriftführerin")).toBeNull();
  await fireEvent.press(screen.getByTestId("club-about-board-b2"));
  expect(navigate).toHaveBeenCalledWith("PublicProfile", { username: "bitbauer" });
  expect(screen.getByText("Was uns ausmacht")).toBeTruthy();
  expect(screen.getByText("Fairplay")).toBeTruthy();
  await fireEvent.press(screen.getByTestId("club-about-email"));
  expect(share).toHaveBeenCalledWith(expect.objectContaining({ message: "verein@example.test" }));
  await fireEvent.press(screen.getByTestId("club-about-mail"));
  expect(mail).toHaveBeenCalledWith("mailto:verein@example.test");
  await fireEvent.press(screen.getByTestId("club-about-join-button"));
  expect(mockOpenLink).toHaveBeenLastCalledWith(expect.stringMatching(/\/membership\/join$/));
  await fireEvent.press(screen.getByTestId("club-about-link-members"));
  expect(mockOpenLink).toHaveBeenLastCalledWith(expect.stringMatching(/\/members$/));
});

test("Mitglieder sehen kein „Mitglied werden“; ohne Adresse der Weg zum Kontaktformular", async () => {
  mockAuth.user = { id: "u-1", is_club_member: true };
  mockGet.mockImplementation((path: string) => Promise.resolve({ data: path === "/home/about" ? ABOUT : path === "/board" ? BOARD : {} }));
  await render(<ClubAboutScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("club-about-contact")).toBeTruthy());
  expect(screen.queryByTestId("club-about-join")).toBeNull();
  expect(screen.queryByTestId("club-about-email")).toBeNull();
  expect(screen.getByText("Schreib uns über das Kontaktformular auf der Website.")).toBeTruthy();
});
