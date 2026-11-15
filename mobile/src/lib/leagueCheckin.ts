import type { VetoBlock } from "./leagueVeto";
import { viennaDate, viennaTime } from "./vienna";

// Liga-Check-in auf der Matchseite (#2173, Web: frontend/src/lib/leagueCheckin.js, docs/LIGA.md D.2): Stand, Sätze und Countdown im
// Klartext, damit Captains ohne Vorwissen sehen, was jetzt zu tun ist. Zahlen und Stand kommen vom Server (`checkin`) - hier wird nur
// formuliert. Dieselben Sätze wie im Web; lib/leagueCheckin.test.ts prüft dieselben Fälle.

export type CheckinRules = {
  opens_minutes_before?: number;
  closes_minutes_after?: number;
  min_present?: number;
  remind_minutes_before_close?: number;
};

export type CheckinPerson = { id: string; name?: string | null; blocked?: string | null };

export type CheckinSide = {
  registration_id: string;
  name?: string | null;
  own?: boolean;
  checked_in?: boolean;
  at?: string | null;
  updated_at?: string | null;
  via?: "side" | "lead" | string | null;
  present?: CheckinPerson[];
  present_count?: number;
  consent_open?: boolean;
  rules_url?: string | null;
  lead_reason?: string | null;
};

export type CheckinState = "none" | "no_time" | "waiting" | "open" | "closed" | "veto" | "ready" | "running" | "finished";

export type CheckinBlock = {
  rules?: CheckinRules | null;
  state?: CheckinState | string | null;
  scheduled_at?: string | null;
  window?: { opens_at?: string | null; closes_at?: string | null } | null;
  ready_at?: string | null;
  started_at?: string | null;
  sides?: CheckinSide[];
  own_registration_id?: string | null;
  can_checkin?: boolean;
  checkin_hint?: string | null;
  roster?: CheckinPerson[];
  roster_hint?: string | null;
  eligible_count?: number;
  me?: { reason?: string | null; fix_url?: string | null } | null;
  min_present?: number;
  can_start?: boolean;
  start_hint?: string | null;
  proposal?: { due_at?: string | null; missing?: string[] } | null;
  lead?: { can_enter?: boolean } | null;
  // Das Map-Veto (D.3/D.4) steht im selben Block.
  veto?: VetoBlock | null;
};

export const STATE_LABELS: Record<string, string> = {
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
export function clock(value?: string | null): string {
  return value ? viennaTime(value, { hour: "2-digit", minute: "2-digit" }) : "";
}

/** „Sa 14.11. 19:45“ - wie `shortWhen` im Web (lib/leagueSchedule.js). */
export function shortWhen(value?: string | null): string {
  if (!value) return "";
  const day = viennaDate(value, { weekday: "short", day: "2-digit", month: "2-digit" }).replace(/\.,/, "").replace(",", "");
  return `${day} ${clock(value)}`;
}

export function ownSide(block?: CheckinBlock | null): CheckinSide | null {
  return (block?.sides || []).find((side) => side.own) || null;
}

export function otherSide(block?: CheckinBlock | null): CheckinSide | null {
  return (block?.sides || []).find((side) => !side.own) || null;
}

/** Der eine Satz unter der Überschrift: was jetzt gilt und was die eigene Seite tun soll. */
export function stateText(block?: CheckinBlock | null): string {
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
export function countdownTarget(block?: CheckinBlock | null): number | null {
  if (!block?.window) return null;
  if (block.state === "waiting") return new Date(String(block.window.opens_at)).getTime();
  if (block.state === "open") return new Date(String(block.window.closes_at)).getTime();
  return null;
}

export function countdownLabel(block?: CheckinBlock | null): string {
  if (block?.state === "waiting") return "öffnet in";
  if (block?.state === "open") return "noch";
  return "";
}

/** Wie viel vom Ring noch übrig ist (1 = voll). Vor der Öffnung bleibt er voll, im Fenster schrumpft er bis zum Schluss. */
export function ringShare(block?: CheckinBlock | null, now = Date.now()): number {
  if (!block?.window || block.state !== "open") return 1;
  const opens = new Date(String(block.window.opens_at)).getTime();
  const closes = new Date(String(block.window.closes_at)).getTime();
  if (!(closes > opens)) return 1;
  return Math.min(1, Math.max(0, (closes - now) / (closes - opens)));
}

/** „12:30“ bzw. „1:02:05“ bis zum Ziel - nie negativ. */
export function remainingText(target: number | null, now = Date.now()): string {
  if (!target) return "";
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Die Zeile zu einer Seite: „eingecheckt um 19:52 · 3 Spieler“, „eingetragen von der Liga-Leitung“, „noch nicht eingecheckt“. */
export function sideStatusText(side?: CheckinSide | null): string {
  if (!side) return "";
  if (!side.checked_in) return "noch nicht eingecheckt";
  const count = Number(side.present_count || 0);
  const who = side.via === "lead" ? "eingetragen von der Liga-Leitung" : "eingecheckt";
  return `${who} um ${clock(side.updated_at || side.at)} · ${count} Spieler`;
}

/** Die Regeln der Season als kurze Sätze. */
export function rulesSentences(rules?: CheckinRules | null): string[] {
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
export function selectionText(count: number, minimum: number): string {
  if (count >= minimum) return `${count} angehakt – das reicht (mindestens ${minimum}).`;
  const missing = minimum - count;
  return `${count} angehakt – noch ${missing === 1 ? "eine Person" : `${missing} Personen`} bis zur Mindestzahl ${minimum}.`;
}

/** Ob die eigene Seite gerade die Anwesenden-Liste sieht (vor dem Start, mit eigener Seite). */
export function showsOwnCheckin(block?: CheckinBlock | null): boolean {
  return Boolean(ownSide(block) && ["waiting", "open", "closed", "no_time"].includes(String(block?.state || "")));
}

// Matchablauf auf einen Blick (#2173): der Stand als Schild im Kopf der Matchseite - dieselben Wörter wie die Überschrift des
// Check-ins. „none“ (keine Regeln) und „finished“ zeigen nichts, das sagt der Kopf schon.
export type FlowTone = "brand" | "ok" | "warn" | "live" | "quiet";
const FLOW_TONES: Record<string, FlowTone> = {
  no_time: "quiet", waiting: "brand", open: "brand", closed: "warn", veto: "ok", ready: "ok", running: "live",
};

export function flowBadge(block?: CheckinBlock | null): { label: string; tone: FlowTone } | null {
  const state = String(block?.state || "");
  if (!block || !FLOW_TONES[state]) return null;
  return { label: STATE_LABELS[state] || "Check-in", tone: FLOW_TONES[state] };
}
