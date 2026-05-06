import { useCallback, useEffect, useState } from "react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { api, resolveMediaUrl } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { ExternalLink, Handshake } from "lucide-react";

export default function PartnersPage() {
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

        {partners.length === 0 ? (
          <div className="mt-12 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            <Handshake className="w-10 h-10 mx-auto opacity-40 mb-4" />
            <div className="font-heading font-bold text-lg">Partner werden bald ergänzt.</div>
            <div className="text-sm mt-2">Du willst mit uns zusammenarbeiten? Schreib uns direkt über die Kontaktseite.</div>
          </div>
        ) : (
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {partners.map((p) => (
              <a
                key={p.id}
                href={p.link || undefined}
                target={p.link ? "_blank" : undefined}
                rel="noreferrer"
                className="border border-white/10 hover:border-[#29B6E8]/60 rounded-sm bg-[#121212] p-6 transition group"
              >
                <div className="h-24 flex items-center justify-start">
                  {p.logo_url ? (
                    <img src={resolveMediaUrl(p.logo_url)} alt={p.name} className="max-h-20 max-w-52 object-contain" />
                  ) : (
                    <Handshake className="w-8 h-8 text-[#29B6E8]" />
                  )}
                </div>
                <div className="mt-4 text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{p.kind || "Partner"}</div>
                <h3 className="mt-1 font-heading font-black uppercase text-lg">{p.name}</h3>
                {p.description && <p className="mt-2 text-sm text-white/65 line-clamp-3">{p.description}</p>}
                {p.link && (
                  <span className="mt-4 inline-flex items-center gap-1 text-xs uppercase tracking-wider font-bold text-[#29B6E8] group-hover:underline">
                    Website <ExternalLink className="w-3 h-3" />
                  </span>
                )}
              </a>
            ))}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}
