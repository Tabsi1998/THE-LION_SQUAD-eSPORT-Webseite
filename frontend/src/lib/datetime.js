import { asInstant, dayBefore, dayNoon, viennaDate, viennaDateTime, viennaDay, viennaTime } from "@/lib/vienna";

// Ein Datumsformat (#1220, #1307, Wahl des Betreibers vom 07.10.2026): „Sa 23. Mai · 18:00“ - Wochentag kurz, Monat
// ausgeschrieben, das Jahr nur, wenn es nicht das laufende ist. Tag und Uhrzeit gelten in Wien (lib/vienna.js), der Monat
// heißt wie in Österreich („Jänner“). Die App schreibt dasselbe (mobile/src/lib/format.ts); beide prüfen dieselben Fälle
// aus docs/date-cases.json.
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const nextDay = (day) => new Date(dayNoon(day).getTime() + DAY_MS).toISOString().slice(0, 10);

/** Ein Wiener Kalendertag als „Sa 23. Mai“ - ohne Monat („Sa 23.“) für den Anfang eines Zeitraums, mit Jahr auf Wunsch. */
function dayText(day, { withMonth = true, withYear = false } = {}) {
  const noon = dayNoon(day);
  const [year, , date] = day.split("-").map(Number);
  const month = withMonth ? ` ${viennaDate(noon, { month: "long" })}` : "";
  return `${WEEKDAYS[noon.getUTCDay()]} ${date}.${month}${withMonth && withYear ? ` ${year}` : ""}`;
}

/**
 * Wann etwas ist - ganz und kurz, die eine Schreibweise der Seite: „Sa 23. Mai · 18:00“, heute „heute 18:00“, morgen
 * „morgen 18:00“, ein anderes Jahr „Sa 23. Mai 2027 · 18:00“. Mit `time: false` nur der Tag („Sa 23. Mai“, „heute“).
 * `now` ist der Bezugszeitpunkt. Ohne gültigen Wert kommt `fallback`.
 */
export function formatWhen(value, { now = new Date(), fallback = "", time = true } = {}) {
  if (value == null || value === "") return fallback;
  const day = viennaDay(value);
  if (!day) return fallback;
  const clock = time ? viennaTime(value, { hour: "2-digit", minute: "2-digit" }) : "";
  const today = viennaDay(now);
  if (day === today) return time ? `heute ${clock}` : "heute";
  if (day === nextDay(today)) return time ? `morgen ${clock}` : "morgen";
  const text = dayText(day, { withYear: day.slice(0, 4) !== today.slice(0, 4) });
  return time ? `${text} · ${clock}` : text;
}

/**
 * Ein Zeitraum nach Tagen: „Fr 19. – Sa 20. Juni“, über den Monat „Mo 30. November – Mi 2. Dezember“, über den
 * Jahreswechsel mit beiden Jahren, ganz in einem anderen Jahr mit dem Jahr am Ende. An einem Tag oder ohne Ende nur der
 * Tag („Sa 23. Mai“). Gezählt in Wiener Tagen - ein Ende um 00:30 ist schon der nächste Tag.
 */
export function formatRange(start, end, { now = new Date(), fallback = "" } = {}) {
  const first = start == null || start === "" ? "" : viennaDay(start);
  if (!first) return fallback;
  const last = end == null || end === "" ? first : viennaDay(end) || first;
  const thisYear = viennaDay(now).slice(0, 4);
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
  if (value == null || value === "") return fallback;
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const diff = asInstant(now).getTime() - date.getTime();
  if (diff < -MINUTE_MS) return formatWhen(date, { now });
  if (diff < MINUTE_MS) return "gerade eben";
  if (diff < HOUR_MS) return `vor ${Math.floor(diff / MINUTE_MS)} Min.`;
  const day = viennaDay(date);
  const today = viennaDay(now);
  if (day === today) return `vor ${Math.floor(diff / HOUR_MS)} Std.`;
  if (day === dayBefore(today)) return "gestern";
  return formatWhen(date, { now, time: false });
}

export function formatDateTime(value, options = {}) {
  if (!value) return options.fallback || "TBD";
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return viennaDateTime(date, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(value, options = {}) {
  if (!value) return options.fallback || "TBD";
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return viennaDate(date, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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

export function getRegistrationState(item, noun = "Anmeldung") {
  const now = Date.now();
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
    return { state: "scheduled", canRegister: false, label: `${noun} öffnet am ${formatDateTime(item.registration_open_from)}` };
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
