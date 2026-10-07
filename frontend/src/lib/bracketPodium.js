// Podium und Finale eines Turnierbaums (#833, #1119): wer auf Platz 1 bis 3 steht und welches Spiel das Turnier
// entscheidet. Mit mehreren Phasen zählt nur die letzte - Vorrunden-Sieger stehen nicht auf dem Podest. Genutzt von der
// Turnierseite (BracketTree färbt Platz 1 bis 3) und vom Turnierbaum-TV (goldener Weg, Siegerkarte).

const DONE_STATUSES = new Set(["completed", "finished", "reported", "confirmed"]);
const FINAL_SECTIONS = new Set(["gf", "grand_final"]);
const MAIN_SECTIONS = new Set(["main", "wb", "winner", "final"]);
const LOSER_SECTIONS = new Set(["lb", "loser"]);

export function normalizeSection(section) {
  return String(section || "MAIN").toLowerCase();
}

export function isCompleted(match) {
  return DONE_STATUSES.has(String(match?.status || "").toLowerCase());
}

export function isBronzeMatch(match) {
  const haystack = [
    match?.section,
    match?.bracket,
    match?.round_name,
    match?.match_key,
    match?.name,
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes("bronze") || haystack.includes("platz 3") || haystack.includes("third");
}

/** Mehrere Phasen (#833): die letzte Phase (höchste Nummer) - nur sie vergibt das Podium. */
export function lastStageId(matches = [], stages = []) {
  const ids = [...new Set(matches.map((match) => match.stage_id || "__default"))];
  if (ids.length <= 1) return null;
  const numbers = new Map(stages.map((stage) => [stage.id, Number(stage.number) || 0]));
  const numberOf = (id) => (numbers.has(id)
    ? numbers.get(id)
    : Math.max(0, ...matches.filter((match) => (match.stage_id || "__default") === id).map((match) => Number(match.stage_number) || 0)));
  return ids.reduce((best, id) => (best === null || numberOf(id) > numberOf(best) ? id : best), null);
}

/** Die Spiele der letzten Phase - bei nur einer Phase alle. */
export function lastStageMatches(matches = [], stages = []) {
  const lastStage = lastStageId(matches, stages);
  return lastStage ? matches.filter((match) => (match.stage_id || "__default") === lastStage) : matches;
}

/**
 * Das Spiel, das das Turnier entscheidet (#1119): das Grand Final, sonst die letzte Runde des Hauptfelds - nie das Spiel
 * um Platz 3. `null`, wenn es keins gibt (Liga, Gruppen, Schweizer System haben eine Tabelle statt eines Finales).
 */
export function finalMatchOf(matches = [], stages = []) {
  const pool = lastStageMatches(matches, stages).filter((match) => !isBronzeMatch(match));
  const grandFinals = pool.filter((match) => FINAL_SECTIONS.has(normalizeSection(match.section)));
  const candidates = grandFinals.length ? grandFinals : pool.filter((match) => MAIN_SECTIONS.has(normalizeSection(match.section)));
  if (!candidates.length) return null;
  const maxRound = Math.max(...candidates.map((match) => Number(match.round || 1)));
  const lastRound = candidates.filter((match) => Number(match.round || 1) === maxRound);
  // Ein Finale ist ein einzelnes Spiel; stehen mehrere in der letzten Runde, ist es (noch) kein Baum mit Finale.
  return lastRound.length === 1 ? lastRound[0] : null;
}

export function buildPodiumMap(allMatches = [], stages = []) {
  // Vorrunden-Sieger stehen nicht auf dem Podest: mit mehreren Phasen zählt nur die letzte (#833).
  const matchesV2 = lastStageMatches(allMatches, stages);
  const podium = new Map();
  const place = (id, rank) => {
    if (!id || ![1, 2, 3].includes(rank)) return;
    const current = podium.get(id);
    if (!current || rank < current) podium.set(id, rank);
  };

  const maxRoundBySection = new Map();
  for (const match of matchesV2) {
    const section = normalizeSection(match.section);
    const round = Number(match.round || 1);
    maxRoundBySection.set(section, Math.max(maxRoundBySection.get(section) || 0, round));
  }
  const hasGrandFinal = matchesV2.some((match) => FINAL_SECTIONS.has(normalizeSection(match.section)));
  const isFinal = (match) => {
    const section = normalizeSection(match.section);
    return !isBronzeMatch(match) && (FINAL_SECTIONS.has(section) || (!hasGrandFinal && ["main", "wb", "winner"].includes(section) && Number(match.round || 1) === maxRoundBySection.get(section)));
  };
  // Vergibt das Finale selbst schon Platz 3 (ein Durchgang mit mehreren Spielern, #1119), zählt kein anderes Spiel für
  // Platz 3 - sonst stünde der Zweite des Loser-Bracket-Finales, der ja ins Grand Final kam, auch auf dem Podest.
  const finalHasThird = matchesV2.some((match) => isFinal(match) && isCompleted(match) && (match.results || []).some((result) => Number(result.rank) === 3));

  for (const match of matchesV2) {
    if (!isCompleted(match) || !(match.results || []).length) continue;
    const section = normalizeSection(match.section);
    const round = Number(match.round || 1);
    const finalSection = isFinal(match);
    const lowerFinal = !finalHasThird && LOSER_SECTIONS.has(section) && round === maxRoundBySection.get(section);

    if (isBronzeMatch(match)) {
      if (finalHasThird) continue;
      const winner = (match.results || []).find((result) => Number(result.rank) === 1 || result.qualified);
      place(winner?.registration_id, 3);
      continue;
    }

    if (finalSection) {
      for (const result of match.results || []) {
        const rank = Number(result.rank);
        if ([1, 2, 3].includes(rank)) place(result.registration_id, rank);
      }
      continue;
    }

    if (lowerFinal) {
      const loser = (match.results || []).find((result) => Number(result.rank) === 2);
      place(loser?.registration_id, 3);
    }
  }

  return podium;
}
