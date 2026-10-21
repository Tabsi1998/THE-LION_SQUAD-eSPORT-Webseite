// Map-Pool öffentlich (#1616): je Modus die Maps als Karten mit Bild - auf der Turnierseite, der Serienseite und
// später im Ergebnisblatt der Team-Liga und im Veto (#1618). Liest nur den Snapshot des Servers (Name und Bild von
// damals), rechnet nichts. Bewegung in maps.css: gestaffeltes Erscheinen, dezentes Anheben bei Maus und Antippen.
import { Map as MapIcon } from "lucide-react";
import { LazyImg } from "@/components/tls/LazyImg";
import "./maps.css";

const STAGGER_STEPS = 8;
// Karten im Raster: zwei Spalten am Handy, drei ab sm, vier ab lg (max. ~240 px in der schmalen Spalte).
const CARD_SIZES = "(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw";

export function MapCard({ item, index = 0, position = null, sizes = CARD_SIZES, testId = "map-card" }) {
  return (
    <div className="tls-map-card" style={{ "--tls-i": Math.min(index, STAGGER_STEPS) }} data-testid={testId}>
      <div className="tls-map-card__media">
        {item?.image_url ? (
          <LazyImg src={item.image_url} alt="" sizes={sizes} className="tls-map-card__img" />
        ) : (
          <span className="tls-map-card__placeholder" aria-hidden="true" data-testid="map-card-placeholder">
            <MapIcon className="w-7 h-7" />
          </span>
        )}
        <span className="tls-map-card__shade" aria-hidden="true" />
        {position ? <span className="tls-map-card__badge" aria-hidden="true" data-testid="map-card-position">{position}</span> : null}
        <span className="tls-map-card__name font-heading">{item?.name}</span>
      </div>
    </div>
  );
}

function countText(count) {
  return count === 1 ? "1 Map" : `${count} Maps`;
}

const HEADING = "font-heading text-2xl font-black uppercase";

// `headingClass` und `icon`: die Überschrift im Stil der Seite (Turnierseite: fett mit Symbol wie „Regeln“, „Preise“).
export function MapPoolView({ pool, title = "Map-Pool", hint = "", headingId = "map-pool-title", headingClass = HEADING, icon: Icon = null,
  className = "mt-12", testId = "map-pool" }) {
  const groups = (pool?.modes || []).filter((group) => group.maps?.length);
  if (!groups.length) return null;
  const showModes = groups.length > 1 || groups[0].mode;
  return (
    <section className={className} aria-labelledby={headingId} data-testid={testId}>
      <h2 id={headingId} className={headingClass}>{Icon ? <Icon className="w-4 h-4 text-[#29B6E8]" aria-hidden="true" /> : null}{title}</h2>
      {hint ? <p className="mt-1 text-sm text-white/55">{hint}</p> : null}
      <div className="mt-4 space-y-6">
        {groups.map((group) => (
          <div key={group.mode || "alle"} data-testid="map-pool-mode">
            {showModes ? (
              <h3 className="mb-2 flex items-baseline gap-2 text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">
                {group.label || group.mode}
                <span className="text-white/45 tracking-normal normal-case font-semibold tabular-nums">{countText(group.maps.length)}</span>
              </h3>
            ) : null}
            <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {group.maps.map((item, index) => (
                <li key={item.map_id || item.name}><MapCard item={item} index={index} /></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
