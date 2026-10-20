// Finalrechner der Serienseite (#1745): „Was braucht X fürs Finale?“ aus dem gespeicherten Stand. Bewusst nur ein
// Richtwert (`approximate`): er rechnet mit dem Abstand zur Finalgrenze und den offenen Runden, nicht mit
// Streichergebnissen, Aktivitätspunkten oder dem, was die anderen holen. Bei Gleichstand entscheidet der Vorrang.

function points(row) {
  const n = Number(row?.points);
  return Number.isFinite(n) ? n : 0;
}

/** Höchstwert je Runde aus dem Punkteschlüssel (Platz 1 plus Boni und Aktivitätspunkte); `null`, wenn unbekannt. */
export function maxRoundPoints(rules) {
  const scheme = (rules?.points_by_place || []).map(Number).filter(Number.isFinite);
  if (rules?.points_mode !== "scheme" || scheme.length === 0) return null;
  const bonuses = Object.values(rules.bonuses || {}).reduce((sum, bonus) => sum + (Number(bonus?.points) || 0), 0);
  return Math.max(...scheme) + bonuses + (Number(rules.activity_points?.points) || 0);
}

/**
 * Was braucht `row` fürs Finale? `rows`: die ganze Wertung nach Rang; `topN`: Finalgrenze; `remaining`: offene
 * Wertungsrunden; `maxPerRound`: Höchstwert je Runde (oder `null`).
 *
 * - `none`: keine Finalgrenze
 * - `qualified` / `out`: keine offenen Runden mehr, der Stand entscheidet
 * - `inside`: innerhalb der Grenze, `lead` = Vorsprung auf den ersten dahinter (`null`, wenn keiner dahinter ist)
 * - `outside`: `gap` = Punkte bis zur Grenze (gleichziehen), `perRound` = nötiger Schnitt je offener Runde,
 *   `reachable` = ob das mit dem Höchstwert je Runde geht (`null`, wenn der Höchstwert unbekannt ist)
 */
export function finalNeeds(row, rows, { topN, remaining = 0, maxPerRound = null } = {}) {
  const limit = Number(topN);
  if (!row || !Number.isInteger(limit) || limit < 1) return { status: "none" };
  const list = [...(rows || [])].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  const inside = (row.rank ?? Infinity) <= limit;
  const open = Math.max(0, Number(remaining) || 0);
  if (open === 0) return { status: inside ? "qualified" : "out" };
  if (inside) {
    const first = list.find((other) => (other.rank ?? Infinity) > limit);
    return { status: "inside", lead: first ? points(row) - points(first) : null, remaining: open, approximate: true };
  }
  const cutoff = list.filter((other) => (other.rank ?? Infinity) <= limit).pop();
  const gap = Math.max(0, points(cutoff) - points(row));
  const perRound = gap / open;
  const max = maxPerRound == null ? null : Number(maxPerRound);
  return {
    status: "outside", gap, perRound, remaining: open,
    reachable: max == null || !Number.isFinite(max) ? null : perRound <= max,
    approximate: true,
  };
}
