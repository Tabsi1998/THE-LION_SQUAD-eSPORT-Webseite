// Ergebnis teilen (#1194): Der Server zeichnet zwei Bilder - hoch 1080×1920 für WhatsApp-Status und
// Instagram-Story, breit 1200×630 als Link-Vorschau - und eine Seite /tournaments/<turnier>/ergebnis/<name>.
// Im Handy-Browser teilt „Teilen“ das hohe Bild samt Link über das Teilen-Menü; am PC gibt es
// „Bild herunterladen“ und „Link kopieren“.

export function resultShareUrl(path, origin) {
  const base = origin || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${path || ""}`;
}

/** Kann dieser Browser Bilder ins Teilen-Menü geben? (Handy: ja, die meisten PC-Browser: nein) */
export function canShareFiles(nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!nav || typeof nav.share !== "function" || typeof nav.canShare !== "function" || typeof File === "undefined") return false;
  try {
    return !!nav.canShare({ files: [new File([""], "ergebnis.png", { type: "image/png" })] });
  } catch {
    return false;
  }
}

/**
 * Handy oder PC? Das Teilen-Menü mit Bild nur auf Touch-Geräten, die Dateien teilen können - am PC (auch wenn
 * Windows ein Teilen-Fenster hätte) „Bild herunterladen“ und „Link kopieren“.
 */
export function prefersShareSheet(nav = typeof navigator !== "undefined" ? navigator : null, win = typeof window !== "undefined" ? window : null) {
  if (!canShareFiles(nav)) return false;
  try {
    return !!win?.matchMedia?.("(pointer: coarse)")?.matches;
  } catch {
    return false;
  }
}

/** „ergebnis-fc26-cup-neonfalke-story.png“ aus dem Pfad der Teilen-Seite. */
export function resultFileName(path, format = "story") {
  const parts = String(path || "").split("/").filter(Boolean);
  const slug = parts[1] || "turnier";
  const name = parts[3] || "ergebnis";
  return `ergebnis-${slug}-${name}-${format}.png`.replace(/[^A-Za-z0-9._-]+/g, "-");
}

/**
 * Lädt das Bild vorab - das Teilen-Menü muss direkt beim Tippen aufgehen, sonst lehnt der Browser ab.
 * Gibt eine Datei zurück oder null.
 */
export async function loadResultImage(imageUrl, fileName, fetchImpl = typeof fetch !== "undefined" ? fetch : null) {
  if (!fetchImpl || !imageUrl || typeof File === "undefined") return null;
  try {
    const response = await fetchImpl(imageUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    return new File([blob], fileName || "ergebnis.png", { type: "image/png" });
  } catch {
    return null;
  }
}

/**
 * Teilt das Bild (wenn vorab geladen) mit Text und Link über das Teilen-Menü, sonst nur den Link.
 * Ergebnis: "shared", "cancelled" oder "failed".
 */
export async function shareResultImage({ file, url, text, title, nav = typeof navigator !== "undefined" ? navigator : null }) {
  if (!nav || typeof nav.share !== "function") return { status: "failed" };
  try {
    if (file && typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], title, text: url ? `${text} ${url}` : text });
    } else {
      await nav.share({ title, text, url });
    }
    return { status: "shared" };
  } catch (err) {
    if (err?.name === "AbortError") return { status: "cancelled" };
    return { status: "failed" };
  }
}

/** Link in die Zwischenablage. Ergebnis: "copied" oder "failed". */
export async function copyResultLink(url, nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!nav?.clipboard || typeof nav.clipboard.writeText !== "function") return { status: "failed" };
  try {
    await nav.clipboard.writeText(url);
    return { status: "copied" };
  } catch {
    return { status: "failed" };
  }
}
