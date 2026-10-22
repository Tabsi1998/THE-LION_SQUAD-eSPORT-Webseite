// Original-Bilder des Veranstalters je Termin (#1933): Arten, Beschriftung, Vorschaubilder und wo ein Bild öffentlich
// erscheint. Der Server prüft und kodiert neu; hier wird nur beschriftet und sortiert - für das Ergebnisblatt der
// Verwaltung und „Original ansehen“ auf Serien- und Rundenseite.
import { roundKind } from "@/lib/raceWeekend";
import { safeHttpUrl } from "@/lib/safeLink";

/** Arten in der Reihenfolge, in der sie stehen: wie ein Wochenende abläuft, dann Tabelle und Sonstiges. */
export const ORIGINAL_KINDS = [
  ["qualifying", "Qualifying"],
  ["sprint", "Sprint"],
  ["race", "Rennen"],
  ["scoreboard", "Scoreboard"],
  ["table", "Tabelle"],
  ["other", "Sonstiges"],
];
const LABELS = Object.fromEntries(ORIGINAL_KINDS);
export const MAX_MAP = 15;
// Breiten der Vorschaubilder - dieselben wie im Server (`services/image_variants.py`).
const VARIANT_WIDTHS = [160, 320, 400, 800, 1600];

/** „Rennen“, „Scoreboard · Map 2“ … */
export function originalLabel(item) {
  const label = LABELS[item?.kind] || "Original";
  return item?.kind === "scoreboard" && item?.map ? `${label} · Map ${item.map}` : label;
}

/** Die Art, die ein Bild ohne Wahl bekommt: der Lauf in einer Rennliga, sonst „Sonstiges“. */
export function defaultOriginalKind(round, seriesKind) {
  if (seriesKind !== "racing") return "other";
  const kind = roundKind(round);
  return LABELS[kind] ? kind : "race";
}

/** Adresse eines Vorschaubilds (`?w=`); ohne Breite das Bild selbst. */
export function originalSrc(url, width) {
  if (!url) return "";
  return width ? `${url}${url.includes("?") ? "&" : "?"}w=${width}` : url;
}

/** srcset aus den Vorschaubildern, die kleiner als das Bild sind, dazu das Bild selbst. */
export function originalSrcSet(item) {
  if (!item?.url || !item?.width) return undefined;
  const widths = VARIANT_WIDTHS.filter((width) => width < item.width);
  return [...widths.map((width) => `${originalSrc(item.url, width)} ${width}w`), `${item.url} ${item.width}w`].join(", ");
}

/** Quellen-Link nur als https (wie der Server) - alles andere zeigt keinen Link. */
export function sourceLink(item) {
  const url = safeHttpUrl(item?.source_url);
  return url.startsWith("https:") ? url : "";
}

/** Warum ein Bild öffentlich (noch) nicht zu sehen ist - kurz, für die Verwaltung. */
export const HIDDEN_REASONS = {
  admin_only: "Nur Verwaltung",
  draft: "Entwurf – geht mit dem Ergebnis hinaus",
  archived: "Termin archiviert",
  not_published: "Öffentlich, sobald das Ergebnis veröffentlicht ist",
  hidden_name: "Bleibt intern: im Ergebnis ist ein Name ausgeblendet",
};

export function hiddenReason(item) {
  if (!item || item.shown) return "";
  return HIDDEN_REASONS[item.hidden_reason] || "Öffentlich nicht sichtbar";
}

/**
 * Die öffentlichen Bilder mehrerer Termine (etwa aller Läufe einer Runde) in einer Liste. `withSession`: vor die Art
 * kommt der Lauf („Sprint · Rennen“ wäre doppelt, darum nur, wenn er etwas sagt).
 */
export function originalsOf(originals, rounds, { withSession = false } = {}) {
  const out = [];
  for (const round of rounds || []) {
    for (const item of (originals || {})[round.id] || []) {
      const session = String(round.session || "").trim();
      const label = originalLabel(item);
      out.push({ ...item, label: withSession && session && session !== label ? `${session} · ${label}` : label });
    }
  }
  return out;
}

/** Ob der Quellen-Link eine vollständige https-Adresse ist (leer ist erlaubt). */
export function sourceUrlProblem(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return sourceLink({ source_url: text }) ? "" : "Nur eine vollständige https-Adresse, etwa https://veranstalter.example/ergebnis.";
}
