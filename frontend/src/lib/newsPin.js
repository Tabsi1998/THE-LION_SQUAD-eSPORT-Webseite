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

/** Vorschlag beim Anheften: heute + 14 Tage (Wiener Tag). */
export function defaultPinUntil(now = new Date()) {
  return shiftDay(viennaToday(now), PIN_DEFAULT_DAYS);
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
  const active = typeof post.pin_active === "boolean" ? post.pin_active : !post.pinned_until || viennaToday(now) <= post.pinned_until;
  return { active, until: post.pinned_until || "", text: pinUntilText(post.pinned_until) };
}
