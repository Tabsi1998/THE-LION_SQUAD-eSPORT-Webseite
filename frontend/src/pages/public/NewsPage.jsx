import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";

export default function NewsPage() {
  const [list, setList] = useState([]);
  useEffect(() => { api.get("/news").then(({ data }) => setList(data)); }, []);
  return (
    <PublicLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">News</span>
        <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase">Ankündigungen</h1>
        <div className="mt-10 space-y-6">
          {list.map((n) => (
            <article key={n.id} data-testid={`news-article-${n.slug}`} className="border border-white/10 rounded-sm p-6 bg-[#121212]">
              <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">
                {new Date(n.created_at).toLocaleDateString("de-DE", { dateStyle: "long" })}
              </div>
              <h2 className="mt-2 font-heading text-2xl md:text-3xl font-bold">{n.title}</h2>
              {n.excerpt && <p className="mt-2 text-white/70">{n.excerpt}</p>}
              <p className="mt-4 text-white/80 whitespace-pre-line">{n.content}</p>
            </article>
          ))}
          {list.length === 0 && <div className="text-center py-16 text-white/40 font-display tracking-widest">KEINE NEWS</div>}
        </div>
      </div>
    </PublicLayout>
  );
}
