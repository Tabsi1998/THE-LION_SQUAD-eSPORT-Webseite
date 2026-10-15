// Live vor Ort (#1556): Spielzeit-Uhr (#1167), Verzug und die Zeile „Du bist als Nächstes an Station 2“. Die Daten
// kommen fertig vom Server (GET /tournaments/<id>/live-queue, services/live_queue.py) - hier steht nur, wie sie
// aussehen. Reine Rechnung: die Uhr („jetzt“) gibt der Aufrufer.
import { asInstant, viennaTime } from "@/lib/vienna";

// Ab so viel Verschiebung heißt es „Verzug“ - darunter ist es Rauschen (wie am TV, #1564).
export const DELAY_SHOWN_FROM = 5;
// Die Uhr wird gelb ab 80 % der Dauer und rot ab 100 % (#1167).
export const CLOCK_WARN_AT = 0.8;

const clock = (value) => viennaTime(value, { hour: "2-digit", minute: "2-digit" });
const pad = (value) => String(value).padStart(2, "0");

function timeOf(value) {
  if (!value) return null;
  const time = asInstant(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Die Spielzeit-Uhr eines laufenden Spiels: „12:34“ gegen „30 Min.“, Anteil für den Balken und die Farbe
 * (`run`, `warn` ab 80 %, `over` ab 100 %, `none` ohne Dauer). `stepped`: der Balken springt minutenweise
 * („Bewegung reduzieren“). Ohne Startzeit `null`.
 */
export function matchClock(startedAt, durationMinutes, now = Date.now(), { stepped = false } = {}) {
  const started = timeOf(startedAt);
  if (started === null) return null;
  const elapsed = Math.max(0, Math.floor((now - started) / 1000));
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const text = hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  const limit = Number(durationMinutes) > 0 ? Number(durationMinutes) : null;
  if (!limit) return { text, limit: "", ratio: null, tone: "none", overMinutes: 0 };
  const share = (stepped ? Math.floor(elapsed / 60) * 60 : elapsed) / (limit * 60);
  const exact = elapsed / (limit * 60);
  const tone = exact >= 1 ? "over" : exact >= CLOCK_WARN_AT ? "warn" : "run";
  return {
    text,
    limit: `${limit} Min.`,
    ratio: Math.min(1, share),
    tone,
    overMinutes: Math.max(0, Math.floor(elapsed / 60) - limit),
  };
}

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
