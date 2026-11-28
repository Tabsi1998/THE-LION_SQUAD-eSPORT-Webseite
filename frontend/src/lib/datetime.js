import { asInstant, dayBefore, dayNoon, viennaDate, viennaDay, viennaTime } from "@/lib/vienna";

// Ein Datumsformat (#1220, #1307, Wahl des Betreibers vom 07.10.2026): „Sa 23. Mai · 18:00“ - Wochentag kurz, Monat
// ausgeschrieben, das Jahr nur, wenn es nicht das laufende ist. Tag und Uhrzeit gelten in Wien (lib/vienna.js), der Monat
// heißt wie in Österreich („Jänner“). Die App schreibt dasselbe (mobile/src/lib/format.ts); beide prüfen dieselben Fälle
// aus docs/date-cases.json.
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const nextDay = (day) => new Date(dayNoon(day).getTime() + DAY_MS).toISOString().slice(0, 10);
// Ein reiner Kalendertag („2026-12-31“, etwa ein Ablauf- oder Stichtag) hat keine Uhrzeit - er steht ohne „· 01:00“ da.
const PURE_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isPureDay = (value) => typeof value === "string" && PURE_DAY.test(value.trim());
// „2026-02-30“ gibt es nicht - der Browser liefe in den März über, der Server sagt nichts. Beide: kein Datum.
const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})/;
function noSuchDay(value) {
  const match = typeof value === "string" ? CALENDAR_DAY.exec(value.trim()) : null;
  if (!match) return false;
  const [year, month, date] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, date));
  return check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date;
}
// Ein unlesbares `now` zählt wie keines - dann gilt die echte Uhr (wie der Server).
const todayOf = (now) => viennaDay(now) || viennaDay(new Date());

/** Ein Wiener Kalendertag als „Sa 23. Mai“ - ohne Monat („Sa 23.“) für den Anfang eines Zeitraums, mit Jahr auf Wunsch. */
function dayText(day, { withMonth = true, withYear = false } = {}) {
  const noon = dayNoon(day);
  const [year, , date] = day.split("-").map(Number);
  const month = withMonth ? ` ${viennaDate(noon, { month: "long" })}` : "";
  return `${WEEKDAYS[noon.getUTCDay()]} ${date}.${month}${withMonth && withYear ? ` ${year}` : ""}`;
}

/**
 * Wann etwas ist - ganz und kurz, die eine Schreibweise der Seite: „Sa 23. Mai · 18:00“, heute „heute 18:00“, morgen
 * „morgen 18:00“, ein anderes Jahr „Sa 23. Mai 2027 · 18:00“. Mit `time: false` nur der Tag („Sa 23. Mai“, „heute“);
 * ein reiner Kalendertag („2026-05-23“) steht immer ohne Uhrzeit. `relative: false` lässt „heute“ und „morgen“ weg -
 * für Sätze wie „Gesendet am Mi 20. Mai · 18:00“. `now` ist der Bezugszeitpunkt. Ohne gültigen Wert kommt `fallback`.
 * Der Server schreibt dasselbe (backend/services/date_text.py, Fälle in docs/date-cases.json).
 */
export function formatWhen(value, { now = new Date(), fallback = "", time = true, relative = true } = {}) {
  if (value == null || value === "" || noSuchDay(value)) return fallback;
  const day = viennaDay(value);
  if (!day) return fallback;
  const withClock = time && !isPureDay(value);
  const clock = withClock ? formatClock(value) : "";
  const today = todayOf(now);
  if (relative && day === today) return withClock ? `heute ${clock}` : "heute";
  if (relative && day === nextDay(today)) return withClock ? `morgen ${clock}` : "morgen";
  const text = dayText(day, { withYear: day.slice(0, 4) !== today.slice(0, 4) });
  return withClock ? `${text} · ${clock}` : text;
}

