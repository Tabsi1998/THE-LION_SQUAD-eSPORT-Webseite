import { createNavigationContainerRef } from "@react-navigation/native";
import type { MainTabParamList } from "./types";
import type { UserNotification } from "../types";

export const navigationRef = createNavigationContainerRef<MainTabParamList>();

export function navigateToNotification(item: UserNotification) {
  if (!navigationRef.isReady()) return false;
  const target = targetFromNotification(item);
  if (!target) {
    navigationRef.navigate("More", { screen: "Notifications" });
    return false;
  }

  if (target.area === "dashboard") {
    navigationRef.navigate("Dashboard");
    return true;
  }
  if (target.area === "profile") {
    navigationRef.navigate("Profile");
    return true;
  }
  if (target.area === "teams") {
    navigationRef.navigate("Teams", { screen: target.screen, params: target.params } as never);
    return true;
  }
  if (target.area === "tournaments") {
    navigationRef.navigate("Tournaments", { screen: target.screen, params: target.params } as never);
    return true;
  }
  navigationRef.navigate("More", { screen: target.screen, params: target.params } as never);
  return true;
}

type NotificationTarget =
  | { area: "dashboard" }
  | { area: "profile" }
  | { area: "teams"; screen: "TeamList"; params?: undefined }
  | { area: "teams"; screen: "TeamDetail" | "TeamChat"; params: { id: string; title?: string } }
  | { area: "tournaments"; screen: "TournamentDetail" | "EventDetail" | "FastLapDetail" | "MatchDetail" | "TournamentChat"; params: { id: string; title?: string } }
  | { area: "more"; screen: "NewsDetail" | "PublicProfile" | "DirectThread" | "DirectMessages" | "Notifications" | "InfoCenter"; params?: Record<string, unknown> };

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

  const tournamentId = stringMeta(meta, "tournament_id");
  if (tournamentId && kind.includes("tournament_chat")) {
    return { area: "tournaments", screen: "TournamentChat", params: { id: tournamentId, title: "Turnier-Chat" } };
  }
  if (tournamentId && (kind.includes("tournament") || kind.includes("prize"))) {
    return { area: "tournaments", screen: "TournamentDetail", params: { id: tournamentId } };
  }

  const requesterId = stringMeta(meta, "requester_username") || stringMeta(meta, "username");
  if (requesterId && kind.includes("friend")) {
    return { area: "more", screen: "PublicProfile", params: { username: requesterId } };
  }
  if (kind.includes("friend")) return { area: "profile" };

  return targetFromUrl(item.url);
}

function targetFromUrl(url?: string | null): NotificationTarget | null {
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
  if (["u", "users", "user", "players", "player", "members", "member", "profiles"].includes(first || "") && second) {
    return { area: "more", screen: "PublicProfile", params: { username: second } };
  }
  if (first === "profile" && second) return { area: "more", screen: "PublicProfile", params: { username: second } };
  if (first === "profile" && parsed.query.includes("tab=inbox")) return { area: "more", screen: "DirectMessages" };
  if (first === "profile" && parsed.query.includes("tab=teams")) return { area: "teams", screen: "TeamList" };
  if (first === "profile") return { area: "profile" };
  if (first === "me" && second === "prizes") return { area: "profile" };
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
