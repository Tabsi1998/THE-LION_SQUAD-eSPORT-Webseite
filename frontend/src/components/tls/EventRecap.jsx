import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Award, CheckCircle, Flag, Newspaper, Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { numberTiles, ownResultLine, podiumOrder } from "@/lib/eventRecap";

// Rückblick nach dem Event (#1187): ersetzt nach dem letzten Event-Tag den Satz „Das Event ist vorbei“ (#1221) oben auf
// der Event-Seite. Reihenfolge wie in der App (EventRecapCard): „Du warst dabei“ mit dem eigenen Ergebnis, die Zahlen,
// die Sieger je Turnier und Fast Lap als kleines Treppchen, der Bericht. Die Fotos stehen darunter wie bisher.
// Solange die Daten fehlen (Laden, Fehler, älterer Server), steht `fallback` da - der bisherige Satz mit den Turnieren.

const PLACE_STYLE = {
  1: { bar: "h-16 bg-[#FFD700]/20 border-[#FFD700]/50", text: "text-[#FFD700]" },
  2: { bar: "h-11 bg-white/10 border-white/25", text: "text-white/80" },
  3: { bar: "h-8 bg-[#CD7F32]/15 border-[#CD7F32]/45", text: "text-[#E0A36B]" },
};

function itemPath(item) {
  return item.kind === "fastlap" ? `/fastlap/${item.slug || item.id}` : `/tournaments/${item.slug || item.id}`;
}

// Kleines Treppchen je Turnier bzw. Fast Lap: Platz 2 links, 1 in der Mitte, 3 rechts. Vorlesen in der Reihenfolge der
// Plätze über die Beschriftung jeder Stufe. Wird durch den Baustein `Podium` aus #1339 ersetzt, sobald es ihn gibt.
function MiniPodium({ podium, testId }) {
  if (!podium?.length) return <p className="text-sm text-white/50">Noch keine Ergebnisse.</p>;
  return (
    <ol className="grid grid-cols-3 items-end gap-2" data-testid={testId}>
      {podiumOrder(podium).map((entry, index) => {
        const rank = [2, 1, 3][index];
        const style = PLACE_STYLE[rank];
        if (!entry) return <li key={rank} aria-hidden="true" />;
        return (
          <li key={rank} className="min-w-0 text-center" aria-label={`Platz ${rank}: ${entry.name}${entry.detail ? `, ${entry.detail}` : ""}`} data-testid={`${testId}-${rank}`}>
            <div className={`text-sm font-bold leading-tight break-words ${rank === 1 ? "text-white" : "text-white/85"}`}>{entry.name}</div>
            {entry.detail ? <div className="text-[11px] text-white/55 tabular-nums break-words">{entry.detail}</div> : null}
            <div className={`mt-1.5 rounded-t-sm border border-b-0 flex items-start justify-center pt-1 ${style.bar}`}>
              <span className={`font-heading text-lg font-black ${style.text}`} aria-hidden="true">{rank}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function EventRecap({ event, accessToken = "", fallback = null }) {
  const [recap, setRecap] = useState(null);
  const key = event?.slug || event?.id;

  useEffect(() => {
    let alive = true;
    setRecap(null);
    if (!key) return undefined;
    api.get(`/events/${key}/recap`, { params: accessToken ? { access: accessToken } : undefined })
      .then(({ data }) => { if (alive) setRecap(data && data.available === true ? data : null); })
      .catch(() => { if (alive) setRecap(null); });
    return () => { alive = false; };
  }, [key, accessToken]);

  if (!recap) return fallback;
  const tiles = numberTiles(recap.numbers);
  const results = [...(recap.winners || []), ...(recap.fastlaps || [])];
  const mine = recap.mine?.was_there ? recap.mine : null;

  return (
    <section className="space-y-6" data-section="recap" data-testid="event-recap">
      <h2 className="font-heading text-2xl font-black uppercase inline-flex items-center gap-2">
        <Award className="w-5 h-5 text-[#FFD700]" aria-hidden="true" /> Rückblick
      </h2>

      {mine && (
        <div className="border border-[#29B6E8]/40 bg-[#29B6E8]/5 rounded-sm p-4" data-testid="event-recap-mine">
          <div className="inline-flex items-center gap-2 font-heading text-lg font-black uppercase text-[#29B6E8]">
            <CheckCircle className="w-5 h-5" aria-hidden="true" /> Du warst dabei
          </div>
          {!!mine.results?.length && (
            <ul className="mt-2 space-y-1">
              {mine.results.map((result) => (
                <li key={`${result.kind}-${result.id}`} className="text-sm text-white/85 flex flex-wrap gap-x-2 min-w-0" data-testid={`event-recap-mine-${result.kind}-${result.id}`}>
                  <Link to={itemPath(result)} className="font-bold text-white hover:text-[#29B6E8] break-words">{result.title}</Link>
                  <span className="text-white/65">{ownResultLine(result)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!!tiles.length && (
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2" data-testid="event-recap-numbers">
          {tiles.map((tile) => (
            <div key={tile.key} className="flex flex-col-reverse rounded-sm bg-white/[0.04] px-3 py-3 min-w-0" data-testid={`event-recap-number-${tile.key}`}>
              <dt className="text-[11px] uppercase tracking-widest font-bold text-white/55">{tile.label}</dt>
              <dd className="font-heading text-3xl font-black tabular-nums text-white">{tile.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {!!results.length && (
        <div className="grid sm:grid-cols-2 gap-4" data-testid="event-recap-winners">
          {results.map((item) => {
            const Icon = item.kind === "fastlap" ? Flag : Trophy;
            return (
              <div key={`${item.kind}-${item.id}`} className="border border-white/10 bg-[#121212] rounded-sm p-4 min-w-0" data-testid={`event-recap-${item.kind}-${item.id}`}>
                <Link to={itemPath(item)} className="inline-flex items-center gap-2 font-heading font-bold leading-tight hover:text-[#29B6E8] break-words">
                  <Icon className={`w-4 h-4 shrink-0 ${item.kind === "fastlap" ? "text-[#2DD4BF]" : "text-[#29B6E8]"}`} aria-hidden="true" /> {item.title}
                </Link>
                {item.kind === "fastlap" && item.track ? <div className="text-xs text-white/50 mt-0.5">Beste Zeit auf {item.track}</div> : null}
                {item.kind === "tournament" && item.team ? <div className="text-xs text-white/50 mt-0.5">Team-Turnier</div> : null}
                <div className="mt-3">
                  <MiniPodium podium={item.podium} testId={`event-recap-podium-${item.id}`} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {recap.report && (
        <Link to={`/news/${recap.report.slug}`} className="tls-card flex items-center gap-3 border border-white/10 bg-[#121212] rounded-sm p-4 min-w-0" data-testid="event-recap-report">
          <Newspaper className="w-5 h-5 text-[#29B6E8] shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[10px] uppercase tracking-widest text-white/45">Bericht</span>
            <span className="tls-card__title block font-heading font-bold break-words">{recap.report.title}</span>
            {recap.report.excerpt ? <span className="block text-xs text-white/60 line-clamp-2">{recap.report.excerpt}</span> : null}
          </span>
        </Link>
      )}
    </section>
  );
}
