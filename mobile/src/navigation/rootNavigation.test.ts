import { currentTab, navigateToNotification, navigateToUrl, openSignIn, openTab, signInOpen, targetFromNotification, targetFromUrl } from "./rootNavigation";
import { ARTICLE, FOREIGN_ARTICLE_LINKS, OWN_ARTICLE_LINKS } from "../lib/linkOrigins.fixture";

// Wohin Adressen und Benachrichtigungen führen (#1143, #1144): Detail-Screens legen sich über den Tab, in dem man gerade
// ist; nur die Übersichten (Home, Events, Community, Verein, Mein Bereich) wechseln den Tab. Alte Adressen - aus Mails, alten
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
  ["/calendar/mine", tab("EventsTab", "TournamentList", { scope: "mine" })],
  ["/calendar/mine#abo", tab("EventsTab", "TournamentList", { scope: "mine" })],
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
  // Interne News (#2059): im Web Mein Bereich → Verein → News - in der App die News, gleich auf „Verein“ gestellt.
  ["/members/news", detail("NewsList", { scope: "club" })],
  // Mein Bereich (#2059): /profile ist im Web Mein Bereich → Profil; das eigene Profil liegt über dem Tab.
  ["/profile", detail("MeinBereichGruppe", { gruppe: "profil" })],
  ["/u/me", detail("OwnProfile")],
  ["/u/me?tab=achievements", detail("OwnProfile", { tab: "achievements" })],
  ["/u/me?tab=trophaeen", detail("OwnProfile", { tab: "awards" })],
  ["/profile?tab=achievements", detail("OwnProfile", { tab: "achievements" })],
  ["/profile?tab=honours", detail("OwnProfile", { tab: "honours" })],
  ["/matches/m-1", detail("MatchDetail", { id: "m-1" })],
  ["/tournaments/herbst-cup", detail("TournamentDetail", { id: "herbst-cup" })],
  ["/tournaments/herbst-cup/chat", detail("TournamentChat", { id: "herbst-cup" })],
  // Turnierleitung am Handy (#1156, #1160): die Ansicht der Turnierleitung, mit Spiel oder Fall.
  ["/tournaments/herbst-cup/leitung", detail("TournamentLead", { id: "herbst-cup" })],
  ["/tournaments/herbst-cup/leitung?spiel=m-1&fall=rm-m-1", detail("TournamentLead", { id: "herbst-cup", spiel: "m-1", fall: "rm-m-1" })],
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
  ["/account/documents", detail("MyDocuments")],
  ["/profile?tab=invoices&invoice=d-501", detail("MyInvoices", { invoice: "d-501" })],
  ["/me/prizes", detail("MyPrizes")],
  ["/my/prizes", detail("MyPrizes")],
  // Die alten Reiter der Einstellungen (#1146) an ihrer Stelle in Mein Bereich (#2059).
  ["/profile?tab=notifications", detail("MeinBereichGruppe", { gruppe: "benachrichtigungen" })],
  // Der Link aus der Sammel-Mail (#1662) nennt den Bereich E-Mail - die App springt zur Sammel-Mail.
  ["/profile?tab=notifications&bereich=mail", detail("MeinBereichGruppe", { gruppe: "benachrichtigungen", ziel: "sammel-mail" })],
  ["/profile?tab=notifications&bereich=ruhezeit", detail("MeinBereichGruppe", { gruppe: "benachrichtigungen", ziel: "ruhezeit" })],
  ["/profile?tab=privacy", detail("MeinBereichGruppe", { gruppe: "datenschutz" })],
  ["/profile?tab=security", detail("MeinBereichGruppe", { gruppe: "konto" })],
  ["/profile?tab=sessions", detail("MeinBereichGruppe", { gruppe: "konto", ziel: "geraete" })],
  ["/profile?tab=appearance", detail("MeinBereichGruppe", { gruppe: "konto", ziel: "darstellung" })],
  ["/profile?tab=about", detail("MeinBereichGruppe", { gruppe: "konto", ziel: "version" })],
  ["/profile?tab=calendar", detail("CalendarSubscription")],
  ["/profile?tab=prizes", detail("MyPrizes")],
  ["/profile?tab=gaming", detail("ProfileEdit")],
  ["/privacy-account", detail("MeinBereichGruppe", { gruppe: "datenschutz", ziel: "daten" })],
  ["/my/penalties", detail("MeinBereichGruppe", { gruppe: "rechnungen", ziel: "strafen" })],
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
  // Saison einer Serie (#1945): die Seite des Webs hat jetzt einen Screen in der App.
  ["/references/series/prl/2026-liga-1", detail("ReferenceSeason", { lineage: "prl", season: "2026-liga-1" })],
  // Statistik und Ergebnis je Runde (#1950, #1974): der Reiter bzw. die Runde mit dem Lauf aus ?lauf=.
  ["/references/series/prl/2026-liga-1?ansicht=statistik", detail("ReferenceSeason", { lineage: "prl", season: "2026-liga-1", view: "statistik" })],
  ["/references/series/prl/2026-liga-1/runde/3", detail("ReferenceRound", { lineage: "prl", season: "2026-liga-1", round: 3 })],
  ["/references/series/prl/2026-liga-1/runde/3?lauf=sprint", detail("ReferenceRound", { lineage: "prl", season: "2026-liga-1", round: 3, session: "sprint" })],
  // Keine gültige Nummer: die Saison.
  ["/references/series/prl/2026-liga-1/runde/abc", detail("ReferenceSeason", { lineage: "prl", season: "2026-liga-1" })],
  // Gesamtwertung über Seasons (F.5, #2173): hat einen Screen in der App; die übrigen Seiten der Liga bleiben im Web.
  ["/liga/cod/season-2/gesamtwertung", detail("LeagueOverall", { league: "cod", season: "season-2" })],
  ["/liga/cod/season-2", null],
  ["/liga/cod/season-2/staffeln/t1", null],
  // Trophäen (#2425): ?tab=trophaeen öffnet den Reiter an Team und eigenem Profil.
  ["/teams/t-9?tab=trophaeen", detail("TeamDetail", { id: "t-9", tab: "trophies" })],
  ["/teams/t-9?tab=chat", detail("TeamDetail", { id: "t-9" })],
  ["/profile?tab=trophaeen", detail("OwnProfile", { tab: "awards" })],
];

