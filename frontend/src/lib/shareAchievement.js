// Teilen eines Erfolgs (#619): die Seite /achievements/a/<award_id> trägt die Karte als Open-Graph-Bild.
// Web Share API, wenn es sie gibt (Handy, Safari, Edge), sonst kommt der Link in die Zwischenablage.

export function achievementShareUrl(awardId, origin) {
  const base = origin || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/achievements/a/${encodeURIComponent(awardId)}`;
}

export function achievementShareText({ name, materialName, personName, clubName = "THE LION SQUAD" }) {
  const who = personName ? `${personName} hat` : "Ich habe";
  const material = materialName ? ` (${materialName})` : "";
  return `${who} „${name}“${material} bei ${clubName} freigeschaltet.`;
}

/**
 * Teilt einen Erfolg. Ergebnis: "shared" (Web Share), "copied" (Zwischenablage), "cancelled" (abgebrochen)
 * oder "failed". Ohne Zwischenablage und ohne Web Share bleibt nur "failed".
 */
export async function shareAchievement({ awardId, name, materialName, personName, clubName, nav = typeof navigator !== "undefined" ? navigator : null, origin }) {
  const url = achievementShareUrl(awardId, origin);
  const text = achievementShareText({ name, materialName, personName, clubName });
  const title = `${name} · ${clubName || "THE LION SQUAD"}`;
  if (nav && typeof nav.share === "function") {
    try {
      await nav.share({ title, text, url });
      return { status: "shared", url };
    } catch (err) {
      if (err?.name === "AbortError") return { status: "cancelled", url };
      // Manche Browser lehnen share() ab (z. B. ohne Nutzergeste) - dann der Link.
    }
  }
  if (nav?.clipboard && typeof nav.clipboard.writeText === "function") {
    try {
      await nav.clipboard.writeText(url);
      return { status: "copied", url };
    } catch {
      return { status: "failed", url };
    }
  }
  return { status: "failed", url };
}
