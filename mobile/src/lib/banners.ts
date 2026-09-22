import * as SecureStore from "expo-secure-store";
import { colors } from "../theme";

// Laufbanner in der App (#245): dieselben Banner wie die Website, nur die mit Kanal „app“.
// Wegwischen blendet einen Banner aus, bis er sich ändert (Kennung + Text im Gerätespeicher).

export type SiteBanner = {
  id: string;
  enabled?: boolean;
  title?: string;
  text: string;
  tone?: "info" | "live" | "warning" | "success" | string;
  mode?: "ticker" | "static" | string;
  speed_seconds?: number;
  link_url?: string;
  link_label?: string;
  priority?: number;
  channels?: string[];
  source?: string;
};

const DISMISSED_KEY = "tls.banners.dismissed";
const MAX_DISMISSED = 40;

/** Die Kennung, unter der ein Banner als weggewischt gilt: ändert sich der Text, kommt er wieder. */
export function dismissKey(banner: SiteBanner): string {
  return `${banner.id}:${(banner.text || "").trim()}`;
}

export function visibleBanners(banners: SiteBanner[], dismissed: readonly string[]): SiteBanner[] {
  const gone = new Set(dismissed);
  return banners
    .filter((banner) => banner && banner.enabled !== false && (banner.text || "").trim() && !gone.has(dismissKey(banner)))
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
}

export function toneColor(tone?: string): string {
  if (tone === "live") return colors.live;
  if (tone === "warning") return colors.gold;
  if (tone === "success") return "#00FF88";
  return colors.cyan;
}

/** Laufzeit einer Runde: so lange, dass der Text lesbar bleibt - nie unter der eingestellten Zeit. */
export function tickerDurationMs(text: string, speedSeconds?: number): number {
  const configured = Math.max(8, Math.min(180, Number(speedSeconds || 22)));
  const byLength = Math.ceil((text || "").length / 12);
  return Math.max(configured, byLength) * 1000;
}

export async function loadDismissed(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(DISMISSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function rememberDismissed(current: readonly string[], key: string): Promise<string[]> {
  const next = [...current.filter((item) => item !== key), key].slice(-MAX_DISMISSED);
  try {
    await SecureStore.setItemAsync(DISMISSED_KEY, JSON.stringify(next));
  } catch {
    // Ohne Speicher gilt das Wegwischen bis zum Neustart - besser als gar nicht.
  }
  return next;
}
