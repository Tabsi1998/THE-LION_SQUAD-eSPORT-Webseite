// Öffentliche Season-Seite (#2268): reine Helfer für „Was gespielt wird“, Ablauf, Unterseiten und Spieltage - ohne React, mit
// Tests. Gerechnet wird nur, was die Lese-API ohnehin liefert (Season, Spiel, Map-Pool, Staffel); nichts davon kommt aus der
// Verwaltung. Wörter wie in der Verwaltung (lib/league.js) und im Regelwerk.
import { ruleHint } from "@/components/tls/league/leagueResultRules";
import { defaultSlot, dayRange } from "@/lib/leaguePage";
import { pointsSummary, tiebreakOrder } from "@/lib/leagueTable";
import { viennaDate } from "@/lib/vienna";

/** Die Unterseiten einer Season in der Reihenfolge der Navigation. `key` ist der letzte Teil der Adresse. */
export const SEASON_SECTIONS = [
  { key: "", label: "Übersicht" },
  { key: "spieltage", label: "Spieltage" },
  { key: "teams", label: "Teams" },
  { key: "regeln", label: "Regelwerk" },
  // Gesamtwertung über Seasons (F.5, #2215): nur, wenn die Season zu einem Zeitraum der Liga gehört.
  { key: "gesamtwertung", label: "Gesamtwertung" },
];

/** Adresse einer Unterseite: `/liga/<liga>/<season>[/<key>]`. */
export function sectionPath(leagueSlug, seasonSlug, key = "") {
  return `/liga/${leagueSlug}/${seasonSlug}${key ? `/${key}` : ""}`;
}

const MAP_REPEAT_TEXT = {
  other_mode: "Gleiche Map in einer Serie nur in anderem Modus",
  never: "Jede Map nur einmal je Serie",
  always: "Maps dürfen sich in einer Serie wiederholen",
};

