import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { BracketTree } from "@/components/tls/BracketTree";
import { toast } from "sonner";
import { Zap, RefreshCw, Eye } from "lucide-react";

export default function AdminTournamentEditPage() {
  const { id } = useParams();
  const [t, setT] = useState(null);
  const [regs, setRegs] = useState([]);
  const [bracket, setBracket] = useState(null);
  const [tab, setTab] = useState("participants");

  const load = async () => {
    const { data } = await api.get(`/tournaments/${id}`);
    setT(data);
    const { data: r } = await api.get(`/tournaments/${id}/registrations`);
    setRegs(r);
    const { data: b } = await api.get(`/tournaments/${id}/bracket`);
    setBracket(b);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const generate = async () => {
    try {
      const { data } = await api.post(`/tournaments/${id}/generate-bracket`);
      toast.success(`Bracket mit ${data.match_count} Matches generiert.`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const reset = async () => {
    if (!confirm("Bracket wirklich zurücksetzen?")) return;
    await api.post(`/tournaments/${id}/reset-bracket`);
    toast.success("Bracket zurückgesetzt.");
    load();
  };
  const setRegStatus = async (rid, status) => {
    await api.patch(`/tournaments/${id}/registrations/${rid}`, { status });
    load();
  };
  const setTournStatus = async (status) => {
    await api.post(`/tournaments/${id}/status`, { status });
    toast.success(`Status: ${status}`);
    load();
  };

  if (!t) return <AdminLayout><div className="p-10 text-white/40">Lade…</div></AdminLayout>;

  return (
    <AdminLayout>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <Link to="/admin/tournaments" className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← Turniere</Link>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">{t.title}</h1>
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <StatusBadge status={t.status} />
            <span className="text-white/60 text-sm">{t.format?.replace("_", " ")}</span>
            <Link to={`/tournaments/${t.slug || t.id}`} target="_blank" className="text-[#29B6E8] text-xs uppercase tracking-wider font-bold hover:text-white inline-flex items-center gap-1"><Eye className="w-3 h-3" /> Public Seite</Link>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <select value={t.status} onChange={(e) => setTournStatus(e.target.value)} data-testid="admin-tr-status-select" className="bg-[#0A0A0A] border border-white/10 px-3 py-2 text-sm rounded-sm">
            {["draft", "registration_open", "check_in", "live", "paused", "completed", "archived"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button onClick={generate} data-testid="admin-tr-generate" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-sm hover:bg-[#1E95C2] inline-flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" /> Bracket generieren
          </button>
          <button onClick={reset} data-testid="admin-tr-reset" className="px-4 py-2 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm text-sm hover:border-[#FF3B30]/60 hover:text-[#FF3B30] inline-flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5" /> Reset
          </button>
          {t.format === "swiss" && (
            <button onClick={async()=>{ try{ const {data} = await api.post(`/tournaments/${id}/swiss/next-round`); toast.success(`Runde ${data.round} mit ${data.match_count} Matches generiert`); load(); }catch(e){ toast.error(e.response?.data?.detail||"Fehler"); } }} data-testid="admin-tr-swiss-next" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-sm">Swiss Runde</button>
          )}
          {t.format === "groups" && (
            <button onClick={async()=>{ const gc = prompt("Wie viele Gruppen?", "4"); if(!gc) return; try{ const {data} = await api.post(`/tournaments/${id}/groups/generate`,{group_count: parseInt(gc)}); toast.success(`${data.group_count} Gruppen mit ${data.match_count} Matches`); load(); }catch(e){ toast.error(e.response?.data?.detail||"Fehler"); } }} data-testid="admin-tr-groups" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-sm">Gruppen generieren</button>
          )}
          <div className="flex gap-1">
            <a href={`${process.env.REACT_APP_BACKEND_URL}/api/exports/tournaments/${t.id}/participants.pdf`} className="px-3 py-2 border border-white/20 text-white/80 text-xs uppercase font-bold rounded-sm hover:border-[#29B6E8]/40" target="_blank" rel="noreferrer">PDF Teilnehmer</a>
            <a href={`${process.env.REACT_APP_BACKEND_URL}/api/exports/tournaments/${t.id}/checkin.pdf`} className="px-3 py-2 border border-white/20 text-white/80 text-xs uppercase font-bold rounded-sm hover:border-[#29B6E8]/40" target="_blank" rel="noreferrer">PDF Check-in</a>
            <a href={`${process.env.REACT_APP_BACKEND_URL}/api/exports/tournaments/${t.id}/matches.pdf`} className="px-3 py-2 border border-white/20 text-white/80 text-xs uppercase font-bold rounded-sm hover:border-[#29B6E8]/40" target="_blank" rel="noreferrer">PDF Matches</a>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-5 border-b border-white/10">
        {["participants", "bracket", "matches", "edit"].map((s) => (
          <button
            key={s}
            data-testid={`admin-tr-tab-${s}`}
            onClick={() => setTab(s)}
            className={`px-4 py-3 text-xs font-bold uppercase tracking-wider ${tab === s ? "text-[#29B6E8] border-b-2 border-[#29B6E8]" : "text-white/60 hover:text-white"}`}
          >
            {s === "participants" ? "Teilnehmer" : s === "bracket" ? "Bracket" : s === "matches" ? "Matches" : "Bearbeiten"}
          </button>
        ))}
      </div>

      {tab === "participants" && (
        <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">#</th>
                <th className="text-left px-4 py-3">Spieler</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Discord</th>
                <th className="text-right px-4 py-3">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {regs.map((r, i) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-white/50">{i + 1}</td>
                  <td className="px-4 py-3">{r.display_name || r.user?.display_name || r.ingame_name}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-white/60">{r.discord || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <select value={r.status} onChange={(e) => setRegStatus(r.id, e.target.value)} data-testid={`admin-reg-status-${r.id}`} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 text-xs rounded-sm">
                      {["pending", "approved", "rejected", "waitlist", "checked_in"].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {regs.length === 0 && <tr><td colSpan="5" className="text-center py-10 text-white/40">Keine Anmeldungen</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "bracket" && bracket && (
        <div className="bg-[#0A0A0A] rounded-sm p-4 border border-white/10">
          {bracket.matches?.length === 0 ? (
            <div className="text-center py-16 text-white/40 font-display tracking-widest">BRACKET NICHT GENERIERT</div>
          ) : (
            <BracketTree data={bracket} />
          )}
        </div>
      )}

      {tab === "matches" && bracket?.matches && (
        <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Runde</th>
                <th className="text-left px-4 py-3">Teilnehmer A</th>
                <th className="text-left px-4 py-3">Teilnehmer B</th>
                <th className="text-center px-4 py-3">Score</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Aktion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {bracket.matches.map((m) => {
                const a = bracket.registrations.find((r) => r.id === m.participant_a_id);
                const b = bracket.registrations.find((r) => r.id === m.participant_b_id);
                return (
                  <tr key={m.id}>
                    <td className="px-4 py-3 text-white/70">{m.round_name || m.round}</td>
                    <td className="px-4 py-3">{a?.display_name || "TBD"}</td>
                    <td className="px-4 py-3">{b?.display_name || "TBD"}</td>
                    <td className="px-4 py-3 text-center font-display font-bold">{m.score_a} : {m.score_b}</td>
                    <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link to={`/matches/${m.id}`} className="text-[#29B6E8] text-xs font-bold uppercase hover:text-white">Öffnen →</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {tab === "edit" && (
        <TournamentEditForm tournament={t} onSaved={load} />
      )}
    </AdminLayout>
  );
}

function TournamentEditForm({ tournament, onSaved }) {
  const [f, setF] = useState({
    title: tournament.title || "",
    description: tournament.description || "",
    rules: tournament.rules || "",
    prize_pool: tournament.prize_pool || "",
    banner_url: tournament.banner_url || "",
    stream_link: tournament.stream_link || "",
    discord_link: tournament.discord_link || "",
    location: tournament.location || "",
    max_participants: tournament.max_participants || 16,
    best_of: tournament.best_of || 1,
    bronze_match: !!tournament.bronze_match,
    is_public: tournament.is_public !== false,
  });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    try {
      await api.patch(`/tournaments/${tournament.id}`, f);
      toast.success("Gespeichert.");
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || "Fehler"); }
  };
  return (
    <div className="max-w-2xl space-y-3 border border-white/10 bg-[#121212] rounded-sm p-5">
      <Fld label="Titel" value={f.title} onChange={(v)=>set("title",v)} testId="tr-edit-title"/>
      <Fld label="Banner URL" value={f.banner_url} onChange={(v)=>set("banner_url",v)} testId="tr-edit-banner"/>
      <Fld label="Location" value={f.location} onChange={(v)=>set("location",v)} testId="tr-edit-location"/>
      <Fld label="Stream Link" value={f.stream_link} onChange={(v)=>set("stream_link",v)} testId="tr-edit-stream"/>
      <Fld label="Discord Link" value={f.discord_link} onChange={(v)=>set("discord_link",v)} testId="tr-edit-discord"/>
      <div className="grid grid-cols-2 gap-3">
        <Fld label="Max Teilnehmer" type="number" value={f.max_participants} onChange={(v)=>set("max_participants",Number(v))} testId="tr-edit-max"/>
        <Fld label="Best of" type="number" value={f.best_of} onChange={(v)=>set("best_of",Number(v))} testId="tr-edit-bo"/>
      </div>
      <Txt label="Beschreibung" value={f.description} onChange={(v)=>set("description",v)} testId="tr-edit-desc"/>
      <Txt label="Regeln" value={f.rules} onChange={(v)=>set("rules",v)} testId="tr-edit-rules"/>
      <Txt label="Preise" value={f.prize_pool} onChange={(v)=>set("prize_pool",v)} testId="tr-edit-prizes"/>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.bronze_match} onChange={(e)=>set("bronze_match",e.target.checked)} className="accent-[#29B6E8]"/><span>Bronze Match</span></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_public} onChange={(e)=>set("is_public",e.target.checked)} className="accent-[#29B6E8]"/><span>Öffentlich</span></label>
      <button onClick={save} data-testid="tr-edit-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Speichern</button>
    </div>
  );
}
function Fld({ label, value, onChange, type="text", testId }) {
  return (<label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div><input type={type} value={value ?? ""} onChange={(e)=>onChange(e.target.value)} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"/></label>);
}
function Txt({ label, value, onChange, testId }) {
  return (<label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div><textarea rows={3} value={value ?? ""} onChange={(e)=>onChange(e.target.value)} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"/></label>);
}
