import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { PublicEmptyState } from "@/components/tls/PublicEmptyState";
import { LazyImg } from "@/components/tls/LazyImg";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { ArrowRight, Pin, Newspaper, Crown, Lock, Search, X } from "lucide-react";

const CATEGORY_COLORS = {
  club: "#29B6E8",
  tournaments: "#FFD700",
  events: "#9F7AEA",
  community: "#F59E0B",
  sponsors: "#FFD700",
  members: "#FFD700",
  teams: "#10B981",
  announcement: "#FF3B30",
  recap: "#6B7280",
  maintenance: "#6B7280",
};

const VIS_ICON = { members: Crown, internal: Lock, community: null, public: null };

export default function NewsPage() {
  useDocumentTitle("News", "Aktuelle News, Ergebnisse, Ankündigungen, Events und Turnier-Updates von THE LION SQUAD eSports aus Tirol.");
  const [searchParams, setSearchParams] = useSearchParams();
  const [list, setList] = useState([]);
  const [meta, setMeta] = useState({ categories: [], visibilities: [] });
  const [activeCat, setActiveCat] = useState(searchParams.get("category") || "");
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/news-meta").then(({ data }) => setMeta(data)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ compact: "true", limit: "90" });
    if (activeCat) params.set("category", activeCat);
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    api.get(`/news?${params.toString()}`).then(({ data }) => setList(data)).catch(() => {}).finally(() => setLoading(false));
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

  const pinned = list.filter((n) => n.pinned);
  const rest = list.filter((n) => !n.pinned);

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">VEREINS-NEWS</span>
        <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase">News & Ankündigungen</h1>
        <p className="mt-3 text-white/60 max-w-2xl">
          Alles was im Rudel passiert — von Turnier-Recaps über Eventankündigungen bis zu Vereinsthemen.
        </p>

        <div className="mt-8 space-y-4">
          <div className="relative max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => updateNewsFilters({ q: e.target.value })}
              placeholder="News suchen"
              data-testid="news-search"
              className="w-full rounded-sm border border-white/10 bg-[#0A0A0A] py-3 pl-10 pr-11 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-[#29B6E8]/60"
            />
            {hasSearch && (
              <button
                type="button"
                onClick={() => updateNewsFilters({ q: "" })}
                aria-label="Suche leeren"
                className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-sm text-white/45 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => updateNewsFilters({ category: "" })}
              data-testid="news-filter-all"
              className={`px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm transition ${!activeCat ? "bg-[#29B6E8] text-black" : "border border-white/10 text-white/60 hover:text-white"}`}
            >Alle</button>
            {meta.categories.map((c) => (
              <button
                key={c.k}
                onClick={() => updateNewsFilters({ category: c.k })}
                data-testid={`news-filter-${c.k}`}
                className={`px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm transition ${activeCat === c.k ? "bg-[#29B6E8] text-black" : "border border-white/10 text-white/60 hover:text-white"}`}
              >{c.l}</button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="mt-10 text-white/40 text-sm">Lade …</div>
        ) : list.length === 0 ? (
          <PublicEmptyState
            icon={Newspaper}
            eyebrow="News"
            title={hasSearch ? "Keine News gefunden" : activeCat ? "Keine News in dieser Kategorie" : "Noch keine News sichtbar"}
            description={hasSearch ? "Passe deine Suche an oder leere den Suchbegriff, um wieder alle passenden News zu sehen." : activeCat ? "Waehle eine andere Kategorie oder komm spaeter wieder, sobald neue Updates veroeffentlicht sind." : "Neue Ankuendigungen, Recaps und Vereinsupdates erscheinen hier automatisch."}
            primaryAction={hasSearch ? { label: "Suche leeren", onClick: () => updateNewsFilters({ q: "" }) } : activeCat ? { label: "Alle News", onClick: () => updateNewsFilters({ category: "" }) } : { to: "/events", label: "Events ansehen" }}
            secondaryAction={{ to: "/tournaments", label: "Turniere" }}
            className="mt-10"
          />
        ) : (
          <div className="mt-10 space-y-10">
            {pinned.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-widest text-[#FFD700]/80 font-bold mb-3 flex items-center gap-2">
                  <Pin className="w-3.5 h-3.5" /> Angepinnt
                </div>
                <div className="grid md:grid-cols-2 gap-5">
                  {pinned.map((n) => <NewsCard key={n.id} n={n} featured />)}
                </div>
              </div>
            )}
            <div>
              {pinned.length > 0 && <div className="text-[11px] uppercase tracking-widest text-white/40 font-bold mb-3">Aktuell</div>}
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
                {rest.map((n) => <NewsCard key={n.id} n={n} />)}
              </div>
            </div>
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

function NewsCard({ n, featured = false }) {
  const c = CATEGORY_COLORS[n.category] || "#29B6E8";
  const VIcon = VIS_ICON[n.visibility];
  return (
    <Link
      to={`/news/${n.slug}`}
      data-testid={`news-card-${n.slug}`}
      className={`group border border-white/10 hover:border-white/30 rounded-sm bg-[#121212] overflow-hidden flex flex-col transition ${featured ? "lg:col-span-1" : ""}`}
    >
      <div className="aspect-video bg-[#0A0A0A] overflow-hidden">
        {n.banner_url ? (
          <LazyImg src={n.banner_url} alt="" sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${c}33, #0A0A0A 48%, #121212)` }}>
            <Newspaper className="w-10 h-10 text-white/20" />
          </div>
        )}
        </div>
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold">
          <span style={{ color: c }}>{n.category}</span>
          {n.pinned && <Pin className="w-3 h-3 text-[#FFD700]" />}
          {VIcon && <VIcon className="w-3 h-3 text-[#FFD700]" />}
          <span className="text-white/30 ml-auto">{new Date(n.published_at || n.created_at).toLocaleDateString("de-DE")}</span>
        </div>
        <h3 className={`mt-2 font-heading font-black leading-tight break-words line-clamp-3 ${featured ? "text-xl md:text-2xl" : "text-lg"} group-hover:text-[#29B6E8] transition`}>
          {n.title}
        </h3>
        {n.excerpt && <p className="mt-2 text-sm text-white/65 line-clamp-3 flex-1">{n.excerpt}</p>}
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
          <span className="text-[10px] uppercase tracking-widest font-bold text-white/35">Beitrag</span>
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]">
            Weiterlesen <ArrowRight className="w-3 h-3" />
          </span>
        </div>
      </div>
    </Link>
  );
}
