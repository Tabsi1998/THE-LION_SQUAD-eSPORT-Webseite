import type { NavigatorScreenParams } from "@react-navigation/native";
import type { GruppeKey } from "../lib/meinBereich";

/** Hilfe beim Anmelden (#996): Link zum Zurücksetzen des Passworts oder neue Bestätigungs-Mail. */
export type LoginHelpKind = "password" | "verification";

// Gast zuerst (#918): Die App startet ohne Konto. Anmelden und Registrieren liegen im Stapel über den Tabs - erreichbar aus
// dem Tab Mein Bereich, dem Hinweis beim ersten Start und überall, wo man ein Konto braucht; danach geht es zurück, woher man kam.
export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  Login: undefined;
  Register: undefined;
  // Passwort vergessen oder Bestätigungs-Mail (#996): die E-Mail aus der Anmeldung kommt mit.
  LoginHelp: { kind: LoginHelpKind; email?: string };
};

// Fünf Tabs für alle (#1143, Fabians Wahl B): Home · Events · Community · Verein · Mein Bereich (#2059, früher „Profil“; die
// Kennung `ProfileTab` bleibt). Jeder Tab ist ein eigener Stapel mit denselben Detail-Screens (#1144) - was man öffnet, legt
// sich über den Tab, in dem man gerade ist.
export type MainTabParamList = {
  HomeTab: NavigatorScreenParams<AppStackParamList> | undefined;
  EventsTab: NavigatorScreenParams<AppStackParamList> | undefined;
  CommunityTab: NavigatorScreenParams<AppStackParamList> | undefined;
  VereinTab: NavigatorScreenParams<AppStackParamList> | undefined;
  ProfileTab: NavigatorScreenParams<AppStackParamList> | undefined;
};

export type MainTabName = keyof MainTabParamList;

/** Die Reiter des Profils (#1149) - eigenes und fremdes Profil haben dieselben. */
export type ProfileTabKey = "overview" | "achievements" | "awards" | "references" | "teams" | "honours";

/** Was im Events-Tab vorgewählt ist - alte Links auf die Fast-Lap-Liste landen bei „Fast Laps“ (#1150). */
export type EventsFilter = "all" | "events" | "tournaments" | "fastlaps";

/** Die Bereiche im Tab Community (#1143). */
export type CommunitySection = "chats" | "teams" | "players" | "leaderboards";

/** Die Übersicht je Tab - der erste Screen im Stapel. */
export type TabRootParamList = {
  // `feedback` (#1196): „Wie war …?“ aus der Meldung - Home öffnet dann gleich das Bewerten.
  Dashboard: { feedback?: string } | undefined;
  // `scope: "mine"` (#1788): „Mein Kalender“ - nur die eigenen Termine.
  TournamentList: { filter?: EventsFilter; scope?: "all" | "mine" } | undefined;
  CommunityHub: { section?: CommunitySection } | undefined;
  VereinHub: undefined;
  // Mein Bereich (#2059, #1677): die Übersicht mit „Zu tun“, „Häufig gebraucht“, der Suche und allen Gruppen.
  MeinBereich: undefined;
};