// Mein Bereich (#2059): jede Adresse des Webs (frontend/src/lib/meinBereich*.js) und ihre Stelle in der App - Gruppen,
// Reiter (?tab=), Anker (#…) und die Seiten unter Verein. Mails, Push und die FAQ nennen sie, sobald die App sie kennt.
const MEIN_BEREICH: Array<[string, unknown]> = [
  ["/mein-bereich", tab("ProfileTab", "MeinBereich")],
  ["/mein-bereich/", tab("ProfileTab", "MeinBereich")],
  ["https://lionsquad.at/mein-bereich", tab("ProfileTab", "MeinBereich")],
  ["/mein-bereich/gibt-es-nicht", tab("ProfileTab", "MeinBereich")],
  // Profil
  ["/mein-bereich/profil", detail("MeinBereichGruppe", { gruppe: "profil" })],
  ["/mein-bereich/profil?tab=basic", detail("ProfileEdit")],
  ["/mein-bereich/profil?tab=gaming", detail("ProfileEdit")],
  ["/mein-bereich/profil?tab=socials", detail("ProfileEdit")],
  // Mitgliedschaft: die Gruppe, mit Anker direkt die Stelle in „Meine Mitgliedschaft“.
  ["/mein-bereich/mitgliedschaft", detail("MeinBereichGruppe", { gruppe: "mitgliedschaft" })],
  ["/mein-bereich/mitgliedschaft#nummer", detail("MyMembership", { ziel: "nummer" })],
  ["https://lionsquad.at/mein-bereich/mitgliedschaft#meine-daten", detail("MyMembership", { ziel: "meine-daten" })],
  ["/mein-bereich/mitgliedschaft#beitrag", detail("MyMembership", { ziel: "beitrag" })],
  ["/mein-bereich/mitgliedschaft#austritt", detail("MyMembership", { ziel: "austritt" })],
  ["/mein-bereich/mitgliedschaft#status", detail("MyMembership", { ziel: "status" })],
  ["/mein-bereich/mitgliedschaft#website-profil", detail("MyMembership", { ziel: "website-profil" })],
  ["/mein-bereich/mitgliedschaft#mitgliedskarte", detail("MemberCard")],
  ["/mein-bereich/mitgliedschaft#beitreten", detail("MeinBereichGruppe", { gruppe: "mitgliedschaft", ziel: "beitreten" })],
  // Rechnungen & Unterlagen: die Belege direkt, die übrigen Reiter ihre Screens, Strafen die Stelle in der Gruppe.
  ["/mein-bereich/rechnungen", detail("MyInvoices", undefined)],
  ["/mein-bereich/rechnungen?invoice=d-501", detail("MyInvoices", { invoice: "d-501" })],
  ["/mein-bereich/rechnungen?invoice=../x", detail("MyInvoices", undefined)],
  ["/mein-bereich/rechnungen?tab=unterlagen", detail("MyDocuments")],
  ["/mein-bereich/rechnungen?tab=gewinne", detail("MyPrizes")],
  ["/mein-bereich/rechnungen?tab=strafen", detail("MeinBereichGruppe", { gruppe: "rechnungen", ziel: "strafen" })],
  // Verein: die Übersicht ist der Tab Verein, die Seiten darunter ihre Screens.
  ["/mein-bereich/verein", tab("VereinTab", "VereinHub")],
  ["/mein-bereich/verein/versammlungen", detail("MemberMeetings")],
  ["/mein-bereich/verein/versammlungen?meeting=m-1", detail("MemberMeetings")],
  ["/mein-bereich/verein/helfen", detail("MemberHelperShifts")],
  ["/mein-bereich/verein/helfen?event=5", detail("MemberHelperShifts", { event: 5 })],
  ["/mein-bereich/verein/dokumente", detail("MemberDocuments")],
  ["/mein-bereich/verein/news", detail("NewsList", { scope: "club" })],
  ["/mein-bereich/verein/vorteile", detail("InfoCenter", { section: "benefits" })],
  // Benachrichtigungen: ?bereich= aus dem Web (Themen, E-Mail, Ruhezeit, Mehr) oder ein Anker.
  ["/mein-bereich/benachrichtigungen", detail("MeinBereichGruppe", { gruppe: "benachrichtigungen" })],
  ["/mein-bereich/benachrichtigungen?bereich=mail", detail("MeinBereichGruppe", { gruppe: "benachrichtigungen", ziel: "sammel-mail" })],
  ["/mein-bereich/benachrichtigungen?bereich=ruhezeit", detail("MeinBereichGruppe", { gruppe: "benachrichtigungen", ziel: "ruhezeit" })],
  ["/mein-bereich/benachrichtigungen?bereich=themen", detail("MeinBereichGruppe", { gruppe: "benachrichtigungen", ziel: "themen" })],
  ["/mein-bereich/benachrichtigungen?bereich=mehr", detail("MeinBereichGruppe", { gruppe: "benachrichtigungen", ziel: "weitere-wege" })],
  ["/mein-bereich/benachrichtigungen#newsletter", detail("MeinBereichGruppe", { gruppe: "benachrichtigungen", ziel: "newsletter" })],
  // Konto & Sicherheit
  ["/mein-bereich/konto", detail("MeinBereichGruppe", { gruppe: "konto" })],
  ["/mein-bereich/konto#passwort", detail("MeinBereichGruppe", { gruppe: "konto", ziel: "passwort" })],
  ["/mein-bereich/konto?mfa=required&next=%2Fadmin", detail("MeinBereichGruppe", { gruppe: "konto", ziel: "passwort" })],
  ["/mein-bereich/konto?tab=sessions#dieser-browser", detail("MeinBereichGruppe", { gruppe: "konto", ziel: "geraete" })],
  ["/mein-bereich/konto?tab=appearance", detail("MeinBereichGruppe", { gruppe: "konto", ziel: "darstellung" })],
  ["/mein-bereich/konto?tab=about", detail("MeinBereichGruppe", { gruppe: "konto", ziel: "version" })],
  ["/mein-bereich/konto?tab=calendar", detail("CalendarSubscription")],
  // Datenschutz
  ["/mein-bereich/datenschutz", detail("MeinBereichGruppe", { gruppe: "datenschutz" })],
  ["/mein-bereich/datenschutz?tab=einwilligungen", detail("MeinBereichGruppe", { gruppe: "datenschutz", ziel: "einwilligungen" })],
  ["/mein-bereich/datenschutz?tab=daten", detail("MeinBereichGruppe", { gruppe: "datenschutz", ziel: "daten" })],
  ["/mein-bereich/datenschutz?tab=loeschung", detail("MeinBereichGruppe", { gruppe: "datenschutz", ziel: "loeschung" })],
  ["/mein-bereich/datenschutz#erfolge-oeffentlich", detail("MeinBereichGruppe", { gruppe: "datenschutz", ziel: "erfolge-oeffentlich" })],
  // Ein kaputter oder fremder Anker zählt als keiner.
  ["/mein-bereich/datenschutz#%E0%A4", detail("MeinBereichGruppe", { gruppe: "datenschutz" })],
  ["/mein-bereich/konto#<script>", detail("MeinBereichGruppe", { gruppe: "konto" })],
  // Eine fremde Website mit demselben Pfad öffnet nie einen Screen (#921).
  ["https://evil.example/mein-bereich/konto", null],
  ["//evil.example/mein-bereich", null],
];

