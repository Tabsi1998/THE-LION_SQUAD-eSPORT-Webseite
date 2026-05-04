import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

export default function AdminSeasonsPage() {
  const [list, setList] = useState([]);
  const [games, setGames] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [form, setForm] = useState({ name: "", slug: "", kind: "season", description: "", tournament_ids: [], f1_challenge_ids: [], drop_worst: 0, points_per_position: "25,18,15,12,10,8,6,4,2,1" });

  const load = async () => {
    const [s, g, t, c] = await Promise.all([
      api.get("/seasons"), api.get("/games"), api.get("/tournaments"), api.get("/f1/challenges"),
    ]);
    setList(s.data); setGames(g.data); setTournaments(t.data); setChallenges(c.data);
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...form,
        points_per_position: form.points_per_position.split(",").map((x)=>parseInt(x.trim()) || 0).filter((x)=>x>0),
        drop_worst: parseInt(form.drop_worst) || 0,
      };
      await api.post("/seasons", payload);
      toast.success("Saison erstellt.");
      setForm({ name: "", slug: "", kind: "season", description: "", tournament_ids: [], f1_challenge_ids: [], drop_worst: 0, points_per_position: "25,18,15,12,10,8,6,4,2,1" });
      load();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  const toggleTournament = (id) => {
    setForm(f => ({ ...f, tournament_ids: f.tournament_ids.includes(id) ? f.tournament_ids.filter(x=>x!==id) : [...f.tournament_ids, id] }));
  };
  const toggleF1 = (id) => {
    setForm(f => ({ ...f, f1_challenge_ids: f.f1_challenge_ids.includes(id) ? f.f1_challenge_ids.filter(x=>x!==id) : [...f.f1_challenge_ids, id] }));
  };

  const del = async (id) => {
    if (!confirm("Saison löschen?")) return;
    await api.delete(`/seasons/${id}`); load();
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Circuit</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Saisons / Circuits</h1>
      <div className="grid lg:grid-cols-2 gap-6">
        <form onSubmit={submit} className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Neue Saison / Circuit</div>
          <input required placeholder="Name" value={form.name} onChange={(e)=>setForm({...form, name: e.target.value, slug: form.slug || e.target.value.toLowerCase().replace(/\s+/g,"-")})} data-testid="season-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"/>
          <input required placeholder="Slug" value={form.slug} onChange={(e)=>setForm({...form, slug: e.target.value})} data-testid="season-slug" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"/>
          <select value={form.kind} onChange={(e)=>setForm({...form, kind: e.target.value})} data-testid="season-kind" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
            <option value="season">Saison</option><option value="circuit">Circuit</option>
          </select>
          <textarea placeholder="Beschreibung" value={form.description} onChange={(e)=>setForm({...form, description: e.target.value})} rows={2} data-testid="season-desc" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"/>
          <input placeholder="Punkteformel (z.B. 25,18,15,...)" value={form.points_per_position} onChange={(e)=>setForm({...form, points_per_position: e.target.value})} data-testid="season-points" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono"/>
          <input type="number" placeholder="Streichresultate (drop_worst)" value={form.drop_worst} onChange={(e)=>setForm({...form, drop_worst: e.target.value})} data-testid="season-drop" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"/>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Turniere einbeziehen</div>
            <div className="max-h-48 overflow-y-auto border border-white/10 rounded-sm p-2 space-y-1 bg-[#0A0A0A]">
              {tournaments.map((t)=>(
                <label key={t.id} className="flex items-center gap-2 text-sm hover:bg-white/5 px-2 py-1 rounded-sm">
                  <input type="checkbox" checked={form.tournament_ids.includes(t.id)} onChange={()=>toggleTournament(t.id)} className="accent-[#29B6E8]"/>
                  <span className="truncate">{t.title}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">F1 Challenges einbeziehen</div>
            <div className="max-h-32 overflow-y-auto border border-white/10 rounded-sm p-2 space-y-1 bg-[#0A0A0A]">
              {challenges.map((c)=>(
                <label key={c.id} className="flex items-center gap-2 text-sm hover:bg-white/5 px-2 py-1 rounded-sm">
                  <input type="checkbox" checked={form.f1_challenge_ids.includes(c.id)} onChange={()=>toggleF1(c.id)} className="accent-[#29B6E8]"/>
                  <span className="truncate">{c.title}</span>
                </label>
              ))}
            </div>
          </div>
          <button data-testid="season-submit" className="w-full px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Plus className="w-4 h-4"/> Anlegen</button>
        </form>
        <div className="space-y-3">
          {list.map((s)=>(
            <div key={s.id} className="border border-white/10 bg-[#121212] rounded-sm p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">{s.kind} · {s.status}</div>
                  <h3 className="font-heading text-lg font-bold">{s.name}</h3>
                  <div className="text-xs text-white/50">Turniere: {s.tournament_ids?.length || 0} · F1: {s.f1_challenge_ids?.length || 0}</div>
                </div>
                <div className="flex gap-2">
                  <Link to={`/seasons/${s.slug}`} target="_blank" className="text-[#29B6E8] text-xs uppercase font-bold hover:text-white">Public →</Link>
                  <button onClick={()=>del(s.id)} className="p-1 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4"/></button>
                </div>
              </div>
            </div>
          ))}
          {list.length === 0 && <div className="text-center py-10 text-white/40 font-display tracking-widest">KEINE SAISONS</div>}
        </div>
      </div>
    </AdminLayout>
  );
}
