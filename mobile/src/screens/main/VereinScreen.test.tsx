import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { clubRows, discordServerLine, socialIcon, VereinScreen } from "./VereinScreen";

// Der Tab Verein (#1147): Mitglieder sehen oben ihre Mitgliedskarte mit Gruß und Beitragsstand (#1336) und ihren
// Mitgliederbereich (Karte, Mitgliedschaft, Versammlungen, Helfen, Dokumente, Vorteile - mit denselben Zahlen wie die
// Sprungleiste der Website, #1257 - und interne News), alle anderen „Mitglied werden“ mit drei Gründen. Darunter für alle News, Galerie,
// Referenzen, Sponsoren, Partner und „Folge uns“. Der Einlass steht oben, nur für den Vorstand. Galerie und Vorteile
// stehen nur noch einmal, Rechnungen und interne Termine gar nicht (Profil bzw. Events-Tab, #1150).

const mockGet = jest.fn();
jest.mock("../../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));
const mockUser: { id: string; username: string; display_name: string; is_club_member: boolean; areas?: string[] } = { id: "u-1", username: "neonfalke", display_name: "NeonFalke", is_club_member: true };
const mockGuest = { value: false };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: mockGuest.value ? null : mockUser }) }));
jest.mock("../../live", () => ({ isGuestUser: (user: unknown) => !user }));
jest.mock("../../realtime/LiveChangesProvider", () => ({ useLiveRefresh: () => undefined }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/MediaImage", () => ({ MediaImage: () => null }));
jest.mock("../../seasons/SeasonStage", () => ({ SeasonBackdropSlot: () => null, SeasonShelfSlot: () => null }));
jest.mock("../../seasons/anchors", () => ({ SeasonPerch: () => null }));
jest.mock("../../navigation/rootNavigation", () => ({ openDetail: jest.fn(), navigateToUrl: () => false }));
const mockAdvent: { value: { door: number } | null } = { value: null };
jest.mock("../../advent/entry", () => ({ useAdventEntry: () => mockAdvent.value }));

const navigate = jest.fn();
const navigation = { navigate } as never;
const route = { key: "verein", name: "VereinHub" } as never;

const responses: Record<string, unknown> = {
  "/membership/me": {
    membership: { member_number: "TLS-0007", member_since: "2023-03-01", member_status: "active", membership_type: "ordinary" },
    dolibarr: { led_by_dolibarr: true, type_label: "Ordentliches Mitglied", paid_until: "2026-12-31", fee: { status: "paid" } },
  },
  "/membership/area-summary": { meetings_open: 1, ballots_open: 0, helping_free: 6, helping_mine: 0, news_new: 1, documents: 4, documents_new: 2 },
  "/news": [{ id: "n1", slug: "intern", title: "Neue Vereinsfarben", visibility: "members", created_at: "2026-09-20T10:00:00Z" }, { id: "n2", slug: "pub", title: "Für alle", visibility: "public" }],
  "/board": [{ id: "p1", display_title: "Obfrau", user: { display_name: "Obfrau Otti", username: "otti", gamertag: "OttiOtter" } }],
  // Beitrag offen (#1251): für alle, die noch nicht Mitglied sind.
  "/membership/fees": { available: true, stale: false, as_of: "2026-10-07T08:00:00Z", fees: [
    { id: 2, label: "Ordentliches Mitglied", description: "Mit Stimmrecht", amount: 60, currency: "EUR", period_label: "je Jahr", subscription_required: true },
    { id: 9, label: "Ehrenmitglied", amount: null, subscription_required: false },
  ] },
  "/settings/public": {
    discord_invite_url: "https://discord.gg/lions",
    social_links: [
      { platform: "discord", label: "Discord", url: "https://discord.com/invite/lions", enabled: true },
      { platform: "instagram", label: "Instagram", url: "https://instagram.com/lions", enabled: true },
      { platform: "facebook", label: "Facebook", url: "https://facebook.com/x", enabled: false },
    ],
  },
  "/membership/steam-presence": { available: true, stale: false, online_count: 2, me: { linked: true, opted_in: false }, players: [
    { user_id: "u9", username: "rockraupe", display_name: "RockRaupe", state: "playing", state_text: "spielt gerade Rocket League", game: "Rocket League" },
  ] },
  // „Discord jetzt“ (#581): nur Zahlen je Sprachkanal.
  "/membership/discord-voice": { available: true, online: 42, in_voice: 3, invite: "https://discord.gg/lions", voice: [{ name: "Chillen", count: 1 }, { name: "Turnier-Lobby", count: 2 }] },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGuest.value = false;
  mockAdvent.value = null;
  mockUser.is_club_member = true;
  delete mockUser.areas;
  mockGet.mockImplementation((path: string) => (path in responses ? Promise.resolve({ data: responses[path] }) : Promise.reject(new Error("nope"))));
});

test("Mitglied: oben Karte, Gruß und Beitrag, dann sechs Kacheln mit Zahlen und internen News - Galerie und Vorteile je einmal", async () => {
  await render(<VereinScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByText("Neue Vereinsfarben")).toBeTruthy());

  expect(screen.getByTestId("verein-header-title")).toHaveTextContent("Verein");
  expect(screen.getByTestId("verein-member-area")).toBeTruthy();
  expect(screen.queryByTestId("verein-join")).toBeNull();
  // Die Karte wie auf der Website (#1336): Name, Nummer, Art und gültig bis; daneben Gruß, „Mitglied seit“ und Beitrag.
  expect(screen.getByTestId("verein-member-card-art")).toHaveProp("accessibilityLabel", "Mitgliedskarte NeonFalke, Nr. TLS-0007 · seit 2023, Ordentliches Mitglied · gültig bis 31.12.2026");
  expect(screen.getByTestId("verein-member-greeting")).toHaveTextContent("Hallo, NeonFalke");
  expect(screen.getByTestId("verein-member-since")).toHaveTextContent("Mitglied seit 01.03.2023");
  expect(screen.getByTestId("verein-member-fee")).toHaveTextContent("Beitrag bezahlt");
  expect(screen.queryByText("Für alle")).toBeNull();
  // Dieselben Zahlen wie im Mitgliederbereich der Website (#1257); ohne Offenes keine Zahl.
  expect(screen.getByLabelText("Versammlungen, 1 offen")).toBeTruthy();
  expect(screen.getByLabelText("Helfen, 6 frei")).toBeTruthy();
  expect(screen.getByLabelText("Dokumente, 2 neu")).toBeTruthy();
  expect(screen.getByLabelText("Mitgliedschaft")).toBeTruthy();
  expect(mockGet).not.toHaveBeenCalledWith("/documents");
  for (const label of ["Galerie", "Vorteile", "News", "Referenzen", "Sponsoren", "Partner"]) expect(screen.getAllByText(label)).toHaveLength(1);
  // Rechnungen (Profil) und interne Termine (Events-Tab) stehen nicht im Verein-Tab.
  expect(screen.queryByText(/Rechnung/)).toBeNull();
  expect(screen.queryByText("Interne Events")).toBeNull();

  const taps: Array<[string, unknown[]]> = [
    ["verein-member-card", ["MemberCard", undefined]],
    ["member-area-card", ["MemberCard", undefined]],
    ["member-area-membership", ["MyMembership", undefined]],
    ["member-area-meetings", ["MemberMeetings", undefined]],
    ["member-area-helping", ["MemberHelperShifts", undefined]],
    ["member-area-documents", ["MemberDocuments", undefined]],
    ["member-area-benefits", ["InfoCenter", { section: "benefits" }]],
    ["verein-row-about", ["ClubAbout", undefined]],
    ["verein-row-gallery", ["Gallery", undefined]],
    ["verein-row-news", ["NewsList", undefined]],
    ["verein-row-sponsors", ["InfoCenter", { section: "sponsors" }]],
  ];
  for (const [testID, args] of taps) {
    await fireEvent.press(screen.getByTestId(testID));
    expect(navigate).toHaveBeenLastCalledWith(...args);
  }
  await fireEvent.press(screen.getByText("Neue Vereinsfarben"));
  expect(navigate).toHaveBeenLastCalledWith("NewsDetail", { id: "intern" });

  // Was im Verein gerade los ist, bleibt im Mitgliederbereich: Discord jetzt, Steam, Ansprechpartner.
  expect(screen.getByTestId("member-area-discord-summary")).toHaveTextContent("42 online · 3 im Voice");
  expect(screen.getByTestId("member-area-steam-summary")).toHaveTextContent("2 Mitglieder gerade in Steam");
  // Ansprechpartner wie im Web (#1332): Rolle, Name, Spielername.
  expect(screen.getByTestId("member-area-contact-p1-gamertag")).toHaveTextContent("OttiOtter");
  await fireEvent.press(screen.getByText("Obfrau Otti"));
  expect(navigate).toHaveBeenLastCalledWith("PublicProfile", { username: "otti" });
  // Mitglieder brauchen den Beitrag nicht mehr - er wird gar nicht erst geladen.
  expect(mockGet).not.toHaveBeenCalledWith("/membership/fees");
});

