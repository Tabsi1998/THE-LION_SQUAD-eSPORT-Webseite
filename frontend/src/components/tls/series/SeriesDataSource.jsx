import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";

// Hinweis „Daten von …“ der Serienseite (#1964): Holt die Saison ihre Turniertage von der Plattform eines Partners,
// nennt der Kopf die Quelle - verlinkt zur Partnerseite (#1934), ohne gewählten Partner zur Plattform selbst.

const LINK = "text-white/75 underline underline-offset-4 decoration-white/25 hover:text-[#29B6E8] hover:decoration-[#29B6E8] transition-colors";

export function SeriesDataSource({ source }) {
  if (!source || !(source.partner?.name || source.provider)) return null;
  const partner = source.partner;
  return (
    <p className="mt-3 mb-0 text-xs text-white/50" data-testid="series-data-source">
      Daten von{" "}
      {partner ? (
        <Link to={`/partners/${partner.slug || partner.id}`} className={LINK}>{partner.name}</Link>
      ) : (
        <a href={source.url} target="_blank" rel="noopener noreferrer" className={`${LINK} inline-flex items-center gap-1`}>
          {source.provider}<ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      )}
    </p>
  );
}
