import { createNavigationContainerRef, type NavigationState, type PartialState } from "@react-navigation/native";
import type { AppStackParamList, DetailScreenName, LooseNavigation, MainTabName, TabRootParamList } from "./types";
import type { UserNotification } from "../types";
import { isLocalPath, ownPath } from "../lib/siteUrls";
import { overallParams } from "../lib/leagueOverall";
import { isQuietDigest } from "../lib/notificationKinds";

// Die Navigation von außen (#1144): Benachrichtigungen, Links von außen und Adressen aus Inhalten öffnen ihren Screen
// über dem Tab, in dem man gerade ist - die Tab-Leiste springt nicht mit. Nur die Übersicht eines Tabs (Home, Events,
// Community, Verein, Mein Bereich) wechselt den Tab. Eine Stelle für alle Wege: `openTarget`.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const navigationRef = createNavigationContainerRef<any>();

/** Der Reiter „Trophäen“ in Links (#2425): dieselben Namen wie im Web (`?tab=trophaeen`, `trophies`, `awards`). */
const TROPHY_TABS = new Set(["trophaeen", "trophies", "awards"]);
let pendingNotification: UserNotification | null = null;

type TabRootName = keyof TabRootParamList;

/** Ein Ziel in der App: die Übersicht eines Tabs oder ein Detail-Screen über dem aktuellen Tab. */
export type AppTarget =
  | { kind: "tab"; tab: MainTabName; screen: TabRootName; params?: Record<string, unknown> }
  | { kind: "detail"; screen: DetailScreenName; params?: Record<string, unknown> };

/** Welche Übersicht zu welchem Tab gehört. */
export const TAB_OF_ROOT: Record<TabRootName, MainTabName> = {
  Dashboard: "HomeTab",
  TournamentList: "EventsTab",
  CommunityHub: "CommunityTab",
  VereinHub: "VereinTab",
  MeinBereich: "ProfileTab",
};

export const ROOT_OF_TAB: Record<MainTabName, TabRootName> = {
  HomeTab: "Dashboard",
  EventsTab: "TournamentList",
  CommunityTab: "CommunityHub",
  VereinTab: "VereinHub",
  ProfileTab: "MeinBereich",
};

const tab = (screen: TabRootName, params?: Record<string, unknown>): AppTarget => ({ kind: "tab", tab: TAB_OF_ROOT[screen], screen, params });
const detail = (screen: DetailScreenName, params?: Record<string, unknown>): AppTarget => ({ kind: "detail", screen, params });

export function navigateToNotification(item: UserNotification) {
  if (!navigationRef.isReady()) {
    pendingNotification = item;
    return false;
  }
  const target = targetFromNotification(item);
  if (!target) {
    openTarget(detail("Notifications"));
    return false;
  }
  openTarget(target);
  return true;
}

/** Eine Adresse der Website im passenden Screen öffnen - false, wenn die App dafür keinen Screen hat. */
export function navigateToUrl(url?: string | null): boolean {
  if (!navigationRef.isReady()) return false;
  const target = targetFromUrl(url);
  if (!target) return false;
  openTarget(target);
  return true;
}

/**
 * Gast zuerst (#918): Anmelden oder Registrieren öffnen - aus dem Tab Mein Bereich, dem Hinweis beim ersten Start, einem Turnier,
 * dem Adventkalender ... Die Seiten liegen im Stapel über den Tabs; nach der Anmeldung geht es dorthin zurück, woher man kam.
 */
export function openSignIn(screen: "Login" | "Register" = "Login") {
  if (!navigationRef.isReady()) return false;
  navigationRef.navigate(screen);
  return true;
}

/** Ob gerade Anmelden oder Registrieren offen ist (#918) - dann braucht es keinen Hinweis darauf. */
export function signInOpen() {
  if (!navigationRef.isReady()) return false;
  const name = navigationRef.getCurrentRoute()?.name as string | undefined;
  return name === "Login" || name === "Register";
}

/** Der Tab, in dem man gerade ist (ohne Navigation: Home). */
function rootStateOf(): NavigationState | undefined {
  return navigationRef.isReady() && typeof navigationRef.getRootState === "function" ? navigationRef.getRootState() : undefined;
}