test("ohne Mitgliedschaft: oben „Mitglied werden“ mit drei Gründen, der Antrag öffnet die Website", async () => {
  mockUser.is_club_member = false;
  const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await render(<VereinScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("/settings/public"));
  expect(screen.queryByTestId("verein-member-area")).toBeNull();
  for (const reason of ["Mitgliedskarte", "Mitreden", "Interne Events"]) expect(screen.getByText(reason)).toBeTruthy();
  // Der Beitrag offen (#1251): dieselben Beträge wie auf der Website.
  await waitFor(() => expect(screen.getByTestId("verein-join-fees")).toBeTruthy());
  expect(screen.getByTestId("verein-join-fee-2")).toHaveTextContent(/Ordentliches Mitglied.*60,00 je Jahr/);
  expect(screen.getByTestId("verein-join-fee-9")).toHaveTextContent(/Ehrenmitglied.*Ohne Beitrag/);
  expect(screen.queryByTestId("verein-join-fees-stand")).toBeNull();
  await fireEvent.press(screen.getByTestId("verein-join-apply"));
  expect(openUrl).toHaveBeenCalledWith(expect.stringMatching(/\/membership\/join$/));
  // Nicht-Mitglieder laden nichts aus dem Mitgliederbereich.
  expect(mockGet).not.toHaveBeenCalledWith("/membership/me");
  expect(screen.getByTestId("verein-row-gallery")).toBeTruthy();
});

