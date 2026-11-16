// Live vor Ort (#1556): Verzug und die Zeile „Du bist als Nächstes an Station 2“. Die Daten
// kommen fertig vom Server (GET /tournaments/<id>/live-queue, services/live_queue.py) - hier steht nur, wie sie
// aussehen. Die Spielzeit-Uhr (#1167) rechnet lib/matchClock.
import { viennaTime } from "@/lib/vienna";

// Ab so viel Verschiebung heißt es „Verzug“ - darunter ist es Rauschen (wie am TV, #1564).
export const DELAY_SHOWN_FROM = 5;
const clock = (value) => viennaTime(value, { hour: "2-digit", minute: "2-digit" });

/** „+11 Min.“ - erst ab 5 Minuten; früher als geplant „12 Min. früher“. */
export function delayText(minutes) {
  const value = Number(minutes);
  if (minutes === null || minutes === undefined || Number.isNaN(value) || Math.abs(value) < DELAY_SHOWN_FROM) return "";
  return value > 0 ? `+${value} Min.` : `${Math.abs(value)} Min. früher`;
}

/**
 * Was die Spieler-Sicht über ein Spiel sagt: Titel, eine Zeile darunter und der Ton (`live`, `call`, `next`, `later`).
 * Ein Eintrag aus `/live-queue/me` (`entries`) oder `/live-queue` (`matches[id]`). `personal: false` für die
 * Matchseite - dort schauen auch Zuschauer, also ohne „du“.
 */
export function myQueueLine(entry, { personal = true } = {}) {
  if (!entry) return null;
  const where = entry.station_text || "";
  if (!personal && entry.state === "called") {
    return { title: where ? `Aufgerufen: ${where}` : "Aufgerufen", detail: entry.report_by ? `Antreten bis ${clock(entry.report_by)}` : "", tone: "call" };
  }
  if (entry.state === "running") return { title: where ? `Läuft an ${where}` : "Läuft", detail: "", tone: "live" };
  if (entry.state === "called") {
    return {
      title: where ? `Du bist dran: ${where}` : "Du bist dran",
      detail: entry.report_by ? `Bitte bis ${clock(entry.report_by)} antreten` : "Bitte jetzt antreten",
      tone: "call",
    };
  }
  const when = entry.forecast_at ? `${entry.forecast ? "voraussichtlich " : ""}ca. ${clock(entry.forecast_at)}` : "";
  const detail = [when, delayText(entry.delay_minutes)].filter(Boolean).join(" · ");
  if (!where) return { title: personal ? "Dein nächstes Spiel" : "Noch ohne Station", detail, tone: "later" };
  if (entry.position === 1) return { title: personal ? `Du bist als Nächstes an ${where}` : `Als Nächstes an ${where}`, detail, tone: "next" };
  if (entry.position === 2) return { title: `Danach an ${where}`, detail, tone: "later" };
  return { title: `Später an ${where}`, detail, tone: "later" };
}

/** „+11 Min. · Finale jetzt ca. 20:51“ - der Verzug und wann das letzte Spiel jetzt beginnt. */
export function queueSummaryLine(summary) {
  const last = summary?.last;
  if (!last?.forecast_at) return "";
  const delay = delayText(summary.delay_minutes);
  return delay ? `${delay} · ${last.label} jetzt ca. ${clock(last.forecast_at)}` : `Im Plan · ${last.label} ca. ${clock(last.forecast_at)}`;
}

// Ein gescheiterter Abruf der Warteschlange (#2440): Netz, Server (5xx) oder Zeitüberschreitung lassen den letzten Stand
// stehen - nur „gibt es nicht“ nimmt sie weg. Das sagt der Server mit `applies: false` (online, keine Station) oder,
// wenn es das Turnier nicht (mehr) gibt oder es nicht sichtbar ist, mit 404 bzw. 403 (routes/tournament_live_routes.py).
export const QUEUE_GONE_STATUSES = Object.freeze([403, 404]);
// Die eigenen Spiele (`/live-queue/me`, angemeldet): 401 heißt, die Sitzung ist abgelaufen (das Auffrischen scheiterte
// schon) - dann fällt die Zeile weg, und es wird nicht weiter nachgefragt.
export const QUEUE_ME_GONE_STATUSES = Object.freeze([401, 403, 404]);
// Hängt ein Abruf, gilt er nach so vielen ms als gescheitert - sonst stünde der nächste für immer hinten an.
export const QUEUE_TIMEOUT_MS = 15000;
// Nach einem Fehler kein Dauerfeuer: der Takt wird langsamer - 5 s, 10, 20, 40, höchstens 60 s, aber nie schneller als
// der Grundtakt der Seite. Meldungen aus dem Strom und das Wiederverbinden laden sofort (nur nie überlappend).
export const QUEUE_RETRY_MIN_MS = 5000;
export const QUEUE_RETRY_MAX_MS = 60000;
// Spieler-Sichten (Spielplan, „Du bist als Nächstes“): Scheitert das Nachladen so lange, fällt der alte Stand weg - sonst
// stünde ein falsches „Du bist dran“ unbegrenzt da. Die Turnierleitung behält ihn mit Hinweis.
export const QUEUE_STALE_MAX_MS = 3 * 60 * 1000;

/**
 * Ob ein Fehler beim Abruf heißt „diese Warteschlange gibt es nicht“ (403/404) - sonst ist er vorübergehend. `statuses`:
 * welche Antworten zählen - `/live-queue/me` nimmt 401 dazu (Sitzung abgelaufen, das Auffrischen scheiterte schon).
 */
export function queueGoneError(error, statuses = QUEUE_GONE_STATUSES) {
  return statuses.includes(error?.response?.status);
}

/** Wartezeit bis zum nächsten Versuch von selbst nach `failures` Fehlschlägen in Folge (0: sofort). */
export function queueRetryDelay(failures) {
  const count = Math.max(0, Math.floor(Number(failures) || 0));
  if (!count) return 0;
  return Math.min(QUEUE_RETRY_MAX_MS, QUEUE_RETRY_MIN_MS * 2 ** (count - 1));
}

/** Der Takt nach `failures` Fehlschlägen in Folge: der Grundtakt, nach Fehlern mindestens die Wartezeit. 0 bleibt 0. */
export function queuePollMs(baseMs, failures) {
  const base = Math.max(0, Number(baseMs) || 0);
  return base ? Math.max(base, queueRetryDelay(failures)) : 0;
}

/** „Letzter Stand vor 25 s“, ab einer Minute „vor 3 Min.“ - solange das Nachladen scheitert. */
export function staleText(ms) {
  const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `Letzter Stand vor ${seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} Min.`} – es wird weiter nachgeladen.`;
}
