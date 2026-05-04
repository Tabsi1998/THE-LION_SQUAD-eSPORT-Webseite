import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Pin, ArrowLeft, Newspaper, Crown } from "lucide-react";

export default function MemberNewsPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/news?visibility=members").then(({ data }) => {
      // backend doesn't filter visibility query; we filter client-side
      setList(data.filter((n) => n.visibility === "members" || n.visibility === "internal"));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <PublicLayout>
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link to="/members/area" className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-white/50 hover:text-[#FFD700]">
          <ArrowLeft className="w-3.5 h-3.5" /> Mitgliederbereich
        </Link>
        <span className="mt-6 text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700] flex items-center gap-1.5"><Crown className="w-3 h-3" /> EXKLUSIV</span>
        <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">Interne News</h1>
        <p className="mt-3 text-white/60 max-w-2xl">
          Vereinsinterne Ankündigungen, Vorstandsmitteilungen und Mitglieder-Nachrichten — nur für offizielle Vereinsmitglieder.
        </p>

        {loading ? (
          <div className="mt-10 text-white/40 text-sm">Lade …</div>
        ) : list.length === 0 ? (
          <div className="mt-10 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            <Newspaper className="w-10 h-10 mx-auto opacity-40 mb-3" />
            <div className="font-heading font-bold text-lg">Keine internen News</div>
            <div className="text-sm mt-1">Aktuell gibt es keine vereinsinternen Beiträge.</div>
          </div>
        ) : (
          <div className="mt-10 space-y-3">
            {list.map((n) => (
              <Link
                key={n.id}
                to={`/news/${n.slug}`}
                data-testid={`member-news-${n.slug}`}
                className="block border border-[#FFD700]/15 hover:border-[#FFD700]/40 rounded-sm bg-[#121212] p-5 transition group"
              >
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold">
                  <span className="text-[#FFD700]">{n.category}</span>
                  {n.pinned && <Pin className="w-3 h-3 text-[#FFD700]" />}
                  <span className="text-white/30 ml-auto">{new Date(n.created_at).toLocaleDateString("de-DE")}</span>
                </div>
                <h3 className="mt-2 font-heading font-black text-xl group-hover:text-[#FFD700] transition">{n.title}</h3>
                {n.excerpt && <p className="mt-2 text-sm text-white/65 line-clamp-2">{n.excerpt}</p>}
              </Link>
            ))}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}
