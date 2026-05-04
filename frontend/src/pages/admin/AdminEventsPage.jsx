import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export default function AdminEventsPage() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ name: "", slug: "", description: "", location: "", start_date: "", end_date: "" });
  const load = async () => { const { data } = await api.get("/events"); setList(data); };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form };
      if (!payload.start_date) delete payload.start_date;
      if (!payload.end_date) delete payload.end_date;
      await api.post("/events", payload);
      toast.success("Event erstellt.");
      setForm({ name: "", slug: "", description: "", location: "", start_date: "", end_date: "" });
      load();
    } catch { toast.error("Fehler."); }
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Events</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Events</h1>
      <div className="grid lg:grid-cols-3 gap-6">
        <form onSubmit={submit} className="lg:col-span-1 border border-white/10 rounded-sm bg-[#121212] p-5 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Neues Event</div>
          <input required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || e.target.value.toLowerCase().replace(/\s+/g, "-") })} data-testid="ev-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <input required placeholder="Slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} data-testid="ev-slug" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <textarea placeholder="Beschreibung" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} data-testid="ev-desc" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} data-testid="ev-location" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <input type="datetime-local" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} data-testid="ev-start" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <input type="datetime-local" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} data-testid="ev-end" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <button data-testid="ev-submit" className="w-full px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Plus className="w-4 h-4" /> Anlegen</button>
        </form>
        <div className="lg:col-span-2 space-y-3">
          {list.map((e) => (
            <div key={e.id} className="border border-white/10 rounded-sm bg-[#121212] p-4">
              <div className="font-heading text-lg font-bold">{e.name}</div>
              <div className="text-xs text-white/50 mt-1">{e.location || "—"} · {e.start_date ? new Date(e.start_date).toLocaleString("de-DE") : "Kein Datum"}</div>
              {e.description && <div className="text-sm text-white/70 mt-2 line-clamp-2">{e.description}</div>}
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
