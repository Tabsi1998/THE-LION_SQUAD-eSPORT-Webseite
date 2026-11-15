// Hinweis der Turnierleitung in der App (#1166, #2393): Vorlagen, Ablauf und Restzeit - für das Banner auf Turnier- und
// Event-Seite und den Reiter „Hinweis“ der Turnierleitung. Dieselben Regeln wie im Web (frontend/src/lib/
// tournamentNotices.js); Empfänger, Rechte und Doppelversand prüft der Server (backend/services/tournament_notices.py).
import { viennaTime } from "./vienna";

export type NoticeItem = {
  id: string;
  text?: string;
  created_at?: string | null;
  expires_at?: string | null;
  target?: "tournament" | "event" | string;
  tv?: boolean;
  tournament_title?: string | null;
};

export type LeadNoticeItem = NoticeItem & {
  target_label?: string;
  author?: string;
  active?: boolean;
  can_remove?: boolean;
  removed_at?: string | null;
  removed_by?: string | null;
  state?: "sending" | "sent" | "interrupted" | "failed" | string;
  stale?: boolean;
  recipients?: number;
  processed?: number;
  delivered?: number;
  failed?: number;
};

export const NOTICE_MAX = 140;
export const NOTICE_MIN = 3;
export const NOTICE_DURATION_DEFAULT = 120;
// Die Dauern zur Wahl - die Vorgabe zwei Stunden; der Server nimmt 15 Minuten bis 12 Stunden.
export const NOTICE_DURATIONS: Array<[number, string]> = [
  [30, "30 Min."],
  [60, "1 Std."],
  [120, "2 Std."],
  [240, "4 Std."],
  [480, "8 Std."],
];

const MINUTE = 60000;
const clock = (value: string | number) => viennaTime(value, { hour: "2-digit", minute: "2-digit" });
const time = (value?: string | null) => Date.parse(value || "");

/** „Pause bis …“ als Vorschlag: in einer Viertelstunde, auf fünf Minuten aufgerundet - Wiener Uhr („14:30“). */
export function suggestedPauseClock(now = Date.now()): string {
  const step = 5 * MINUTE;
  return clock(Math.ceil((now + 15 * MINUTE) / step) * step);
}

/** Die drei Vorlagen wie im Web. `station`: der Name der ersten Station („PC 1“), sonst bleibt „PC 1“ zum Anpassen. */
export function noticeTemplates({ now = Date.now(), station = "" }: { now?: number; station?: string } = {}) {
  return [
    { key: "pause", label: "Pause bis …", text: `Pause bis ${suggestedPauseClock(now)}` },
    { key: "final", label: `Finale an ${station || "PC …"}`, text: `Finale an ${station || "PC 1"}` },
    { key: "checkin", label: "Bitte zum Check-in", text: "Bitte zum Check-in" },
  ];
}

/** Länge wie beim Server: Leerraum zählt zusammengefasst. */
export function noticeLength(text: string | null | undefined): number {
  return String(text || "").split(/\s+/).filter(Boolean).join(" ").length;
}

/** Nur, was noch steht - der neueste zuerst. */
export function activeNotices<T extends NoticeItem>(items: T[] | null | undefined, now = Date.now()): T[] {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.text && time(item.expires_at) > now)
    .sort((a, b) => time(b.created_at) - time(a.created_at));
}

/** Wann der nächste Hinweis abläuft (ms ab `now`) - für den Zeitgeber, der ihn dann ausblendet. */
export function nextExpiry(items: NoticeItem[] | null | undefined, now = Date.now()): number | null {
  const left = activeNotices(items, now).map((item) => time(item.expires_at) - now);
  return left.length ? Math.min(...left) : null;
}

/** „noch 1 Std. 45 Min.“, „noch 12 Min.“, „läuft gleich ab“. */
export function remainingText(expiresAt: string | null | undefined, now = Date.now()): string {
  const minutes = Math.ceil((time(expiresAt) - now) / MINUTE);
  if (!Number.isFinite(minutes) || minutes <= 1) return "läuft gleich ab";
  if (minutes < 60) return `noch ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `noch ${hours} Std. ${rest} Min.` : `noch ${hours} Std.`;
}

/** Wie viel der Zeit noch übrig ist (1 = gerade geschrieben, 0 = abgelaufen) - für die Leiste unter dem Banner. */
export function remainingShare(item: NoticeItem | null | undefined, now = Date.now()): number {
  const start = time(item?.created_at);
  const end = time(item?.expires_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(1, Math.max(0, (end - now) / (end - start)));
}

/** „14:05“ - wann der Hinweis kam, Wiener Uhr. */
export function noticeClock(item: NoticeItem | null | undefined): string {
  return item?.created_at ? clock(item.created_at) : "";
}

/** Der Stand eines Versands in einem Satz für die Liste der Turnierleitung. */
export function deliveryText(item: LeadNoticeItem | null | undefined): string {
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

/** „Geht an 12 Personen …“ - die Empfänger vor dem Senden. */
export function recipientsText(count: number | null | undefined): string {
  if (count == null) return "Empfänger werden gezählt …";
  if (count === 0) return "Gerade ist niemand angemeldet – der Hinweis steht nur als Banner.";
  return `Geht an ${count === 1 ? "1 Person" : `${count} Personen`}: alle Angemeldeten, bei Teams alle Mitglieder.`;
}

/** Eine Kennung je Hinweis - derselbe Tipp (Doppeltipp, neuer Versuch) trägt dieselbe, der Server schickt nichts doppelt. */
export function newRequestId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const random = cryptoApi?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `notice-${random}`;
}