export function currentTab(): MainTabName {
  const root = rootStateOf();
  const main = root?.routes?.find((route) => route.name === "Main");
  const tabs = main?.state as NavigationState | PartialState<NavigationState> | undefined;
  const index = typeof tabs?.index === "number" ? tabs.index : 0;
  const name = tabs?.routes?.[index]?.name as MainTabName | undefined;
  return name && name in ROOT_OF_TAB ? name : "HomeTab";
}

/** Zur Übersicht eines Tabs - Home, Events, Community, Verein oder Profil. Liegt etwas darüber, geht es darunter zurück. */
export function openTab(screen: TabRootName, params?: Record<string, unknown>) {
  if (!navigationRef.isReady()) return false;
  openTarget(tab(screen, params));
  return true;
}

/** Einen Detail-Screen über dem aktuellen Tab öffnen (Suche, Glocke, Saison-Figuren ...). */
export function openDetail<T extends DetailScreenName>(screen: T, params?: AppStackParamList[T]) {
  if (!navigationRef.isReady()) return false;
  openTarget(detail(screen, params as Record<string, unknown> | undefined));
  return true;
}

export function openTarget(target: AppTarget) {
  if (target.kind === "tab") {
    // `pop`: liegt im Tab schon etwas über der Übersicht, geht es dorthin zurück, statt eine zweite Übersicht aufzulegen.
    // Das äußere `pop`: steht Anmelden oder Registrieren darüber, geht es zurück zu den Tabs statt eine zweite Tab-Ebene
    // aufzulegen.
    navigationRef.navigate("Main", { screen: target.tab, params: { screen: target.screen, params: target.params, pop: true } }, { pop: true });
    return;
  }
  const rootState = rootStateOf();
  const rootName = rootState?.routes?.[rootState?.index ?? 0]?.name;
  if (rootName && rootName !== "Main") {
    // Über Anmelden oder Registrieren: zurück in die Tabs und dort im aktuellen Tab öffnen.
    navigationRef.navigate("Main", { screen: currentTab(), params: { screen: target.screen, params: target.params, initial: false } }, { pop: true });
    return;
  }
  // Ohne Ziel-Tab nimmt der Stapel des aktuellen Tabs den Screen auf (jeder Tab kennt alle Detail-Screens).
  (navigationRef as unknown as LooseNavigation).navigate(target.screen, target.params);
}

export function flushPendingNotification() {
  if (!navigationRef.isReady() || !pendingNotification) return false;
  const item = pendingNotification;
  pendingNotification = null;
  return navigateToNotification(item);
}

