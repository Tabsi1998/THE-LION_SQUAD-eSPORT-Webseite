import { Linking } from "react-native";
import { API_BASE_URL } from "../config";
import { navigateToUrl } from "../navigation/rootNavigation";

// Adressen aus einem Türchen (#641, #642): was die App selbst zeigen kann (News, Event, Turnier, Team, Profil,
// Meine Gewinne), öffnet sich im Screen - alles andere im Browser. Eine fremde Adresse wird nie als eigener Screen
// gedeutet, und geöffnet wird nur, was mit http oder https beginnt.

export const WEB_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");

/** Der Pfad auf der eigenen Website - oder null, wenn die Adresse woanders hinführt. */
export function ownPath(url?: string | null): string | null {
  const text = String(url || "").trim();
  if (!text) return null;
  if (text.startsWith("/")) return text.startsWith("//") ? null : text;
  if (text === WEB_BASE_URL) return "/";
  return text.startsWith(`${WEB_BASE_URL}/`) ? text.slice(WEB_BASE_URL.length) : null;
}

export type LinkResult = "screen" | "browser" | "none";

export function openDoorLink(url?: string | null): LinkResult {
  const text = String(url || "").trim();
  const path = ownPath(text);
  if (path !== null && navigateToUrl(path)) return "screen";
  const address = path !== null ? `${WEB_BASE_URL}${path}` : text;
  if (!/^https?:\/\//i.test(address)) return "none";
  Linking.openURL(address).catch(() => {});
  return "browser";
}
