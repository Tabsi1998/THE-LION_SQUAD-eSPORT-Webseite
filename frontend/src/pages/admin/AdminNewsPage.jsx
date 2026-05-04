import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

export default function AdminNewsPage() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ title: "", slug: "", excerpt: "", content: "", published: true });
  const load = async () => { const { data } = await api.get("/news?published_only=false"); setList(data); };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try { await api.post("/news", form); toast.success("Artikel veröffentlicht."); setForm({ title: "", slug: "", excerpt: "", content: "", published: true }); load(); }
    catch { toast.error("Fehler."); }
  };
  const del = async (id) => { if (!confirm("Löschen?")) return; await api.delete(`/news/${id}`); load(); };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">News</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Ankündigungen</h1>
      <div className="grid lg:grid-cols-3 gap-6">
        <form onSubmit={submit} className="lg:col-span-1 border border-white/10 rounded-sm bg-[#121212] p-5 space-y-3">
          <input required placeholder="Titel" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value, slug: form.slug || e.target.value.toLowerCase().replace(/\s+/g, "-") })} data-testid="news-title" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <input required placeholder="Slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} data-testid="news-slug" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <input placeholder="Kurzer Teaser" value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} data-testid="news-excerpt" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <textarea required placeholder="Inhalt" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={6} data-testid="news-content" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <button data-testid="news-submit" className="w-full px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Plus className="w-4 h-4" /> Veröffentlichen</button>
        </form>
        <div className="lg:col-span-2 space-y-3">
          {list.map((n) => (
            <div key={n.id} className="border border-white/10 rounded-sm bg-[#121212] p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{new Date(n.created_at).toLocaleDateString("de-DE")}</div>
                  <h3 className="font-heading text-lg font-bold">{n.title}</h3>
                  <p className="text-sm text-white/60 line-clamp-2 mt-1">{n.excerpt}</p>
                </div>
                <button onClick={() => del(n.id)} className="p-1 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
