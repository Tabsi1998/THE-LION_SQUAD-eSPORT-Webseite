import { Link } from "react-router-dom";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useCookieConsent } from "@/components/tls/CookieConsent";

export function ExternalMediaNotice({
  service = "Externes Medium",
  reason = "Dieses externe Medium wird erst nach deiner Zustimmung geladen.",
  url = "",
  accent = "#29B6E8",
  compact = false,
  testId,
}) {
  const { openSettings } = useCookieConsent();

  return (
    <div
      data-testid={testId}
      className={`flex flex-col items-center justify-center text-center rounded-sm border bg-[#121212] ${compact ? "min-h-[220px] p-5" : "min-h-72 p-6"}`}
      style={{ borderColor: `${accent}55` }}
    >
      <ShieldCheck className={`${compact ? "h-8 w-8" : "h-10 w-10"} mb-3`} style={{ color: accent }} />
      <div className="font-heading font-black uppercase">{service} blockiert</div>
      <p className="mt-2 max-w-md text-sm text-white/60">{reason}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={openSettings}
          className="px-4 py-2 border text-xs uppercase tracking-wider font-bold rounded-sm"
          style={{ borderColor: `${accent}88`, color: accent }}
        >
          Cookie-Einstellungen
        </button>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-white/15 text-white/70 hover:text-white text-xs uppercase tracking-wider font-bold rounded-sm"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Direkt öffnen
          </a>
        )}
      </div>
      <Link to="/privacy" className="mt-3 text-[11px] uppercase tracking-widest text-white/45 hover:text-white">
        Datenschutz ansehen
      </Link>
    </div>
  );
}
