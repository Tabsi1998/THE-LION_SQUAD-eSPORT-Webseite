import { Link } from "react-router-dom";
import { usePublicSiteSettings } from "@/hooks/usePublicSiteSettings";

// Mitmachen-Band (#1878) am Ende der Übersicht: „Selbst für den Verein antreten?“ mit „Mitglied werden“ und Discord
// (Einladung aus den öffentlichen Einstellungen; ohne Einladung fehlt der Knopf).

export function JoinBand({ index = 6 }) {
  const settings = usePublicSiteSettings();
  const discord = String(settings?.discord_invite_url || "").trim();
  return (
    <section className="tls-ref-rise max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-12 md:pt-24 md:pb-20" style={{ "--tls-ref-i": index }} data-testid="references-join">
      <div className="flex flex-col md:flex-row md:flex-wrap md:items-center md:justify-between gap-3.5 md:gap-6 p-[22px] md:p-8 bg-surface-1 border border-brand/30 rounded-[10px]">
        <div className="flex flex-col gap-2 max-w-[60ch]">
          <h2 className="m-0 font-heading font-extrabold uppercase leading-[1.1] text-xl md:text-2xl">Selbst für den Verein antreten?</h2>
          <p className="m-0 text-sm md:text-base text-zinc-400">Jede Teilnahme oben hat mit einer Anmeldung angefangen. Im Discord stellen wir Teams für die nächsten Serien zusammen.</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2.5">
          <Link to="/membership/join" data-testid="references-join-member" className="tls-btn tls-btn--primary inline-flex items-center justify-center min-h-[48px] px-5 font-bold rounded">Mitglied werden</Link>
          {discord && (
            <a href={discord} target="_blank" rel="noreferrer" data-testid="references-join-discord" className="tls-btn tls-btn--quiet inline-flex items-center justify-center min-h-[48px] px-5 font-bold rounded">Discord beitreten</a>
          )}
        </div>
      </div>
    </section>
  );
}
