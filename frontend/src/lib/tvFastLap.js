// Fast-Lap-TV mit Bestzeit-Moment (#1127): alte und neue Rangliste der gezeigten Strecke im Browser vergleichen. Nur
// echte Verbesserungen lösen etwas aus - ein Neuladen ohne neue Zeit bewegt nichts. Eine schnellere Zeit bekommt kurz
// „−1.204 s · persönliche Bestzeit“ an die Zeile, eine erste Zeit „Neu“. Ist es die schnellste Zeit überhaupt (echt
// schneller, nicht gleich schnell, ohne Strafsekunden), kommt der Bestzeit-Moment: Name, Zeit, Abstand und wer sie
// vorher hatte. Strafsekunden und ungültige Zeiten sortiert der Server ein (die Zeiten kommen in Millisekunden, mit
// Strafe) - sie machen nichts schneller und lösen keinen Moment aus.

function entriesOf(board) {
  return (board?.entries || []).filter((entry) => entry?.user_id && Number.isFinite(Number(entry.time_ms)));
}

/**
 * Was sich zwischen zwei Ständen getan hat: `improved` (schneller als vorher), `added` (erste Zeit), `best` (neue
 * Bestzeit) - leer, wenn die Strecke gewechselt hat oder es keinen alten Stand gibt.
 */
export function compareBoards(previous, next) {
  const empty = { improved: [], added: [], best: null };
  if (!previous || !next) return empty;
  if ((previous.track?.id || "") !== (next.track?.id || "")) return empty;
  const before = new Map(entriesOf(previous).map((entry) => [entry.user_id, entry]));
  const improved = [];
  const added = [];
  for (const entry of entriesOf(next)) {
    const old = before.get(entry.user_id);
    if (!old) added.push({ userId: entry.user_id, entry });
    else if (Number(entry.time_ms) < Number(old.time_ms)) improved.push({ userId: entry.user_id, entry, old, deltaMs: Number(entry.time_ms) - Number(old.time_ms) });
  }
  const [oldLeader] = entriesOf(previous).sort((a, b) => a.time_ms - b.time_ms);
  const [newLeader] = entriesOf(next).sort((a, b) => a.time_ms - b.time_ms);
  let best = null;
  const changed = new Set([...improved, ...added].map((row) => row.userId));
  if (newLeader && changed.has(newLeader.user_id) && !(Number(newLeader.penalty_seconds) > 0)) {
    if (!oldLeader || Number(newLeader.time_ms) < Number(oldLeader.time_ms)) {
      best = {
        userId: newLeader.user_id,
        entry: newLeader,
        previous: oldLeader || null,
        gapMs: oldLeader ? Number(newLeader.time_ms) - Number(oldLeader.time_ms) : null,
        ownRecord: Boolean(oldLeader && oldLeader.user_id === newLeader.user_id),
      };
    }
  }
  return { improved, added, best };
}

/** „−1.204 s“ - mit echtem Minuszeichen; schneller ist negativ. */
export function deltaText(ms) {
  if (!Number.isFinite(Number(ms))) return "";
  const value = Number(ms);
  const sign = value < 0 ? "−" : value > 0 ? "+" : "±";
  return `${sign}${(Math.abs(value) / 1000).toFixed(3)} s`;
}

/** Was kurz an der Zeile steht: „−1.204 s · persönliche Bestzeit“, „Neu“, bei der Bestzeit „Bestzeit“. */
export function rowChips(change) {
  const chips = new Map();
  for (const row of change?.improved || []) chips.set(row.userId, { kind: "personal", text: `${deltaText(row.deltaMs)} · persönliche Bestzeit` });
  for (const row of change?.added || []) chips.set(row.userId, { kind: "new", text: "Neu" });
  if (change?.best) chips.set(change.best.userId, { kind: "best", text: "Neue Bestzeit" });
  return chips;
}

/** „vorher KartKönigin · 1:22.399“ - wer die Bestzeit vorher hatte; bei eigener Verbesserung „vorher selbst …“. */
export function previousHolderText(best) {
  if (!best?.previous) return "die erste Zeit auf dieser Strecke";
  const time = best.previous.time_str || "";
  return best.ownRecord ? `vorher selbst ${time}`.trim() : `vorher ${best.previous.display_name || "jemand anderes"} · ${time}`.trim();
}
