import { resolveMediaUrl } from "@/lib/api";
import { describeSlot, finderFor, initials } from "@/lib/slotSource";
import { gridSubline, isDuelMatch, startGrid } from "@/lib/tvGrid";
import { advancementsOf, outcomeLabel } from "@/lib/tvTravel";

// Durchgänge als Startaufstellung (#1120): die Plätze im versetzten Raster wie beim Start eines Rennens. Nach dem Ergebnis
// rücken die Weiterkommer mit „weiter“ nach vorn, die anderen rutschen mit „→ Loser Bracket“ oder „raus“ zur Seite -
// die Plätze fahren dorthin (ohne Bewegung stehen sie sofort dort). Duelle bleiben „A gegen B“. Gebraucht in der
// Stations-Ansicht und später auf der Folie „Live-Spiele“ (TV III). Alle Größen am Bildschirm (tv.css), nie „…“.

/** Bild oder Kürzel - ein noch leerer Platz bekommt nur einen gestrichelten Rahmen. */
function Face({ name, avatar }) {
  return (
    <span className={`tv-grid__avatar ${name || avatar ? "" : "tv-grid__avatar--empty"}`} aria-hidden="true">
      {avatar ? <img src={resolveMediaUrl(avatar)} alt="" /> : initials(name)}
    </span>
  );
}

/** Was in einem Platz steht: der Name, sonst im Klartext, wer kommt (#1113) - ein Setzplatz vor dem Start bleibt leer. */
function slotText(match, matches, nameOf) {
  const findMatch = finderFor(matches)(match);
  const bySlot = new Map((match.slots || []).map((slot, index) => [slot.slot ?? index + 1, slot]));
  return (number) => describeSlot(bySlot.get(number), nameOf, findMatch).label;
}

export function TvStartGrid({ match, matches = [], nameOf, avatarOf = () => "", lastStage = true, table = false }) {
  const grid = startGrid(match, matches, { lastStage, table });
  const textOf = slotText(match, matches, nameOf);
  return (
    <div
      className="tv-grid"
      data-testid="tv-start-grid"
      data-decided={grid.decided ? "1" : "0"}
      style={{ "--rows": Math.max(1, grid.rows), "--extra": grid.decided ? 0 : 0.35 }}
    >
      {grid.places.map((place) => {
        const name = place.registrationId ? nameOf(place.registrationId) : textOf(place.slot);
        return (
          <div
            key={place.registrationId || `slot-${place.slot}`}
            className={["tv-grid__slot", place.back ? "tv-grid__slot--back" : "", place.kind ? `tv-grid__slot--${place.kind}` : ""].filter(Boolean).join(" ")}
            style={{ "--col": place.col, "--row": place.row }}
            data-testid={`tv-grid-slot-${place.registrationId || place.slot}`}
            data-col={place.col}
            data-row={place.row}
          >
            <span className="tv-grid__num font-display">{place.rank ?? place.start}</span>
            <Face name={place.registrationId ? name : ""} avatar={place.registrationId ? avatarOf(place.registrationId) : ""} />
            <span className="tv-grid__text">
              {name ? <span className="tv-grid__name" data-tv-name="1">{name}</span> : null}
              <span className="tv-grid__sub">{gridSubline(place)}</span>
            </span>
            {place.label ? <span className={`tv-chip tv-chip--${place.kind} tv-grid__chip`} data-testid={`tv-grid-label-${place.registrationId}`}>{place.label}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Ein Duell an der Station: „A gegen B“, nach dem Ergebnis mit weiter / Loser Bracket / raus. */
export function TvDuel({ match, matches = [], nameOf, avatarOf = () => "", lastStage = true, table = false }) {
  const outcomes = new Map(advancementsOf(match, matches, { lastStage, table }).map((entry) => [entry.registrationId, entry]));
  const textOf = slotText(match, matches, nameOf);
  const slots = (match.slots || []).slice(0, 2);
  return (
    <div className="tv-duel" data-testid="tv-duel">
      {slots.map((slot, index) => {
        const name = slot.registration_id ? nameOf(slot.registration_id) : textOf(slot.slot ?? index + 1);
        const outcome = outcomes.get(slot.registration_id);
        const result = (match.results || []).find((row) => row.registration_id && row.registration_id === slot.registration_id);
        return (
          <div key={slot.slot ?? index} className="tv-duel__side-wrap">
            {index === 1 ? <div className="tv-duel__vs font-heading" aria-hidden="true">gegen</div> : null}
            <div className={`tv-duel__side ${outcome ? `tv-duel__side--${outcome.kind}` : ""}`} data-testid={`tv-duel-side-${index + 1}`}>
              <Face name={slot.registration_id ? name : ""} avatar={slot.registration_id ? avatarOf(slot.registration_id) : ""} />
              {name ? <span className="tv-grid__name" data-tv-name="1">{name}</span> : null}
              {result ? <span className="tv-duel__score font-display">{result.score ?? result.points ?? ""}</span> : null}
              {outcome && outcomeLabel(outcome) ? <span className={`tv-chip tv-chip--${outcome.kind}`}>{outcomeLabel(outcome)}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Raster oder Duell - je nach Spiel. */
export function TvLineup(props) {
  return isDuelMatch(props.match) ? <TvDuel {...props} /> : <TvStartGrid {...props} />;
}
