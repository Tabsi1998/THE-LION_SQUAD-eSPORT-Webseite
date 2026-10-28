// Tabelle am Turnierbaum-TV (#2121): Liga, Jeder gegen jeden, Schweizer System und Gruppen haben keinen Baum, sondern
// eine Tabelle. Der TV zeigt sie als eigene Folie direkt nach dem Spielplan, nennt Kopf, Fuß und Folien nach dem Format
// und kürt den Sieger aus Platz 1, sobald das Turnier beendet ist - ein Finale, aus dem er sonst kommt, gibt es dort
// nicht. Die Tabelle rechnet der Server (GET /bracket/display, `standings`); hier wird nur ausgewählt und beschriftet.
import { STANDING_COLUMNS, standingSections, tableKind } from "@/lib/standingsTable";

export const TABLE_SLIDE = "table";
const TABLE_FORMATS = new Set(["league", "round_robin", "swiss", "groups"]);
const FINISHED = new Set(["completed", "results_published", "archived"]);
// Ohne Gruppen-Endstand (#1778) gibt es bei Gruppen keinen Sieger aus der Tabelle.
const CHAMPION_FORMATS = new Set(["league", "round_robin", "swiss"]);

/**
 * Spielt das Turnier ohne Baum? Mit Spielen entscheiden die Spiele (Gruppen mit K.-o. danach haben einen Baum), ohne
 * Spiele das Format. `isTable(match)`: BracketTree.isTableFormat für ein Spiel.
 */
export function isTreeless(tournament, matches = [], isTable = () => false) {
  if (matches.length) return matches.every((match) => isTable(match));
  return TABLE_FORMATS.has(String(tournament?.format || ""));
}

/** Die Wörter des TVs je Format: Kopfzeile, Name der Spiele-Folie, leerer Zustand, QR-Code und sein Ziel. */
export function tvWords(treeless) {
  return treeless
    ? { kicker: "TABELLE", board: "Tabelle", tree: "Spieltage", empty: "Der Spielplan steht noch nicht", qr: "QR scannen und Tabelle öffnen", path: "standings" }
    : { kicker: "TURNIERBAUM", board: "Turnierbaum", tree: "Turnierbaum", empty: "Turnierbaum wurde noch nicht generiert", qr: "QR scannen und Turnierbaum öffnen", path: "bracket" };
}

/** Die Tabellen am TV: je Gruppe eine (mit Namen), sonst eine - nur mit Zeilen. */
export function tvTableSections(standings) {
  return standingSections(Array.isArray(standings) ? standings : []).filter((section) => section.rows?.length);
}

/** Die Spalten am TV - wie auf der Website, ohne die Form; `compact` (viele Gruppen nebeneinander) auch ohne S/U/N. */
export function tvTableColumns(rows, { compact = false } = {}) {
  const columns = STANDING_COLUMNS[tableKind(rows)] || STANDING_COLUMNS.league;
  return columns.filter((column) => column.key !== "form" && !(compact && column.wide));
}

/**
 * Die Folie „Tabelle“ kommt direkt nach dem Spielplan („tree“), genauso lang - nur bei Formaten ohne Baum und nur,
 * wenn die Liste den Spielplan zeigt. Gespeichert wird sie nicht: die Liste in den Grundwerten bleibt, wie sie ist.
 */
export function withTableSlide(playlist, on) {
  const list = playlist || [];
  if (!on || list.some((entry) => entry.slide === TABLE_SLIDE)) return list;
  const index = list.findIndex((entry) => entry.slide === "tree");
  if (index < 0) return list;
  return [...list.slice(0, index + 1), { slide: TABLE_SLIDE, seconds: list[index].seconds }, ...list.slice(index + 1)];
}

/**
 * Der Sieger aus der Tabelle (#2121): beendet, Liga/Jeder gegen jeden/Schweizer System, genau ein Erster mit Spielen.
 * Dieselbe Form wie `championOf` - ohne Weg durch einen Baum (`path`, `segments` leer).
 */
export function tableChampionOf(standings, tournament) {
  if (!FINISHED.has(String(tournament?.status || "")) || !CHAMPION_FORMATS.has(String(tournament?.format || ""))) return null;
  const rows = (Array.isArray(standings) ? standings : []).filter((row) => row && !Array.isArray(row.standings) && row.registration_id);
  const leaders = rows.filter((row) => Number(row.rank) === 1 && Number(row.played) > 0);
  if (leaders.length !== 1) return null;
  const podium = [1, 2, 3]
    .map((rank) => {
      const holders = rows.filter((row) => Number(row.rank) === rank);
      return holders.length === 1 ? { rank, registrationId: holders[0].registration_id } : null;
    })
    .filter(Boolean);
  return {
    winnerId: leaders[0].registration_id,
    finalMatchId: TABLE_SLIDE,
    score: leaders[0].points ?? null,
    path: [],
    segments: [],
    podium,
    viaLoser: false,
    fromTable: true,
  };
}
