// Der Countdown in der App (N3 #741): dieselben Stufen wie im Web (frontend/src/seasons/newYear/countdown.js) - Hinweis
// ab 23:00, ruhig ab 23:59:00, Puls in den letzten zehn Sekunden, um 00:00 der Gruß. Maßgeblich ist die Serveruhr
// (`serverOffset` aus dem SeasonProvider).

export const COUNTDOWN_SECONDS = 60;
export const PULSE_SECONDS = 10;
export const ZERO_SECONDS = 8;
export const HINT_MINUTES = 60;

export type CountdownStage = "waiting" | "hint" | "calm" | "pulse" | "zero" | "done";
export type CountdownState = { stage: CountdownStage; remaining: number; minutes?: number; seconds?: number; since?: number };

export function countdownState(serverNow: number, showStart: number): CountdownState {
  const remaining = (showStart - serverNow) / 1000;
  if (!Number.isFinite(remaining)) return { stage: "waiting", remaining: Infinity };
  if (remaining > HINT_MINUTES * 60) return { stage: "waiting", remaining };
  if (remaining > COUNTDOWN_SECONDS) return { stage: "hint", remaining, minutes: Math.ceil(remaining / 60) };
  if (remaining > PULSE_SECONDS) return { stage: "calm", remaining, seconds: Math.ceil(remaining) };
  if (remaining > 0) return { stage: "pulse", remaining, seconds: Math.ceil(remaining) };
  if (remaining > -ZERO_SECONDS) return { stage: "zero", remaining, since: -remaining };
  return { stage: "done", remaining, since: -remaining };
}

export function newYearOf(showStartIso: string | null | undefined): number | null {
  const year = Number(String(showStartIso || "").slice(0, 4));
  return Number.isFinite(year) && year > 2000 ? year : null;
}

/**
 * Der Abstand der Serveruhr zur Geräteuhr (ms): Zeitpunkt der Antwort gegen die Mitte zwischen Anfrage und Antwort -
 * wie `serverOffset` im Web (frontend/src/seasons/clock.js). Ohne gültige Zeit: 0.
 */
export function serverOffset(serverNowIso: string | null | undefined, requestedAt: number, receivedAt: number): number {
  const server = Date.parse(serverNowIso || "");
  if (!Number.isFinite(server) || !Number.isFinite(requestedAt) || !Number.isFinite(receivedAt)) return 0;
  return Math.round(server - (requestedAt + receivedAt) / 2);
}
