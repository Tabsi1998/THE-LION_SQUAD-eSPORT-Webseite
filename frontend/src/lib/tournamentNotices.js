// Hinweis der Turnierleitung (#1166): Vorlagen, Ablauf und Restzeit - für das Formular in der Turnierleitung, das Banner
// auf Turnier- und Event-Seite und den TV. Die Regeln (Empfänger, Rechte, Doppelversand) stehen im Server
// (backend/services/tournament_notices.py); hier nur, was die Oberfläche rechnet.
import { fromViennaInput, viennaInputValue, viennaTime } from "@/lib/vienna";

export const NOTICE_MAX = 140;
export const NOTICE_DURATION_DEFAULT = 120;
// Die Dauern im Formular - die Vorgabe zwei Stunden; der Server nimmt 15 Minuten bis 12 Stunden.
export const NOTICE_DURATIONS = [
  [30, "30 Min."],
  [60, "1 Std."],
  [120, "2 Std."],
  [240, "4 Std."],
  [480, "8 Std."],
];

const MINUTE = 60000;

const clock = (value) => viennaTime(value, { hour: "2-digit", minute: "2-digit" });

/** „Pause bis …“ als Vorschlag: in einer Viertelstunde, auf fünf Minuten aufgerundet - Wiener Uhr („14:30“). */
export function suggestedPauseClock(now = Date.now()) {
  const step = 5 * MINUTE;
  return clock(Math.ceil((now + 15 * MINUTE) / step) * step);
}

/** Eine Uhrzeit „14:30“ (Wiener Uhr) als Zeitpunkt: heute - liegt sie mehr als eine Stunde zurück, morgen. */
export function pauseUntilIso(hhmm, now = Date.now()) {
  if (!/^\d{1,2}:\d{2}$/.test(String(hhmm || "").trim())) return null;
  const [hours, minutes] = String(hhmm).trim().split(":").map(Number);
  if (hours > 23 || minutes > 59) return null;
  const today = viennaInputValue(now).slice(0, 10);
  const wall = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  const iso = fromViennaInput(`${today}T${wall}`);
  if (!iso) return null;
  if (Date.parse(iso) >= now - 60 * MINUTE) return iso;
  return new Date(Date.parse(iso) + 24 * 60 * MINUTE).toISOString();
}

/** Die drei Vorlagen. `station`: der Name der ersten Station („PC 1“), sonst bleibt „PC 1“ zum Anpassen. */
export function noticeTemplates({ now = Date.now(), station = "" } = {}) {
  return [
    { key: "pause", label: "Pause bis …", text: `Pause bis ${suggestedPauseClock(now)}` },
    { key: "final", label: `Finale an ${station || "PC …"}`, text: `Finale an ${station || "PC 1"}` },
    { key: "checkin", label: "Bitte zum Check-in", text: "Bitte zum Check-in" },
  ];
}

/** Steht im Text „Pause bis 14:30“? Dann die Uhrzeit - für „Pause bis“ am TV (#1123). */
export function pauseClockIn(text) {
  const match = /pause bis (\d{1,2}:\d{2})/i.exec(String(text || ""));
  return match ? match[1] : "";
}

/** Zeichen, die noch frei sind - Leerraum zählt wie beim Server zusammengefasst. */
export function noticeLength(text) {
  return String(text || "").split(/\s+/).filter(Boolean).join(" ").length;
}

/** Nur, was noch steht - der neueste zuerst. */
export function activeNotices(items, now = Date.now()) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.text && Date.parse(item.expires_at || "") > now)
    .sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""));
}

/** Wann der nächste Hinweis abläuft (ms ab `now`) - für den Zeitgeber, der ihn dann ausblendet. */
export function nextExpiry(items, now = Date.now()) {
  const left = activeNotices(items, now).map((item) => Date.parse(item.expires_at) - now);
  return left.length ? Math.min(...left) : null;
}

/** „noch 1 Std. 45 Min.“, „noch 12 Min.“, „läuft gleich ab“. */
export function remainingText(expiresAt, now = Date.now()) {
  const minutes = Math.ceil((Date.parse(expiresAt || "") - now) / MINUTE);
  if (!Number.isFinite(minutes) || minutes <= 1) return "läuft gleich ab";
  if (minutes < 60) return `noch ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `noch ${hours} Std. ${rest} Min.` : `noch ${hours} Std.`;
}

/** Wie viel der Zeit noch übrig ist (1 = gerade geschrieben, 0 = abgelaufen) - für die Leiste unter dem Banner. */
export function remainingShare(item, now = Date.now()) {
  const start = Date.parse(item?.created_at || "");
  const end = Date.parse(item?.expires_at || "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(1, Math.max(0, (end - now) / (end - start)));
}

/** „14:05“ - wann der Hinweis kam, Wiener Uhr. */
export function noticeClock(item) {
  return item?.created_at ? clock(item.created_at) : "";
}

/** Der Stand eines Versands in einem Satz für die Liste der Turnierleitung. */
export function deliveryText(item) {
  if (!item) return "";
  const people = item.recipients === 1 ? "1 Person" : `${item.recipients || 0} Personen`;
  if (item.state === "sending" && !item.stale) return `wird verschickt · ${item.processed || 0} von ${people}`;
  if (item.state === "interrupted" || item.stale) {
    const failed = item.failed ? ` · bei ${item.failed === 1 ? "1 Person" : `${item.failed} Personen`} hat es geklemmt` : "";
    return `Versand unterbrochen · ${item.processed || 0} von ${people}${failed} – bitte fortsetzen`;
  }
  if (item.state === "failed") return "Versand fehlgeschlagen";
  return `an ${people} · ${item.delivered || 0} benachrichtigt`;
}

/** Eine Kennung je Hinweis - derselbe Klick (Doppelklick, neuer Versuch) trägt dieselbe, der Server schickt nichts doppelt. */
export function newRequestId() {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `notice-${random}`;
}
