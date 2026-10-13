// Rückblick nach dem Event (#1187) und Freunde beim Event (#1188): die Texte und Regeln für die Event-Seite. Dieselben
// Regeln stehen für die App in mobile/src/lib/eventRecap.ts; die Daten rechnet der Server (services/event_recap.py,
// services/event_friends.py) - hier wird nur gezeigt.
import { viennaDay } from "@/lib/vienna";

const YOUTH_AGE = 14;

/** Podest wie ein Treppchen: Platz 2 links, Platz 1 in der Mitte, Platz 3 rechts - fehlende Plätze bleiben leer. */
export function podiumOrder(podium = []) {
  const byRank = new Map(podium.map((entry) => [Number(entry.rank), entry]));
  return [2, 1, 3].map((rank) => byRank.get(rank) || null);
}

/** Die Zahlen als Kacheln - nur Summen, keine Namen. Leere Werte (0) fallen weg, Teilnehmer bleiben immer stehen. */
export function numberTiles(numbers) {
  if (!numbers) return [];
  const rows = [
    { key: "participants", value: numbers.participants, one: "Teilnehmer", many: "Teilnehmer", always: true },
    { key: "matches", value: numbers.matches, one: "Spiel", many: "Spiele" },
    { key: "tournaments", value: numbers.tournaments, one: "Turnier", many: "Turniere" },
    { key: "fastlaps", value: numbers.fastlaps, one: "Fast Lap", many: "Fast Laps" },
    { key: "photos", value: numbers.photos, one: "Foto", many: "Fotos" },
  ];
  return rows
    .filter((row) => row.always || Number(row.value) > 0)
    .map((row) => ({ key: row.key, value: Number(row.value) || 0, label: Number(row.value) === 1 ? row.one : row.many }));
}

/** Das eigene Ergebnis in einer Zeile: „Platz 2 von 8 · mit Lions Rocket“ bzw. „Beste Runde 1:31.234 · Platz 1 von 5“. */
export function ownResultLine(result) {
  if (!result) return "";
  const place = result.rank ? `Platz ${result.rank}${result.of ? ` von ${result.of}` : ""}` : "";
  if (result.kind === "fastlap") {
    return [result.best_lap ? `Beste Runde ${result.best_lap}` : "", place, result.track && result.track !== result.title ? result.track : ""].filter(Boolean).join(" · ");
  }
  return [place || "Ohne Platzierung", result.team_name ? `mit ${result.team_name}` : ""].filter(Boolean).join(" · ");
}

/** „Finn ist dabei“, „Finn und Lea sind dabei“, „Finn, Lea und 3 weitere sind dabei“ - mit „waren“ nach dem Event. */
export function friendsSentence(friends = [], { over = false } = {}) {
  const names = friends.map((friend) => friend.display_name || "Freund");
  if (!names.length) return "";
  const verb = names.length === 1 ? (over ? "war" : "ist") : (over ? "waren" : "sind");
  let list;
  if (names.length === 1) list = names[0];
  else if (names.length === 2) list = `${names[0]} und ${names[1]}`;
  else if (names.length === 3) list = `${names[0]}, ${names[1]} und ${names[2]}`;
  else list = `${names[0]}, ${names[1]} und ${names.length - 2} weitere`;
  return `${list} ${verb} dabei`;
}

/**
 * Wo ein Freund dabei ist. Auf der Event-Seite: „Event“, je Turnier der Titel (bei Team-Turnieren mit Teamname) und je
 * Fast Lap der Titel. Auf der Turnierseite (#1188 Teil 2) nur der Teamname bzw. „angemeldet“, auf der Fast-Lap-Seite
 * „Zeit gefahren“ - der Titel steht dort ohnehin oben.
 */
export function friendPlaces(friend, { scope = "event" } = {}) {
  return (friend?.where || []).map((place) => {
    if (place.kind === "event") return "Event";
    if (place.kind === "fastlap") return scope === "fastlap" ? "Zeit gefahren" : place.title;
    if (scope === "tournament") return place.team_name ? `mit ${place.team_name}` : "angemeldet";
    return `${place.title}${place.team_name ? ` (${place.team_name})` : ""}`;
  });
}

function ageOn(birthDate, today) {
  const born = String(birthDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(born) || !today) return null;
  const [by, bm, bd] = born.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/**
 * „Freunde sehen, wo ich angemeldet bin“ ohne eigene Wahl: an (Fabians Wahl B) - mit Geburtsdatum unter 14 Jahren aus.
 * Wie der Server (services/event_friends.py → sharing_default), damit der Schalter den wirksamen Stand zeigt.
 */
export function friendsSharingDefault(user, now = new Date()) {
  const age = ageOn(user?.birth_date, viennaDay(now));
  return !(age !== null && age < YOUTH_AGE);
}

export function friendsSharing(user, now = new Date()) {
  const value = user?.privacy_friends_see_registrations;
  return typeof value === "boolean" ? value : friendsSharingDefault(user, now);
}