export function targetFromNotification(item: UserNotification): AppTarget | null {
  const meta = (item.meta || {}) as Record<string, unknown>;
  const kind = String(item.kind || "").toLowerCase();

  // Sammelmeldung nach der Ruhezeit (#2444): die Meldungen liegen in der Glocke - dorthin, egal was die Adresse sagt.
  if (isQuietDigest(item)) return detail("Notifications");

  // Saisonende-Moment (#2584, docs/LIGA.md F.8): Die Nachricht trägt `reason: league_moment` und `moment_id`. Die Ligaseite gibt es
  // nur im Web - Mein Profil holt den Moment gleich, ist er noch offen; sonst steht er dort unter „Saisonende“ zum Ansehen.
  if (stringMeta(meta, "reason") === "league_moment") return ownProfileTarget("", stringMeta(meta, "moment_id"));

  // Turnierleitung (#1158, #1160): „Dispute: bitte prüfen“, „Ergebnis fehlt“, „Station defekt“ öffnen ihre Ansicht.
  if (kind === "match_attention" && String(item.url || "").includes("/leitung")) {
    const lead = targetFromUrl(item.url);
    if (lead) return lead;
  }
  // Hinweis der Turnierleitung (#1166, #2393): die Adresse des Servers nennt die Seite mit dem Banner - beim Ziel „ganzes
  // Event“ die Event-Seite, nicht das Turnier, aus dem er geschrieben wurde.
  if (kind === "tournament_notice") {
    const page = targetFromUrl(item.url);
    if (page) return page;
  }
  const matchId = stringMeta(meta, "match_id");
  if (matchId && (kind.includes("match") || kind.includes("station"))) return detail("MatchDetail", { id: matchId });

  const teamId = stringMeta(meta, "team_id");
  if (teamId && kind.includes("team_chat")) return detail("TeamChat", { id: teamId, title: "Team-Chat" });
  if (teamId && kind.includes("team")) return detail("TeamDetail", { id: teamId });

  const threadUserId = stringMeta(meta, "thread_user_id");
  if (threadUserId && kind.includes("direct_message")) return detail("DirectThread", { userId: threadUserId, title: item.title || "Chat" });

  const newsId = stringMeta(meta, "news_id") || stringMeta(meta, "slug");
  if (newsId && kind.includes("news")) return detail("NewsDetail", { id: newsId });

  const challengeId = stringMeta(meta, "challenge_id") || stringMeta(meta, "fastlap_id");
  if (challengeId && (kind.includes("f1") || kind.includes("fast"))) return detail("FastLapDetail", { id: challengeId });
  // Gewinne (#1149): „Nur für dich“ im Profil führt zu „Meine Gewinne“ - die Benachrichtigung auch.
  if (kind.includes("prize")) return detail("MyPrizes");

  const tournamentId = stringMeta(meta, "tournament_id");
  if (tournamentId && kind.includes("tournament_chat")) return detail("TournamentChat", { id: tournamentId, title: "Turnier-Chat" });
  if (tournamentId && kind.includes("tournament")) return detail("TournamentDetail", { id: tournamentId });

  // Rückmeldung (#1196): „Wie war der FC 26 Cup?“ öffnet Home mit dem Bewerten.
  const feedbackTarget = stringMeta(meta, "target_id");
  const feedbackKind = stringMeta(meta, "kind");
  if (kind === "feedback_request" && feedbackTarget && (feedbackKind === "tournament" || feedbackKind === "event")) {
    return tab("Dashboard", { feedback: `${feedbackKind}:${feedbackTarget}` });
  }

  const requesterId = stringMeta(meta, "requester_username") || stringMeta(meta, "username");
  if (requesterId && kind.includes("friend")) return detail("PublicProfile", { username: requesterId });
  // Freunde stehen in Community → Spieler (#1143).
  if (kind.includes("friend")) return tab("CommunityHub", { section: "players" });

  return targetFromUrl(item.url);
}

