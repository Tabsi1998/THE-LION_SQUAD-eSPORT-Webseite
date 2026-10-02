// Der Countdown (N3, #741): kein bloßes Zählwerk, sondern ein Ablauf - ab 23:59:00 ruhig, die letzten zehn Sekunden
// mit Puls, um 00:00 bricht die Zahl auf und der Gruß kommt, dann läuft die Show, ohne dass etwas die Seite verdeckt.
// Maßgeblich ist die Uhr des Servers: der Abstand zur Geräteuhr kommt aus der Saison-Abfrage (`clock.js`).
// Reine Rechnung, gleich in der App (mobile/src/seasons/newYear/countdown.ts).

/** Ab so vielen Sekunden vor Mitternacht steht der Countdown da (23:59:00). */
export const COUNTDOWN_SECONDS = 60;
/** Die letzten Sekunden mit Puls. */
export const PULSE_SECONDS = 10;
/** So lange steht der Gruß groß da, bevor er klein wird und der Show Platz macht. */
export const ZERO_SECONDS = 8;
/** Kleiner Hinweis in der Kopfzeile ab 23:00 („noch 42 Min.“). */
export const HINT_MINUTES = 60;

/**
 * Wo der Countdown steht: `hint` (ab 23:00, Minuten bis Mitternacht), `calm` (ab 23:59:00, Sekunden), `pulse` (letzte
 * zehn Sekunden), `zero` (der Gruß, acht Sekunden), `done` (danach) - sonst `waiting`. Alles in ms der Serveruhr.
 */
export function countdownState(serverNow, showStart) {
  const remaining = (showStart - serverNow) / 1000;
  if (!Number.isFinite(remaining)) return { stage: "waiting", remaining: Infinity };
  if (remaining > HINT_MINUTES * 60) return { stage: "waiting", remaining };
  if (remaining > COUNTDOWN_SECONDS) return { stage: "hint", remaining, minutes: Math.ceil(remaining / 60) };
  if (remaining > PULSE_SECONDS) return { stage: "calm", remaining, seconds: Math.ceil(remaining) };
  if (remaining > 0) return { stage: "pulse", remaining, seconds: Math.ceil(remaining) };
  if (remaining > -ZERO_SECONDS) return { stage: "zero", remaining, since: -remaining };
  return { stage: "done", remaining, since: -remaining };
}

/** Das neue Jahr aus dem Beginn der Show (ISO vom Server, Ortszeit Wien) - nie aus einer festen Zahl. */
export function newYearOf(showStartIso) {
  const year = Number(String(showStartIso || "").slice(0, 4));
  return Number.isFinite(year) && year > 2000 ? year : null;
}

/** Wie stark der Puls in einer Sekunde ist (0–1): ein kurzer Schlag zu Beginn jeder Sekunde, zum Ende stärker. */
export function pulseLevel(remaining) {
  if (remaining <= 0 || remaining > PULSE_SECONDS) return 0;
  const intoSecond = 1 - (remaining - Math.floor(remaining));
  const beat = intoSecond < 0.18 ? 1 - intoSecond / 0.18 : 0;
  const build = 0.55 + 0.45 * (1 - remaining / PULSE_SECONDS);
  return Math.round(beat * build * 1000) / 1000;
}
