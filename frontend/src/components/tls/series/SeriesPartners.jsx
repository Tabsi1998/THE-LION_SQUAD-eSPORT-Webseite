import { Fragment } from "react";
import { Link } from "react-router-dom";
import { resolveMediaUrl } from "@/lib/api";

// Kopf der Serienseite (#1934): „Veranstaltet von“ mit dem Logo des Partners im Original (keine Einfärbung) und dem
// Namen, verlinkt zur Partnerseite; mitwirkende Partner in einer Zeile darunter. Nur aktive Partner (Server).

const partnerHref = (partner) => `/partners/${partner.slug || partner.id}`;

export function SeriesPartners({ partners }) {
  const organizers = Array.isArray(partners?.organizers) ? partners.organizers : [];
  const contributors = Array.isArray(partners?.contributors) ? partners.contributors : [];
  if (!organizers.length && !contributors.length) return null;
  return (
    <div className="mt-5 flex flex-col gap-2.5" data-testid="series-partners">
      {organizers.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="series-organizers">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Veranstaltet von</span>
          {organizers.map((partner) => (
            <Link
              key={partner.id}
              to={partnerHref(partner)}
              data-testid={`series-organizer-${partner.slug || partner.id}`}
              className="group inline-flex items-center gap-2.5 min-h-[44px] max-w-full text-white no-underline"
            >
              {partner.logo_url && (
                <img src={resolveMediaUrl(partner.logo_url)} alt="" loading="lazy" decoding="async" className="h-8 w-auto max-w-[120px] object-contain shrink-0" />
              )}
              <span className="font-semibold break-words [overflow-wrap:anywhere] underline-offset-4 decoration-white/30 group-hover:underline group-hover:text-[#29B6E8] transition-colors">{partner.name}</span>
            </Link>
          ))}
        </div>
      )}
      {contributors.length > 0 && (
        <p className="m-0 text-sm text-white/60 break-words" data-testid="series-contributors">
          <span className="text-white/45">Mit </span>
          {contributors.map((partner, index) => (
            <Fragment key={partner.id}>
              {index > 0 && <span aria-hidden="true"> · </span>}
              <Link to={partnerHref(partner)} data-testid={`series-contributor-${partner.slug || partner.id}`} className="text-white/80 underline underline-offset-4 decoration-white/25 hover:text-[#29B6E8] hover:decoration-[#29B6E8] transition-colors">{partner.name}</Link>
            </Fragment>
          ))}
        </p>
      )}
    </div>
  );
}
