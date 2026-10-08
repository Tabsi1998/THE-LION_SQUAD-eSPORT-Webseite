import { currentTab, navigateToNotification, navigateToUrl, openSignIn, openTab, signInOpen, targetFromNotification, targetFromUrl } from "./rootNavigation";

// Wohin Adressen und Benachrichtigungen führen (#1143, #1144): Detail-Screens legen sich über den Tab, in dem man gerade
// ist; nur die Übersichten (Home, Events, Community, Verein, Profil) wechseln den Tab. Alte Adressen - aus Mails, alten
// Benachrichtigungen und Links von außen - landen am neuen Ort.

const mockRef = { ready: false, navigate: jest.fn(), root: undefined as unknown };
jest.mock("@react-navigation/native", () => ({
  createNavigationContainerRef: () => ({
    isReady: () => mockRef.ready,
    navigate: (...args: unknown[]) => mockRef.navigate(...args),
    getCurrentRoute: () => null,
    getRootState: () => mockRef.root,
  }),
}));

function onTab(tab: string) {
  return { index: 0, routes: [{ name: "Main", state: { index: ["HomeTab", "EventsTab", "CommunityTab", "VereinTab", "ProfileTab"].indexOf(tab), routes: ["HomeTab", "EventsTab", "CommunityTab", "VereinTab", "ProfileTab"].map((name) => ({ name })) } }] };
}

beforeEach(() => {
  mockRef.ready = false;
  mockRef.root = onTab("HomeTab");
  mockRef.navigate.mockClear();
});

