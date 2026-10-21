import { formatWhen } from "@/lib/datetime";
import { plainTextPreview } from "@/lib/textPreview";
import { viennaDay, viennaTime } from "@/lib/vienna";

// Bestätigungs-Blatt der Turnier-Anmeldung (#1261): was das Blatt vor „Verbindlich anmelden“ zusammenfasst.

const SUMMARY_MAX = 280;

/** Die Regeln in (höchstens) drei Sätzen, als Klartext. Sehr lange Sätze werden am Wort gekürzt. */
export function rulesSummary(rules, count = 3) {
  // Überschriften sind keine Sätze - sie fallen weg.
  const body = String(rules || "").split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
  const text = plainTextPreview(body);
  if (!text) return "";
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  const rest = text.slice(sentences.join("").length).trim();
  const picked = (sentences.length ? sentences : [text]).slice(0, count).map((part) => part.trim());
  if (sentences.length && sentences.length < count && rest) picked.push(rest);
  const summary = picked.join(" ");
  if (summary.length <= SUMMARY_MAX) return summary;
  const cut = summary.slice(0, SUMMARY_MAX);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : SUMMARY_MAX).trim()}…`;
}

/** Das Check-in-Fenster: „Sa 23. Mai · 20:00–20:45“, über Tage beide Zeitpunkte, sonst „ab …“/„bis …“. */
export function checkInWindow(tournament, now = new Date()) {
  const from = tournament?.check_in_from;
  const until = tournament?.check_in_until;
  const fromText = formatWhen(from, { now });
  const untilText = formatWhen(until, { now });
  if (fromText && untilText) {
    if (viennaDay(from) === viennaDay(until)) return `${fromText}–${viennaTime(until, { hour: "2-digit", minute: "2-digit" })}`;
    return `${fromText} – ${untilText}`;
  }
  if (fromText) return `ab ${fromText}`;
  if (untilText) return `bis ${untilText}`;
  return "";
}

/** Wo gespielt wird: „Online“, „Vor Ort · Adresse“ oder beides. */
export function placeLine(tournament) {
  const mode = tournament?.event_mode || "online";
  const label = mode === "local" ? "Vor Ort" : mode === "hybrid" ? "Online und vor Ort" : "Online";
  const location = mode === "online" ? "" : String(tournament?.location || "").trim();
  return location ? `${label} · ${location}` : label;
}

/**
 * Voller Cup (#1941): „Der Cup ist voll – du kommst auf die Warteliste (Platz 3).“ - dieselbe Regel wie die schlanke
 * Vor-Ort-Ansicht („Alle Plätze belegt – Warteliste“). Ohne Länge der Warteliste (ältere Antwort) ohne Platz; mit
 * freien Plätzen oder ohne Höchstzahl leer.
 */
export function waitlistLead(tournament) {
  const max = Number(tournament?.max_participants) || 0;
  const taken = Number(tournament?.participant_count) || 0;
  if (!max || taken < max) return "";
  const waiting = Number(tournament?.waitlist_count);
  const place = Number.isInteger(waiting) && waiting >= 0 ? ` (Platz ${waiting + 1})` : "";
  return `Der Cup ist voll – du kommst auf die Warteliste${place}.`;
}
