import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Gift, ExternalLink } from "lucide-react";

export default function MemberBenefitsPage() {
  const [benefits, setBenefits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/membership/benefits").then(({ data }) => setBenefits(data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <PublicLayout>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">EXKLUSIV</span>
        <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">Mitgliedervorteile</h1>
        <p className="mt-3 text-white/60 max-w-2xl">
          Rabatte, Partnerangebote, Mitglieder-only Aktionen und exklusive Erlebnisse — alles, was deine Mitgliedschaft im Rudel besonders macht.
        </p>

        <div className="mt-10">
          {loading ? (
            <div className="text-white/40 text-sm">Lade …</div>
          ) : benefits.length === 0 ? (
            <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
              <Gift className="w-10 h-10 mx-auto opacity-40 mb-4" />
              <div className="font-heading font-bold text-lg">Noch keine Vorteile</div>
              <div className="text-sm mt-2">Der Vorstand arbeitet an neuen Partnerschaften und Aktionen.</div>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {benefits.map((b) => (
                <article key={b.id} data-testid={`benefit-${b.id}`} className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden hover:border-[#FFD700]/40 transition flex flex-col">
                  {b.image_url && (
                    <div className="aspect-video bg-[#0A0A0A]">
                      <img src={b.image_url} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="p-5 flex-1 flex flex-col">
                    {b.category && <div className="text-[10px] uppercase tracking-widest text-[#FFD700]/80 font-bold">{b.category}</div>}
                    <h3 className="mt-1 font-heading font-black text-lg">{b.title}</h3>
                    {b.description && <p className="mt-2 text-sm text-white/65 flex-1">{b.description}</p>}
                    {b.valid_until && (
                      <div className="mt-3 text-xs text-white/40">Gültig bis {new Date(b.valid_until).toLocaleDateString("de-DE")}</div>
                    )}
                    {b.link_url && (
                      <a href={b.link_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-xs uppercase tracking-wider font-bold text-[#FFD700] hover:underline">
                        Mehr erfahren <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
