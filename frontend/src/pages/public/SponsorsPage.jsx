import { useCallback, useEffect, useState } from "react";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { SmartLogo } from "@/components/tls/SmartLogo";
import { Star } from "lucide-react";

const tierLabel = { main: "Hauptsponsor", platinum: "Platin", gold: "Gold", silver: "Silber", bronze: "Bronze" };
const tierColor = { main: "#29B6E8", platinum: "#E5E4E2", gold: "#FFD700", silver: "#C0C0C0", bronze: "#CD7F32" };
const tierGrid = {
  main: "md:grid-cols-1",
  platinum: "md:grid-cols-2",
  gold: "sm:grid-cols-2 md:grid-cols-3",
  silver: "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
  bronze: "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
};
const tierCard = {
  main: "p-9 min-h-72 border-[#29B6E8]/25 bg-[#071114]",
  platinum: "p-8 min-h-64 border-white/15 bg-[#111111]",
  gold: "p-7 min-h-56 border-[#FFD700]/15 bg-[#101010]",
  silver: "p-5 min-h-44",
  bronze: "p-4 min-h-36",
};
const tierLogo = {
  main: "h-52 md:h-60",
  platinum: "h-44",
  gold: "h-36",
  silver: "h-28",
  bronze: "h-24",
};

export default function SponsorsPage() {
  useDocumentTitle("Sponsoren", "Sponsoren und Unterstützer von THE LION SQUAD eSports.");
  const [list, setList] = useState([]);
  const load = useCallback(() => {
    api.get("/sponsors").then(({ data }) => setList(data)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useApiInvalidation(load, ["sponsors"]);

  const publicSponsors = list.filter((s) => s.logo_url);
  const grouped = publicSponsors.reduce((acc, s) => {
    const t = ["main", "platinum", "gold", "silver", "bronze"].includes(s.tier) ? s.tier : "bronze";
    (acc[t] = acc[t] || []).push(s);
    return acc;
  }, {});
  const order = ["main", "platinum", "gold", "silver", "bronze"];

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">UNSERE PARTNER</span>
        <h1 className="mt-3 font-heading text-4xl md:text-5xl font-black uppercase">Sponsoren</h1>
        <p className="mt-4 text-white/70 max-w-2xl">
          Diese Marken und Unternehmen unterstützen THE LION SQUAD — eSports. Ohne sie wären viele unserer Events, Turniere und Aktionen nicht möglich. Danke!
        </p>

        {publicSponsors.length === 0 && (
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
              <div className={`grid gap-4 ${tierGrid[t] || tierGrid.bronze}`}>
                {grouped[t].map((s) => (
                  <a
                    key={s.id}
                    href={s.link || undefined}
                    target={s.link ? "_blank" : undefined}
                    rel="noreferrer"
                    aria-label={s.name}
                    data-testid={`sponsor-${s.id}`}
                    className={`border border-white/10 hover:border-[#FFD700]/40 rounded-sm bg-[#101010] transition group flex items-center justify-center ${tierCard[t] || tierCard.bronze}`}
                  >
                    <div className={`${tierLogo[t] || tierLogo.bronze} w-full flex items-center justify-center overflow-hidden`}>
                      {s.logo_url ? (
                        <SmartLogo src={resolveMediaUrl(s.logo_url)} alt={s.name} className="w-full h-full object-contain" />
                      ) : (
                        <span className="sr-only">{s.name}</span>
                      )}
                    </div>
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
