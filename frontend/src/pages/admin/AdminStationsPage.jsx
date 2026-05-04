import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function AdminStationsPage() {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ name: "", device_type: "switch", notes: "" });

  const load = async () => { const { data } = await api.get("/stations"); setList(data); };
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    try { await api.post("/stations", form); toast.success("Station angelegt."); setForm({ name: "", device_type: "switch", notes: "" }); load(); }
    catch { toast.error("Fehler."); }
  };
  const updateStatus = async (id, status) => { await api.patch(`/stations/${id}`, { status }); load(); };
  const del = async (id) => { if (!confirm("Löschen?")) return; await api.delete(`/stations/${id}`); load(); };

  const devices = [["switch", "Switch"], ["switch2", "Switch 2"], ["pc", "PC"], ["racing_rig", "Racing Rig"], ["beamer", "Beamer"], ["stream_setup", "Stream"], ["admin_desk", "Admin Desk"]];

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Event Setup</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Stationen</h1>
      <div className="grid lg:grid-cols-3 gap-6">
        <form onSubmit={create} className="lg:col-span-1 border border-white/10 rounded-sm bg-[#121212] p-5 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Neue Station</div>
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="station-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <select value={form.device_type} onChange={(e) => setForm({ ...form, device_type: e.target.value })} data-testid="station-device" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
            {devices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input placeholder="Notiz" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="station-notes" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <button data-testid="station-submit" className="w-full px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Plus className="w-4 h-4" /> Anlegen</button>
        </form>
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {list.map((s) => (
            <div key={s.id} className="border border-white/10 rounded-sm bg-[#121212] p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{s.device_type}</div>
                  <div className="font-heading text-lg font-bold">{s.name}</div>
                </div>
                <button onClick={() => del(s.id)} className="p-1 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={s.status} />
                <select value={s.status} onChange={(e) => updateStatus(s.id, e.target.value)} data-testid={`station-status-${s.id}`} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs">
                  {["free", "busy", "broken", "reserved"].map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>
              {s.notes && <div className="mt-2 text-white/50 text-xs">{s.notes}</div>}
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
