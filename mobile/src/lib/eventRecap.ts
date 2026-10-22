// Rückblick nach dem Event (#1187) und Freunde beim Event (#1188): dieselben Texte und Regeln wie auf der Website
// (frontend/src/lib/eventRecap.js). Die Daten rechnet der Server (services/event_recap.py, services/event_friends.py).
import { showLapTime } from "./laptime";
import { viennaDay } from "./vienna";

const YOUTH_AGE = 14;

export type PodiumEntry = { rank: number; name: string; team?: boolean; detail?: string | null; time_ms?: number | null };
export type RecapItem = { kind: "tournament" | "fastlap"; id: string; slug?: string | null; title: string; team?: boolean; track?: string | null; podium: PodiumEntry[] };
export type OwnResult = {
  kind: "tournament" | "fastlap"; id: string; slug?: string | null; title: string;
  rank?: number | null; of?: number | null; team_name?: string | null; best_lap?: string | null; track?: string | null;
};
export type EventRecapData = {
  available: boolean;
  winners?: RecapItem[];
  fastlaps?: RecapItem[];
  numbers?: { participants?: number; matches?: number; tournaments?: number; fastlaps?: number; photos?: number } | null;
  report?: { id: string; slug?: string | null; title: string; excerpt?: string | null } | null;
  mine?: { was_there: boolean; results: OwnResult[] } | null;
};
export type FriendPlace =
  | { kind: "event" }
  | { kind: "tournament"; id: string; slug?: string | null; title: string; team_name?: string | null }
  | { kind: "fastlap"; id: string; slug?: string | null; title: string };
export type FriendScope = "event" | "tournament" | "fastlap";
export type EventFriend = { id: string; display_name: string; avatar_url?: string | null; username?: string | null; where: FriendPlace[] };
export type EventFriendsData = { friends: EventFriend[]; sharing: boolean; hint: boolean };

/** Podest wie ein Treppchen: Platz 2 links, Platz 1 in der Mitte, Platz 3 rechts - fehlende Plätze bleiben leer. */
export function podiumOrder(podium: PodiumEntry[] = []): Array<PodiumEntry | null> {
  const byRank = new Map(podium.map((entry) => [Number(entry.rank), entry]));
  return [2, 1, 3].map((rank) => byRank.get(rank) || null);
}

/** Was unter einem Namen am Treppchen steht: eine Rundenzeit (mit `time_ms`) mit Komma (#1969), sonst der Text vom Server. */
export function podiumDetail(entry: PodiumEntry): string {
  if (entry.time_ms != null) return showLapTime(entry.detail || entry.time_ms);
  return entry.detail || "";
}

/** Die Zahlen als Kacheln - nur Summen. Leere Werte fallen weg, Teilnehmer bleiben immer stehen. */
export function numberTiles(numbers: EventRecapData["numbers"]): Array<{ key: string; value: number; label: string }> {
  if (!numbers) return [];
  const rows = [
    { key: "participants", value: numbers.participants, one: "Teilnehmer", many: "Teilnehmer", always: true },
    { key: "matches", value: numbers.matches, one: "Spiel", many: "Spiele", always: false },
    { key: "tournaments", value: numbers.tournaments, one: "Turnier", many: "Turniere", always: false },
    { key: "fastlaps", value: numbers.fastlaps, one: "Fast Lap", many: "Fast Laps", always: false },
    { key: "photos", value: numbers.photos, one: "Foto", many: "Fotos", always: false },
  ];
  return rows
    .filter((row) => row.always || Number(row.value) > 0)
    .map((row) => ({ key: row.key, value: Number(row.value) || 0, label: Number(row.value) === 1 ? row.one : row.many }));
}

/** Das eigene Ergebnis in einer Zeile - wie im Web. */
export function ownResultLine(result: OwnResult | null | undefined): string {
  if (!result) return "";
  const place = result.rank ? `Platz ${result.rank}${result.of ? ` von ${result.of}` : ""}` : "";
  if (result.kind === "fastlap") {
    return [result.best_lap ? `Beste Runde ${showLapTime(result.best_lap)}` : "", place, result.track && result.track !== result.title ? result.track : ""].filter(Boolean).join(" · ");
  }
  return [place || "Ohne Platzierung", result.team_name ? `mit ${result.team_name}` : ""].filter(Boolean).join(" · ");
}

/** „Finn ist dabei“, „Finn und Lea sind dabei“, „Finn, Lea und 2 weitere sind dabei“ - nach dem Event „war/waren“. */
export function friendsSentence(friends: EventFriend[] = [], { over = false }: { over?: boolean } = {}): string {
  const names = friends.map((friend) => friend.display_name || "Freund");
  if (!names.length) return "";
  const verb = names.length === 1 ? (over ? "war" : "ist") : (over ? "waren" : "sind");
  let list: string;
  if (names.length === 1) list = names[0];
  else if (names.length === 2) list = `${names[0]} und ${names[1]}`;
  else if (names.length === 3) list = `${names[0]}, ${names[1]} und ${names[2]}`;
  else list = `${names[0]}, ${names[1]} und ${names.length - 2} weitere`;
  return `${list} ${verb} dabei`;
}

/**
 * Wo ein Freund dabei ist - wie im Web (frontend/src/lib/eventRecap.js). Event-Seite: „Event“, je Turnier der Titel
 * (mit Teamname) und je Fast Lap der Titel. Turnierseite (#1188 Teil 2): Teamname bzw. „angemeldet“; Fast-Lap-Seite:
 * „Zeit gefahren“ - der Titel steht dort ohnehin oben.
 */
export function friendPlaces(friend: EventFriend | null | undefined, { scope = "event" }: { scope?: FriendScope } = {}): string[] {
  return (friend?.where || []).map((place) => {
    if (place.kind === "event") return "Event";
    if (place.kind === "fastlap") return scope === "fastlap" ? "Zeit gefahren" : place.title;
    if (scope === "tournament") return place.team_name ? `mit ${place.team_name}` : "angemeldet";
    return `${place.title}${place.team_name ? ` (${place.team_name})` : ""}`;
  });
}

function ageOn(birthDate: unknown, today: string): number | null {
  const born = String(birthDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(born) || !today) return null;
  const [by, bm, bd] = born.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/** „Freunde sehen, wo ich angemeldet bin“ ohne eigene Wahl: an - mit Geburtsdatum unter 14 Jahren aus (wie der Server). */
export function friendsSharingDefault(user: { birth_date?: string | null } | null | undefined, now: Date = new Date()): boolean {
  const age = ageOn(user?.birth_date, viennaDay(now));
  return !(age !== null && age < YOUTH_AGE);
}

export function friendsSharing(user: { birth_date?: string | null; privacy_friends_see_registrations?: boolean | null } | null | undefined, now: Date = new Date()): boolean {
  const value = user?.privacy_friends_see_registrations;
  return typeof value === "boolean" ? value : friendsSharingDefault(user, now);
}
