import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { newsCategoryLabel } from "@/lib/newsCategories";
import { SkeletonCards } from "@/components/tls/Skeleton";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useLoad } from "@/hooks/useLoad";
import { LoadState } from "@/components/tls/LoadState";
import { Pin, Newspaper } from "lucide-react";
import { viennaDate } from "@/lib/vienna";

export default function MemberNewsPage() {
  // „Keine internen News“ nur nach einer erfolgreichen Antwort ohne interne Beiträge (#984). Der Server filtert die
  // Sichtbarkeit nicht - das macht die Seite.
  const news = useLoad("news/members", ({ signal }) => api.get("/news?visibility=members", { signal }).then(({ data }) => (
    (Array.isArray(data) ? data : []).filter((n) => n.visibility === "members" || n.visibility === "internal")
  )));
  useApiInvalidation(news.reload, ["news"]);

  return (
    <>
      <section className="min-w-0">
        <p className="text-white/60 max-w-2xl">
          Vereinsinterne Ankündigungen, Vorstandsmitteilungen und Mitglieder-Nachrichten — nur für offizielle Vereinsmitglieder.
        </p>

        <div className="mt-10">
          <LoadState
            load={news}
            loading={<SkeletonCards count={3} label="Lade News" />}
            errorTitle="Interne News konnten nicht geladen werden"
            empty={(
              <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
                <Newspaper className="w-10 h-10 mx-auto opacity-40 mb-3" />
                <div className="tls-type-card">Keine internen News</div>
                <div className="tls-type-small mt-1">Aktuell gibt es keine vereinsinternen Beiträge.</div>
              </div>
            )}
          >
            {(list) => (
          <div className="space-y-3">
            {list.map((n) => (
              <Link
                key={n.id}
                to={`/news/${n.slug}`}
                data-testid={`member-news-${n.slug}`}
                className="block border border-brand/15 hover:border-brand/40 rounded-sm bg-[#121212] p-5 transition group"
              >
                <div className="flex items-center gap-2 tls-type-label">
                  <span className="text-brand">{newsCategoryLabel(n.category)}</span>
                  {n.pinned && <Pin className="w-3 h-3 text-white" />}
                  <span className="text-white/30 ml-auto">{viennaDate(n.created_at)}</span>
                </div>
                <h3 className="mt-2 tls-type-card group-hover:text-brand transition">{n.title}</h3>
                {n.excerpt && <p className="mt-2 tls-type-body text-white/65 line-clamp-2">{n.excerpt}</p>}
              </Link>
            ))}
          </div>
            )}
          </LoadState>
        </div>
      </section>
    </>
  );
}
