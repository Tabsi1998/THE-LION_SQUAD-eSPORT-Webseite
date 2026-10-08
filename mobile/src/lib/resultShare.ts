import { Share } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { API_BASE_URL } from "../config";
import { resolveMediaUrl } from "./api";

// Ergebnis teilen (#1194) - wie im Web (frontend/src/lib/resultShare.js): Der Server zeichnet das hohe Bild
// (1080×1920, WhatsApp-Status und Instagram-Story) und das breite (1200×630, Link-Vorschau). In der App lädt
// „Bild teilen“ das hohe Bild und öffnet das Teilen-Menü des Geräts; „Link teilen“ teilt die Seite mit Vorschau.

export type ResultShareOptions = {
  shareable: boolean;
  reason?: "not_finished" | "not_participant" | "not_public" | "private_profile" | string;
  text?: string;
  path?: string;
  image_paths?: { story: string; wide: string };
  headline?: string;
  share_text?: string;
};

const WEB_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");

export function resultShareUrl(path?: string | null): string {
  return `${WEB_BASE_URL}${path || ""}`;
}

/** „ergebnis-fc26-cup-neonfalke-story.png“ aus dem Pfad der Teilen-Seite. */
export function resultFileName(path?: string | null, format: "story" | "wide" = "story"): string {
  const parts = String(path || "").split("/").filter(Boolean);
  return `ergebnis-${parts[1] || "turnier"}-${parts[3] || "ergebnis"}-${format}.png`.replace(/[^A-Za-z0-9._-]+/g, "-");
}

/** Hinweis statt Knopf? Nur, wenn man selbst etwas ändern kann oder es sonst rätselhaft wäre. */
export function showsHint(options?: ResultShareOptions | null): boolean {
  return Boolean(options && !options.shareable && ["private_profile", "not_public"].includes(String(options.reason || "")));
}

/** Link mit Text ins Teilen-Menü. Abbrechen ist kein Fehler. */
export async function shareResultLink(options: ResultShareOptions): Promise<"shared" | "failed"> {
  const url = resultShareUrl(options.path);
  try {
    await Share.share({ message: `${options.share_text || options.headline || ""} ${url}`.trim(), url, title: options.headline });
    return "shared";
  } catch {
    return "failed";
  }
}

/** Das hohe Bild laden und ins Teilen-Menü geben - geht das auf dem Gerät nicht, wenigstens den Link. */
export async function shareResultImage(options: ResultShareOptions): Promise<"shared" | "failed"> {
  if (!options.image_paths?.story) return "failed";
  try {
    if (!(await Sharing.isAvailableAsync())) return shareResultLink(options);
    const target = `${FileSystem.cacheDirectory}${resultFileName(options.path)}`;
    const download = await FileSystem.downloadAsync(resolveMediaUrl(options.image_paths.story), target);
    if (download.status && download.status !== 200) return "failed";
    await Sharing.shareAsync(download.uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: options.headline || "Ergebnis teilen" });
    return "shared";
  } catch {
    return "failed";
  }
}
