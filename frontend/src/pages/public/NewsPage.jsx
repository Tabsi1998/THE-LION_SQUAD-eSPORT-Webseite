import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { newsCategoryLabel } from "@/lib/newsCategories";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Reveal } from "@/components/tls/Reveal";
import { PublicEmptyState, PublicErrorState } from "@/components/tls/PublicEmptyState";
import { problemKind } from "@/lib/loadProblem";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { LazyImg } from "@/components/tls/LazyImg";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { ArrowRight, Pin, Crown, Lock } from "lucide-react";
import { NewsFilterRow } from "@/components/tls/NewsFilterRow";
import { NewsTextCard } from "@/components/tls/NewsTextCard";
import { NewsLead } from "@/components/tls/NewsLead";
import { withoutRepeatedBanners } from "@/lib/newsCards";
import { formatAgo } from "@/lib/datetime";
import { newsCategoryColor } from "@/lib/categoryColors";

const VIS_ICON = { members: Crown, internal: Lock, community: null, public: null };

export default function NewsPage() {
  useDocumentTitle("News", "Aktuelle News, Ergebnisse, Ankündigungen, Events und Turnier-Updates von THE LION SQUAD eSports aus Tirol.");
  const [searchParams, setSearchParams] = useSearchParams();
  const [list, setList] = useState([]);
  const [meta, setMeta] = useState({ categories: [], in_use: [], visibilities: [] });
  const [activeCat, setActiveCat] = useState(searchParams.get("category") || "");
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const [loading, setLoading] = useState(true);
  // Ladefehler (#2412): ohne Liste steht der Fehler mit „Nochmal versuchen“ da, nicht „noch nichts da“.
  const [problem, setProblem] = useState(null);

  useEffect(() => {
    // Bewusst still: nur die Kategorie-Leiste; die Liste selbst meldet ihren Ladefehler.
    api.get("/news-meta").then(({ data }) => setMeta(data)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ compact: "true", limit: "90" });
    if (activeCat) params.set("category", activeCat);
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    api.get(`/news?${params.toString()}`).then(({ data }) => { setList(Array.isArray(data) ? data : data?.items || []); setProblem(null); }).catch((error) => setProblem(problemKind(error))).finally(() => setLoading(false));
  }, [activeCat, searchQuery]);

  useEffect(() => {
    load();
  }, [load]);

  useApiInvalidation(load, ["news"]);

  useEffect(() => {
    const nextCategory = searchParams.get("category") || "";
    const nextSearch = searchParams.get("q") || "";
    if (nextCategory !== activeCat) setActiveCat(nextCategory);
    if (nextSearch !== searchQuery) setSearchQuery(nextSearch);
  }, [searchParams, activeCat, searchQuery]);

  const updateNewsFilters = ({ category = activeCat, q = searchQuery } = {}) => {
    setActiveCat(category);
    setSearchQuery(q);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (category) params.set("category", category);
      else params.delete("category");
      if (q.trim()) params.set("q", q.trim());
      else params.delete("q");
      return params;
    }, { replace: true });
  };

  const hasSearch = Boolean(searchQuery.trim());

  // Dasselbe Bild nie zweimal (#1343): die Wiederholung bekommt die Text-Karte.
  const shown = withoutRepeatedBanners(list);
  const lead = shown.find((n) => n.pinned) || null;
  const grid = shown.filter((n) => n !== lead);

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="tls-type-label text-[#29B6E8]">VEREINS-NEWS</span>
        <h1 className="mt-2 tls-type-title">News & Ankündigungen</h1>
        <p className="mt-3 text-white/60 max-w-2xl">
          Alles was im Rudel passiert — von Turnier-Recaps über Eventankündigungen bis zu Vereinsthemen.
        </p>

        <div className="mt-8">
          <NewsFilterRow
            categories={meta.in_use || []}
            active={activeCat}
            onSelect={(category) => updateNewsFilters({ category })}
            query={searchQuery}
            onQuery={(q) => updateNewsFilters({ q })}
          />
        </div>

        {loading ? (
          <PublicLoadingState cards={6} className="mt-10" />
        ) : problem && list.length === 0 ? (
          <PublicErrorState kind={problem} onRetry={load} className="mt-10" />
        ) : list.length === 0 ? (
          <PublicEmptyState
            art={hasSearch ? "search" : "sleep"}
            title={hasSearch ? "Keine News gefunden" : activeCat ? "Keine News in dieser Kategorie" : "Noch keine News sichtbar"}
            description={hasSearch ? "Passe deine Suche an oder leere den Suchbegriff, um wieder alle passenden News zu sehen." : activeCat ? "Wähle eine andere Kategorie oder komm später wieder, sobald neue Updates veröffentlicht sind." : "Neue Ankündigungen, Recaps und Vereinsupdates erscheinen hier automatisch."}
            primaryAction={hasSearch ? { label: "Suche leeren", onClick: () => updateNewsFilters({ q: "" }) } : activeCat ? { label: "Alle News", onClick: () => updateNewsFilters({ category: "" }) } : { to: "/events", label: "Events ansehen" }}
            secondaryAction={{ to: "/tournaments", label: "Turniere" }}
            className="mt-10"
          />
        ) : (
          <div className="mt-8 space-y-8">
            {/* Die angepinnte News als breiter Aufmacher (#1342) - weitere angepinnte stehen vorne im Raster. */}
            {lead && (
              <Reveal className="tls-reveal-grid">
                <NewsLead news={lead} priority />
              </Reveal>
            )}
            {grid.length > 0 && (
              <Reveal className="tls-reveal-grid grid md:grid-cols-2 lg:grid-cols-3 gap-5" data-testid="news-grid">
                {grid.map((n) => <NewsCard key={n.id} n={n} />)}
              </Reveal>
            )}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

function NewsCard({ n }) {
  // Farbe je Kategorie (#1305): Turniere Cyan, Events Violett, Verein und Mitglieder Gold, alles andere Grau.
  const c = newsCategoryColor(n.category);
  const VIcon = VIS_ICON[n.visibility];
  return (
    <Link
      to={`/news/${n.slug}`}
      data-testid={`news-card-${n.slug}`}
      data-season-anchor="card"
      className="tls-card tls-reveal-item group border border-white/10 rounded-sm bg-[#121212] overflow-hidden flex flex-col"
    >
      <div className="aspect-video bg-[#0A0A0A] overflow-hidden">
        {n.banner_url ? (
          <LazyImg src={n.banner_url} alt="" sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw" className="w-full h-full object-cover tls-card__media" />
        ) : (
          <NewsTextCard news={n} />
        )}
        </div>
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-center gap-2 tls-type-label">
          <span style={{ color: c }}>{newsCategoryLabel(n.category)}</span>
          {n.pinned && <Pin className="w-3 h-3 text-white" aria-label="Angepinnt" />}
          {VIcon && <VIcon className="w-3 h-3 text-honor" />}
          <span className="text-white/45 ml-auto normal-case tracking-normal">{formatAgo(n.published_at || n.created_at)}</span>
        </div>
        <h3 className="tls-wrap mt-2 tls-type-card leading-tight tls-card__title">
          {n.title}
        </h3>
        {n.excerpt && <p className="mt-2 tls-type-body text-white/65 line-clamp-3 flex-1">{n.excerpt}</p>}
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
          <span className="tls-type-label text-quiet">Beitrag</span>
          <span className="inline-flex items-center gap-1.5 tls-type-label text-[#29B6E8]">
            Weiterlesen <ArrowRight className="tls-card__arrow w-3 h-3" />
          </span>
        </div>
      </div>
    </Link>
  );
}
