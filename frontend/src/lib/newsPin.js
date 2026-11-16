import { dayNoon, viennaDate, viennaDay } from "@/lib/vienna";

// Angeheftete News laufen ab (#1263): das Ende ist ein Wiener Kalendertag („JJJJ-MM-TT“), angeheftet bleibt der Beitrag
// bis zum Ende dieses Tages. Beim Anheften schlägt der Editor 14 Tage vor - derselbe Wert wie am Server.
export const PIN_DEFAULT_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Ein Tag „JJJJ-MM-TT“, um ``days`` Kalendertage verschoben. */
export function shiftDay(day, days) {
  return new Date(dayNoon(day).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Heute in Wien. */
export function viennaToday(now = new Date()) {
  return viennaDay(now);
}

/** Ab diesem Wiener Tag ist der Beitrag zu sehen: heute oder - bei einem geplanten Beitrag - sein Termin (wie der Server). */
export function pinBaseDay(publishAt = null, now = new Date()) {
  const today = viennaToday(now);
  const planned = publishAt ? viennaDay(publishAt) : "";
  return planned && planned > today ? planned : today;
}

/** Vorschlag beim Anheften: 14 Tage ab dem Erscheinen (Wiener Tag). */
export function defaultPinUntil(now = new Date(), publishAt = null) {
  return shiftDay(pinBaseDay(publishAt, now), PIN_DEFAULT_DAYS);
}

/** „bis 21.10.2026“ für das Ende - leer ohne gültigen Tag. */
export function pinUntilText(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return "";
  return `bis ${viennaDate(dayNoon(day), { day: "2-digit", month: "2-digit", year: "numeric" })}`;
}

/**
 * Stand der Anheftung für die News-Liste der Verwaltung: ``active`` (mit Ende), ``expired`` (Ende vorbei) oder
 * ``null`` (nicht angeheftet). ``pin_active`` kommt vom Server; ohne ihn rechnet die Seite selbst.
 */
export function pinState(post, now = new Date()) {
  if (!post?.pinned) return null;
  // ``pin_until``: das geltende Ende vom Server - beim Altbestand ohne eigenes Ende das errechnete.
  const until = post.pin_until || post.pinned_until || "";
  const active = typeof post.pin_active === "boolean" ? post.pin_active : !until || viennaToday(now) <= until;
  return { active, until, text: pinUntilText(until) };
}
