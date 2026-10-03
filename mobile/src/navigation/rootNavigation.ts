import { createNavigationContainerRef } from "@react-navigation/native";
import type { MainTabParamList } from "./types";
import type { UserNotification } from "../types";

export const navigationRef = createNavigationContainerRef<MainTabParamList>();
let pendingNotification: UserNotification | null = null;

export function navigateToNotification(item: UserNotification) {
  if (!navigationRef.isReady()) {
    pendingNotification = item;
    return false;
  }
  const target = targetFromNotification(item);
  if (!target) {
    navigationRef.navigate("More", { screen: "Notifications" });
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

function openTarget(target: NotificationTarget) {
  if (target.area === "dashboard") {
    navigationRef.navigate("Dashboard");
    return;
  }
  if (target.area === "profile") {
    navigationRef.navigate("Profile", target.params);
    return;
  }
  if (target.area === "teams") {
    navigationRef.navigate("Teams", { screen: target.screen, params: target.params } as never);
    return;
  }
  if (target.area === "tournaments") {
    navigationRef.navigate("Tournaments", { screen: target.screen, params: target.params } as never);
    return;
  }
  navigationRef.navigate("More", { screen: target.screen, params: target.params } as never);
}

export function flushPendingNotification() {
  if (!navigationRef.isReady() || !pendingNotification) return false;
  const item = pendingNotification;
  pendingNotification = null;
  return navigateToNotification(item);
}

type NotificationTarget =
  | { area: "dashboard" }
  | { area: "profile"; params?: { tab?: "overview" | "references" | "prizes" | "edit" | "achievements" | "privacy" | "notifications" } }
  | { area: "teams"; screen: "TeamList"; params?: undefined }
  | { area: "teams"; screen: "TeamDetail" | "TeamChat"; params: { id: string; title?: string } }
  | { area: "tournaments"; screen: "TournamentList"; params?: undefined }
  | { area: "tournaments"; screen: "TournamentDetail" | "EventDetail" | "FastLapDetail" | "MatchDetail" | "TournamentChat"; params: { id: string; title?: string } }
  | { area: "more"; screen: "NewsDetail" | "PublicProfile" | "DirectThread" | "DirectMessages" | "Notifications" | "InfoCenter" | "NewsList" | "Gallery" | "FastLapList" | "AdventCalendar" | "AchievementShowcase"; params?: Record<string, unknown> };

function targetFromNotification(item: UserNotification): NotificationTarget | null {
  const meta = (item.meta || {}) as Record<string, unknown>;
  const kind = String(item.kind || "").toLowerCase();

  const matchId = stringMeta(meta, "match_id");
  if (matchId && (kind.includes("match") || kind.includes("station"))) {
    return { area: "tournaments", screen: "MatchDetail", params: { id: matchId } };
  }

  const teamId = stringMeta(meta, "team_id");
  if (teamId && kind.includes("team_chat")) {
    return { area: "teams", screen: "TeamChat", params: { id: teamId, title: "Team-Chat" } };
  }
  if (teamId && kind.includes("team")) {
    return { area: "teams", screen: "TeamDetail", params: { id: teamId } };
  }

  const threadUserId = stringMeta(meta, "thread_user_id");
  if (threadUserId && kind.includes("direct_message")) {
    return { area: "more", screen: "DirectThread", params: { userId: threadUserId, title: item.title || "Chat" } };
  }

  const newsId = stringMeta(meta, "news_id") || stringMeta(meta, "slug");
  if (newsId && kind.includes("news")) {
    return { area: "more", screen: "NewsDetail", params: { id: newsId } };
  }

  const challengeId = stringMeta(meta, "challenge_id") || stringMeta(meta, "fastlap_id");
  if (challengeId && (kind.includes("f1") || kind.includes("fast"))) {
    return { area: "tournaments", screen: "FastLapDetail", params: { id: challengeId } };
  }
  if (kind.includes("prize")) {
    return { area: "profile", params: { tab: "prizes" } };
  }

  const tournamentId = stringMeta(meta, "tournament_id");
  if (tournamentId && kind.includes("tournament_chat")) {
    return { area: "tournaments", screen: "TournamentChat", params: { id: tournamentId, title: "Turnier-Chat" } };
  }
  if (tournamentId && kind.includes("tournament")) {
    return { area: "tournaments", screen: "TournamentDetail", params: { id: tournamentId } };
  }

  const requesterId = stringMeta(meta, "requester_username") || stringMeta(meta, "username");
  if (requesterId && kind.includes("friend")) {
    return { area: "more", screen: "PublicProfile", params: { username: requesterId } };
  }
  if (kind.includes("friend")) return { area: "profile" };

  return targetFromUrl(item.url);
}

export function targetFromUrl(url?: string | null): NotificationTarget | null {
  const parsed = parsePath(url);
  if (!parsed.path) return null;
  const parts = parsed.path.split("/").filter(Boolean);
  const [first, second, third] = parts;

  if (first === "matches" && second) return { area: "tournaments", screen: "MatchDetail", params: { id: second } };
  if (first === "tournaments" && second) return { area: "tournaments", screen: third === "chat" ? "TournamentChat" : "TournamentDetail", params: { id: second } };
  if (first === "events" && second) return { area: "tournaments", screen: "EventDetail", params: { id: second } };
  if ((first === "fastlap" || first === "fastlaps") && second) return { area: "tournaments", screen: "FastLapDetail", params: { id: second } };
  if (first === "f1" && parts[1] === "challenges" && parts[2]) return { area: "tournaments", screen: "FastLapDetail", params: { id: parts[2] } };
  if (first === "teams" && second) return { area: "teams", screen: "TeamDetail", params: { id: second } };
  if (first === "news" && second) return { area: "more", screen: "NewsDetail", params: { id: second } };
  if (["u", "users", "user", "players", "player", "profiles"].includes(first || "") && second) {
    return { area: "more", screen: "PublicProfile", params: { username: second } };
  }
  if (first === "profile" && second) return { area: "more", screen: "PublicProfile", params: { username: second } };
  if (first === "profile" && parsed.query.includes("tab=inbox")) return { area: "more", screen: "DirectMessages" };
  if (first === "profile" && parsed.query.includes("tab=teams")) return { area: "teams", screen: "TeamList" };
  // „Erfolg freigeschaltet“ (#301, #218) führt zu den Erfolgen, nicht nur ins Profil.
  if (first === "profile" && parsed.query.includes("tab=achievements")) return { area: "profile", params: { tab: "achievements" } };
  if (first === "profile") return { area: "profile" };
  if (first === "me" && second === "prizes") return { area: "profile", params: { tab: "prizes" } };
  // Adressen ohne Kennung (aus Inhalten wie dem Adventkalender, #641): die passende Liste der App.
  if (!second) {
    if (first === "events" || first === "tournaments") return { area: "tournaments", screen: "TournamentList" };
    // „Als Nächstes“ bei den Team-Erfolgen (E13, #623) verlinkt die Teams.
    if (first === "teams") return { area: "teams", screen: "TeamList" };
    // Der Schaukasten der Erfolge (E13, #623) - auch Ziel von „Krone“-Benachrichtigungen im Web.
    if (first === "achievements") return { area: "more", screen: "AchievementShowcase" };
    if (first === "news") return { area: "more", screen: "NewsList" };
    if (first === "gallery" || first === "galerie") return { area: "more", screen: "Gallery" };
    if (first === "fastlap" || first === "fastlaps" || first === "f1") return { area: "more", screen: "FastLapList" };
    if (first === "advent") return { area: "more", screen: "AdventCalendar" };
  }
  return null;
}

function parsePath(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return { path: "", query: "" };
  try {
    const url = raw.startsWith("http") ? new URL(raw) : new URL(raw, "https://lionsquad.local");
    return { path: url.pathname.replace(/^\/+|\/+$/g, ""), query: url.search.replace(/^\?/, "") };
  } catch {
    const [path, query = ""] = raw.split("?");
    return { path: path.replace(/^\/+|\/+$/g, ""), query };
  }
}

function stringMeta(meta: Record<string, unknown>, key: string) {
  const value = meta[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}