test("als Gast: dasselbe wie ohne Mitgliedschaft, und die Vereinskanäle aus den Einstellungen", async () => {
  mockGuest.value = true;
  const openUrl = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  await render(<VereinScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByLabelText("Discord")).toBeTruthy());
  expect(screen.getByTestId("verein-join")).toBeTruthy();
  expect(screen.getByLabelText("Instagram")).toBeTruthy();
  expect(screen.queryByLabelText("Facebook")).toBeNull();
  await fireEvent.press(screen.getByLabelText("Discord"));
  expect(openUrl).toHaveBeenCalledWith("https://discord.com/invite/lions");
});

test("Vorstand: der Einlass steht oben - sonst nicht", async () => {
  mockUser.areas = ["club"];
  const board = await render(<VereinScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(screen.getByTestId("verein-admission")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("verein-admission"));
  expect(navigate).toHaveBeenCalledWith("Admission", undefined);
  await board.unmount();
  delete mockUser.areas;
  await render(<VereinScreen navigation={navigation} route={route} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  expect(screen.queryByTestId("verein-admission")).toBeNull();
});

test("Adventkalender: die Zeile steht nur da, solange der Kalender läuft - als erste unter „Vom Verein“", () => {
  // Über uns, Vorstand, Kontakt (#1024) steht als erste Zeile - für Gäste, Eltern und Neue.
  expect(clubRows(false).map((row) => row.title)).toEqual(["Über uns, Vorstand, Kontakt", "News", "Galerie", "Referenzen", "Sponsoren", "Partner"]);
  expect(clubRows(true).map((row) => row.title)).toEqual(["Adventkalender", "Über uns, Vorstand, Kontakt", "News", "Galerie", "Referenzen", "Sponsoren", "Partner"]);
});

test("Symbole je Kanal, Unbekanntes als Link; Discord-Server-Zeile", () => {
  expect(socialIcon("discord")).toBe("logo-discord");
  expect(socialIcon("TikTok")).toBe("logo-tiktok");
  for (const key of ["x", "threads", "bluesky", "mastodon", "telegram", "kick", "linkedin", "steam", "github", "email"]) {
    expect(socialIcon(key)).not.toBe("link-outline");
  }
  expect(socialIcon("gibt-es-nicht")).toBe("link-outline");
  expect(discordServerLine({ available: true, guild_id: "9", member_count: 0 })).toBe("");
  expect(discordServerLine({ available: true, guild_id: "9", member_count: 1 })).toBe("1 Mitglied");
  expect(discordServerLine({ available: true, guild_id: "9", member_count: 120, main: true })).toBe("Hauptserver · 120 Mitglieder");
});

test("Mitglied ohne Mitgliederverwaltung: Gruß ohne Schild; ohne gültige Mitgliedschaft keine Karte", async () => {
  const original = responses["/membership/me"];
  responses["/membership/me"] = { membership: { member_since: "2023-03-01", member_status: "pending" } };
  try {
    await render(<VereinScreen navigation={navigation} route={route} />);
    await waitFor(() => expect(screen.getByTestId("verein-member-since")).toBeTruthy());
    expect(screen.getByTestId("verein-member-greeting")).toHaveTextContent("Hallo, NeonFalke");
    expect(screen.queryByTestId("verein-member-fee")).toBeNull();
    expect(screen.queryByTestId("verein-member-card")).toBeNull();
  } finally {
    responses["/membership/me"] = original;
  }
});
