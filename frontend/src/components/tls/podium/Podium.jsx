import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Crown } from "lucide-react";
import { LazyImg } from "@/components/tls/LazyImg";
import { resolveMediaUrl } from "@/lib/api";
import { motionAllowed } from "@/lib/motion";
import { initials } from "@/lib/slotSource";
import { podiumPlaces } from "@/lib/placementMoment";

/**
 * Podest (#1339): ein echtes Treppchen - Platz 1 in der Mitte und 24 px höher mit kleiner Krone, links 2, rechts 3; je
 * Stufe Bild, Name (zwei Zeilen) und Wert. Metall nur als obere Kante und große Ziffer. Gleichstand steht nebeneinander,
 * ein fehlender Platz bleibt mit „–“. Beim ersten Sichtbarwerden heben sich die Stufen einmal (3, 2, 1 - zum Sieger
 * hin), die Ziffern schwingen kaum merklich über, über die Krone läuft ein kurzer Glanz. „Bewegung reduzieren“: still.
 *
 * `rows`: Rangliste (/standings) - nur veröffentlichte Ergebnisse; `registrations`: Anmeldungen für Bild bzw. Logo.
 * Der Baustein ist für Turnierseite, Fast Lap (#1349), Event-Rückblick (#1187) und Jahreswertung (#1348) gedacht.
 */
const RISE_ORDER = { 3: 0, 2: 1, 1: 2 };

function valueText(row) {
  if (row.value != null && row.value !== "") return String(row.value);
  if ("score_diff" in row || "buchholz" in row) return `${row.points ?? 0} Pkt`;
  const wins = row.wins ?? row.won;
  if (wins != null) return `${wins} ${Number(wins) === 1 ? "Sieg" : "Siege"}`;
  if (row.points != null) return `${row.points} Pkt`;
  return "";
}

function Avatar({ name, src }) {
  return (
    <span className="tls-podium__avatar" aria-hidden="true">
      {src ? <LazyImg src={src} alt="" sizes="64px" widths={[96, 192]} width={64} height={64} className="h-full w-full object-cover" /> : <span>{initials(name) || "?"}</span>}
    </span>
  );
}

/** Spielt die Bewegung einmal, sobald das Podest zu sehen ist; liegt es schon im Bild, sofort. */
// Nichts wird vorab versteckt (Abnahme #1593): liegt das Podest beim Öffnen im Bild, heben sich die Stufen („run“);
// kommt es erst beim Scrollen herein, steht es schon da und nur Ziffern und Krone grüßen einmal („late“). So ist es
// auch hinter dem Sieger-Moment nie leer.
function usePlayOnce(ref) {
  const [play, setPlay] = useState(() => (motionAllowed() ? "run" : null));
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !play || typeof IntersectionObserver === "undefined") return undefined;
    const rect = node.getBoundingClientRect();
    if (rect.top < (window.innerHeight || 0) && rect.bottom > 0) return undefined;
    setPlay("idle");
    const observer = new IntersectionObserver((items) => {
      if (items.some((item) => item.isIntersecting)) {
        setPlay("late");
        observer.disconnect();
      }
    }, { rootMargin: "0px 0px -10% 0px" });
    observer.observe(node);
    return () => observer.disconnect();
    // Nur beim Erscheinen - spätere Zustände ändern nichts mehr.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return play;
}

export function Podium({ rows, registrations = [], className = "" }) {
  const places = useMemo(() => podiumPlaces(rows), [rows]);
  const regMap = useMemo(() => new Map((registrations || []).map((reg) => [reg.id, reg])), [registrations]);
  const ref = useRef(null);
  const play = usePlayOnce(ref);
  if (!places.length) return null;
  // Breite je Stufe: Platz 1 etwas breiter, jeder weitere Name auf einer geteilten Stufe bekommt Platz dazu.
  const columns = places.map((place) => `minmax(0, ${(place.rank === 1 ? 4 : 3) + Math.max(0, place.rows.length - 1) * 3}fr)`).join(" ");
  return (
    <div ref={ref} className={`tls-podium ${className}`} data-testid="podium" data-play={play || undefined} data-steps={places.length}>
      <ol className="tls-podium__stage" aria-label="Podest" style={{ gridTemplateColumns: columns }}>
        {places.map((place) => (
          <li
            key={place.rank}
            className="tls-podium__col"
            data-place={place.rank}
            data-metal={place.metal}
            data-testid={`podium-place-${place.rank}`}
            style={{ "--tls-i": RISE_ORDER[place.rank] }}
            aria-label={`${place.label}: ${place.rows.map((row) => row.display_name).join(", ") || "nicht vergeben"}`}
          >
            <div className="tls-podium__people">
              {place.rank === 1 && (
                <span className="tls-podium__crown" data-testid="podium-crown" aria-hidden="true">
                  <Crown className="h-5 w-5" strokeWidth={2.25} />
                </span>
              )}
              {place.rows.length ? place.rows.map((row) => {
                const reg = regMap.get(row.registration_id) || {};
                const src = resolveMediaUrl(reg.team?.logo_url || reg.user?.avatar_url || "");
                return (
                  <div key={row.registration_id} className="tls-podium__entry" data-podium-entry="" data-mine={row.is_mine ? "true" : undefined}>
                    <Avatar name={row.display_name} src={src} />
                    {/* Nie mitten im Wort brechen: mehrere Wörter dürfen zwei Zeilen nehmen, ein langes Wort endet mit „…“. */}
                    <span className={`tls-podium__name ${/\s/.test((row.display_name || "").trim()) ? "" : "tls-podium__name--word"}`} title={row.display_name || undefined}>{row.display_name || "Teilnehmer"}</span>
                    {valueText(row) && <span className="tls-podium__value">{valueText(row)}</span>}
                  </div>
                );
              }) : <div className="tls-podium__empty">–</div>}
            </div>
            <div className="tls-podium__step">
              <span className="tls-podium__digit">{place.rank}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
