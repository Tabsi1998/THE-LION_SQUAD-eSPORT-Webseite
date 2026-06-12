import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { api, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { SmartLogo } from "@/components/tls/SmartLogo";
import { ArrowRight, ExternalLink, Handshake, Star } from "lucide-react";

export default function PartnersPage() {
  useDocumentTitle(
    "Partner",
    "Partner, Vereine, Veranstalter und Communitys im Netzwerk von THE LION SQUAD eSports aus Tirol."
  );

  const [partners, setPartners] = useState([]);

  const load = useCallback(() => {
    api.get("/partners").then(({ data }) => setPartners(data || [])).catch(() => setPartners([]));
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
            <p className="mt-2 text-sm text-white/55">Unterstuetzer, Tiers und Marken, die Events und Turniere mitmoeglich machen.</p>
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
            {partners.map((p, idx) => (
              <a
                key={p.id}
                href={p.link || undefined}
                target={p.link ? "_blank" : undefined}
                rel="noreferrer"
                className="grid lg:grid-cols-2 gap-0 border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#101010] overflow-hidden transition group"
              >
                <div className={`${idx % 2 === 1 ? "lg:order-2" : ""} min-h-72 bg-[#070707] border-b lg:border-b-0 ${idx % 2 === 1 ? "lg:border-l" : "lg:border-r"} border-white/10 flex items-center justify-center p-10`}>
                  {p.logo_url ? (
                    <SmartLogo src={resolveMediaUrl(p.logo_url)} alt={p.name} className="max-h-44 max-w-[80%] w-auto h-auto" />
                  ) : (
                    <Handshake className="w-14 h-14 text-[#29B6E8]" />
                  )}
                </div>
                <div className="p-7 md:p-10 flex flex-col justify-center">
                  <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{p.kind || "Partner"}</div>
                  <h3 className="mt-2 font-heading font-black uppercase text-2xl md:text-3xl leading-tight">{p.name}</h3>
                  {p.description && <p className="mt-4 text-white/70 leading-relaxed">{p.description}</p>}
                  {p.link && (
                    <span className="mt-6 inline-flex items-center gap-1 text-xs uppercase tracking-wider font-bold text-[#29B6E8] group-hover:underline">
                      Website <ExternalLink className="w-3 h-3" />
                    </span>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}
