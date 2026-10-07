import { Trophy } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";
import { initials } from "@/lib/slotSource";
import { formatBracketSection, formatRoundName } from "@/lib/tournamentLabels";
import { matchName } from "@/lib/tvLive";
import { advancementsOf, outcomeLabel, rankingOf } from "@/lib/tvTravel";
import { isDuelMatch } from "@/lib/tvGrid";

// Die Momente über dem Turnierbaum (#1116, #1118, #1119): „Jetzt live“, das Ergebnis groß (aus 5 Metern lesbar, etwa
// 3 Sekunden), die Sammelkarte für mehr als drei Ergebnisse auf einmal und die Siegerkarte. Alle Größen hängen an der
// TV-Schrift (tv.css) und halten die Untergrenze; ohne Bewegung erscheinen und verschwinden sie ohne Gleiten.

export function nameOfRegistration(registrations = []) {
  const byId = new Map((registrations || []).map((reg) => [reg.id, reg]));
  return (registrationId) => {
    const reg = byId.get(registrationId);
    return reg?.display_name || reg?.user?.display_name || reg?.ingame_name || "";
  };
}

export function avatarOfRegistration(registrations = []) {
  const byId = new Map((registrations || []).map((reg) => [reg.id, reg]));
  return (registrationId) => {
    const reg = byId.get(registrationId);
    return reg?.user?.avatar_url || reg?.avatar_url || "";
  };
}

function Avatar({ name, avatar, className = "" }) {
  return (
    <span className={`tv-mavatar ${className}`} aria-hidden="true">
      {avatar ? <img src={resolveMediaUrl(avatar)} alt="" /> : initials(name)}
    </span>
  );
}

/** „Ergebnis · Winner Bracket · Runde 1“ */
function resultKicker(match) {
  return ["Ergebnis", formatBracketSection(match.section), formatRoundName(match.round_name, match.round)].filter(Boolean).join(" · ");
}

