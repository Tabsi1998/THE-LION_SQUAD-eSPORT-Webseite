import { Link } from "react-router-dom";
import { Trophy } from "lucide-react";
import { seriesAddress } from "@/lib/referenceSeries";
import { KIND_LABELS } from "@/lib/referencesOverview";
import { PARTNER_ROLE_LABELS } from "@/lib/seriesPartners";

// Partnerseite (#1934): „Ligen und Serien mit uns“ – je Spur mit diesem Partner ihre Saisons (neueste zuerst) mit Spiel,
// Saison, Stand bzw. Endplatz des Vereins und „läuft gerade“. Daten aus `shared.series` (nur sichtbare Spuren und
// Saisons, nie interne, ohne Namen). Jede Saison führt zu ihrer Serienseite.

export function seasonName(season) {
  return [season.title, season.season, season.tier].filter(Boolean).join(" · ");
}

export function clubText(season) {
  const rank = season.club?.rank;
  if (!rank) return season.running ? "Noch offen" : "";
  const of = season.club.of ? ` von ${season.club.of}` : "";
  return season.running ? `Stand: ${rank}.${of}` : `Endplatz ${rank}.${of}`;
}

export function PartnerSeries({ items, partnerName, Title }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <section data-testid="partner-series">
      <Title icon={Trophy} kicker="Gemeinsam" title="Ligen und Serien mit uns" />
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <article key={item.lineage.slug} className="border border-white/10 rounded-sm bg-[#121212] p-3 min-w-0" data-testid={`partner-series-${item.lineage.slug}`}>
            <div className="text-[10px] uppercase tracking-widest font-bold text-[#29B6E8] break-words">
              {[item.role === "organizer" ? `${PARTNER_ROLE_LABELS.organizer}: ${partnerName}` : PARTNER_ROLE_LABELS.contributor, KIND_LABELS[item.lineage.kind], item.lineage.game_name].filter(Boolean).join(" · ")}
            </div>
            <h3 className="mt-1 font-heading font-bold leading-tight break-words [overflow-wrap:anywhere]">{item.lineage.title}</h3>
            <ul className="mt-2 divide-y divide-white/[0.06] border-t border-white/[0.06]">
              {item.seasons.map((season) => (
                <li key={season.season_slug}>
                  <Link to={seriesAddress(item.lineage, season)} data-testid={`partner-season-${item.lineage.slug}-${season.season_slug}`}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 min-h-[44px] py-2 text-sm text-white/80 hover:text-white transition-colors">
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{seasonName(season)}</span>
                    <span className="inline-flex items-center gap-2 shrink-0 tabular-nums text-white/60">
                      {season.running && (
                        <span className="inline-flex items-center px-2 py-0.5 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-[10px] font-bold uppercase tracking-widest" data-testid="partner-season-running">Läuft gerade</span>
                      )}
                      {clubText(season) && <span data-testid="partner-season-place">{clubText(season)}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
