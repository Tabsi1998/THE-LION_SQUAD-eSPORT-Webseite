import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { api, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { SmartLogo } from "@/components/tls/SmartLogo";
import { ChannelIcon, channelColor } from "@/components/tls/ChannelIcon";
import { ArrowRight, ExternalLink, Handshake, Star } from "lucide-react";

// Partnerliste: jede Karte führt auf die Partnerseite (#469) - Kanäle, Twitch-Live, Discord,
// Tools und gemeinsame News stehen dort; die Website bleibt als kleiner Link an der Karte.

export default function PartnersPage() {
  useDocumentTitle(
    "Partner",
    "Partner, Vereine, Veranstalter und Communitys im Netzwerk von THE LION SQUAD eSports aus Tirol."
  );

  const [partners, setPartners] = useState([]);

  const load = useCallback(() => {
    api.get("/partners").then(({ data }) => setPartners(Array.isArray(data) ? data : [])).catch(() => setPartners([]));
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["partners"]);

  return (
    <PublicLayout>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">COMMUNITY</span>
        <h1 className="mt-3 font-heading text-4xl md:text-5xl font-black uppercase">Partner</h1>
        <p className="mt-4 text-white/70 max-w-2xl">
          Befreundete Vereine, Veranstalter und Communitys, mit denen wir zusammenarbeiten.
        </p>

        <div className="mt-8 grid md:grid-cols-2 gap-3">
          <Link to="/sponsors" className="group rounded-sm border border-white/10 bg-[#101010] p-4 transition hover:border-[#FFD700]/35 hover:bg-white/[0.03]">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#FFD700]">
              <Star className="h-3.5 w-3.5" /> Sponsoren
            </div>
            <p className="mt-2 text-sm text-white/55">Unterstützer, Tiers und Marken, die Events und Turniere mit möglich machen.</p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/35 group-hover:text-[#FFD700]">
              Sponsoren ansehen <ArrowRight className="h-3 w-3" />
            </span>
          </Link>
          <Link to="/contact" className="group rounded-sm border border-white/10 bg-[#101010] p-4 transition hover:border-[#29B6E8]/35 hover:bg-white/[0.03]">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[#29B6E8]">
              <Handshake className="h-3.5 w-3.5" /> Kooperation
            </div>
            <p className="mt-2 text-sm text-white/55">Kontakt für gemeinsame Events, Community-Projekte und langfristige Partnerschaften.</p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/35 group-hover:text-[#29B6E8]">
              Kontakt aufnehmen <ArrowRight className="h-3 w-3" />
            </span>
          </Link>
        </div>

        {partners.length === 0 ? (
          <div className="mt-12 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            <Handshake className="w-10 h-10 mx-auto opacity-40 mb-4" />
            <div className="font-heading font-bold text-lg">Partner werden bald ergänzt.</div>
            <div className="text-sm mt-2">Du willst mit uns zusammenarbeiten? Schreib uns direkt über die Kontaktseite.</div>
          </div>
        ) : (
          <div className="mt-12 space-y-8">
            {partners.map((p, idx) => {
              const target = `/partners/${encodeURIComponent(p.slug || p.id)}`;
              const channels = Array.isArray(p.channels) ? p.channels : [];
              const since = p.since || (p.since_year ? String(p.since_year) : "");
              return (
                <article key={p.id} data-testid={`partner-card-${p.slug || p.id}`} className="grid lg:grid-cols-2 gap-0 border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#101010] overflow-hidden transition">
                  <Link to={target} className={`${idx % 2 === 1 ? "lg:order-2" : ""} min-h-72 bg-[#070707] border-b lg:border-b-0 ${idx % 2 === 1 ? "lg:border-l" : "lg:border-r"} border-white/10 flex items-center justify-center p-10`}>
                    {p.logo_url ? (
                      <SmartLogo src={resolveMediaUrl(p.logo_url)} alt={p.name} className="max-h-44 max-w-[80%] w-auto h-auto" />
                    ) : (
                      <Handshake className="w-14 h-14 text-[#29B6E8]" />
                    )}
                  </Link>
                  <div className="p-7 md:p-10 flex flex-col justify-center min-w-0">
                    <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{p.kind || "Partner"}{since ? <span className="text-white/40"> · seit {since}</span> : null}</div>
                    <h3 className="mt-2 font-heading font-black uppercase text-2xl md:text-3xl leading-tight break-words">
                      <Link to={target} data-testid={`partner-open-${p.slug || p.id}`} className="hover:text-[#29B6E8] transition">{p.name}</Link>
                    </h3>
                    {p.description && <p className="mt-4 text-white/70 leading-relaxed">{p.description}</p>}
                    {channels.length > 0 && (
                      <div className="mt-5 flex flex-wrap gap-2">
                        {channels.map((channel) => (
                          <a key={channel.key} href={channel.url} target="_blank" rel="noopener noreferrer" aria-label={channel.label} title={channel.label} data-testid={`partner-icon-${channel.key}`} className="inline-flex h-9 w-9 items-center justify-center border border-white/10 bg-[#0A0A0A] rounded-sm text-white/60 transition hover:text-[var(--c)] hover:border-[var(--c)]" style={{ "--c": channelColor(channel.key) }}>
                            <ChannelIcon kind={channel.key} className="w-4 h-4" />
                          </a>
                        ))}
                      </div>
                    )}
                    <div className="mt-6 flex flex-wrap items-center gap-4">
                      <Link to={target} className="inline-flex items-center gap-1 text-xs uppercase tracking-wider font-bold text-[#29B6E8] hover:underline">
                        Partnerseite <ArrowRight className="w-3 h-3" />
                      </Link>
                      {p.link && (
                        <a href={p.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs uppercase tracking-wider font-bold text-white/45 hover:text-white">
                          Website <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}
