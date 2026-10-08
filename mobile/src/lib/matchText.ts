// Klartext auf der Matchseite (#1139, wie die Website seit #1220 - frontend/src/lib/tournamentLabels.js): Überschrift
// mit Namen statt „Match A“, „Freilos“ statt „Offen“, ein leerer Platz vor der Auslosung „noch offen“, ein fertiges
// Spiel „Beendet“ mit dem Ergebnis statt des Terminstatus, die Station genau einmal im Klartext. Dieselben Fälle prüfen
// Website und App (frontend/src/lib/matchText.cases.json).

export const BYE_LABEL = "Freilos";
export const OPEN_SLOT_LABEL = "noch offen";
const BYE_STATES = new Set(["bye", "walkover"]);
const FINISHED_MATCH_STATUSES = new Set(["completed", "forfeit", "bye", "archived"]);
const HEAT_STAGES = new Set(["ffa_single_elimination", "ffa_custom_bracket"]);

type Slot = { registration_id?: string | null; status?: string | null; state?: string | null; source?: { type?: string | null } | null; display_name?: string | null };
type MatchLike = {
  status?: string | null;
  winner_id?: string | null;
  match_type?: string | null;
  stage_type?: string | null;
  results?: Array<{ registration_id?: string | null; rank?: number | string | null; score?: number | string | null; points?: number | string | null }> | null;
  score_a?: number | string | null;
  score_b?: number | string | null;
  station_text?: string | null;
  station_label?: string | null;
  station_name?: string | null;
  station?: { name?: string | null } | null;
};

const DEVICE_TYPE_LABELS: Record<string, string> = {
  switch: "Switch",
  switch2: "Switch 2",
  pc: "PC",
  racing_rig: "Renn-Setup",
  beamer: "Beamer",
  stream_setup: "Übertragungsplatz",
  admin_desk: "Orga-Tisch",
};

function deviceName(value: string) {
  return DEVICE_TYPE_LABELS[value] || value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

/** „Spiel“ oder „Heat“ - ein Durchgang mit mehreren Spielern heißt Heat (wie formatMatchKind der Website). */
export function formatMatchKind(match: MatchLike = {}) {
  return match.match_type === "ffa" || HEAT_STAGES.has(String(match.stage_type || "")) ? "Heat" : "Spiel";
}

/** Ist dieser Platz ein Freilos? Auch ein leerer Platz in einem fertigen Spiel mit Sieger (ältere Spiele) ist eins. */
export function isByeSlot(slot: Slot | null | undefined, match: MatchLike = {}) {
  if (BYE_STATES.has(String(slot?.status || slot?.state || "").toLowerCase())) return true;
  if (String(slot?.source?.type || "").toLowerCase() === "bye") return true;
  if (slot?.registration_id) return false;
  return FINISHED_MATCH_STATUSES.has(String(match?.status || "")) && Boolean(match?.winner_id);
}

/** Der Name eines Platzes: die Anmeldung - sonst „Freilos“ oder „noch offen“. */
export function slotName(name: string | null | undefined, slot: Slot | null | undefined, match: MatchLike = {}) {
  if (name) return name;
  return isByeSlot(slot, match) ? BYE_LABEL : OPEN_SLOT_LABEL;
}

/** Ist das Spiel entschieden (beendet, gewertet, Freilos)? */
export function isMatchFinished(match: MatchLike | null | undefined) {
  return FINISHED_MATCH_STATUSES.has(String(match?.status || ""));
}

/** Überschrift: „NeonFalke gegen LunaByte“, ein Freilos beim Namen; ein Heat mit der Zahl der Plätze. */
export function matchHeadline(participants: Slot[] = [], match: MatchLike = {}) {
  const names = participants.map((participant) => slotName(participant?.display_name, participant, match));
  if (names.length === 2) return `${names[0]} gegen ${names[1]}`;
  if (names.length === 1) return names[0];
  if (!names.length) return formatMatchKind(match);
  return `${formatMatchKind(match)} mit ${names.length} Plätzen`;
}

function scoreOf(participant: Slot | undefined, index: number, match: MatchLike) {
  const result = (match.results || []).find((row) => row?.registration_id && row.registration_id === participant?.registration_id);
  const value = result ? (result.score ?? result.points) : index === 0 ? match.score_a : match.score_b;
  return value == null || value === "" || Number.isNaN(Number(value)) ? null : Number(value);
}

/** Der Satz im Kasten „Beendet“: „LunaByte gewinnt 3:1.“, „Freilos – NeonFalke kommt kampflos weiter.“ */
export function finishedMatchText(participants: Slot[] = [], match: MatchLike = {}) {
  const winnerId = match.winner_id || (match.results || []).find((row) => Number(row?.rank) === 1)?.registration_id;
  const winner = participants.find((participant) => participant?.registration_id && participant.registration_id === winnerId);
  const winnerName = winner?.display_name || "";
  if (winnerName && participants.some((participant) => isByeSlot(participant, match))) return `${BYE_LABEL} – ${winnerName} kommt kampflos weiter.`;
  if (winnerName && String(match.status) === "forfeit") return `${winnerName} gewinnt durch Wertung.`;
  let score = "";
  if (participants.length === 2) {
    const scores = participants.map((participant, index) => scoreOf(participant, index, match));
    if (scores.every((value) => value != null)) {
      const ordered = winner && participants[1] === winner ? [scores[1], scores[0]] : scores;
      score = `${ordered[0]}:${ordered[1]}`;
    }
  }
  if (winnerName) return score ? `${winnerName} gewinnt ${score}.` : participants.length > 2 ? `Sieger: ${winnerName}` : `${winnerName} gewinnt.`;
  return score ? `Unentschieden ${score}.` : "Das Spiel ist entschieden.";
}

/** Die Station im Klartext: der fertige Text vom Server - bei älteren Antworten aus Name und Gerät gebaut. */
export function stationText(match: MatchLike | null | undefined) {
  if (typeof match?.station_text === "string") return match.station_text;
  const raw = String(match?.station_label || match?.station_name || match?.station?.name || "").trim();
  if (!raw) return "";
  const [name, device] = raw.split(/\s+-\s+/);
  const deviceLabel = device ? deviceName(device) : "";
  const station = name.length <= 3 && !/\bstation\b/i.test(name) ? `Station ${name}` : name;
  return deviceLabel && !station.toLowerCase().includes(deviceLabel.toLowerCase()) ? `${station} · ${deviceLabel}` : station;
}
