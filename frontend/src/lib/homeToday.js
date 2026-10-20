// „Heute im Einsatz“ auf der Startseite (#1753): aus dem schlanken Endpunkt der laufenden Saisons (#1748) nur, was heute
// (Wiener Tag) ansteht, dazu je Saison eine kurze Zeile - Runde, Uhrzeit, gemeldete Vereinsleute. Namen gibt es hier nie.

const ROUND_WORD = { racing: "Rennen", team_league: "Spieltag" };
const PEOPLE_WORD = { racing: "Vereinsfahrer" };

export function todayItems(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.filter((item) => item?.today && item.lineage && item.series);
}

export function todayFacts(item) {
  const kind = item?.lineage?.kind;
  const next = item?.next || {};
  const round = next.code ? `${ROUND_WORD[kind] || "Runde"} ${next.code}` : next.title || "";
  const count = Number(item?.club_count) || 0;
  return [
    round,
    next.time ? `${next.time} Uhr` : "",
    count > 0 ? `${count} ${PEOPLE_WORD[kind] || "Vereinsspieler"}` : "",
  ].filter(Boolean);
}
