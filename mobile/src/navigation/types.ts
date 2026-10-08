import type { NavigatorScreenParams } from "@react-navigation/native";

// Gast zuerst (#918): Die App startet ohne Konto. Anmelden und Registrieren liegen im Stapel über den Tabs - erreichbar aus
// dem Profil-Tab, dem Hinweis beim ersten Start und überall, wo man ein Konto braucht; danach geht es zurück, woher man kam.
export type RootStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  Login: undefined;
  Register: undefined;
};

// Fünf Tabs für alle (#1143, Fabians Wahl B): Home · Events · Community · Verein · Profil. Jeder Tab ist ein eigener Stapel
// mit denselben Detail-Screens (#1144) - was man öffnet, legt sich über den Tab, in dem man gerade ist.
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
  TournamentList: { filter?: EventsFilter } | undefined;
  CommunityHub: { section?: CommunitySection } | undefined;
  VereinHub: undefined;
  Profile: { tab?: ProfileTabKey } | undefined;
};

/** Detail-Screens, die in jedem Tab-Stapel liegen (#1144). */
export type DetailParamList = {
  TournamentDetail: { id: string };
  EventDetail: { id: string };
  FastLapDetail: { id: string };
  MatchDetail: { id: string };
  TournamentChat: { id: string; title?: string };
  // `invite` (#1191): der Schlüssel aus einem Einladungs-Link (/teams/<id>?einladung=…) - oben steht dann „Beitreten“.
  TeamDetail: { id: string; invite?: string };
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
  MyMembership: undefined;
  MemberDocuments: undefined;
  // Versammlungen und Abstimmungen (#327): aus der Vereinsakte, nur mit Weg dorthin.
  MemberMeetings: undefined;
  // Helferdienste (#331): Schichten aus der Vereinsakte.
  // `event` (#1197): aus dem Helfer-Aufruf - diese Veranstaltung steht oben und leuchtet.
  MemberHelperShifts: { event?: number } | undefined;
  MemberCard: undefined;
  // Einlass bei der Generalversammlung (#845): nur für den Vorstand (Bereich „Verein“).
  Admission: undefined;
  InfoCenter: { section?: "sponsors" | "partners" | "events" | "benefits" | "references" | "profiles" } | undefined;
  // Über uns, Vorstand, Werte, Kontakt (#1024): kurz in der App, lange Seiten bleiben auf der Website.
  ClubAbout: undefined;
  // Jahresrückblick „Dein Jahr bei LION“ (#1195): ab Mitte Dezember; Vorschau für die Verwaltung.
  YearReview: { preview?: boolean } | undefined;
  // Einstellungen an einem Ort (#1146): Zahnrad oben im Profil.
  Settings: undefined;
  ProfileEdit: undefined;
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
