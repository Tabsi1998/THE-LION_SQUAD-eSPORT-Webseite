// Belohnungen der Liga (F.4, #2214, docs/LIGA.md „F.4 Belohnungen“): Arten, Plätze, Empfänger und was Formular, Sammlung, Zeremonie
// und Ligaseite daraus machen. Dieselben Texte wie der Server (services/league_reward_rules.py) - der Server prüft selbst noch einmal.

export const REWARD_KINDS = [
  { key: "medal", label: "Medaille" },
  { key: "banner", label: "Banner" },
  { key: "emblem", label: "Emblem" },
  { key: "title", label: "Titel" },
];
export const KIND_LABELS = Object.fromEntries(REWARD_KINDS.map((row) => [row.key, row.label]));

export const PLACE_MODES = [
  { key: "rank", label: "Platz" },
  { key: "range", label: "Platzbereich" },
  { key: "all", label: "Alle Teilnehmer" },
];

export const PLAYER_BASIS = [
  { key: "fielded", label: "Spieler mit Einsatz", hint: "Wer in der Staffel mindestens ein gewertetes Spiel in der Aufstellung stand." },
  { key: "roster", label: "Ganzer Kader zum Abschluss", hint: "Alle im Kader des Co-Teams, wenn die Staffel abgeschlossen wird." },
];

export const REWARD_LIMIT = 20;
export const NAME_MAX = 60;
const METALS = { 1: "gold", 2: "silver", 3: "bronze" };

/** „1. Platz“, „Platz 4–6“, „Alle Teilnehmer“. */
export function placeLabel(places) {
  if (places?.mode === "rank") return `${places.rank}. Platz`;
  if (places?.mode === "range") return `Platz ${places.from}–${places.to}`;
  return "Alle Teilnehmer";
}

/** Farbe der Vorlage: Gold, Silber, Bronze für Platz 1–3, sonst Lionsquad-Blau. */
export function metalOf(places) {
  if (places?.mode === "rank") return METALS[Number(places.rank)] || "lion";
  return "lion";
}

export function recipientsLabel(recipients, basis = "fielded") {
  const parts = [];
  if ((recipients || []).includes("team")) parts.push("Team");
  if ((recipients || []).includes("players")) parts.push(PLAYER_BASIS.find((row) => row.key === basis)?.label || PLAYER_BASIS[0].label);
  return parts.join(" und ");
}

/** Eine neue Belohnung im Formular: eine Medaille für Platz 1 an Team und Spieler. */
export function emptyReward(index = 0) {
  return { key: `neu-${Date.now()}-${index}`, id: null, kind: "medal", name: "", description: "", places: { mode: "rank", rank: 1 },
    recipients: ["team", "players"], image_url: "", prize: "" };
}

/** Aus der Antwort des Servers ein Formular-Eintrag (mit stabilem Schlüssel für React). */
export function rewardToForm(item) {
  return { key: item.id || `neu-${Math.random().toString(36).slice(2, 8)}`, id: item.id || null, kind: item.kind || "medal", name: item.name || "",
    description: item.description || "", places: { ...(item.places || { mode: "all" }) }, recipients: [...(item.recipients || [])],
    image_url: item.image_url || "", prize: item.prize || "" };
}

/** Was an den Server geht - ohne den Formular-Schlüssel, leere Texte als null. */
export function rewardPayload(item) {
  const places = item.places?.mode === "rank" ? { mode: "rank", rank: Number(item.places.rank) }
    : item.places?.mode === "range" ? { mode: "range", from: Number(item.places.from), to: Number(item.places.to) } : { mode: "all" };
  return { ...(item.id ? { id: item.id } : {}), kind: item.kind, name: String(item.name || "").trim(), description: String(item.description || "").trim(),
    places, recipients: item.recipients, image_url: item.image_url || null, prize: String(item.prize || "").trim() || null };
}

/** Was im Formular fehlt - leer heißt: passt. Gleiche Regeln wie der Server, damit der Fehler schon beim Tippen steht. */
export function rewardProblem(item) {
  if (!String(item?.name || "").trim()) return "Name fehlt.";
  if (!(item.recipients || []).length) return "Wähle, wer sie bekommt: Team, Spieler oder beide.";
  const whole = (value) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 99;
  if (item.places?.mode === "rank" && !whole(item.places.rank)) return "Platz: eine Zahl von 1 bis 99.";
  if (item.places?.mode === "range") {
    if (!whole(item.places.from) || !whole(item.places.to)) return "Platzbereich: Zahlen von 1 bis 99.";
    if (Number(item.places.to) < Number(item.places.from)) return "Platzbereich: „bis“ darf nicht vor „von“ liegen.";
  }
  return "";
}

export function listProblem(items) {
  if ((items || []).length > REWARD_LIMIT) return `Höchstens ${REWARD_LIMIT} Belohnungen.`;
  return (items || []).map(rewardProblem).find(Boolean) || "";
}

/** Die Belohnungen einer Sammlung - Auszeichnungen mit `reward`. */
export function rewardsOf(awards) {
  return (Array.isArray(awards) ? awards : []).filter((award) => award?.reward);
}

/** Nach Season gruppiert, die neueste zuerst; je Season Platz 1 vorn. */
export function groupBySeason(awards) {
  const groups = new Map();
  for (const award of rewardsOf(awards)) {
    const key = award.league?.season_id || award.season?.id || award.reward?.art?.season || "season";
    if (!groups.has(key)) {
      groups.set(key, { key, season: award.reward?.art?.season || award.season?.name || "Season", league: award.reward?.art?.league || "", items: [], latest: "" });
    }
    const group = groups.get(key);
    group.items.push(award);
    const stamp = String(award.updated_at || award.date || "");
    if (stamp > group.latest) group.latest = stamp;
  }
  const rank = (award) => (Number.isInteger(award.rank) ? award.rank : 999);
  return [...groups.values()]
    .map((group) => ({ ...group, items: group.items.sort((a, b) => rank(a) - rank(b) || String(a.reward.name).localeCompare(String(b.reward.name), "de")) }))
    .sort((a, b) => b.latest.localeCompare(a.latest));
}

/** Beschriftung der Vorlage: Season, Liga N, Platz (Nr. 164). */
export function artLines(art) {
  return [art?.season, art?.division, art?.place].filter(Boolean);
}

/** Wo eine Belohnung auf der Ligaseite steht: je Platz 1–3 die Belohnungen, dazu „alle“ und Bereiche als eigene Liste. */
export function rewardsByPlace(items) {
  const places = { 1: [], 2: [], 3: [] };
  const others = [];
  for (const item of items || []) {
    if (item.places?.mode === "rank" && places[item.places.rank]) places[item.places.rank].push(item);
    else others.push(item);
  }
  return { places, others };
}

/** Kurzer Satz unter dem Podest: „Alle Teilnehmer bekommen: Season-Banner.“ */
export function everyoneLine(items) {
  const names = (items || []).filter((item) => item.places?.mode === "all").map((item) => item.name);
  return names.length ? `Alle Teilnehmer bekommen: ${names.join(", ")}.` : "";
}
