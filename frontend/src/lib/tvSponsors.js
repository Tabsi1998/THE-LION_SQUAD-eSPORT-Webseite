// Sponsoren am TV (#1125): drei Schalter nach Fabians Wahl C - Sponsor-Moment (an, höchstens alle 3 Minuten),
// „Runde 2 präsentiert von“ (an) und das Laufband unten (aus). Jede Kombination geht, alle aus heißt: keine Sponsoren.
// Die Sponsoren kommen aus derselben Liste wie bisher (/api/sponsors?placement=tv: aktiv und mit „TV / Anzeige“) und
// der Reihe nach dran. Welcher Sponsor eine Runde präsentiert, wählt die Turnierleitung beim Turnier; der TV zeigt ihn,
// solange diese Runde läuft oder als Nächstes dran ist - ist die Runde fertig, verschwindet er.
import { isMatchDone } from "@/lib/slotSource";
import { formatBracketSection, formatRoundName } from "@/lib/tournamentLabels";
import { isLiveMatch } from "@/lib/tvLive";

/** Was die TV-Seiten an Sponsoren brauchen: nur mit Logo, jeder einmal, in der Reihenfolge der Liste. */
export function tvSponsors(list = []) {
  const seen = new Set();
  return (list || []).filter((sponsor) => {
    if (!sponsor?.logo_url) return false;
    const key = sponsor.id || sponsor.logo_url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Der Sponsor für den n-ten Moment - der Reihe nach, dann wieder von vorn. */
export function sponsorFor(sponsors, count) {
  if (!sponsors?.length) return null;
  return sponsors[((count % sponsors.length) + sponsors.length) % sponsors.length];
}

/** Was je Bildschirm läuft: Moment, „präsentiert von“, Laufband - aus den drei Schaltern und ob es Sponsoren gibt. */
export function sponsorPlan(settings = {}, sponsors = []) {
  const any = (sponsors || []).length > 0;
  return {
    moment: Boolean(settings.sponsor_moment) && any,
    presented: Boolean(settings.sponsor_presented),
    ticker: Boolean(settings.sponsor_ticker),
  };
}

const SECTION_ORDER = { WB: 0, LB: 1, BRONZE: 2, GF: 3 };

function roundId(match) {
  return `${match?.stage_id || ""}::${String(match?.section || "").toUpperCase()}::${Number(match?.round || 0)}`;
}

/**
 * Die Runde, die gerade im Bild ist: die mit einem laufenden Spiel - sonst die erste, deren Spiele als Nächstes dran
 * sind (alle Plätze besetzt). Eine fertige Runde ist es nie.
 */
export function currentRound(matches = []) {
  const byRound = new Map();
  for (const match of matches || []) {
    if (!match?.id) continue;
    const id = roundId(match);
    if (!byRound.has(id)) byRound.set(id, []);
    byRound.get(id).push(match);
  }
  const rounds = [...byRound.entries()].map(([id, list]) => ({
    id,
    matches: list,
    first: list[0],
    live: list.some(isLiveMatch),
    open: list.some((match) => !isMatchDone(match)),
    ready: list.some((match) => !isMatchDone(match) && (match.slots || []).length > 0 && (match.slots || []).every((slot) => slot.registration_id)),
  }));
  const order = (round) => [Number(round.first.stage_number || 0), SECTION_ORDER[String(round.first.section || "").toUpperCase()] ?? 9, Number(round.first.round || 0)];
  const sorted = rounds.filter((round) => round.open).sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return x[0] - y[0] || x[2] - y[2] || x[1] - y[1];
  });
  return sorted.find((round) => round.live) || sorted.find((round) => round.ready) || null;
}

/**
 * „Runde 2 präsentiert von“: der Sponsor der Runde, die gerade im Bild ist - nur, wenn die Turnierleitung einen gewählt
 * hat und er in der TV-Liste steht. Gibt `{ label, sponsor }` oder `null` zurück.
 */
export function presentedBy(tournament, matches = [], sponsors = []) {
  const entries = Array.isArray(tournament?.round_sponsors) ? tournament.round_sponsors : [];
  if (!entries.length || !sponsors?.length) return null;
  const round = currentRound(matches);
  if (!round) return null;
  const match = round.first;
  const entry = entries.find((row) => Number(row?.round) === Number(match.round || 0)
    && String(row?.section || "").toUpperCase() === String(match.section || "").toUpperCase()
    && (!row?.stage_id || row.stage_id === match.stage_id));
  const sponsor = entry ? sponsors.find((row) => row.id === entry.sponsor_id) : null;
  if (!sponsor) return null;
  const section = formatBracketSection(match.section);
  const name = formatRoundName(match.round_name, match.round);
  const showSection = section && !["WB", ""].includes(String(match.section || "").toUpperCase()) && !name.toLowerCase().includes(section.toLowerCase().split(" ")[0]);
  return { label: showSection ? `${section} · ${name}` : name, sponsor, roundId: round.id };
}
