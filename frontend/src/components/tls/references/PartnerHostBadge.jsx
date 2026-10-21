import { resolveMediaUrl } from "@/lib/api";
import { SmartLogo } from "@/components/tls/SmartLogo";

// Kleines Partner-Abzeichen (#1934) für Chronik, „Läuft gerade“ und Serien & Ligen: ein Partner des Vereins veranstaltet
// die Serie. Logo im Original (keine Einfärbung) und Name. Kein eigener Link, weil die Zeile bzw. Karte schon verlinkt
// ist – zur Partnerseite führt die Serienseite.

export function PartnerHostBadge({ partner, className = "" }) {
  if (!partner?.name) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 max-w-full min-w-0 self-start px-2 py-0.5 rounded-full border border-white/[0.12] bg-surface-2 text-[12px] leading-[1.4] text-zinc-300 ${className}`}
      title={`Veranstaltet von ${partner.name}, Partner des Vereins`}
      data-testid="partner-host-badge"
    >
      {partner.logo_url && (
        <span className="h-3.5 max-w-[44px] shrink-0 inline-flex items-center" data-testid="partner-host-logo">
          <SmartLogo src={resolveMediaUrl(partner.logo_url)} alt="" className="max-h-3.5 max-w-full w-auto h-auto" />
        </span>
      )}
      <span className="sr-only">Veranstaltet von </span>
      <span className="truncate">{partner.name}</span>
      <span className="text-quiet shrink-0" aria-hidden="true">· Partner</span>
    </span>
  );
}