/** Ein Ergebnis groß über dem Baum: Spiel, Plätze mit Punkten, wer weiterkommt. */
export function TvResultCard({ match, matches, registrations, lastStage = true, table = false }) {
  const nameOf = nameOfRegistration(registrations);
  const avatarOf = avatarOfRegistration(registrations);
  const outcomes = advancementsOf(match, matches, { lastStage, table });
  const duel = isDuelMatch(match);
  return (
    <div className="tv-moment tv-result" role="status" data-testid="tv-result-card" data-match={match.id}>
      <div className="tv-kicker tv-t-info">{resultKicker(match)}</div>
      <div className="tv-result__title tv-t-title font-heading">{matchName(match)} entschieden</div>
      <div className="tv-result__rows">
        {outcomes.map((entry) => {
          const label = outcomeLabel(entry);
          const name = nameOf(entry.registrationId);
          return (
            <div key={entry.registrationId} className={`tv-result__row tv-result__row--${entry.kind}`} data-testid={`tv-result-row-${entry.registrationId}`}>
              <span className="tv-result__place font-display">{entry.rank}.</span>
              <Avatar name={name} avatar={avatarOf(entry.registrationId)} className="tv-result__avatar" />
              <span className="tv-result__name" data-tv-name="1">{name}</span>
              {entry.score !== null && entry.score !== undefined ? <span className="tv-result__score font-display">{duel ? entry.score : `${entry.score} Pkt.`}</span> : <span />}
              {label ? <span className={`tv-chip tv-chip--${entry.kind}`}>{label}</span> : <span />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Mehr als drei Ergebnisse auf einmal: eine Karte, je Spiel eine Zeile mit den Weiterkommern. */
export function TvCollectiveCard({ matches: shown, allMatches, registrations, isLastStage = () => true, isTable = () => false, max = 8 }) {
  const nameOf = nameOfRegistration(registrations);
  const list = shown.slice(0, max);
  const hidden = shown.length - list.length;
  return (
    <div className="tv-moment tv-result tv-result--many" role="status" data-testid="tv-collective-card">
      <div className="tv-kicker tv-t-info">Ergebnisse</div>
      <div className="tv-result__title tv-t-title font-heading">{shown.length} Spiele entschieden</div>
      <div className="tv-result__many">
        {list.map((match) => {
          const outcomes = advancementsOf(match, allMatches, { lastStage: isLastStage(match), table: isTable(match) });
          const ranking = rankingOf(match);
          const duel = isDuelMatch(match);
          const forward = outcomes.filter((entry) => entry.kind === "win" || (entry.kind === "place" && entry.place === 1));
          const text = duel && ranking.length >= 2
            ? `${nameOf(ranking[0].registration_id)} ${ranking[0].score ?? ""} : ${ranking[1].score ?? ""} ${nameOf(ranking[1].registration_id)}`.replace(/\s+/g, " ")
            : (forward.length ? forward : outcomes.slice(0, 1)).map((entry) => nameOf(entry.registrationId)).join(", ");
          const label = forward.length && !duel ? outcomeLabel(forward[0]) : "";
          return (
            <div key={match.id} className="tv-result__line" data-testid={`tv-collective-${match.id}`}>
              <span className="tv-result__match tv-t-info">{matchName(match)}</span>
              <span className="tv-result__who" data-tv-name="1">{text}</span>
              {label ? <span className="tv-chip tv-chip--win">{label}</span> : <span />}
            </div>
          );
        })}
        {hidden > 0 ? <div className="tv-result__more tv-t-info">+ {hidden} weitere</div> : null}
      </div>
    </div>
  );
}

/** „Jetzt live: Spiel B an PC 5“ - oben mittig über dem Baum, solange der Zoom läuft. */
export function TvLiveBanner({ text }) {
  return (
    <div className="tv-live-banner tv-t-info" role="status" data-testid="tv-live-banner">
      <span className="tv-live-dot-tv tv-live-dot" aria-hidden="true" />
      <span>Jetzt live: {text}</span>
    </div>
  );
}

function championSubline(champion, tournamentTitle) {
  return [tournamentTitle, champion.viaLoser ? "über das Loser Bracket zurückgekommen" : ""].filter(Boolean).join(" · ");
}

/**
 * Die Siegerkarte: groß in der Mitte (Bild, Name, Turnier, Platz 2 und 3 klein dazu) oder geparkt - dann klein in einer
 * freien Ecke oder in der Kopfleiste, ohne einen Namen zu verdecken. Auch geparkt hält jede Schrift die Untergrenze.
 */
export function TvChampionCard({ champion, registrations, tournamentTitle = "", parked = false, spot = "", testId = "tv-champion" }) {
  const nameOf = nameOfRegistration(registrations);
  const avatarOf = avatarOfRegistration(registrations);
  const name = nameOf(champion.winnerId);
  const others = champion.podium.filter((entry) => entry.rank > 1);
  if (parked) {
    return (
      <div className={`tv-champion tv-champion--parked ${spot ? `tv-champion--${spot}` : ""}`} data-testid={testId} data-spot={spot || undefined}>
        <Trophy className="tv-icon tv-gold tv-champion__cup" aria-hidden="true" />
        <Avatar name={name} avatar={avatarOf(champion.winnerId)} className="tv-champion__avatar" />
        <span className="tv-champion__text">
          <span className="tv-kicker tv-t-meta tv-gold">Champion</span>
          <span className="tv-t-name tv-champion__name" data-tv-name="1">{name}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="tv-moment tv-champion" role="status" data-testid={testId}>
      <div className="tv-champion__top tv-t-info"><Trophy className="tv-icon" aria-hidden="true" /> Champion</div>
      <Avatar name={name} avatar={avatarOf(champion.winnerId)} className="tv-champion__photo" />
      <div className="tv-champion__big font-heading" data-tv-name="1">{name}</div>
      <div className="tv-champion__sub tv-t-info">{championSubline(champion, tournamentTitle)}</div>
      {others.length ? (
        <div className="tv-champion__podium tv-t-info">
          {others.map((entry) => <span key={entry.rank}>Platz {entry.rank}: <span data-tv-name="1">{nameOf(entry.registrationId)}</span></span>)}
        </div>
      ) : null}
    </div>
  );
}