/** Welche Adresse der Website welchen Screen öffnet - alte Adressen aus Mails, Benachrichtigungen und Links eingeschlossen. */
export function targetFromUrl(url?: string | null): AppTarget | null {
  const parsed = parsePath(url);
  if (!parsed.path && !parsed.root) return null;
  const parts = parsed.path.split("/").filter(Boolean);
  const [first, second, third] = parts;
  const query = new URLSearchParams(parsed.query);

  if (first === "dashboard" && query.get("bewerten")) return tab("Dashboard", { feedback: query.get("bewerten") });
  if (parsed.root || first === "dashboard") return tab("Dashboard");
  if (first === "matches" && second) return detail("MatchDetail", { id: second });
  // Turnierleitung (#1156, #1160): /tournaments/<slug>/leitung?spiel=…&fall=… öffnet die Ansicht der Turnierleitung.
  if (first === "tournaments" && second && third === "leitung") {
    return detail("TournamentLead", { id: second, ...(query.get("spiel") ? { spiel: query.get("spiel") } : {}), ...(query.get("fall") ? { fall: query.get("fall") } : {}) });
  }
  if (first === "tournaments" && second) return detail(third === "chat" ? "TournamentChat" : "TournamentDetail", { id: second });
  if (first === "events" && second) return detail("EventDetail", { id: second });
  if ((first === "fastlap" || first === "fastlaps") && second) return detail("FastLapDetail", { id: second });
  if (first === "f1" && second === "challenges" && third) return detail("FastLapDetail", { id: third });
  if (first === "f1" && second) return detail("FastLapDetail", { id: second });
  // Einladungs-Link (#1191): der Schlüssel geht mit, die Team-Seite zeigt dann „Beitreten“. `?tab=trophaeen` (#2425) öffnet die Trophäen.
  if (first === "teams" && second) {
    const trophies = TROPHY_TABS.has(query.get("tab") || "") ? { tab: "trophies" as const } : {};
    return detail("TeamDetail", query.get("einladung") ? { id: second, invite: query.get("einladung"), ...trophies } : { id: second, ...trophies });
  }
  // Gesamtwertung über Seasons (F.5, #2173): /liga/<liga>/<season>/gesamtwertung - die übrigen Seiten der Liga bleiben im Web.
  if (first === "liga") {
    const overall = overallParams(parsed.path);
    if (overall) return detail("LeagueOverall", overall);
  }
  if (first === "news" && second) return detail("NewsDetail", { id: second });
  // Saison einer Serie (#1945): /references/series/<spur>/<saison> öffnet die Saison in der App.
  if (first === "references" && second === "series" && third && parts[3]) {
    // Ergebnis einer Runde (#1974): …/runde/<nr>?lauf=<lauf> öffnet die Runde mit dem Reiter des Laufs.
    const round = parts[4] === "runde" && /^\d{1,3}$/.test(parts[5] || "") ? Number(parts[5]) : 0;
    if (round > 0) return detail("ReferenceRound", { lineage: third, season: parts[3], round, ...(query.get("lauf") ? { session: query.get("lauf") } : {}) });
    return detail("ReferenceSeason", { lineage: third, season: parts[3], ...(query.get("ansicht") === "statistik" ? { view: "statistik" } : {}) });
  }
  if ((first === "galerie" || first === "gallery") && second) return detail("GalleryAlbum", { id: second });
  if (first === "messages" && second) return detail("DirectThread", { userId: second });
  // Mein Bereich (#2059): dieselben Adressen wie im Web, jede Gruppe mit Reitern und Ankern.
  if (first === "mein-bereich") return meinBereichTarget(parts.slice(1), query, parsed.hash);
  // Das eigene Profil (/u/me) liegt seit Mein Bereich über dem Tab (#2059) - `?tab=` öffnet einen Reiter wie im Web.
  if (first === "u" && second === "me") return ownProfileTarget(query.get("tab") || "", query.get("moment") || "");
  if (["u", "users", "user", "players", "player", "profiles"].includes(first || "") && second) return detail("PublicProfile", { username: second });
  if (first === "profile" && second) return detail("PublicProfile", { username: second });
  if (first === "profile") return profileTarget(query);
  if (first === "account" && second === "invoices") return detail("MyInvoices", invoiceParams(query));
  if (first === "account" && second === "documents") return detail("MyDocuments");
  if ((first === "me" || first === "my") && second === "prizes") return detail("MyPrizes");
  // Meine Strafen (#2059): im Web Mein Bereich → Rechnungen & Unterlagen → Strafen, in der App dieselbe Stelle.
  if (first === "my" && second === "penalties") return gruppeTarget("rechnungen", "strafen");
  // Helfer-Aufruf (#1197): /members/helfen?event=5 öffnet die Helferdienste mit dieser Veranstaltung oben.
  if (first === "members" && second === "helfen" && Number(query.get("event"))) return detail("MemberHelperShifts", { event: Number(query.get("event")) });
  if (first === "members" && second) return memberTarget(second);
  if (first === "seasons") return detail("SeasonPass");
  // „Mein Kalender“ (#1788): /calendar/mine öffnet im Events-Tab die eigenen Termine.
  if (first === "calendar" && second === "mine") return tab("TournamentList", { scope: "mine" });
  if (second) return null;

  switch (first) {
    case "events":
      return tab("TournamentList", { filter: "events" });
    case "tournaments":
      return tab("TournamentList", { filter: "tournaments" });
    case "fastlap":
    case "fastlaps":
    case "f1":
      // Fast Laps stehen im Events-Tab (#1150) - keine zweite Liste mehr.
      return tab("TournamentList", { filter: "fastlaps" });
    case "calendar":
    case "esports":
      return tab("TournamentList");
    case "community":
      return tab("CommunityHub");
    case "messages":
      return tab("CommunityHub", { section: "chats" });
    case "teams":
      return tab("CommunityHub", { section: "teams" });
    case "players":
      return tab("CommunityHub", { section: "players" });
    case "verein":
    case "mitgliederbereich":
    case "member-area":
    case "membership":
      return tab("VereinHub");
    case "notifications":
      return detail("Notifications");
    // Der Schaukasten der Erfolge (E13, #623) - auch Ziel von „Krone“-Benachrichtigungen im Web.
    case "achievements":
      return detail("AchievementShowcase");
    case "news":
      return detail("NewsList");
    case "gallery":
    case "galerie":
      return detail("Gallery");
    case "advent":
      return detail("AdventCalendar");
    // Ostereiersuche (#647): Korb, Hinweise, Preise - auch aus Benachrichtigungen (Gewinn, voller Korb).
    case "ostern":
      return detail("EasterHunt");
    // Jahresrückblick (#1195): die Meldung „Dein Jahr ist da“ führt hierher.
    case "dein-jahr":
      return detail("YearReview");
    // Über uns, Vorstand, Werte (#1024): kurz in der App.
    case "about":
    case "board":
    case "values":
      return detail("ClubAbout");
    case "sponsors":
      return detail("InfoCenter", { section: "sponsors" });
    case "partners":
      return detail("InfoCenter", { section: "partners" });
    case "references":
      return detail("InfoCenter", { section: "references" });
    // FAQ (#2449): /faq und die alte Hilfe (/hilfe) öffnen die FAQ der App. Eine Anleitung (/faq/<thema>) bleibt im Web -
    // dort stehen die Bilder. Wie im Web: #frage-<id> und #bereich-<id> klappen auf, ?q= sucht.
    case "faq":
    case "hilfe":
      return detail("Faq", faqParams(parsed.hash, query));
    // Datenschutz und Konto (#2059): im Web Mein Bereich → Datenschutz → Daten herunterladen.
    case "privacy-account":
      return gruppeTarget("datenschutz", "daten");
    default:
      return null;
  }
}

