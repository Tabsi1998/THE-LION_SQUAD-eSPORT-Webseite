// Liga-Check-in auf der Matchseite (#1652, docs/LIGA.md D.2): Stand, Sätze und Countdown im Klartext, damit Captains ohne
// Vorwissen sehen, was jetzt zu tun ist. Die Zahlen und der Stand kommen vom Server (`checkin`), hier wird nur formuliert.
import { shortWhen } from "@/lib/leagueSchedule";
import { viennaTime } from "@/lib/vienna";

export const STATE_LABELS = {
  no_time: "Termin offen",
  waiting: "Check-in öffnet bald",
  open: "Check-in offen",
  closed: "Check-in geschlossen",
  veto: "Veto läuft",
  ready: "Spielbereit",
  running: "Spiel läuft",
  finished: "Beendet",
};

/** „19:52“ in Wiener Zeit. */
export function clock(value) {
  return value ? viennaTime(value, { hour: "2-digit", minute: "2-digit" }) : "";
}

export function ownSide(block) {
  return (block?.sides || []).find((side) => side.own) || null;
}

export function otherSide(block) {
  return (block?.sides || []).find((side) => !side.own) || null;
}

/** Der eine Satz unter der Überschrift: was jetzt gilt und was die eigene Seite tun soll. */
export function stateText(block) {
  if (!block) return "";
  const rules = block.rules || {};
  const own = ownSide(block);
  const other = otherSide(block);
  const closes = block.window?.closes_at ? shortWhen(block.window.closes_at) : "";
  switch (block.state) {
    case "no_time":
      return `Der Check-in öffnet ${rules.opens_minutes_before} Minuten vor dem Termin – sobald einer feststeht.`;
    case "waiting":
      return `Der Check-in öffnet um ${shortWhen(block.window?.opens_at)} (${rules.opens_minutes_before} Minuten vor dem Termin) und schließt um ${closes}.`;
    case "open":
      if (own?.checked_in) return `Ihr seid eingecheckt – jetzt fehlt noch ${other?.name || "die Gegenseite"}. Bis ${closes} könnt ihr Anwesende ergänzen.`;
      if (own) return `Hakt an, wer da ist (mindestens ${rules.min_present}), und tippt auf „Einchecken“ – bis ${closes}.`;
      return `Beide Seiten checken bis ${closes} ein.`;
    case "closed":
      return `Das Fenster ist seit ${closes} zu. Fehlt eine Seite, entscheidet die Liga-Leitung – gewertet wird nichts von selbst.`;
    case "veto":
      return "Beide Seiten sind eingecheckt – das Veto läuft.";
    case "ready":
      return "Beide Seiten sind eingecheckt. Map 1 kann beginnen – eine Seite tippt auf „Spiel starten“, auch vor dem Termin.";
    case "running":
      return block.started_at ? `Das Spiel läuft seit ${clock(block.started_at)}.` : "Das Spiel läuft.";
    case "finished":
      return "Das Spiel ist entschieden.";
    default:
      return "";
  }
}

/** Wohin der Countdown zählt: bis zur Öffnung oder bis zum Schluss - sonst nichts. */
export function countdownTarget(block) {
  if (!block?.window) return null;
  if (block.state === "waiting") return new Date(block.window.opens_at).getTime();
  if (block.state === "open") return new Date(block.window.closes_at).getTime();
  return null;
}

export function countdownLabel(block) {
  if (block?.state === "waiting") return "öffnet in";
  if (block?.state === "open") return "noch";
  return "";
}

/** Wie viel vom Ring noch übrig ist (1 = voll). Vor der Öffnung bleibt er voll, im Fenster schrumpft er bis zum Schluss. */
export function ringShare(block, now = Date.now()) {
  if (!block?.window || block.state !== "open") return 1;
  const opens = new Date(block.window.opens_at).getTime();
  const closes = new Date(block.window.closes_at).getTime();
  if (!(closes > opens)) return 1;
  return Math.min(1, Math.max(0, (closes - now) / (closes - opens)));
}

/** „12:30“ bzw. „1:02:05“ bis zum Ziel - nie negativ. */
export function remainingText(target, now = Date.now()) {
  if (!target) return "";
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Die Zeile zu einer Seite: „eingecheckt um 19:52 · 3 Spieler“, „eingetragen von der Liga-Leitung“, „noch nicht eingecheckt“. */
export function sideStatusText(side) {
  if (!side) return "";
  if (!side.checked_in) return "noch nicht eingecheckt";
  const count = Number(side.present_count || 0);
  const players = `${count} ${count === 1 ? "Spieler" : "Spieler"}`;
  const who = side.via === "lead" ? "eingetragen von der Liga-Leitung" : "eingecheckt";
  return `${who} um ${clock(side.updated_at || side.at)} · ${players}`;
}

/** Die Regeln der Season als kurze Sätze. */
export function rulesSentences(rules) {
  if (!rules) return [];
  return [
    `Der Check-in öffnet ${rules.opens_minutes_before} Minuten vor dem Termin und schließt ${rules.closes_minutes_after} Minuten danach.`,
    `Mindestens ${rules.min_present} Spieler aus dem Kader müssen da und spielberechtigt sein – ergänzen geht bis zum Schluss.`,
    "Sobald beide Seiten eingecheckt sind, kann Map 1 beginnen – auch vor dem Termin. Verspätung zählt nur beim Check-in.",
    "Fehlt eine Seite nach dem Fenster, entscheidet die Liga-Leitung. Gewertet wird nie automatisch.",
    "Hat ein Team einer neuen Regelversion nicht zugestimmt, geht für dieses Team kein Check-in und kein Start.",
  ];
}

/** Wie viele angehakt sind und ob das reicht - für die Zeile unter der Liste. */
export function selectionText(count, minimum) {
  if (count >= minimum) return `${count} angehakt – das reicht (mindestens ${minimum}).`;
  const missing = minimum - count;
  return `${count} angehakt – noch ${missing === 1 ? "eine Person" : `${missing} Personen`} bis zur Mindestzahl ${minimum}.`;
}