/** Detail-Screens, die in jedem Tab-Stapel liegen (#1144). */
export type DetailParamList = {
  TournamentDetail: { id: string };
  // returnTournament (#1184): vom Turnier mit Event-Pflicht (#875) gekommen - nach der Anmeldung geht es dorthin zurück.
  EventDetail: { id: string; returnTournament?: string };
  FastLapDetail: { id: string };
  MatchDetail: { id: string };
  // Turnierleitung am Handy (#1156): offene Spiele eines Turniers; `spiel` öffnet gleich das Ergebnis-Fenster.
  TournamentLead: { id: string; spiel?: string; fall?: string };
  TournamentChat: { id: string; title?: string };
  // `invite` (#1191): der Schlüssel aus einem Einladungs-Link (/teams/<id>?einladung=…) - oben steht dann „Beitreten“.
  // `tab` (#2425): „trophies“ öffnet gleich den Reiter Trophäen (aus /teams/<id>?tab=trophaeen).
  TeamDetail: { id: string; invite?: string; tab?: "trophies" };
  TeamChat: { id: string; title?: string };
  PublicProfile: { username: string };
  DirectThread: { userId: string; title?: string };
  NewsList: undefined;
  NewsDetail: { id: string };
  // Galerie (#236): Alben, Album-Raster, Großansicht ab einem Bild.
  Gallery: undefined;
  GalleryAlbum: { id: string };
  GalleryViewer: { albumId: string; index: number };
  // Die Glocke (#1145): die einzige Stelle für Benachrichtigungen.
  Notifications: undefined;
  // Die Lupe (#1145): eine Suche über Turniere, Events, News, Spieler und Teams.
  Search: undefined;
  SeasonPass: undefined;
  // Schaukasten der Erfolge (E13, #623): Erfolg der Woche, Kategorien, Bestenliste, Katalog mit Seltenheit.
  AchievementShowcase: undefined;
  // Adventkalender (#641, #642): 24 Türchen, derselbe Stand wie auf der Website.
  AdventCalendar: undefined;
  EasterHunt: undefined;
  // Meine Rechnungen (#320): für jedes Konto, nicht nur Mitglieder - erreichbar über „Nur für dich“ im Profil (#1149).
  /** `invoice`: aus „Deine Rechnung ist da“ (#841) - der Beleg öffnet sich gleich. */
  MyInvoices: { invoice?: string } | undefined;
  // Meine Gewinne (#1149): aus „Nur für dich“ im Profil.
  MyPrizes: undefined;
  // Mitgliederbereich (#340, #1147): oben im Tab Verein, nur für Vereinsmitglieder; der Server prüft jede Antwort.
  // `ziel` (#2059): die Stelle, die sich gleich zeigt (status, beitrag, nummer, meine-daten, website-profil, austritt).
  MyMembership: { ziel?: string } | undefined;
  MemberDocuments: undefined;
  // Deine Unterlagen (#1255): die eigenen Schreiben aus der Vereinsakte - aus „Nur für dich“ im Profil.
  MyDocuments: undefined;
  // Versammlungen und Abstimmungen (#327): aus der Vereinsakte, nur mit Weg dorthin.
  MemberMeetings: undefined;
  // Helferdienste (#331): Schichten aus der Vereinsakte.
  // `event` (#1197): aus dem Helfer-Aufruf - diese Veranstaltung steht oben und leuchtet.
  MemberHelperShifts: { event?: number } | undefined;
  MemberCard: undefined;
  // Einlass bei der Generalversammlung (#845): nur für den Vorstand (Bereich „Verein“).
  Admission: undefined;
  InfoCenter: { section?: "sponsors" | "partners" | "events" | "benefits" | "references" | "profiles" } | undefined;
  // Saison einer Serie (#1945, nur lesen): Rennliga, Team-Liga oder Turnierserie - aus Verein › Erfolge und dem Profil.
  // `view` (#1974): „statistik“ öffnet den Reiter Statistik (aus /references/series/…?ansicht=statistik).
  ReferenceSeason: { lineage: string; season: string; view?: string };
  // Gesamtwertung über Seasons (F.5, #2215; App: #2173): /liga/<liga>/<season>/gesamtwertung, je Liga N Co-Teams und Spieler.
  LeagueOverall: { league: string; season: string; level?: number };
  // Ergebnis einer Runde (#1950, #1974): Rennliga, Runde nach Nummer, optional mit Lauf (`session`, wie ?lauf= im Web).
  ReferenceRound: { lineage: string; season: string; round: number; session?: string };
  // Über uns, Vorstand, Werte, Kontakt (#1024): kurz in der App, lange Seiten bleiben auf der Website.
  ClubAbout: undefined;
  // Jahresrückblick „Dein Jahr bei LION“ (#1195): ab Mitte Dezember; Vorschau für die Verwaltung.
  YearReview: { preview?: boolean } | undefined;
  // Das eigene Profil (#1149), wie andere es sehen - seit Mein Bereich (#2059) eine Seite darüber: aus Mein Bereich → Profil,
  // dem Kopf der Übersicht und /u/me. `tab` öffnet gleich einen Reiter (Erfolge, Trophäen …).
  OwnProfile: { tab?: ProfileTabKey } | undefined;
  // Eine Gruppe von Mein Bereich (#2059, #1677): die Einstellungen wohnen hier - flach, ohne Zahnrad. `ziel` springt zu einer
  // Stelle (Suchtreffer, /mein-bereich/<gruppe>#<ziel>).
  MeinBereichGruppe: { gruppe: Exclude<GruppeKey, "start">; ziel?: string };
  ProfileEdit: undefined;
  // Mein Kalender-Abo (#1788): der persönliche Link - aus den Einstellungen und dem Hinweis nach einer Anmeldung.
  CalendarSubscription: undefined;
  // FAQ (#2449): Suche, Häufige Fragen und Bereiche wie /faq im Web - aus den Einstellungen unter „Über die App“.
  // `frage`/`bereich` aus /faq#frage-<id> bzw. #bereich-<id> klappen auf und scrollen hin, `q` aus ?q= sucht.
  Faq: { frage?: string; bereich?: string; q?: string } | undefined;
};

export type AppStackParamList = TabRootParamList & DetailParamList;

/** Für Bausteine, die in jedem Stapel stehen: öffnen per Name, ohne die Typen des einzelnen Stapels. */
export type LooseNavigation = { navigate: (screen: string, params?: object) => void };
export type AppScreenName = keyof AppStackParamList;
export type DetailScreenName = keyof DetailParamList;

// Frühere Namen der Stapel: die Screens tippen ihre Props weiter damit, alle zeigen auf denselben Stapel.
export type TournamentStackParamList = AppStackParamList;
export type TeamStackParamList = AppStackParamList;
export type MoreStackParamList = AppStackParamList;
