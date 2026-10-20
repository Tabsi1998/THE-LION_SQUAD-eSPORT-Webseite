// Stufen und Ergebnis einer Saison (#1898): ob eine Saison auf- oder abgestiegen ist, steht zuerst im Vermerk der
// Saison („Ergebnis der Saison“), sonst kommt es aus der Reihenfolge der Stufen. Die Reihenfolge legt die Spur fest
// (`tier_order`, höchste zuerst); ohne eigene Reihenfolge zählt die Zahl im Stufennamen („Liga 1“ vor „Liga 2“).

export const SEASON_RESULT_OPTIONS = [["", "—"], ["promoted", "Aufstieg"], ["relegated", "Abstieg"], ["stayed", "Klassenerhalt"], ["champion", "Meister"]];
export const SEASON_RESULT_LABELS = Object.fromEntries(SEASON_RESULT_OPTIONS.filter(([value]) => value));

// Wörter, nach denen die Nummer einer Stufe steht („Division 2“, „Liga 1“, „Div. 3“). Groß- und Kleinschreibung egal.
const TIER_WORDS = new Set(["liga", "division", "div", "stufe", "tier", "league"]);

/** Der Name in Wörter und Zahlen zerlegt - linear, Zeichen für Zeichen; Punkte bleiben als eigenes Stück stehen. */
function tierTokens(text) {
  const tokens = [];
  let current = "";
  for (const char of String(text || "")) {
    if (/[\p{L}\p{N}]/u.test(char)) {
      current += char;
      continue;
    }
    if (current) tokens.push(current);
    current = "";
    if (char === ".") tokens.push(".");
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Eine Stufennummer: nur Ziffern, 1 bis 999 - eine vierstellige Jahreszahl ist keine Stufe, „4v4“ auch nicht. */
function tierNumber(token) {
  if (!token || token.length > 3 || ![...token].every((char) => char >= "0" && char <= "9")) return null;
  const value = Number(token);
  return value > 0 ? value : null;
}

/**
 * Rang einer Stufe aus ihrem Namen, kleiner ist höher: die Zahl direkt nach einem Stufenwort („4v4 Division 2“ → 2,
 * „Saison 2026 – Liga 1“ → 1), sonst eine Ordnungszahl direkt davor („1. Liga“ → 1). Spielformate (4v4, 2x2) und
 * Jahreszahlen zählen nicht. Ohne Treffer ist die Stufe nicht vergleichbar (Infinity).
 */
export function tierRankFromName(text) {
  const tokens = tierTokens(text);
  const words = tokens.map((token) => token.toLowerCase());
  for (let index = 0; index < tokens.length; index += 1) {
    if (!TIER_WORDS.has(words[index])) continue;
    const next = tokens[index + 1] === "." ? tokens[index + 2] : tokens[index + 1];
    const after = tierNumber(next);
    if (after) return after;
  }
  for (let index = 2; index < tokens.length; index += 1) {
    if (!TIER_WORDS.has(words[index]) || tokens[index - 1] !== ".") continue;
    const before = tierNumber(tokens[index - 2]);
    if (before) return before;
  }
  return Infinity;
}

const tierKey = (value) => String(value || "").split(/\s+/).filter(Boolean).join(" ").toLowerCase();

/**
 * Rang einer Stufe, kleiner ist höher. Hat die Spur eine eigene Reihenfolge, zählt nur sie (Platz in der Liste; eine
 * Stufe, die dort fehlt, ist nicht vergleichbar); sonst die Zahl im Namen.
 */
export function tierRank(tier, tierOrder) {
  const order = Array.isArray(tierOrder) ? tierOrder : [];
  if (!order.length) return tierRankFromName(tier);
  const index = order.findIndex((item) => tierKey(item) === tierKey(tier));
  return index >= 0 ? index + 1 : Infinity;
}

/** Jede Stufe einmal (Groß/klein und Leerraum egal), getrimmt, in der Reihenfolge des Auftretens. */
function uniqueTiers(tiers) {
  const seen = new Map();
  for (const tier of tiers || []) {
    const name = String(tier || "").trim();
    if (name && !seen.has(tierKey(name))) seen.set(tierKey(name), name);
  }
  return [...seen.values()];
}

/** Vorgabe: die Stufen nach der Zahl im Namen, ohne Zahl hinten in der Reihenfolge des Auftretens. */
export function defaultTierOrder(tiers) {
  return uniqueTiers(tiers)
    .map((name, index) => ({ name, index, rank: tierRankFromName(name) }))
    .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank < b.rank ? -1 : 1))
    .map((item) => item.name);
}

/** Die Liste im Formular: die eigene Reihenfolge, dahinter Stufen der Saisons, die dort noch fehlen (nach Vorgabe). */
export function tierOrderList(tiers, tierOrder) {
  const own = uniqueTiers(Array.isArray(tierOrder) ? tierOrder : []);
  const ownKeys = new Set(own.map(tierKey));
  return [...own, ...defaultTierOrder(tiers).filter((name) => !ownKeys.has(tierKey(name)))];
}

/** Ein Eintrag der Liste eine Stelle nach oben (-1) oder unten (+1). */
export function moveTier(list, index, step) {
  const target = index + step;
  if (target < 0 || target >= list.length) return list;
  const next = list.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Vermerk einer Saison im Liga-Weg: zuerst ihr „Ergebnis der Saison“ (Aufstieg, Abstieg, Klassenerhalt, Meister), sonst
 * der Vergleich ihrer Stufe mit der nächsten Saison (`next`) - nach der Reihenfolge der Spur oder der Zahl im Namen.
 * Ohne Vermerk und ohne vergleichbare Stufen bleibt er leer.
 */
export function seasonNote(item, next, tierOrder) {
  const marked = SEASON_RESULT_LABELS[item?.season_result];
  if (marked) return marked;
  if (!item || !next) return "";
  const from = tierRank(item.tier, tierOrder);
  const to = tierRank(next.tier, tierOrder);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return "";
  return to < from ? SEASON_RESULT_LABELS.promoted : SEASON_RESULT_LABELS.relegated;
}