// Gast zuerst (#918): Anmelden und Registrieren von überall - vor dem Start der Navigation passiert nichts.
test("openSignIn öffnet Anmelden oder Registrieren, sobald die Navigation steht", () => {
  expect(openSignIn()).toBe(false);
  expect(mockRef.navigate).not.toHaveBeenCalled();
  mockRef.ready = true;
  expect(openSignIn()).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Login");
  expect(openSignIn("Register")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Register");
  expect(signInOpen()).toBe(false);
});

const detail = (screen: string, params?: Record<string, unknown>) => ({ kind: "detail", screen, params });
const tab = (tabName: string, screen: string, params?: Record<string, unknown>) => ({ kind: "tab", tab: tabName, screen, params });

// Jede bekannte Adresse der Website und alle alten Adressen aus Mails, Benachrichtigungen und Links.
const ADDRESSES: Array<[string, unknown]> = [
  ["/", tab("HomeTab", "Dashboard")],
  ["/dashboard", tab("HomeTab", "Dashboard")],
  ["/events", tab("EventsTab", "TournamentList", { filter: "events" })],
  ["/tournaments", tab("EventsTab", "TournamentList", { filter: "tournaments" })],
  ["/fastlap", tab("EventsTab", "TournamentList", { filter: "fastlaps" })],
  ["/fastlaps", tab("EventsTab", "TournamentList", { filter: "fastlaps" })],
  ["/f1", tab("EventsTab", "TournamentList", { filter: "fastlaps" })],
  ["/calendar", tab("EventsTab", "TournamentList")],
  ["/esports", tab("EventsTab", "TournamentList")],
  ["/community", tab("CommunityTab", "CommunityHub")],
  ["/messages", tab("CommunityTab", "CommunityHub", { section: "chats" })],
  ["/teams", tab("CommunityTab", "CommunityHub", { section: "teams" })],
  ["/players", tab("CommunityTab", "CommunityHub", { section: "players" })],
  ["/profile?tab=inbox", tab("CommunityTab", "CommunityHub", { section: "chats" })],
  ["/profile?tab=teams", tab("CommunityTab", "CommunityHub", { section: "teams" })],
  ["/profile?tab=friends", tab("CommunityTab", "CommunityHub", { section: "players" })],
  ["/verein", tab("VereinTab", "VereinHub")],
  ["/members/area", tab("VereinTab", "VereinHub")],
  ["/mitgliederbereich", tab("VereinTab", "VereinHub")],
  ["/members/news", tab("VereinTab", "VereinHub")],
  ["/profile", tab("ProfileTab", "Profile")],
  ["/u/me", tab("ProfileTab", "Profile")],
  ["/profile?tab=achievements", tab("ProfileTab", "Profile", { tab: "achievements" })],
  ["/profile?tab=honours", tab("ProfileTab", "Profile", { tab: "honours" })],
  ["/matches/m-1", detail("MatchDetail", { id: "m-1" })],
  ["/tournaments/herbst-cup", detail("TournamentDetail", { id: "herbst-cup" })],
  ["/tournaments/herbst-cup/chat", detail("TournamentChat", { id: "herbst-cup" })],
  ["/events/herbst-lan", detail("EventDetail", { id: "herbst-lan" })],
  ["/fastlap/monza", detail("FastLapDetail", { id: "monza" })],
  ["/f1/challenges/monza", detail("FastLapDetail", { id: "monza" })],
  ["/f1/monza", detail("FastLapDetail", { id: "monza" })],
  ["/teams/t-1", detail("TeamDetail", { id: "t-1" })],
  // Einladungs-Link (#1191): der Schlüssel geht mit zur Team-Seite.
  ["https://lionsquad.at/teams/t-1?einladung=AbC123", detail("TeamDetail", { id: "t-1", invite: "AbC123" })],
  ["/news/herbst-lan-plan", detail("NewsDetail", { id: "herbst-lan-plan" })],
  ["/galerie/sommerfest", detail("GalleryAlbum", { id: "sommerfest" })],
  ["/messages/u-9", detail("DirectThread", { userId: "u-9" })],
  ["/profile?tab=inbox&to=u-9", detail("DirectThread", { userId: "u-9" })],
  ["/u/neonfalke", detail("PublicProfile", { username: "neonfalke" })],
  ["/players/neonfalke", detail("PublicProfile", { username: "neonfalke" })],
  ["/profile/neonfalke", detail("PublicProfile", { username: "neonfalke" })],
  ["/account/invoices", detail("MyInvoices", undefined)],
  ["/profile?tab=invoices&invoice=d-501", detail("MyInvoices", { invoice: "d-501" })],
  ["/me/prizes", detail("MyPrizes")],
  ["/my/prizes", detail("MyPrizes")],
  ["/profile?tab=notifications", detail("Settings")],
  ["/profile?tab=privacy", detail("Settings")],
  ["/profile?tab=security", detail("Settings")],
  ["/profile?tab=basic", detail("ProfileEdit")],
  ["/members/membership", detail("MyMembership")],
  ["/members/documents", detail("MemberDocuments")],
  ["/members/meetings", detail("MemberMeetings")],
  ["/members/helfen", detail("MemberHelperShifts")],
  // Helfer-Aufruf (#1197): die Veranstaltung aus der Meldung steht oben.
  ["/members/helfen?event=5", detail("MemberHelperShifts", { event: 5 })],
  ["/members/benefits", detail("InfoCenter", { section: "benefits" })],
  ["/notifications", detail("Notifications")],
  ["/achievements", detail("AchievementShowcase")],
  ["/seasons/current", detail("SeasonPass")],
  ["/news", detail("NewsList")],
  ["/gallery", detail("Gallery")],
  ["/galerie", detail("Gallery")],
  ["/advent", detail("AdventCalendar")],
  ["/ostern", detail("EasterHunt")],
  ["/sponsors", detail("InfoCenter", { section: "sponsors" })],
  ["/partners", detail("InfoCenter", { section: "partners" })],
  ["/references", detail("InfoCenter", { section: "references" })],
];

test("jede bekannte Adresse hat ihren Ort - Übersichten wechseln den Tab, alles andere legt sich darüber", () => {
  for (const [url, expected] of ADDRESSES) {
    expect([url, targetFromUrl(url)]).toEqual([url, expected]);
  }
  // Volle Adressen der eigenen Website wie Pfade, fremde nie.
  expect(targetFromUrl("https://lionsquad.at/news/saisonstart")).toEqual(detail("NewsDetail", { id: "saisonstart" }));
  expect(targetFromUrl("https://start.gg/tournaments/t-1")).toBeNull();
  // Seiten ohne Screen in der App öffnen sich im Browser.
  // Über uns (#1024) hat jetzt einen Screen - der Rest bleibt auf der Website.
  expect(targetFromUrl("/about")).toEqual(detail("ClubAbout"));
  // Jahresrückblick (#1195).
  expect(targetFromUrl("https://lionsquad.at/dein-jahr")).toEqual(detail("YearReview"));
  for (const url of ["/servers", "/membership/join", "/privacy", "/imprint", "/privacy-account", "", null, undefined]) {
    expect([url, targetFromUrl(url)]).toEqual([url, null]);
  }
});

test("„Deine Rechnung ist da“ (#841) öffnet Meine Rechnungen mit dem Beleg - fremde Werte fallen weg", () => {
  expect(targetFromUrl("https://lionsquad.at/profile?tab=invoices&invoice=d-501")).toEqual(detail("MyInvoices", { invoice: "d-501" }));
  expect(targetFromUrl("/profile?tab=invoices&invoice=../../x")).toEqual(detail("MyInvoices", undefined));
});

test("Detail-Screens legen sich über den aktuellen Tab; Übersichten wechseln den Tab und gehen darin zurück", () => {
  expect(navigateToUrl("/news/advent-gruss")).toBe(false);
  expect(mockRef.navigate).not.toHaveBeenCalled();

  mockRef.ready = true;
  mockRef.root = onTab("EventsTab");
  expect(currentTab()).toBe("EventsTab");
  expect(navigateToUrl("/news/advent-gruss")).toBe(true);
  // Kein Tab im Aufruf: der Stapel des aktuellen Tabs (Events) nimmt die News auf.
  expect(mockRef.navigate).toHaveBeenLastCalledWith("NewsDetail", { id: "advent-gruss" });
  expect(navigateToUrl("/teams/t-1")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("TeamDetail", { id: "t-1" });

  expect(navigateToUrl("/fastlap")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Main", { screen: "EventsTab", params: { screen: "TournamentList", params: { filter: "fastlaps" }, pop: true } }, { pop: true });
  expect(openTab("VereinHub")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Main", { screen: "VereinTab", params: { screen: "VereinHub", params: undefined, pop: true } }, { pop: true });
});

test("über Anmelden oder Registrieren: zurück in die Tabs und dort im aktuellen Tab öffnen", () => {
  mockRef.ready = true;
  mockRef.root = { index: 1, routes: [{ name: "Main", state: onTab("CommunityTab").routes[0].state }, { name: "Login" }] };
  expect(navigateToUrl("/events/herbst-lan")).toBe(true);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Main", { screen: "CommunityTab", params: { screen: "EventDetail", params: { id: "herbst-lan" }, initial: false } }, { pop: true });
});

test("Benachrichtigungen: Chats, Teams, Turniere, Gewinne und Freunde - sonst die Glocke", () => {
  const note = (kind: string, meta: Record<string, unknown> = {}, url = "") => ({ id: "n", kind, meta, url, title: "Titel", read: false, created_at: "" });
  expect(targetFromNotification(note("direct_message", { thread_user_id: "u-2" }) as never)).toEqual(detail("DirectThread", { userId: "u-2", title: "Titel" }));
  expect(targetFromNotification(note("team_chat_message", { team_id: "t-1" }) as never)).toEqual(detail("TeamChat", { id: "t-1", title: "Team-Chat" }));
  expect(targetFromNotification(note("tournament_chat_message", { tournament_id: "x" }) as never)).toEqual(detail("TournamentChat", { id: "x", title: "Turnier-Chat" }));
  expect(targetFromNotification(note("match_chat_message", { match_id: "m" }) as never)).toEqual(detail("MatchDetail", { id: "m" }));
  expect(targetFromNotification(note("prize_ready") as never)).toEqual(detail("MyPrizes"));
  expect(targetFromNotification(note("friend_request", { requester_username: "kiwikomet" }) as never)).toEqual(detail("PublicProfile", { username: "kiwikomet" }));
  expect(targetFromNotification(note("friend_accepted") as never)).toEqual(tab("CommunityTab", "CommunityHub", { section: "players" }));
  expect(targetFromNotification(note("achievement", {}, "/profile?tab=achievements") as never)).toEqual(tab("ProfileTab", "Profile", { tab: "achievements" }));

  // Ohne Ziel: die Liste der Glocke - über dem aktuellen Tab.
  mockRef.ready = true;
  mockRef.root = onTab("VereinTab");
  expect(navigateToNotification(note("unbekannt") as never)).toBe(false);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Notifications", undefined);
});
