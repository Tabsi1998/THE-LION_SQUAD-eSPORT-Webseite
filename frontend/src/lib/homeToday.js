// „Heute im Einsatz“ auf der Startseite (#1753): aus dem schlanken Endpunkt der laufenden Saisons (#1748) nur, was heute
// (Wiener Tag) ansteht, dazu je Saison eine kurze Zeile - Runde, Gegner (Team-Liga, #1931), Uhrzeit, gemeldete
// Vereinsleute. Namen von Personen gibt es hier nie. Die Wörter kommen aus dem Art-Profil (#2024, „Turniertag T5“);
// ohne Profil (ältere Antwort) wie bisher.
import { opponentText } from "@/lib/referenceCalendar";
import { kindWord } from "@/lib/seriesKinds";

const ROUND_WORD = { racing: "Rennen", team_league: "Spieltag" };
const PEOPLE_WORD = { racing: "Vereinsfahrer" };

export function todayItems(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.filter((item) => item?.today && item.lineage && item.series);
}

export function todayFacts(item) {
  const kind = item?.lineage?.kind;
  const profile = item?.profile;
  const next = item?.next || {};
  // Runde mit Läufen (#1930): der heutige Lauf statt des Worts „Rennen“ - „R3 · Qualifying“.
  const word = next.session ? next.code : next.code && `${kindWord(profile, "round_one", ROUND_WORD[kind] || "Runde")} ${next.code}`;
  const round = [word || next.title || "", next.session || ""].filter(Boolean).join(" · ");
  const count = Number(item?.club_count) || 0;
  return [
    round,
    opponentText(next),
    next.time ? `${next.time} Uhr` : "",
    count > 0 ? `${count} ${kindWord(profile, "club_people", PEOPLE_WORD[kind] || "Vereinsspieler")}` : "",
  ].filter(Boolean);
}
