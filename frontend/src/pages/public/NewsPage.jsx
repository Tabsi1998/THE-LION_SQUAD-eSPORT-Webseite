import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Pin, Newspaper, Crown, Lock } from "lucide-react";

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
  const [list, setList] = useState([]);
  const [meta, setMeta] = useState({ categories: [], visibilities: [] });
  const [activeCat, setActiveCat] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/news-meta").then(({ data }) => setMeta(data)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const url = activeCat ? `/news?category=${activeCat}` : "/news";
    api.get(url).then(({ data }) => setList(data)).catch(() => {}).finally(() => setLoading(false));
  }, [activeCat]);

  useEffect(() => {
    load();
  }, [load]);

  useApiInvalidation(load, ["news"]);

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

        <div className="mt-8 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveCat("")}
            data-testid="news-filter-all"
            className={`px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm transition ${!activeCat ? "bg-[#29B6E8] text-black" : "border border-white/10 text-white/60 hover:text-white"}`}
          >Alle</button>
          {meta.categories.map((c) => (
            <button
              key={c.k}
              onClick={() => setActiveCat(c.k)}
              data-testid={`news-filter-${c.k}`}
              className={`px-4 py-2 text-xs uppercase tracking-wider font-bold rounded-sm transition ${activeCat === c.k ? "bg-[#29B6E8] text-black" : "border border-white/10 text-white/60 hover:text-white"}`}
            >{c.l}</button>
          ))}
        </div>

        {loading ? (
          <div className="mt-10 text-white/40 text-sm">Lade …</div>
        ) : list.length === 0 ? (
          <div className="mt-10 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            <Newspaper className="w-10 h-10 mx-auto opacity-40 mb-3" />
            <div className="font-heading font-bold text-lg">Keine News</div>
            <div className="text-sm mt-1">In dieser Kategorie liegen aktuell keine News vor.</div>
          </div>
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
      {n.banner_url && (
        <div className="aspect-video bg-[#0A0A0A] overflow-hidden">
          <img src={resolveMediaUrl(n.banner_url)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
        </div>
      )}
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold">
          <span style={{ color: c }}>{n.category}</span>
          {n.pinned && <Pin className="w-3 h-3 text-[#FFD700]" />}
          {VIcon && <VIcon className="w-3 h-3 text-[#FFD700]" />}
          <span className="text-white/30 ml-auto">{new Date(n.created_at).toLocaleDateString("de-DE")}</span>
        </div>
        <h3 className={`mt-2 font-heading font-black ${featured ? "text-2xl" : "text-lg"} group-hover:text-[#29B6E8] transition`}>
          {n.title}
        </h3>
        {n.excerpt && <p className="mt-2 text-sm text-white/65 line-clamp-3 flex-1">{n.excerpt}</p>}
      </div>
    </Link>
  );
}
