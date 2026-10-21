// Team-Liga einfacher eintragen (#1931): Helfer fürs Ergebnisblatt einer Team-Liga - eigenes Spiel erkennen (wie
// `services/own_teams.py`: Name und Schreibweise wörtlich, eine andere Schreibweise nur, wenn sie zu genau einem eigenen
// Team passt), die eingefügte Begegnungsliste ins Formular übernehmen, Kader als Ankreuzliste und Aufstellung je Map.
// Gerechnet und geprüft wird im Server - hier wird nur das Formular gefüllt.
import { cleanText } from "@/lib/resultPaste";
import { emptyMatch } from "@/lib/referenceResults";

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Schlüssel eines Namens wie `series_identity.normalize_name`: ohne Akzente, klein, nur Buchstaben und Ziffern. */
export function teamKey(value) {
  const text = cleanText(value).normalize("NFKD");
  let out = "";
  for (const char of text) {
    // Kombinierende Zeichen (Akzente) fallen weg, ebenso Leer- und Satzzeichen.
    if (char >= "̀" && char <= "ͯ") continue;
    if (LETTER_OR_DIGIT.test(char)) out += char.toLowerCase();
  }
  return out;
}

function literal(value) {
  return cleanText(value).toLowerCase();
}

/** Liefert `(name) => Name des eigenen Teams | null` für die eigenen Teams der Saison (`[{name, aliases}]`). */
export function ownTeamMatcher(ownTeams = []) {
  const exact = new Map();
  const byKey = new Map();
  for (const team of ownTeams || []) {
    const name = cleanText(team?.name);
    if (!name) continue;
    for (const text of [name, ...(team.aliases || [])]) {
      if (!exact.has(literal(text))) exact.set(literal(text), name);
      const key = teamKey(text);
      if (!key) continue;
      const owners = byKey.get(key) || [];
      if (!owners.includes(name)) owners.push(name);
      byKey.set(key, owners);
    }
  }
  return (value) => {
    if (!cleanText(value)) return null;
    if (exact.has(literal(value))) return exact.get(literal(value));
    const owners = byKey.get(teamKey(value)) || [];
    return owners.length === 1 ? owners[0] : null;
  };
}

/** Spielt in diesem Spiel ein eigenes Team? */
export function isOwnMatch(match, isOwn) {
  return Boolean(isOwn(match?.home) || isOwn(match?.away));
}

/** Der Kader eines eigenen Teams: Personen, deren Team (`default_team`) dieses eigene Team ist - nach Namen. */
export function rosterFor(participants = [], team, isOwn) {
  return (participants || [])
    .filter((person) => person.kind !== "team" && team && isOwn(person.default_team) === team)
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "de"));
}

function sameEntry(entry, person) {
  return person.id ? entry.participant_id === person.id : literal(entry.name) === literal(person.name);
}

/** Person in der Aufstellung an- oder abhaken. */
export function toggleLineup(lineup = [], person) {
  if (lineup.some((entry) => sameEntry(entry, person))) return lineup.filter((entry) => !sameEntry(entry, person));
  return [...lineup, { participant_id: person.id || "", name: person.name || "" }];
}

/** Person in der Aufstellung einer Map an- oder abhaken - wer eine Map spielt, steht auch in der des Spiels. */
export function setMapLineup(match, mapKey, person) {
  let added = false;
  const maps = match.maps.map((item) => {
    if (item.key !== mapKey) return item;
    const lineup = toggleLineup(item.lineup || [], person);
    added = lineup.length > (item.lineup || []).length;
    return { ...item, lineup };
  });
  const inMatch = (match.lineup || []).some((entry) => sameEntry(entry, person));
  return { ...match, maps, lineup: added && !inMatch ? [...(match.lineup || []), { participant_id: person.id || "", name: person.name || "" }] : match.lineup };
}

const text = (value) => (value === null || value === undefined ? "" : String(value));

/**
 * Die eingefügte Begegnungsliste ins Formular: das erste Spiel mit einem eigenen Team füllt das eigene Spiel (Teams,
 * Ergebnis, Tag, Uhrzeit - Maps und Aufstellung bleiben), die übrigen Spiele mit Ergebnis kommen dazu, wenn
 * `keepOthers` an ist; noch offene Spiele (ohne Ergebnis) zählen nur in `open`. Liefert `{form, own, others, open}`.
 */
