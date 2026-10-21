import { formatWhen } from "./format";
import { viennaDay, viennaTime } from "./vienna";

// Bestätigungs-Blatt der Turnier-Anmeldung (#1904, App-Teil von #1261): was das Blatt vor „Verbindlich anmelden“
// zusammenfasst. Dieselbe Rechnung und derselbe Wortlaut wie im Web (frontend/src/lib/registrationSheet.js).

const SUMMARY_MAX = 280;

type SheetTournament = {
  check_in_from?: string | null;
  check_in_until?: string | null;
  event_mode?: string | null;
  location?: string | null;
  event?: { location?: string | null } | null;
};

/** Markdown als Klartext (wie plainTextPreview im Web). */
function plainText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^>\s?/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/** Die Regeln als Text: eine Liste (App-Format) wird zu Zeilen. */
export function rulesText(rules?: string[] | string | null): string {
  if (Array.isArray(rules)) return rules.map((line) => String(line || "").trim()).filter(Boolean).join("\n");
  return String(rules || "");
}

/** Die Regeln in (höchstens) drei Sätzen, als Klartext. Sehr lange Sätze werden am Wort gekürzt. */
export function rulesSummary(rules?: string[] | string | null, count = 3): string {
  // Überschriften sind keine Sätze - sie fallen weg.
  const body = rulesText(rules).split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
  const text = plainText(body);
  if (!text) return "";
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  const rest = text.slice(sentences.join("").length).trim();
  const picked = (sentences.length ? sentences : [text]).slice(0, count).map((part) => part.trim());
  if (sentences.length && sentences.length < count && rest) picked.push(rest);
  const summary = picked.join(" ");
  if (summary.length <= SUMMARY_MAX) return summary;
  const cut = summary.slice(0, SUMMARY_MAX);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 0 ? space : SUMMARY_MAX).trim()}…`;
}

/** Das Check-in-Fenster: „Sa 23. Mai · 20:00–20:45“, über Tage beide Zeitpunkte, sonst „ab …“/„bis …“. */
export function checkInWindow(tournament?: SheetTournament | null, now: Date = new Date()): string {
  const from = tournament?.check_in_from;
  const until = tournament?.check_in_until;
  const fromText = formatWhen(from, { now });
  const untilText = formatWhen(until, { now });
  if (from && until && fromText && untilText) {
    if (viennaDay(from) === viennaDay(until)) return `${fromText}–${viennaTime(until, { hour: "2-digit", minute: "2-digit" })}`;
    return `${fromText} – ${untilText}`;
  }
  if (fromText) return `ab ${fromText}`;
  if (untilText) return `bis ${untilText}`;
  return "";
}

/** Wo gespielt wird: „Online“, „Vor Ort · Adresse“ oder beides. */
export function placeLine(tournament?: SheetTournament | null): string {
  const mode = tournament?.event_mode || "online";
  const label = mode === "local" ? "Vor Ort" : mode === "hybrid" ? "Online und vor Ort" : "Online";
  const location = mode === "online" ? "" : String(tournament?.location || tournament?.event?.location || "").trim();
  return location ? `${label} · ${location}` : label;
}

/** Ohne eigene Regeln sagt das Blatt, was gilt. */
export const NO_RULES_TEXT = "Für dieses Turnier sind keine eigenen Regeln hinterlegt – es gelten Fair Play und die Anweisungen der Turnierleitung.";
