import { Share } from "react-native";
import { API_BASE_URL } from "../config";

// Teilen eines Erfolgs (wie im Web, #619): die Seite /achievements/a/<award_id> trägt die Karte als Vorschaubild.
// In der App öffnet das Teilen-Menü des Geräts; der Text ist derselbe wie im Web.

const WEB_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, "");

export function achievementShareUrl(awardId: string): string {
  return `${WEB_BASE_URL}/achievements/a/${encodeURIComponent(awardId)}`;
}

export function achievementShareText({ name, materialName, clubName = "THE LION SQUAD" }: { name: string; materialName?: string | null; clubName?: string }): string {
  const material = materialName ? ` (${materialName})` : "";
  return `Ich habe „${name}“${material} bei ${clubName} freigeschaltet.`;
}

/** Öffnet das Teilen-Menü mit Text und Link; Abbrechen ist kein Fehler. */
export async function shareAchievement({ awardId, name, materialName }: { awardId: string; name: string; materialName?: string | null }): Promise<boolean> {
  const url = achievementShareUrl(awardId);
  try {
    await Share.share({ message: `${achievementShareText({ name, materialName })} ${url}`, url, title: name });
    return true;
  } catch {
    return false;
  }
}
