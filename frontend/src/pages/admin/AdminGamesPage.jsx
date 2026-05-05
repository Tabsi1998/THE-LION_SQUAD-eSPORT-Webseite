import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

const slugFrom = (txt) => (txt || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/ß/g, "ss")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "")
  .slice(0, 80);

export default function AdminGamesPage() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ name: "", slug: "", short_name: "", genre: "", platforms: "", cover_url: "" });
  const load = async () => { const { data } = await api.get("/games"); setList(data); };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/games", {
        ...form,
        platforms: form.platforms ? form.platforms.split(",").map((s) => s.trim()) : [],
      });
      toast.success("Spiel erstellt.");
      setForm({ name: "", slug: "", short_name: "", genre: "", platforms: "", cover_url: "" });
      load();
    } catch { toast.error("Fehler."); }
  };

  const del = async (id) => {
    if (!confirm("Spiel löschen?")) return;
    await api.delete(`/games/${id}`);
    load();
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Games</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Spiele</h1>

      <div className="grid lg:grid-cols-3 gap-6">
        <form onSubmit={submit} className="lg:col-span-1 border border-white/10 rounded-sm bg-[#121212] p-5 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Neues Spiel</div>
          <Input placeholder="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v, slug: form.slug || slugFrom(v) })} required testId="game-name" />
          <Input placeholder="Slug" value={form.slug} onChange={(v) => setForm({ ...form, slug: slugFrom(v) })} required testId="game-slug" />
          <Input placeholder="Kurzname (z.B. MK8DX)" value={form.short_name} onChange={(v) => setForm({ ...form, short_name: v })} testId="game-short" />
          <Input placeholder="Genre" value={form.genre} onChange={(v) => setForm({ ...form, genre: v })} testId="game-genre" />
          <Input placeholder="Plattformen (komma-getrennt)" value={form.platforms} onChange={(v) => setForm({ ...form, platforms: v })} testId="game-platforms" />
          <ImageUpload value={form.cover_url} onChange={(v) => setForm({ ...form, cover_url: v })} label="Cover" testId="game-cover" variant="wide" allowLibrary />
          <button data-testid="game-submit" className="w-full px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] inline-flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" /> Anlegen
          </button>
        </form>
        <div className="lg:col-span-2 border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr><th className="text-left px-4 py-3">Name</th><th className="text-left px-4 py-3">Slug</th><th className="text-left px-4 py-3">Genre</th><th></th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {list.map((g) => (
                <tr key={g.id}>
                  <td className="px-4 py-3">{g.name}</td>
                  <td className="px-4 py-3 text-white/60">{g.slug}</td>
                  <td className="px-4 py-3 text-white/60">{g.genre || "—"}</td>
                  <td className="px-4 py-3 text-right"><button onClick={() => del(g.id)} className="p-1 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}

function Input({ value, onChange, placeholder, required, testId }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} required={required} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white focus:outline-none text-sm" />;
}