/** Nur die Uhrzeit in Wien: „18:00“. Ohne gültigen Wert ein leerer Text. */
export function formatClock(value) {
  if (value == null || value === "" || noSuchDay(value)) return "";
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return "";
  return viennaTime(date, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** Nur der Wochentag in Wien: „Sa“, mit `long: true` „Samstag“ - für Spaltenköpfe und Lauf-Chips. */
export function formatWeekday(value, { long = false } = {}) {
  if (value == null || value === "" || noSuchDay(value)) return "";
  const day = viennaDay(isPureDay(value) ? dayNoon(value.trim()) : value);
  if (!day) return "";
  const noon = dayNoon(day);
  return long ? viennaDate(noon, { weekday: "long" }) : WEEKDAYS[noon.getUTCDay()];
}

/** Ein Monat als Überschrift oder „Dabei seit“: „Februar 2026“, ohne Jahr `year: false` („Februar“). */
export function formatMonth(value, { year = true } = {}) {
  if (value == null || value === "" || noSuchDay(value)) return "";
  const date = isPureDay(value) ? dayNoon(value.trim()) : asInstant(value);
  if (Number.isNaN(date.getTime())) return "";
  return viennaDate(date, year ? { month: "long", year: "numeric" } : { month: "long" });
}

/**
 * Das amtliche Datum „23.05.2026“ - nur für Rechnungen, Urkunden, Ausweise und Rechtstexte (#1307). Alles andere
 * schreibt formatWhen. Ein reiner Kalendertag bleibt dieser Tag.
 */
export function formatOfficialDate(value) {
  if (value == null || value === "" || noSuchDay(value)) return "";
  const day = viennaDay(isPureDay(value) ? dayNoon(value.trim()) : value);
  if (!day) return "";
  const [year, month, date] = day.split("-");
  return `${date}.${month}.${year}`;
}

/**
 * Ein Zeitraum nach Tagen: „Fr 19. – Sa 20. Juni“, über den Monat „Mo 30. November – Mi 2. Dezember“, über den
 * Jahreswechsel mit beiden Jahren, ganz in einem anderen Jahr mit dem Jahr am Ende. An einem Tag oder ohne Ende nur der
 * Tag („Sa 23. Mai“). Gezählt in Wiener Tagen - ein Ende um 00:30 ist schon der nächste Tag.
 */
export function formatRange(start, end, { now = new Date(), fallback = "" } = {}) {
  const first = start == null || start === "" || noSuchDay(start) ? "" : viennaDay(start);
  if (!first) return fallback;
  const last = end == null || end === "" || noSuchDay(end) ? first : viennaDay(end) || first;
  const thisYear = todayOf(now).slice(0, 4);
  if (last <= first) return dayText(first, { withYear: first.slice(0, 4) !== thisYear });
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return `${dayText(first, { withMonth: !sameMonth, withYear: !sameYear })} – ${dayText(last, { withYear: !sameYear || last.slice(0, 4) !== thisYear })}`;
}

/**
 * Vergangenes in Listen (News, Benachrichtigungen): „gerade eben“, „vor 12 Min.“, am selben Wiener Tag „vor 3 Std.“,
 * „gestern“, danach der Tag („Sa 16. Mai“). Was deutlich in der Zukunft liegt, steht wie bei formatWhen.
 */
export function formatAgo(value, { now = new Date(), fallback = "" } = {}) {
  if (value == null || value === "" || noSuchDay(value)) return fallback;
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const nowMs = Number.isNaN(asInstant(now).getTime()) ? Date.now() : asInstant(now).getTime();
  const today = todayOf(now);
  // Ein reiner Tag hat keine Uhrzeit, also auch kein „vor 3 Std.“: heute, gestern, sonst der Tag (#1307, wie der Server).
  if (isPureDay(value)) return viennaDay(value) === dayBefore(today) ? "gestern" : formatWhen(value, { now: new Date(nowMs), time: false });
  const diff = nowMs - date.getTime();
  if (diff < -MINUTE_MS) return formatWhen(value, { now: new Date(nowMs) });
  if (diff < MINUTE_MS) return "gerade eben";
  if (diff < HOUR_MS) return `vor ${Math.floor(diff / MINUTE_MS)} Min.`;
  const day = viennaDay(date);
  if (day === today) return `vor ${Math.floor(diff / HOUR_MS)} Std.`;
  if (day === dayBefore(today)) return "gestern";
  return formatWhen(value, { now: new Date(nowMs), time: false });
}

/**
 * Eine Dauer in Worten (#1304): „154 Tage 16 Std.“, „3 Std. 12 Min.“, „45 Min.“, unter einer Minute „42 Sek.“ -
 * höchstens zwei Einheiten, die größte zuerst, eine Einheit mit 0 fällt weg. Nie „154T 16H“. Negatives zählt als 0.
 * `round: "up"` rundet auf ganze Minuten auf - für die Restzeit bis zu einem Termin („noch 1 Min.“ statt „noch 59 Sek.“).
 * Dieselben Fälle wie die App: docs/duration-cases.json.
 */
export function formatDuration(ms, { round = "down" } = {}) {
  if (ms === null || ms === undefined || ms === "") return "";
  const value = Number(ms);
  if (!Number.isFinite(value)) return "";
  const safe = Math.max(0, value);
  const total = round === "up" ? Math.ceil(safe / MINUTE_MS) * 60 : Math.floor(safe / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const dayText = (count) => `${count} ${count === 1 ? "Tag" : "Tage"}`;
  if (days) return hours ? `${dayText(days)} ${hours} Std.` : dayText(days);
  if (hours) return minutes ? `${hours} Std. ${minutes} Min.` : `${hours} Std.`;
  if (minutes) return `${minutes} Min.`;
  return `${total % 60} Sek.`;
}

// Die beiden alten Namen schreiben seit #1307 dieselbe Form wie formatWhen: formatDateTime „Sa 23. Mai · 18:00“,
// formatDate nur den Tag („Sa 23. Mai“). Ohne Wert kommt der Platzhalter, ein unlesbarer Wert bleibt, wie er ist.
export function formatDateTime(value, { fallback, now, relative } = {}) {
  if (!value) return fallback || "TBD";
  return formatWhen(value, { now, relative, fallback: String(value) });
}

export function formatDate(value, { fallback, now, relative } = {}) {
  if (!value) return fallback || "TBD";
  return formatWhen(value, { now, relative, time: false, fallback: String(value) });
}

// Die beiden Wandler für Eingabefelder (datetime-local) rechnen in der Zeit des Geräts - so zeigt der Browser das Feld.
export function fromDateTimeLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function toDateTimeLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function normalizeDateTimeFields(payload, fields) {
  fields.forEach((field) => {
    if (!payload[field]) {
      if (Object.prototype.hasOwnProperty.call(payload, field)) {
        payload[field] = null;
      }
      return;
    }
    payload[field] = fromDateTimeLocal(payload[field]);
  });
  return payload;
}

export function hasOnlineRegistration(item) {
  return item?.online_registration_enabled === true && item?.registration_enabled === true && !!(item.registration_open_from || item.registration_open_until);
}

// Die eine Regel, ob man sich anmelden kann - Anmeldeseite und Anmelde-QR am TV (#1827) fragen hier. `now`: der TV gibt
// seine Uhr herein (sie läuft jede Minute weiter, auch ohne neue Daten).
export function getRegistrationState(item, noun = "Anmeldung", now = Date.now()) {
  const openFrom = item?.registration_open_from ? new Date(item.registration_open_from) : null;
  const openUntil = item?.registration_open_until ? new Date(item.registration_open_until) : null;
  const openFromMs = openFrom && !Number.isNaN(openFrom.getTime()) ? openFrom.getTime() : null;
  const openUntilMs = openUntil && !Number.isNaN(openUntil.getTime()) ? openUntil.getTime() : null;

  if (!item) return { state: "unknown", canRegister: false, label: `${noun} nicht verfügbar` };
  if (item.registration_enabled === false || item.is_invite_only) {
    return { state: "disabled", canRegister: false, label: `${noun} deaktiviert` };
  }
  if (item.status === "draft") {
    return { state: "draft", canRegister: false, label: "Noch nicht veröffentlicht" };
  }
  if (item.status === "scheduled") {
    const suffix = openFromMs ? ` ab ${formatDateTime(item.registration_open_from)}` : "";
    return { state: "scheduled", canRegister: false, label: `${noun} öffnet${suffix}` };
  }
  if (item.status !== "registration_open") {
    return { state: "closed", canRegister: false, label: `${noun} geschlossen` };
  }
  if (openFromMs && now < openFromMs) {
    return { state: "scheduled", canRegister: false, label: `${noun} öffnet am ${formatDateTime(item.registration_open_from, { relative: false })}` };
  }
  if (openUntilMs && now > openUntilMs) {
    return { state: "closed", canRegister: false, label: `${noun} seit ${formatDateTime(item.registration_open_until)} geschlossen` };
  }
  return {
    state: "open",
    canRegister: true,
    label: openUntilMs ? `${noun} offen bis ${formatDateTime(item.registration_open_until)}` : `${noun} offen`,
  };
}
