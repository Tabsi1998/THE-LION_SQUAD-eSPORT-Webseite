import { useEffect, useState } from "react";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Star, ExternalLink } from "lucide-react";

const tierLabel = { main: "Hauptsponsor", gold: "Gold", silver: "Silber", bronze: "Bronze", supporter: "Supporter", partner: "Partner" };
const tierColor = { main: "#29B6E8", gold: "#FFD700", silver: "#C0C0C0", bronze: "#CD7F32", supporter: "#9CA3AF", partner: "#A855F7" };

export default function SponsorsPage() {
  const [list, setList] = useState([]);
  useEffect(() => { api.get("/sponsors").then(({ data }) => setList(data)).catch(() => {}); }, []);

  const grouped = list.reduce((acc, s) => {
    const t = s.tier || "supporter";
    (acc[t] = acc[t] || []).push(s);
    return acc;
  }, {});
  const order = ["main", "gold", "silver", "bronze", "supporter", "partner"];

  return (
    <PublicLayout>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">UNSERE PARTNER</span>
        <h1 className="mt-3 font-heading text-4xl md:text-5xl font-black uppercase">Sponsoren</h1>
        <p className="mt-4 text-white/70 max-w-2xl">
          Diese Marken und Unternehmen unterstützen THE LION SQUAD — eSports. Ohne sie wären viele unserer Events, Turniere und Aktionen nicht möglich. Danke!
        </p>

        {list.length === 0 && (
          <div className="mt-12 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            <Star className="w-10 h-10 mx-auto opacity-40 mb-4" />
            <div className="font-heading font-bold text-lg">Bald hier</div>
            <div className="text-sm mt-2">Sponsoren werden in Kürze veröffentlicht.</div>
          </div>
        )}

        <div className="mt-12 space-y-12">
          {order.map((t) => grouped[t]?.length ? (
            <div key={t}>
              <div className="flex items-center gap-3 mb-5">
                <Star className="w-4 h-4" style={{ color: tierColor[t] }} />
                <h2 className="font-heading text-xl font-black uppercase tracking-wider">{tierLabel[t] || t}</h2>
                <div className="flex-1 border-t border-white/10" />
              </div>
              <div className={`grid gap-5 ${(t === "main" || t === "gold") ? "md:grid-cols-2" : "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"}`}>
                {grouped[t].map((s) => (
                  <a
                    key={s.id}
                    href={s.link || "#"}
                    target="_blank"
                    rel="noreferrer"
                    data-testid={`sponsor-${s.id}`}
                    className="border border-white/10 hover:border-[#FFD700]/40 rounded-sm bg-[#121212] p-6 transition group flex flex-col"
                  >
                    <div className="aspect-video bg-[#0A0A0A] rounded-sm mb-4 flex items-center justify-center overflow-hidden">
                      {s.logo_url ? (
                        <img src={resolveMediaUrl(s.logo_url)} alt={s.name} className="w-full h-full object-contain p-3" />
                      ) : (
                        <span className="font-heading font-black text-2xl text-white/30">{s.name[0]}</span>
                      )}
                    </div>
                    <div className="font-heading font-black uppercase">{s.name}</div>
                    {s.description && <div className="mt-1 text-xs text-white/55 line-clamp-2">{s.description}</div>}
                    {s.link && (
                      <div className="mt-3 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-[#FFD700] group-hover:underline">
                        Webseite <ExternalLink className="w-2.5 h-2.5" />
                      </div>
                    )}
                  </a>
                ))}
              </div>
            </div>
          ) : null)}
        </div>
      </section>
    </PublicLayout>
  );
}
