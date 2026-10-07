import { asInstant, dayNoon, viennaDate, viennaDateTime, viennaDay, viennaTime } from "@/lib/vienna";

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Wann etwas ist - ganz und kurz, die eine Schreibweise der Seite (#1220, Wahl des Betreibers vom 07.10.2026):
 * „Sa 23. Mai · 18:00“, heute „heute 18:00“, morgen „morgen 18:00“. Das Jahr steht nur dabei, wenn es nicht das
 * laufende ist („Sa 23. Mai 2025 · 18:00“). Tag und Uhrzeit gelten in Wien (lib/vienna.js), der Monat heißt wie in
 * Österreich („Jänner“). Ohne gültigen Wert kommt `fallback`.
 */
export function formatWhen(value, { now = new Date(), fallback = "" } = {}) {
  if (value == null || value === "") return fallback;
  const day = viennaDay(value);
  if (!day) return fallback;
  const time = viennaTime(value, { hour: "2-digit", minute: "2-digit" });
  const today = viennaDay(now);
  if (day === today) return `heute ${time}`;
  if (day === new Date(dayNoon(today).getTime() + DAY_MS).toISOString().slice(0, 10)) return `morgen ${time}`;
  const [year, , date] = day.split("-").map(Number);
  const noon = dayNoon(day);
  const weekday = WEEKDAYS[noon.getUTCDay()];
  const monthName = viennaDate(noon, { month: "long" });
  const yearPart = today.slice(0, 4) === String(year) ? "" : ` ${year}`;
  return `${weekday} ${date}. ${monthName}${yearPart} · ${time}`;
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