/** Anker und Suche der FAQ (#2449) - ein kaputter Anker (etwa #%E0%A4) zählt als keiner, wie ankerAus im Web. */
function faqParams(hash: string, query: URLSearchParams): AppStackParamList["Faq"] {
  let anker = "";
  try {
    anker = decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    anker = "";
  }
  const params: { frage?: string; bereich?: string; q?: string } = {};
  if (anker.startsWith("frage-") && anker.length > 6) params.frage = anker.slice(6);
  if (anker.startsWith("bereich-") && anker.length > 8) params.bereich = anker.slice(8);
  if (query.get("q")) params.q = query.get("q") || "";
  return Object.keys(params).length ? params : undefined;
}

function profileTarget(query: URLSearchParams): AppTarget {
  const wanted = query.get("tab") || "";
  // Alte Reiter von /profile: die Inbox ist Community → Chats, Teams und Freunde stehen in Community (#1143).
  if (wanted === "inbox") {
    const to = query.get("to") || "";
    return to ? detail("DirectThread", { userId: to }) : tab("CommunityHub", { section: "chats" });
  }
  if (wanted === "teams") return tab("CommunityHub", { section: "teams" });
  if (wanted === "friends") return tab("CommunityHub", { section: "players" });
  // „Deine Rechnung ist da“ (#841): Meine Rechnungen - mit dem genannten Beleg, der sich gleich öffnet.
  if (wanted === "invoices") return detail("MyInvoices", invoiceParams(query));
  if (wanted === "prizes") return detail("MyPrizes");
  // „Erfolg freigeschaltet“ (#301, #218) führt zu den Erfolgen im eigenen Profil, Trophäen (#2425) zum Reiter Trophäen.
  if (wanted === "achievements" || wanted === "honours" || TROPHY_TABS.has(wanted)) return ownProfileTarget(wanted);
  // Die Einstellungen wohnen seit #2059 in Mein Bereich - jeder alte Reiter an seiner Stelle (wie legacyTarget im Web).
  // Der Link aus der Sammel-Mail (#1662) nennt ?bereich=mail - dann gleich zur Sammel-Mail (Themen, Ruhezeit, Mehr ebenso).
  if (wanted === "notifications") return gruppeTarget("benachrichtigungen", BENACHRICHTIGUNG_BEREICHE[query.get("bereich") || ""]);
  if (wanted === "privacy") return gruppeTarget("datenschutz");
  if (wanted === "security") return gruppeTarget("konto");
  if (wanted === "sessions") return gruppeTarget("konto", "geraete");
  if (wanted === "appearance") return gruppeTarget("konto", "darstellung");
  if (wanted === "about") return gruppeTarget("konto", "version");
  if (wanted === "calendar") return detail("CalendarSubscription");
  if (["basic", "gaming", "socials", "edit"].includes(wanted)) return detail("ProfileEdit");
  // /profile ohne Reiter: im Web Mein Bereich → Profil, hier dieselbe Gruppe.
  return gruppeTarget("profil");
}