export function applyMatchday(form, rows, { ownTeams = [], keepOthers = true } = {}) {
  const isOwn = ownTeamMatcher(ownTeams);
  const ownOf = (match) => isOwn(match?.home) || isOwn(match?.away);
  const ownRows = (rows || []).filter((row) => ownOf(row));
  const otherRows = (rows || []).filter((row) => !ownOf(row));
  const played = otherRows.filter((row) => row.home_score !== null && row.away_score !== null);
  // Eigene Spiele im Formular (bei mehreren eigenen Teams eines je Team) behalten Maps und Aufstellung.
  const existing = form.matches.filter((match) => ownOf(match));
  // Ohne eigenes Spiel im Formular dient das erste (etwa ein leeres) als eigenes.
  const fallback = existing.length ? null : form.matches[0] || null;
  const used = new Set();
  const matches = [];
  for (const row of ownRows) {
    let current = existing.find((match) => !used.has(match.key) && ownOf(match) === ownOf(row));
    if (!current && fallback && !used.has(fallback.key)) current = fallback;
    if (current) used.add(current.key);
    matches.push({
      ...(current || emptyMatch()), home: row.home, away: row.away,
      home_score: text(row.home_score), away_score: text(row.away_score),
      day: row.day || current?.day || "", time: row.time || current?.time || "",
    });
  }
  matches.push(...existing.filter((match) => !used.has(match.key)));
  if (!ownRows.length && fallback) matches.push(fallback);
  if (keepOthers) {
    for (const row of played) {
      matches.push({ ...emptyMatch({ home: row.home, away: row.away }), home_score: text(row.home_score), away_score: text(row.away_score) });
    }
  }
  // `owns`: alle erkannten eigenen Spiele - bei mehreren eigenen Teams am selben Spieltag je Team eines (Prüfung #1931).
  return { form: { ...form, matches }, own: ownRows[0] || null, owns: ownRows, others: keepOthers ? played.length : 0, open: otherRows.length - played.length };
}

function codeNumber(code) {
  let digits = "";
  for (const char of String(code || "")) {
    if (char >= "0" && char <= "9") digits += char;
    else if (digits) break;
  }
  return digits ? Number(digits) : null;
}

/**
 * Aus mehreren eingefügten Spieltagen (`parseMatchdayPaste(...).matchdays`) den zum Termin: über die Nummer (Zahl im
 * Kürzel, etwa „ST2“, sonst die Position), dann über den Zeitraum bzw. den Tag eines Spiels; ein einzelner passt immer.
 */
export function pickMatchday(matchdays, round) {
  const list = matchdays || [];
  if (!list.length) return null;
  const number = codeNumber(round?.code) ?? (Number(round?.position) || null);
  const byNumber = number !== null ? list.find((day) => day.number === number) : null;
  if (byNumber) return byNumber;
  const day = round?.club_day;
  if (day) {
    const inWindow = list.find((item) => item.from && item.to && item.from <= day && day <= item.to);
    if (inWindow) return inWindow;
    const sameDay = list.find((item) => item.rows.some((row) => row.day === day));
    if (sameDay) return sameDay;
  }
  // Mehrere, keiner passt: die Oberfläche lässt wählen.
  return list.length === 1 ? list[0] : null;
}

function findPerson(name, participants) {
  const wanted = literal(name);
  const found = (participants || []).filter((person) => person.kind !== "team" && literal(person.name) === wanted);
  return found.length === 1 ? { id: found[0].id, name: found[0].name } : { id: "", name: cleanText(name) };
}

/**
 * Eingefügte Aufstellung (`parseLineupPaste`) ins Spiel: mit Häkchen in die Aufstellung, mit „-“/„nein“ heraus, ohne
 * Angabe bleibt es, wie es ist. Ohne ein einziges erkanntes Häkchen (im Browser oft ein Bild) ändert sich nichts.
 * `extra`: eingefügte Namen, die nicht im Kader stehen - sie kommen zur Ankreuzliste dazu. Liefert `{match, marked, extra}`.
 */
export function applyLineupPaste(match, parsed, participants = [], roster = []) {
  const people = (parsed?.rows || []).map((row) => ({ person: findPerson(row.name, participants), played: row.played }));
  const inRoster = (person) => roster.some((entry) => (person.id ? entry.id === person.id : literal(entry.name) === literal(person.name)));
  const extra = people.map(({ person }) => person).filter((person) => !inRoster(person));
  if (!parsed?.marked) return { match, marked: false, extra };
  let lineup = [...(match.lineup || [])];
  for (const { person, played } of people) {
    const has = lineup.some((entry) => sameEntry(entry, person));
    if (played === true && !has) lineup = [...lineup, { participant_id: person.id || "", name: person.name }];
    if (played === false && has) lineup = lineup.filter((entry) => !sameEntry(entry, person));
  }
  return { match: { ...match, lineup }, marked: true, extra };
}

const UNITS = {
  matches: ["Spiel", "Spielen"],
  races: ["Rennen", "Rennen"],
  rounds: ["Runde", "Runden"],
};

/** Einsätze in Worten: „5 von 7 Spielen“ - leer ohne gezählte Spiele. */
export function appearancesText(appearances) {
  const of = Number(appearances?.of) || 0;
  if (!of) return "";
  const [one, many] = UNITS[appearances.unit] || UNITS.matches;
  return `${Number(appearances.played) || 0} von ${of} ${of === 1 ? one : many}`;
}
