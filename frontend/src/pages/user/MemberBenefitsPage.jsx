import { api, resolveMediaUrl } from "@/lib/api";
import { SkeletonCards } from "@/components/tls/Skeleton";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useLoad } from "@/hooks/useLoad";
import { LoadState } from "@/components/tls/LoadState";
import { Gift, ExternalLink } from "lucide-react";
import { viennaDate } from "@/lib/vienna";

export default function MemberBenefitsPage() {
  // „Noch keine Vorteile“ nur nach einer erfolgreichen, leeren Antwort (#984).
  const benefits = useLoad("membership/benefits", ({ signal }) => api.get("/membership/benefits", { signal }).then(({ data }) => (Array.isArray(data) ? data : [])));
  useApiInvalidation(benefits.reload, ["membership"]);

  return (
    <>
      <section className="min-w-0">
        <p className="text-white/60 max-w-2xl">
          Rabatte, Partnerangebote, Mitglieder-only Aktionen und exklusive Erlebnisse — alles, was deine Mitgliedschaft im Rudel besonders macht.
        </p>

        <div className="mt-10">
          <LoadState
            load={benefits}
            loading={<SkeletonCards count={3} image={false} label="Lade Vorteile" />}
            errorTitle="Die Vorteile konnten nicht geladen werden"
            empty={(
              <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
                <Gift className="w-10 h-10 mx-auto opacity-40 mb-4" />
                <div className="font-heading font-bold text-lg">Noch keine Vorteile</div>
                <div className="text-sm mt-2">Der Vorstand arbeitet an neuen Partnerschaften und Aktionen.</div>
              </div>
            )}
          >
            {(rows) => (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {rows.map((b) => (
                <article key={b.id} data-testid={`benefit-${b.id}`} className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden hover:border-[#FFD700]/40 transition flex flex-col">
                  {b.image_url && (
                    <div className="aspect-video bg-[#0A0A0A]">
                      <img src={resolveMediaUrl(b.image_url)} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="p-5 flex-1 flex flex-col">
                    {b.category && <div className="text-[10px] uppercase tracking-widest text-[#FFD700]/80 font-bold">{b.category}</div>}
                    <h3 className="mt-1 font-heading font-black text-lg">{b.title}</h3>
                    {b.description && <p className="mt-2 text-sm text-white/65 flex-1">{b.description}</p>}
                    {b.valid_until && (
                      <div className="mt-3 text-xs text-white/40">Gültig bis {viennaDate(b.valid_until)}</div>
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
          </LoadState>
        </div>
      </section>
    </>
  );
}