/** „A, B und C“. */
export function listWords(items) {
  const list = (items || []).filter(Boolean).map(String);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} und ${list[list.length - 1]}`;
}

function modeInfo(key, pool, game) {
  const group = (pool?.modes || []).find((row) => row.mode === key);
  const known = (game?.modes || []).find((row) => row.mode === key);
  return { mode: key, label: group?.label || known?.label || key, icon_url: group?.icon_url || known?.icon_url || null };
}

/**
 * Die Modi der Season, wie sie gespielt werden: zuerst in der Reihenfolge je Map, dann die übrigen des Pools. Je Modus Name,
 * Symbol (Schnappschuss des Pools, sonst das Spiel), die Regel in Klartext und die Zahl der Maps im Pool.
 */
export function playModes(season, game, pool) {
  const keys = [...(season?.game_mode_order || []), ...(pool?.modes || []).map((row) => row.mode)].filter(Boolean);
  return [...new Set(keys)].map((key) => {
    const group = (pool?.modes || []).find((row) => row.mode === key);
    return { ...modeInfo(key, pool, game), rule: ruleHint(season?.result_rules?.[key]), maps: group?.maps?.length || 0 };
  });
}

/** Map 1 bis N (Best of) mit Modus - leer, wenn die Season keine feste Reihenfolge hat. */
export function mapOrder(season, game, pool) {
  const order = (season?.game_mode_order || []).filter(Boolean);
  const count = Number(season?.best_of) || order.length;
  return order.slice(0, count).map((key, index) => ({ position: index + 1, ...modeInfo(key, pool, game) }));
}

/** Kurz, was gespielt wird: „4 gegen 4“, „Best of 3“, „Jeder gegen jeden, Hin- und Rückrunde“. */
export function formatFacts(season) {
  const size = Number(season?.team_size) || 0;
  const legs = Number(season?.round_robin_legs) || 1;
  return [
    size ? { key: "size", label: "Teamgröße", value: `${size} gegen ${size}` } : null,
    season?.best_of ? { key: "best_of", label: "Serie", value: `Best of ${season.best_of}` } : null,
    { key: "legs", label: "Modus", value: legs > 1 ? "Jeder gegen jeden, Hin- und Rückrunde" : "Jeder gegen jeden, eine Runde" },
    MAP_REPEAT_TEXT[season?.map_repeat] ? { key: "repeat", label: "Maps", value: MAP_REPEAT_TEXT[season.map_repeat] } : null,
  ].filter(Boolean);
}

const hours = (value) => `${value} ${Number(value) === 1 ? "Stunde" : "Stunden"}`;

/** Termine in Klartext (Regelwerk § 7): Standardtermin, 72-h-Regel, Verschiebung, Ergebnis bestätigen. */
export function scheduleLines(season) {
  const rules = season?.schedule_rules;
  const lines = [{ key: "default", title: "Standardtermin", text: `${defaultSlot(season)} – gilt, wenn sich die Teams nicht einigen.` }];
  if (rules?.home_rule) {
    lines.push({ key: "home", title: `${rules.home_rule_hours}-h-Regel`,
      text: `Antwortet die Gastseite nicht binnen ${hours(rules.home_rule_hours)} auf den Vorschlag des Heimteams, gilt er.` });
  }
  if (rules) {
    const max = Number(rules.reschedule_max) || 0;
    lines.push({ key: "reschedule", title: "Verschieben", text: max
      ? `Bis ${hours(rules.reschedule_notice_hours)} vor dem Termin, höchstens ${max}× je Spiel${rules.reschedule_same_week ? ", innerhalb der Spielwoche" : ""}. Alles darüber entscheidet die Liga-Leitung.`
      : "Verschieben legt nur die Liga-Leitung fest." });
  }
  if (season?.result_confirm_hours) {
    lines.push({ key: "confirm", title: "Ergebnis", text: `Die Gegenseite bestätigt binnen ${hours(season.result_confirm_hours)} – danach gilt die Meldung.` });
  }
  return lines;
}

/** Punkte und Gleichstand (E.1) in zwei Sätzen. */
export function pointsLines(season) {
  return [pointsSummary(season), season?.table_tiebreakers?.length ? `Bei Punktgleichheit: ${tiebreakOrder(season.table_tiebreakers)}` : ""]
    .filter(Boolean);
}

/** Spielwochen der Season: „10 Spielwochen“. */
export function weeksText(season) {
  const weeks = Number(season?.weeks_total) || 0;
  return weeks ? `${weeks} ${weeks === 1 ? "Spielwoche" : "Spielwochen"}` : "";
}

const day = (value) => (value ? viennaDate(value, { day: "numeric", month: "numeric", year: "numeric" }) : "");

/**
 * Was vor der Einteilung als Nächstes passiert - für den freundlichen Platzhalter: Anmeldung (falls ein Fenster da ist),
 * Einteilung in Ligen und Staffeln, Start. `state`: done, now, next.
 */
export function nextSteps(season, application) {
  const steps = [];
  if (application?.state === "open" || application?.state === "upcoming") {
    steps.push({ key: "apply", state: application.state === "open" ? "now" : "next", title: "Anmeldung",
      text: application.state === "open" ? `Offen bis ${day(application.closes_at)}` : `Öffnet am ${day(application.opens_at)}` });
  } else if (season?.registration_deadline) {
    steps.push({ key: "apply", state: "done", title: "Anmeldung", text: `Meldeschluss ${day(season.registration_deadline)}` });
  }
  steps.push({ key: "split", state: steps.some((step) => step.state === "now") ? "next" : "now", title: "Einteilung",
    text: "Die Liga-Leitung teilt die Teams in Ligen und Staffeln ein." });
  steps.push({ key: "start", state: "next", title: "Start", text: season?.start_date ? `Erster Spieltag ab ${day(season.start_date)}` : "Der Spielplan folgt." });
  return steps;
}

/** Alle Staffeln der Season flach, mit Liga N - für Auswahl und Teams. */
export function staffelList(divisions) {
  return (divisions || []).flatMap((division) => (division.staffeln || []).map((staffel) => ({
    ...staffel, key: staffel.slug || staffel.tournament_id, division_label: division.label, division_level: division.level,
    label: `${division.label} · Staffel ${staffel.staffel}`,
  })));
}

/** Stand einer Woche für die Leiste: pause, reserve, done (alle gespielt), live (teils), open. */
export function weekState(week) {
  if (week?.kind === "pause") return "pause";
  const matches = week?.matches || [];
  if (!matches.length) return "reserve";
  const done = matches.filter((match) => match.done).length;
  if (done === matches.length) return "done";
  return done ? "live" : "open";
}

/** Kurztext einer Woche in der Leiste: „ST 3“ bzw. „Pause“. */
export function weekShort(week) {
  if (week?.kind === "pause") return "Pause";
  if (week?.kind === "reserve") return "Reserve";
  return `Spieltag ${week?.matchday ?? week?.week}`;
}

/** Tage einer Woche kurz: „10.11.–16.11.“. */
export function weekDays(week) {
  return dayRange(week?.first_day, week?.last_day);
}

/** Ein Spiel mit gewerteter, aber wiederholter Map (C.3) - öffentlich nur, dass wiederholt wurde. */
export function hasReplay(match) {
  return (match?.games || []).some((game) => game.status === "replayed");
}

/**
 * Name eines Co-Teams in Hauptteam und Co-Team: „Löwen · Löwen Nachwuchs B“ → club „Löwen“, squad „Löwen Nachwuchs B“. `redundant`:
 * das Co-Team nennt das Hauptteam schon - am Handy fällt das Hauptteam dann weg, der volle Name bleibt lesbar (#2268).
 */
export function splitTeamName(name) {
  const text = String(name || "");
  const at = text.indexOf(" · ");
  if (at < 0) return { club: "", squad: text, redundant: false };
  const club = text.slice(0, at).trim();
  const squad = text.slice(at + 3).trim();
  return { club, squad, redundant: Boolean(club) && squad.toLocaleLowerCase("de").startsWith(club.toLocaleLowerCase("de")) };
}

/** Initialen eines Teams für das Ersatzbild: „Löwen · Löwen B“ → „LB“, „Nebelwölfe“ → „NE“. */
export function teamInitials(name) {
  const part = String(name || "").split("·").pop().trim();
  const words = part.split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}
