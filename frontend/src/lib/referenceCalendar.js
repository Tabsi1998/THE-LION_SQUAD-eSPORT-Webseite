// Kalender externer Serien (#1742): Beschriftungen und kleine Rechnungen für die Termine einer Saison. Der Status
// („heute“, „Ergebnis fehlt“ …) und „heute“ selbst kommen vom Server (Wiener Tag über club_today()) - hier wird
// nur beschriftet und ein Vorschlag für den nächsten Termin gerechnet, in Kalendertagen, nie mit der Uhr des Geräts.
import { dayNoon, viennaDate } from "@/lib/vienna";

export const STATE_LABELS = {
  planned: "Geplant",
  today: "Heute",
  missing: "Ergebnis fehlt",
  cancelled: "Abgesagt",
  postponed: "Verschoben",
  scored: "Gewertet",
};

// Öffentlich klingt ein fehlendes Ergebnis nach dem, was kommt: „Ergebnis folgt“ (in der Verwaltung „fehlt“).
export const PUBLIC_STATE_LABELS = { ...STATE_LABELS, missing: "Ergebnis folgt" };

// Farbe je Status: Blau für heute, Bernstein für fehlende Ergebnisse, Grün für gewertet, gedämpft für abgesagt.
export const STATE_TONES = {
  planned: "border-white/15 text-white/60",
  today: "border-[#29B6E8]/60 text-[#29B6E8] bg-[#29B6E8]/10",
  missing: "border-amber-400/50 text-amber-300 bg-amber-400/10",
  cancelled: "border-white/10 text-white/40 line-through",
  postponed: "border-violet-400/40 text-violet-300",
  scored: "border-emerald-400/40 text-emerald-300",
};

export const ROUND_KIND_OPTIONS = [["regular", "Regulär"], ["final", "Finale"]];

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Tag „JJJJ-MM-TT“ plus n Kalendertage. */
export function addDays(day, count) {
  return new Date(dayNoon(day).getTime() + count * DAY_MS).toISOString().slice(0, 10);
}

/** Wochentag eines Kalendertags, 0 = Montag (wie in Python). */
export function weekdayOf(day) {
  return (dayNoon(day).getUTCDay() + 6) % 7;
}

/**
 * Vorschlag für den nächsten Termin: der nächste Standard-Wochentag nach dem letzten Termin (ohne Wochentag eine
 * Woche später); ohne Termine der nächste Standard-Wochentag ab heute (oder heute).
 */
export function suggestNextDay(rounds, weekday, today) {
  const days = (rounds || []).map((round) => round.club_day).filter((day) => DAY_RE.test(day || "")).sort();
  const last = days[days.length - 1];
  const hasWeekday = weekday !== null && weekday !== undefined && weekday !== "";
  if (!last) {
    if (!DAY_RE.test(today || "")) return "";
    return hasWeekday ? addDays(today, (Number(weekday) - weekdayOf(today) + 7) % 7) : today;
  }
  if (!hasWeekday) return addDays(last, 7);
  return addDays(last, ((Number(weekday) - weekdayOf(last) + 6) % 7) + 1);
}

/** „Do., 05.11.2026“ - leer ohne Tag. */
export function dayLabel(day) {
  if (!DAY_RE.test(day || "")) return "";
  return viennaDate(dayNoon(day), { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Tag und Uhrzeit eines Termins: „Do., 05.11.2026 · 20:30“, ohne Uhrzeit nur der Tag, ohne Tag „Termin offen“. Ein
 * Spieltag mit Zeitraum (Team-Liga, #1931) zeigt beide Tage ohne Uhrzeit: „Mi., 13.05. – So., 17.05.2026“.
 */
export function roundWhen(round) {
  const day = dayLabel(round?.club_day);
  // Termin offen (#2015): eine gemerkte Uhrzeit steht dabei – „Termin offen · 19:00“.
  if (!day) return round?.time ? `Termin offen · ${round.time}` : "Termin offen";
  const end = round.club_day_end && round.club_day_end !== round.club_day ? dayLabel(round.club_day_end) : "";
  if (end) {
    const sameYear = round.club_day.slice(0, 4) === round.club_day_end.slice(0, 4);
    const start = sameYear ? viennaDate(dayNoon(round.club_day), { weekday: "short", day: "2-digit", month: "2-digit" }) : day;
    return `${start} – ${end}`;
  }
  return round.time ? `${day} · ${round.time}` : day;
}

/** Gegner eines Spieltags (#1931): „vs Team“ daheim, „@ Team“ auswärts, sonst „gegen Team“ - leer ohne Gegner. */
export function opponentText(round) {
  const name = String(round?.opponent || "").trim();
  if (!name) return "";
  if (round.at_home === true) return `vs ${name}`;
  if (round.at_home === false) return `@ ${name}`;
  return `gegen ${name}`;
}

/** „Heim“, „Auswärts“ oder leer. */
export function sideLabel(round) {
  if (round?.at_home === true) return "Heim";
  if (round?.at_home === false) return "Auswärts";
  return "";
}

const SIDE_FORM = { true: "home", false: "away" };

/** Kurzname eines Termins: Kürzel, sonst „Termin 3“. */
export function roundLabel(round) {
  return (round?.code || "").trim() || `Termin ${round?.position || ""}`.trim();
}

/** Ids in neuer Reihenfolge, wenn der Termin an `index` um `step` (−1 / +1) wandert; null am Rand. */
export function moveIds(rounds, index, step) {
  const target = index + step;
  if (target < 0 || target >= rounds.length) return null;
  const ids = rounds.map((round) => round.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return ids;
}

/** Land im Formular (#1925): „auto“ (aus der Strecke erkannt), „none“ (von Hand ohne Flagge) oder der gewählte Code. */
function countryChoice(round) {
  if (round.country_auto !== false) return "auto";
  return round.country_code || "none";
}

function countryPayload(choice) {
  if (!choice || choice === "auto") return { country_auto: true };
  return { country_auto: false, country_code: choice === "none" ? null : choice };
}

/** Formularwerte eines Termins. */
export function roundToForm(round = {}, { day = "", time = "" } = {}) {
  return {
    country: countryChoice(round),
    code: round.code || "",
    session: round.session || "",
    title: round.title || "",
    venue: round.venue || "",
    day: round.id ? round.club_day || "" : day,
    time: round.id ? round.time || "" : time,
    kind: round.kind || "regular",
    counts: round.counts !== false,
    opponent: round.opponent || "",
    note: round.note || "",
    // Team-Liga (#1931): Heim („home“), Auswärts („away“) oder offen („“), letzter Tag des Spieltags.
    at_home: SIDE_FORM[round.at_home] || "",
    day_end: round.club_day_end || "",
  };
}

/**
 * Formular → Body für POST/PATCH; leere Uhrzeit heißt „ohne Uhrzeit“. Land automatisch: der Server erkennt es. Lauf
 * (#1930): leer heißt Rennen. `teamLeague`: dazu Heim/Auswärts und das Ende des Spieltags (#1931).
 */
export function roundPayload(form, { teamLeague = false } = {}) {
  return {
    ...countryPayload(form.country),
    code: form.code.trim() || null,
    session: String(form.session || "").trim() || null,
    title: form.title.trim() || null,
    venue: form.venue.trim() || null,
    day: form.day || null,
    time: form.time || null,
    kind: form.kind,
    counts: Boolean(form.counts),
    opponent: form.opponent.trim() || null,
    note: form.note.trim() || null,
    ...(teamLeague ? { at_home: form.at_home === "home" ? true : form.at_home === "away" ? false : null, day_end: form.day_end || null } : {}),
  };
}
