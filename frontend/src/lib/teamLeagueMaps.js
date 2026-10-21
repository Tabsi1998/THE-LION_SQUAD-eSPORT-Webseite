// Maps der Team-Liga (#1616 an #1931): Auswahl aus dem Map-Pool der Saison im Ergebnisblatt (`map_choices` vom
// Server: Pool der Saison, sonst die Vorgabe des Spiels; ohne Spiel `null` = Freitext), Zuordnung eines getippten oder
// eingefügten Namens über Name, Slug und weitere Schreibweisen, und die Texte für Veto-Karten und Statistik. Prüfen und
// das Bild als Snapshot ins Blatt schreiben macht der Server (services/team_league_maps.py).
import { teamKey } from "@/lib/teamLeagueEntry";
import { cleanText } from "@/lib/resultPaste";

const literal = (value) => cleanText(value).toLowerCase();

/** Jede Map der Auswahl einmal (erstes Vorkommen), mit den Namen ihrer Modi. */
export function choiceList(choices) {
  const out = new Map();
  for (const group of choices?.modes || []) {
    for (const item of group.maps || []) {
      if (!item?.map_id) continue;
      const known = out.get(item.map_id);
      const label = group.label || "";
      // `modeKeys`: die Kennungen der Modi, in denen die Map zur Wahl steht (#1616) - für die Prüfung im Server.
      if (known) {
        if (label && !known.modes.includes(label)) known.modes.push(label);
        if (group.mode && !known.modeKeys.includes(group.mode)) known.modeKeys.push(group.mode);
      } else {
        out.set(item.map_id, { ...item, aliases: item.aliases || [], modes: label ? [label] : [], modeKeys: group.mode ? [group.mode] : [] });
      }
    }
  }
  return [...out.values()];
}

/** Die Map zu einem Namen: zuerst wörtlich (Name, Slug, Schreibweise), dann ohne Leer- und Satzzeichen - nur eindeutig. */
export function findMap(name, choices) {
  const text = literal(name);
  if (!text || !choices) return null;
  const list = choiceList(choices);
  const spellings = (item) => [item.name, item.slug, ...(item.aliases || [])].filter(Boolean);
  const exact = list.filter((item) => spellings(item).some((spelling) => literal(spelling) === text));
  if (exact.length === 1) return exact[0];
  const key = teamKey(name);
  if (!key) return null;
  const loose = list.filter((item) => spellings(item).some((spelling) => teamKey(spelling) === key));
  return loose.length === 1 ? loose[0] : null;
}

/**
 * Name einer Map im Formular ändern: passt er zur Bibliothek, kommt die Kennung dazu, sonst fällt sie weg. Den Modus
 * gibt es nur, wenn die Map in genau einem Modus zur Wahl steht - sonst prüft der Server in irgendeinem.
 */
export function withMapName(item, name, choices) {
  const found = findMap(name, choices);
  const mode = found && found.modeKeys.length === 1 ? found.modeKeys[0] : "";
  return { ...item, name, map_id: found ? found.map_id : "", mode };
}

/** Beim Verlassen des Felds: der Name aus der Auswahl statt der getippten Schreibweise. */
export function canonicalMapName(item, choices) {
  if (!item?.map_id) return item?.name ?? "";
  const found = choiceList(choices).find((entry) => entry.map_id === item.map_id);
  return found ? found.name : item.name;
}

/**
 * Wie eine Map im Formular steht: `pool` (aus der Auswahl), `saved` (Kennung aus einem gespeicherten Spiel, heute nicht
 * mehr in der Auswahl - etwa archiviert), `unknown` (Name ohne Treffer, obwohl es eine Auswahl gibt - gelb markiert,
 * bleibt als Freitext), `free` (Freitext ohne Bibliothek) oder `empty`.
 */
export function mapState(item, choices) {
  if (!cleanText(item?.name) && !item?.map_id) return "empty";
  if (!choices) return "free";
  if (item.map_id) return choiceList(choices).some((entry) => entry.map_id === item.map_id) ? "pool" : "saved";
  return "unknown";
}

/** Eine Map aus dem Pool ins Spiel: in die erste Map ohne Namen, sonst als neue Map am Ende - mit dem Modus, unter dem
 * sie angetippt wurde. */
export function pickMap(match, choice, emptyMap) {
  const maps = match.maps || [];
  const free = maps.findIndex((item) => !cleanText(item.name) && !item.map_id);
  const values = { name: choice.name, map_id: choice.map_id, mode: choice.mode || "" };
  if (free >= 0) return { ...match, maps: maps.map((item, index) => (index === free ? { ...item, ...values } : item)) };
  return { ...match, maps: [...maps, { ...emptyMap(), ...values }] };
}

/** Ein Schritt im Veto aus eigener Sicht: „Bann · wir“, „Wahl Gegner“, „Decider“ … */
export function vetoLabel(step) {
  if (step?.role === "banned") return step.by === "own" ? "Bann · wir" : step.by === "opponent" ? "Bann · Gegner" : "Bann";
  if (step?.role === "picked") return step.by === "own" ? "Unsere Wahl" : step.by === "opponent" ? "Wahl Gegner" : "Wahl";
  if (step?.role === "decider") return "Decider";
  return "Gespielt";
}

const FIGURES = [
  ["played", "Gespielt"], ["won", "Siege"], ["drawn", "Unentschieden"], ["lost", "Niederlagen"],
  ["picked_own", "Unsere Wahl"], ["picked_opponent", "Wahl Gegner"], ["picked", "Gewählt"], ["decider", "Decider"],
  ["banned_own", "Unser Bann"], ["banned_opponent", "Bann Gegner"], ["banned", "Gebannt"],
];

/** Die Kennzahlen einer Map in der Statistik - nur die, die vorkommen. */
export function statFigures(stat) {
  return FIGURES.filter(([key]) => Number(stat?.[key]) > 0).map(([key, label]) => ({ key, label, value: Number(stat[key]) }));
}