test("#2059: jede Adresse von Mein Bereich hat ihre Stelle in der App - Gruppen, Reiter, Anker und Verein", () => {
  for (const [url, expected] of MEIN_BEREICH) {
    expect([url, targetFromUrl(url)]).toEqual([url, expected]);
  }
});

test("#2059: die alten Adressen (/profile, /members, /account, /my) führen weiter dorthin, wo Mein Bereich es zeigt", () => {
  const old: Array<[string, string]> = [
    ["/members/membership", "MyMembership"],
    ["/members/meetings", "MemberMeetings"],
    ["/members/documents", "MemberDocuments"],
    ["/members/helfen", "MemberHelperShifts"],
    ["/account/invoices", "MyInvoices"],
    ["/account/documents", "MyDocuments"],
    ["/my/prizes", "MyPrizes"],
    ["/me/prizes", "MyPrizes"],
    ["/my/penalties", "MeinBereichGruppe"],
    ["/profile?tab=basic", "ProfileEdit"],
    ["/profile?tab=notifications", "MeinBereichGruppe"],
    ["/privacy-account", "MeinBereichGruppe"],
  ];
  for (const [url, screen] of old) expect([url, (targetFromUrl(url) as { screen?: string } | null)?.screen]).toEqual([url, screen]);
  // Die Mitgliederübersicht bleibt der Tab Verein.
  expect(targetFromUrl("/members/area")).toEqual(tab("VereinTab", "VereinHub"));
});

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
  // FAQ (#2449): die Übersicht in der App, auch über die alte Hilfe; eine Anleitung mit Bildern bleibt auf der Website.
  expect(targetFromUrl("/faq")).toEqual(detail("Faq"));
  // Wie im Web: #frage-<id> und #bereich-<id> klappen auf, ?q= sucht; ein kaputter Anker zählt als keiner.
  expect(targetFromUrl("/faq#frage-konto-anlegen")).toEqual(detail("Faq", { frage: "konto-anlegen" }));
  expect(targetFromUrl("https://lionsquad.at/faq#bereich-liga")).toEqual(detail("Faq", { bereich: "liga" }));
  expect(targetFromUrl("/faq?q=check-in#frage-")).toEqual(detail("Faq", { q: "check-in" }));
  expect(targetFromUrl("/faq#%E0%A4")).toEqual(detail("Faq"));
  expect(targetFromUrl("/hilfe?q=ruhezeit")).toEqual(detail("Faq", { q: "ruhezeit" }));
  expect(targetFromUrl("/faq/turniere#einchecken")).toBeNull();
  for (const url of ["/servers", "/membership/join", "/privacy", "/imprint", "", null, undefined]) {
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
  // Turnierleitung (#1158, #1160): Fälle öffnen ihre Ansicht mit genau diesem Fall.
  expect(targetFromNotification(note("match_attention", { match_id: "m" }, "/tournaments/cup/leitung?fall=ds-m") as never)).toEqual(detail("TournamentLead", { id: "cup", fall: "ds-m" }));
  expect(targetFromNotification(note("match_attention", { match_id: "m" }, "/matches/m") as never)).toEqual(detail("MatchDetail", { id: "m" }));
  expect(targetFromNotification(note("prize_ready") as never)).toEqual(detail("MyPrizes"));
  // Sammelmeldung nach der Ruhezeit (#2444): immer die Glocke - auch mit Kennungen in den Metadaten.
  expect(targetFromNotification(note("quiet_digest", { tournament_id: "t-1", category: "tournament_updates" }, "/notifications") as never)).toEqual(detail("Notifications"));
  expect(targetFromNotification(note("quiet_digest", {}, "") as never)).toEqual(detail("Notifications"));
  // Hinweis der Turnierleitung (#1166, #2393): öffnet die Seite, auf der das Banner steht - Turnier oder ganzes Event.
  expect(targetFromNotification(note("tournament_notice", { tournament_id: "t-1", notice_id: "n1" }, "/tournaments/fc-cup") as never)).toEqual(detail("TournamentDetail", { id: "fc-cup" }));
  expect(targetFromNotification(note("tournament_notice", { tournament_id: "t-1", event_id: "e-1" }, "/events/herbst-lan") as never)).toEqual(detail("EventDetail", { id: "herbst-lan" }));
  expect(targetFromNotification(note("friend_request", { requester_username: "kiwikomet" }) as never)).toEqual(detail("PublicProfile", { username: "kiwikomet" }));
  expect(targetFromNotification(note("friend_accepted") as never)).toEqual(tab("CommunityTab", "CommunityHub", { section: "players" }));
  expect(targetFromNotification(note("achievement", {}, "/profile?tab=achievements") as never)).toEqual(detail("OwnProfile", { tab: "achievements" }));
  // Mein Bereich (#2059): „Deine Rechnung ist da“ mit der neuen Adresse öffnet den Beleg, die Sammel-Mail die E-Mail.
  expect(targetFromNotification(note("billing_invoice", {}, "/mein-bereich/rechnungen?invoice=d-7") as never)).toEqual(detail("MyInvoices", { invoice: "d-7" }));
  expect(targetFromNotification(note("system", {}, "/mein-bereich/benachrichtigungen?bereich=mail") as never)).toEqual(detail("MeinBereichGruppe", { gruppe: "benachrichtigungen", ziel: "sammel-mail" }));

  // Ohne Ziel: die Liste der Glocke - über dem aktuellen Tab.
  mockRef.ready = true;
  mockRef.root = onTab("VereinTab");
  expect(navigateToNotification(note("unbekannt") as never)).toBe(false);
  expect(mockRef.navigate).toHaveBeenLastCalledWith("Notifications", undefined);
});

test("gemeinsame Herkunfts-Matrix (#998): Adressen und Benachrichtigungen öffnen nur die eigene Website als Screen", () => {
  for (const url of OWN_ARTICLE_LINKS) {
    expect([url, targetFromUrl(url)]).toEqual([url, detail("NewsDetail", { id: ARTICLE })]);
    expect([url, targetFromNotification({ id: "n", kind: "system", title: "Neu", read: false, url } as never)]).toEqual([url, detail("NewsDetail", { id: ARTICLE })]);
  }
  for (const url of FOREIGN_ARTICLE_LINKS) {
    expect([url, targetFromUrl(url)]).toEqual([url, null]);
    expect([url, targetFromNotification({ id: "n", kind: "system", title: "Neu", read: false, url } as never)]).toEqual([url, null]);
  }
  // Ein Pfad ohne führenden Schrägstrich bleibt wie bisher ein Pfad der eigenen Website.
  expect(targetFromUrl("news/saisonstart")).toEqual(detail("NewsDetail", { id: "saisonstart" }));
});