/** Eine Kennung des Servers (Saisonende-Moment) - nur Buchstaben, Ziffern, `_` und `-`, sonst keine. */
const MOMENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Das eigene Profil mit Reiter - dieselben Namen wie im Web (achievements, honours, trophaeen/trophies/awards). `moment` (#2584): ein
 * Saisonende-Moment, den das Profil gleich holt. */
function ownProfileTarget(wanted: string, moment = ""): AppTarget {
  const tab = wanted === "achievements" || wanted === "honours" ? wanted : TROPHY_TABS.has(wanted) ? "awards" : "";
  const params = { ...(tab ? { tab } : {}), ...(MOMENT_ID.test(moment) ? { moment } : {}) };
  return detail("OwnProfile", Object.keys(params).length ? params : undefined);
}

type MeinBereichGruppe = AppStackParamList["MeinBereichGruppe"]["gruppe"];

function gruppeTarget(gruppe: MeinBereichGruppe, ziel?: string): AppTarget {
  return detail("MeinBereichGruppe", ziel ? { gruppe, ziel } : { gruppe });
}

/** Ein Anker (#nummer) ohne Raute - ein kaputter (#%E0%A4) zählt als keiner, nur Buchstaben, Ziffern und Bindestrich. */
function ankerAus(hash: string): string {
  try {
    const anker = decodeURIComponent(String(hash || "").replace(/^#/, ""));
    return /^[a-z0-9-]{1,40}$/.test(anker) ? anker : "";
  } catch {
    return "";
  }
}

// Mein Bereich (#2059): die Reiter und Anker des Webs (frontend/src/lib/meinBereichSeiten.js, meinBereichAlt.js) und ihre
// Stelle in der App. Ohne Reiter und Anker öffnet eine Gruppe ihre Seite in Mein Bereich - außer dort, wo die Website an
// dieser Adresse eine Liste zeigt, die die App als eigenen Screen hat: Rechnungen (die Belege) und Verein (der Tab Verein).
const MITGLIEDSCHAFT_ZIELE = new Set(["status", "beitrag", "nummer", "meine-daten", "website-profil", "austritt"]);
const BENACHRICHTIGUNG_BEREICHE: Record<string, string> = { themen: "themen", mail: "sammel-mail", ruhezeit: "ruhezeit", mehr: "weitere-wege" };
const KONTO_REITER: Record<string, string> = { sessions: "geraete", appearance: "darstellung", about: "version" };
const DATENSCHUTZ_REITER: Record<string, string> = { einwilligungen: "einwilligungen", daten: "daten", loeschung: "loeschung" };

function meinBereichTarget(segments: string[], query: URLSearchParams, hash: string): AppTarget {
  const [gruppe, seite] = segments;
  const anker = ankerAus(hash);
  const reiter = query.get("tab") || "";
  switch (gruppe) {
    case "profil":
      if (["basic", "gaming", "socials", "edit"].includes(reiter)) return detail("ProfileEdit");
      return gruppeTarget("profil", anker || undefined);
    case "mitgliedschaft":
      if (anker === "mitgliedskarte") return detail("MemberCard");
      if (MITGLIEDSCHAFT_ZIELE.has(anker)) return detail("MyMembership", { ziel: anker });
      return gruppeTarget("mitgliedschaft", anker || undefined);
    case "rechnungen":
      if (reiter === "unterlagen") return detail("MyDocuments");
      if (reiter === "gewinne") return detail("MyPrizes");
      if (reiter === "strafen") return gruppeTarget("rechnungen", "strafen");
      return detail("MyInvoices", invoiceParams(query));
    case "verein":
      if (seite === "versammlungen") return detail("MemberMeetings");
      if (seite === "helfen") return Number(query.get("event")) ? detail("MemberHelperShifts", { event: Number(query.get("event")) }) : detail("MemberHelperShifts");
      if (seite === "dokumente") return detail("MemberDocuments");
      if (seite === "vorteile") return detail("InfoCenter", { section: "benefits" });
      // Interne News: die News, gleich auf „Verein“ gestellt.
      if (seite === "news") return detail("NewsList", { scope: "club" });
      // Die Übersicht: der Tab Verein, wie bisher /members/area.
      return tab("VereinHub");
    case "benachrichtigungen":
      return gruppeTarget("benachrichtigungen", BENACHRICHTIGUNG_BEREICHE[query.get("bereich") || ""] || anker || undefined);
    case "konto":
      if (reiter === "calendar") return detail("CalendarSubscription");
      // `mfa=required` (#348): die Zwei-Faktor-Anmeldung richtet die Website ein - die Zeile dorthin.
      if (query.get("mfa") === "required") return gruppeTarget("konto", "passwort");
      return gruppeTarget("konto", KONTO_REITER[reiter] || anker || undefined);
    case "datenschutz":
      return gruppeTarget("datenschutz", DATENSCHUTZ_REITER[reiter] || anker || undefined);
    default:
      // /mein-bereich selbst - und eine Gruppe, die es nicht gibt, landet in der Übersicht statt im Leeren.
      return tab("MeinBereich");
  }
}

function memberTarget(page: string): AppTarget | null {
  switch (page) {
    case "area":
      return tab("VereinHub");
    // Interne News (#2059): wie /mein-bereich/verein/news - die News, gleich auf „Verein“ gestellt.
    case "news":
      return detail("NewsList", { scope: "club" });
    case "membership":
      return detail("MyMembership");
    case "documents":
      return detail("MemberDocuments");
    case "meetings":
      return detail("MemberMeetings");
    case "helfen":
      return detail("MemberHelperShifts");
    case "benefits":
      return detail("InfoCenter", { section: "benefits" });
    default:
      return null;
  }
}

function invoiceParams(query: URLSearchParams) {
  const invoice = query.get("invoice") || "";
  return /^d-\d{1,12}$/.test(invoice) ? { invoice } : undefined;
}

function parsePath(value?: string | null) {
  // Eine fremde Adresse (#921) bekommt nie einen Screen - auch nicht mit zufällig gleichem Pfad. Dieselbe Regel wie
  // contentLinks und openLink (#998): ein Pfad nur, wenn er auf der eigenen Seite bleibt („//host/…“ ist fremd),
  // sonst nur Adressen der eigenen Website.
  const text = String(value || "").trim();
  const raw = isLocalPath(text) ? text : ownPath(text) || "";
  if (!raw) return { path: "", query: "", hash: "", root: false };
  try {
    const url = new URL(raw, "https://lionsquad.local");
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    // Der Anker (#2449, FAQ): ownPath lässt ihn bei vollen Adressen weg - dann aus der Adresse selbst.
    return { path, query: url.search.replace(/^\?/, ""), hash: url.hash || hashOf(text), root: !path && raw.startsWith("/") };
  } catch {
    const [vorAnker, hash = ""] = raw.split("#");
    const [path, query = ""] = vorAnker.split("?");
    const clean = path.replace(/^\/+|\/+$/g, "");
    return { path: clean, query, hash: hash ? `#${hash}` : "", root: !clean && raw.startsWith("/") };
  }
}

function hashOf(text: string): string {
  try {
    return /^https?:\/\//i.test(text) ? new URL(text).hash : "";
  } catch {
    return "";
  }
}

function stringMeta(meta: Record<string, unknown>, key: string) {
  const value = meta[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}
