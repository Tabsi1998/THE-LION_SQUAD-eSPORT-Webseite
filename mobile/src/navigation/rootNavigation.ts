import { createNavigationContainerRef, type NavigationState, type PartialState } from "@react-navigation/native";
import type { AppStackParamList, DetailScreenName, LooseNavigation, MainTabName, TabRootParamList } from "./types";
import type { UserNotification } from "../types";
import { ownPath } from "../lib/siteUrls";

// Die Navigation von außen (#1144): Benachrichtigungen, Links von außen und Adressen aus Inhalten öffnen ihren Screen
// über dem Tab, in dem man gerade ist - die Tab-Leiste springt nicht mit. Nur die Übersicht eines Tabs (Home, Events,
// Community, Verein, Profil) wechselt den Tab. Eine Stelle für alle Wege: `openTarget`.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const navigationRef = createNavigationContainerRef<any>();
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
  Profile: "ProfileTab",
};

export const ROOT_OF_TAB: Record<MainTabName, TabRootName> = {
  HomeTab: "Dashboard",
  EventsTab: "TournamentList",
  CommunityTab: "CommunityHub",
  VereinTab: "VereinHub",
  ProfileTab: "Profile",
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
 * Gast zuerst (#918): Anmelden oder Registrieren öffnen - aus dem Profil-Tab, dem Hinweis beim ersten Start, einem Turnier,
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

  if (parsed.root || first === "dashboard") return tab("Dashboard");
  if (first === "matches" && second) return detail("MatchDetail", { id: second });
  if (first === "tournaments" && second) return detail(third === "chat" ? "TournamentChat" : "TournamentDetail", { id: second });
  if (first === "events" && second) return detail("EventDetail", { id: second });
  if ((first === "fastlap" || first === "fastlaps") && second) return detail("FastLapDetail", { id: second });
  if (first === "f1" && second === "challenges" && third) return detail("FastLapDetail", { id: third });
  if (first === "f1" && second) return detail("FastLapDetail", { id: second });
  if (first === "teams" && second) return detail("TeamDetail", { id: second });
  if (first === "news" && second) return detail("NewsDetail", { id: second });
  if ((first === "galerie" || first === "gallery") && second) return detail("GalleryAlbum", { id: second });
  if (first === "messages" && second) return detail("DirectThread", { userId: second });
  // Das eigene Profil (/u/me) ist der Tab Profil; jedes andere Profil legt sich über den aktuellen Tab.
  if (first === "u" && second === "me") return tab("Profile");
  if (["u", "users", "user", "players", "player", "profiles"].includes(first || "") && second) return detail("PublicProfile", { username: second });
  if (first === "profile" && second) return detail("PublicProfile", { username: second });
  if (first === "profile") return profileTarget(query);
  if (first === "account" && second === "invoices") return detail("MyInvoices", invoiceParams(query));
  if ((first === "me" || first === "my") && second === "prizes") return detail("MyPrizes");
  if (first === "members" && second) return memberTarget(second);
  if (first === "seasons") return detail("SeasonPass");
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
    case "sponsors":
      return detail("InfoCenter", { section: "sponsors" });
    case "partners":
      return detail("InfoCenter", { section: "partners" });
    case "references":
      return detail("InfoCenter", { section: "references" });
    default:
      return null;
  }
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
  // „Erfolg freigeschaltet“ (#301, #218) führt zu den Erfolgen im eigenen Profil.
  if (wanted === "achievements") return tab("Profile", { tab: "achievements" });
  if (wanted === "honours") return tab("Profile", { tab: "honours" });
  // Einstellungen an einem Ort (#1146): was früher Reiter von /profile war, steht unter dem Zahnrad.
  if (["notifications", "privacy", "security", "sessions", "appearance", "about"].includes(wanted)) return detail("Settings");
  if (["basic", "gaming", "socials", "edit"].includes(wanted)) return detail("ProfileEdit");
  return tab("Profile");
}

function memberTarget(page: string): AppTarget | null {
  switch (page) {
    case "area":
    case "news":
      return tab("VereinHub");
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
  // Eine fremde Adresse (#921) bekommt nie einen Screen - auch nicht mit zufällig gleichem Pfad.
  const raw = /^https?:\/\//i.test(String(value || "").trim()) ? ownPath(value) || "" : String(value || "").trim();
  if (!raw) return { path: "", query: "", root: false };
  try {
    const url = new URL(raw, "https://lionsquad.local");
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    return { path, query: url.search.replace(/^\?/, ""), root: !path && raw.startsWith("/") };
  } catch {
    const [path, query = ""] = raw.split("?");
    const clean = path.replace(/^\/+|\/+$/g, "");
    return { path: clean, query, root: !clean && raw.startsWith("/") };
  }
}

function stringMeta(meta: Record<string, unknown>, key: string) {
  const value = meta[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}
