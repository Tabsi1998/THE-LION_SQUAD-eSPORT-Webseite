// Fast-Lap-TV mit Bestzeit-Moment (#1127): alte und neue Rangliste der gezeigten Strecke im Browser vergleichen. Nur
// echte Verbesserungen lösen etwas aus - ein Neuladen ohne neue Zeit bewegt nichts. Eine schnellere Zeit bekommt kurz
// „−1.204 s · persönliche Bestzeit“ an die Zeile, eine erste Zeit „Neu“. Ist es die schnellste Zeit überhaupt (echt
// schneller, nicht gleich schnell, ohne Strafsekunden), kommt der Bestzeit-Moment: Name, Zeit, Abstand und wer sie
// vorher hatte. Strafsekunden und ungültige Zeiten sortiert der Server ein (die Zeiten kommen in Millisekunden, mit
// Strafe) - sie machen nichts schneller und lösen keinen Moment aus. Schlüssel einer Zeile ist `participant_id` - so
// haben auch Gäste ohne Konto (#1585) ihre eigenen Hinweise; `userId` im Ergebnis ist dieser Schlüssel.
import { participantKey } from "./fastLapEvent";

function byRank(a, b) {
  const rank = (entry) => (Number.isFinite(Number(entry.rank)) ? Number(entry.rank) : Number.POSITIVE_INFINITY);
  return rank(a) - rank(b) || Number(a.time_ms) - Number(b.time_ms);
}

function byRank(a, b) {
  const rank = (entry) => (Number.isFinite(Number(entry.rank)) ? Number(entry.rank) : Number.POSITIVE_INFINITY);
  return rank(a) - rank(b) || Number(a.time_ms) - Number(b.time_ms);
}

function entriesOf(board) {
  return (board?.entries || []).filter((entry) => participantKey(entry) && Number.isFinite(Number(entry.time_ms)));
}

/**
 * Was sich zwischen zwei Ständen getan hat: `improved` (schneller als vorher), `added` (erste Zeit), `best` (neue
 * Bestzeit) - leer, wenn die Strecke gewechselt hat oder es keinen alten Stand gibt.
 */
export function compareBoards(previous, next) {
  const empty = { improved: [], added: [], best: null };
  if (!previous || !next) return empty;
  if ((previous.track?.id || "") !== (next.track?.id || "")) return empty;
  const before = new Map(entriesOf(previous).map((entry) => [participantKey(entry), entry]));
  const improved = [];
  const added = [];
  for (const entry of entriesOf(next)) {
    const key = participantKey(entry);
    const old = before.get(key);
    if (!old) added.push({ userId: key, entry });
    else if (Number(entry.time_ms) < Number(old.time_ms)) improved.push({ userId: key, entry, old, deltaMs: Number(entry.time_ms) - Number(old.time_ms) });
  }
  // Wer vorn liegt, sagt der Rang vom Server (#1584) - bei gleicher Zeit die früher gefahrene.
  const [oldLeader] = entriesOf(previous).sort(byRank);
  const [newLeader] = entriesOf(next).sort(byRank);
  let best = null;
  const changed = new Set([...improved, ...added].map((row) => row.userId));
  if (newLeader && changed.has(participantKey(newLeader)) && !(Number(newLeader.penalty_seconds) > 0)) {
    if (!oldLeader || Number(newLeader.time_ms) < Number(oldLeader.time_ms)) {
      best = {
        userId: participantKey(newLeader),
        entry: newLeader,
        previous: oldLeader || null,
        gapMs: oldLeader ? Number(newLeader.time_ms) - Number(oldLeader.time_ms) : null,
        ownRecord: Boolean(oldLeader && participantKey(oldLeader) === participantKey(newLeader)),
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
