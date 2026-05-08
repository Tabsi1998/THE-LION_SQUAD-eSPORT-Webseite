import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { API, api, formatApiError, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { BracketTree } from "@/components/tls/BracketTree";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { normalizeDateTimeFields, toDateTimeLocalInput } from "@/lib/datetime";
import { toast } from "sonner";
import { Zap, RefreshCw, Eye } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm, usePrompt } from "@/components/tls/ConfirmDialog";

const TOURNAMENT_STATUS_OPTIONS = [
  ["draft", "Entwurf"],
  ["scheduled", "Angekündigt"],
  ["registration_open", "Anmeldung offen"],
  ["registration_closed", "Anmeldung geschlossen"],
  ["check_in", "Check-in offen"],
  ["live", "Live"],
  ["paused", "Pausiert"],
  ["completed", "Beendet"],
  ["results_published", "Ergebnisse veröffentlicht"],
  ["archived", "Archiviert"],
  ["cancelled", "Abgesagt"],
];

export default function AdminTournamentEditPage() {
  const { isAdmin, isModerator } = useAuth();
  const { id } = useParams();
  const [t, setT] = useState(null);
  const [regs, setRegs] = useState([]);
  const [bracket, setBracket] = useState(null);
  const [tab, setTab] = useState("participants");
  const [groups, setGroups] = useState([]);
  const confirm = useConfirm();
  const prompt = usePrompt();

  const load = useCallback(async () => {
    const { data } = await api.get(`/tournaments/${id}`);
    setT(data);
    const { data: r } = await api.get(`/tournaments/${id}/registrations`);
    setRegs(r);
    const { data: b } = await api.get(`/tournaments/${id}/bracket`);
    setBracket(b);
    if (data.format === "groups") {
      try { const { data: g } = await api.get(`/tournaments/${id}/groups`); setGroups(g || []); }
      catch { setGroups([]); }
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["tournaments", "matches", "stations"]);

  const generate = async () => {
    try {
      const { data } = await api.post(`/tournaments/${id}/generate-bracket`);
      toast.success(`Bracket mit ${data.match_count} Matches generiert.`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const reset = async () => {
    if (!await confirm({
      title: "Bracket zurücksetzen?",
      description: "Alle generierten Bracket-Daten werden zurückgesetzt. Diese Aktion ist für laufende Turniere kritisch.",
      confirmLabel: "Zurücksetzen",
    })) return;
    try {
      await api.post(`/tournaments/${id}/reset-bracket`);
      toast.success("Bracket zurückgesetzt.");
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Bracket konnte nicht zurueckgesetzt werden."));
    }
  };
  const setRegStatus = async (rid, status) => {
    try {
      await api.patch(`/tournaments/${id}/registrations/${rid}`, { status });
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Teilnehmerstatus konnte nicht gespeichert werden."));
    }
  };
  const setTournStatus = async (status) => {
    try {
      await api.post(`/tournaments/${id}/status`, { status });
      toast.success(`Status: ${status}`);
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Turnierstatus konnte nicht gespeichert werden."));
    }
  };
  const updateMatchResult = async (m, scoreA, scoreB, winnerId) => {
    try {
      await api.patch(`/matches/${m.id}`, {
        score_a: Number(scoreA) || 0,
        score_b: Number(scoreB) || 0,
        winner_id: winnerId || null,
        status: winnerId ? "completed" : "waiting_result",
      });
      toast.success("Ergebnis gespeichert.");
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const generateGroups = async () => {
    const gc = await prompt({
      title: "Gruppen generieren",
      description: "Wie viele Gruppen sollen erstellt werden?",
      defaultValue: "4",
      placeholder: "4",
      confirmLabel: "Generieren",
      tone: "info",
      multiline: false,
      required: true,
    });
    if (!gc) return;
    const groupCount = parseInt(gc, 10);
    if (!Number.isFinite(groupCount) || groupCount < 1) {
      toast.error("Bitte eine gültige Gruppenanzahl eingeben.");
      return;
    }
    try {
      const { data } = await api.post(`/tournaments/${id}/groups/generate`, { group_count: groupCount });
      toast.success(`${data.group_count} Gruppen mit ${data.match_count} Matches`);
      load();
    } catch (e) {
      toast.error(formatRequestError(e, "Gruppen konnten nicht generiert werden."));
    }
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
          {isAdmin && (
            <div>
              <select value={t.status} onChange={(e) => setTournStatus(e.target.value)} data-testid="admin-tr-status-select" className="bg-[#0A0A0A] border border-white/10 px-3 py-2 text-sm rounded-sm">
                {TOURNAMENT_STATUS_OPTIONS.map(([s, label]) => <option key={s} value={s}>{label}</option>)}
              </select>
              <div className="mt-1 text-[10px] text-white/40">Manuell nur für Ausnahmen; Zeitplan automatisiert.</div>
            </div>
          )}
          {isAdmin && <button onClick={generate} data-testid="admin-tr-generate" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-sm hover:bg-[#1E95C2] inline-flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" /> Bracket generieren
          </button>}
          {isAdmin && <button onClick={reset} data-testid="admin-tr-reset" className="px-4 py-2 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm text-sm hover:border-[#FF3B30]/60 hover:text-[#FF3B30] inline-flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5" /> Reset
          </button>}
          {isAdmin && t.format === "swiss" && (
            <button onClick={async()=>{ try{ const {data} = await api.post(`/tournaments/${id}/swiss/next-round`); toast.success(`Runde ${data.round} mit ${data.match_count} Matches generiert`); load(); }catch(e){ toast.error(formatRequestError(e, "Swiss-Runde konnte nicht generiert werden.")); } }} data-testid="admin-tr-swiss-next" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-sm">Swiss Runde</button>
          )}
          {isAdmin && t.format === "groups" && (
            <button onClick={generateGroups} data-testid="admin-tr-groups" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-sm">Gruppen generieren</button>
          )}
          <div className="flex gap-1">
            <a href={`${API}/exports/tournaments/${t.id}/participants.pdf`} className="px-3 py-2 border border-white/20 text-white/80 text-xs uppercase font-bold rounded-sm hover:border-[#29B6E8]/40" target="_blank" rel="noreferrer">PDF Teilnehmer</a>
            <a href={`${API}/exports/tournaments/${t.id}/checkin.pdf`} className="px-3 py-2 border border-white/20 text-white/80 text-xs uppercase font-bold rounded-sm hover:border-[#29B6E8]/40" target="_blank" rel="noreferrer">PDF Check-in</a>
            <a href={`${API}/exports/tournaments/${t.id}/matches.pdf`} className="px-3 py-2 border border-white/20 text-white/80 text-xs uppercase font-bold rounded-sm hover:border-[#29B6E8]/40" target="_blank" rel="noreferrer">PDF Matches</a>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-5 border-b border-white/10 overflow-x-auto">
        {["participants", "bracket", "matches", ...(t.format === "groups" ? ["groups"] : []), "edit"].map((s) => (
          <button
            key={s}
            data-testid={`admin-tr-tab-${s}`}
            onClick={() => setTab(s)}
            className={`px-4 py-3 text-xs font-bold uppercase tracking-wider whitespace-nowrap ${tab === s ? "text-[#29B6E8] border-b-2 border-[#29B6E8]" : "text-white/60 hover:text-white"}`}
          >
            {s === "participants" ? "Teilnehmer" : s === "bracket" ? "Bracket" : s === "matches" ? "Matches" : s === "groups" ? "Gruppen" : "Bearbeiten"}
          </button>
        ))}
      </div>

      {tab === "participants" && (
        <div className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
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
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
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
                      <div className="flex flex-col items-end gap-2">
                        {isModerator && a && b && (
                          <MatchResultControls match={m} a={a} b={b} onSave={updateMatchResult} />
                        )}
                        <Link to={`/matches/${m.id}`} className="text-[#29B6E8] text-xs font-bold uppercase hover:text-white">Öffnen →</Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
      {tab === "edit" && (
        <TournamentEditForm key={t.updated_at || t.id} tournament={t} onSaved={load} />
      )}
      {tab === "groups" && (
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {groups.map((g) => (
            <div key={g.id} className="border border-white/10 rounded-sm bg-[#121212] p-4">
              <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">Gruppe</div>
              <h3 className="font-heading text-lg font-bold">{g.name}</h3>
              <div className="mt-3 space-y-1.5">
                {(g.participant_ids || []).map((pid) => {
                  const r = bracket?.registrations.find((x) => x.id === pid);
                  return <div key={pid} className="text-sm text-white/80 truncate">{r?.display_name || "—"}</div>;
                })}
              </div>
            </div>
          ))}
          {groups.length === 0 && <div className="col-span-full text-center py-10 text-white/40">Noch keine Gruppen. Oben "Gruppen generieren" klicken.</div>}
        </div>
      )}
    </AdminLayout>
  );
}

function TournamentEditForm({ tournament, onSaved }) {
  const dt = toDateTimeLocalInput;
  const [f, setF] = useState({
    title: tournament.title || "",
    description: tournament.description || "",
    rules: tournament.rules || "",
    prize_pool: tournament.prize_pool || "",
    prize_places: tournament.prize_places || [],
    banner_url: tournament.banner_url || "",
    stream_link: tournament.stream_link || "",
    discord_link: tournament.discord_link || "",
    location: tournament.location || "",
    registration_enabled: tournament.registration_enabled !== false,
    is_invite_only: !!tournament.is_invite_only,
    registration_open_from: dt(tournament.registration_open_from),
    registration_open_until: dt(tournament.registration_open_until),
    check_in_from: dt(tournament.check_in_from),
    check_in_until: dt(tournament.check_in_until),
    start_date: dt(tournament.start_date),
    end_date: dt(tournament.end_date),
    max_participants: tournament.max_participants || 16,
    best_of: tournament.best_of || 1,
    bronze_match: !!tournament.bronze_match,
    is_public: tournament.is_public !== false,
  });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    try {
      const payload = { ...f };
      normalizeDateTimeFields(payload, ["registration_open_from", "registration_open_until", "check_in_from", "check_in_until", "start_date", "end_date"]);
      payload.prize_places = (payload.prize_places || [])
        .filter((p) => p.value && String(p.value).trim())
        .map((p) => ({ place: p.place === "last" ? "last" : Number(p.place) || 0, label: p.label || (p.place === "last" ? "Letzter Platz" : `Platz ${p.place}`), value: p.value }));
      if (payload.prize_places.length === 0) payload.prize_places = null;
      await api.patch(`/tournaments/${tournament.id}`, payload);
      toast.success("Gespeichert.");
      onSaved();
    } catch (e) { toast.error(formatRequestError(e, "Turnier konnte nicht gespeichert werden.", { title: f.title })); }
  };
  return (
    <div className="max-w-2xl space-y-3 border border-white/10 bg-[#121212] rounded-sm p-5">
      <Fld label="Titel" value={f.title} onChange={(v)=>set("title",v)} testId="tr-edit-title"/>
      <ImageUpload value={f.banner_url} onChange={(v)=>set("banner_url",v)} label="Turnier-Banner" testId="tr-edit-banner-upload" variant="wide" allowLibrary />
      <Fld label="Location" value={f.location} onChange={(v)=>set("location",v)} testId="tr-edit-location"/>
      <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4 space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Zeitplan & Anmeldung</div>
        <div className="grid md:grid-cols-2 gap-3">
          <Fld label="Start Event/Turnier" type="datetime-local" value={f.start_date} onChange={(v)=>set("start_date",v)} testId="tr-edit-start"/>
          <Fld label="Ende Event/Turnier" type="datetime-local" value={f.end_date} onChange={(v)=>set("end_date",v)} testId="tr-edit-end"/>
          <Fld label="Anmeldung öffnet" type="datetime-local" value={f.registration_open_from} onChange={(v)=>set("registration_open_from",v)} testId="tr-edit-reg-from"/>
          <Fld label="Anmeldung endet" type="datetime-local" value={f.registration_open_until} onChange={(v)=>set("registration_open_until",v)} testId="tr-edit-reg-until"/>
          <Fld label="Check-in öffnet" type="datetime-local" value={f.check_in_from} onChange={(v)=>set("check_in_from",v)} testId="tr-edit-checkin-from"/>
          <Fld label="Check-in endet" type="datetime-local" value={f.check_in_until} onChange={(v)=>set("check_in_until",v)} testId="tr-edit-checkin-until"/>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="flex items-start gap-2 text-sm text-white/75"><input type="checkbox" checked={f.registration_enabled} onChange={(e)=>set("registration_enabled",e.target.checked)} className="accent-[#29B6E8] mt-1"/><span>Öffentliche Anmeldung erlauben</span></label>
          <label className="flex items-start gap-2 text-sm text-white/75"><input type="checkbox" checked={f.is_invite_only} onChange={(e)=>set("is_invite_only",e.target.checked)} className="accent-[#29B6E8] mt-1"/><span>Nur Einladung/manuelle Teilnehmer</span></label>
        </div>
      </div>
      <Fld label="Stream Link" value={f.stream_link} onChange={(v)=>set("stream_link",v)} testId="tr-edit-stream"/>
      <Fld label="Discord Link" value={f.discord_link} onChange={(v)=>set("discord_link",v)} testId="tr-edit-discord"/>
      <div className="grid grid-cols-2 gap-3">
        <Fld label="Max Teilnehmer" type="number" value={f.max_participants} onChange={(v)=>set("max_participants",Number(v))} testId="tr-edit-max"/>
        <Fld label="Best of" type="number" value={f.best_of} onChange={(v)=>set("best_of",Number(v))} testId="tr-edit-bo"/>
      </div>
      <Txt label="Beschreibung" value={f.description} onChange={(v)=>set("description",v)} testId="tr-edit-desc"/>
      <Txt label="Regeln" value={f.rules} onChange={(v)=>set("rules",v)} testId="tr-edit-rules"/>
      <PrizeEditor value={f.prize_places} onChange={(v)=>set("prize_places", v)} />
      <Txt label="Preise" value={f.prize_pool} onChange={(v)=>set("prize_pool",v)} testId="tr-edit-prizes"/>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.bronze_match} onChange={(e)=>set("bronze_match",e.target.checked)} className="accent-[#29B6E8]"/><span>Bronze Match</span></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_public} onChange={(e)=>set("is_public",e.target.checked)} className="accent-[#29B6E8]"/><span>Öffentlich</span></label>
      <button onClick={save} data-testid="tr-edit-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Speichern</button>
    </div>
  );
}

function MatchResultControls({ match, a, b, onSave }) {
  const [scoreA, setScoreA] = useState(match.score_a ?? 0);
  const [scoreB, setScoreB] = useState(match.score_b ?? 0);
  const winnerId = Number(scoreA) > Number(scoreB)
    ? a.id
    : Number(scoreB) > Number(scoreA)
      ? b.id
      : "";
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <input type="number" min="0" value={scoreA} onChange={(e)=>setScoreA(e.target.value)} className="w-14 bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs text-center" aria-label="Score A" />
      <span className="text-white/40">:</span>
      <input type="number" min="0" value={scoreB} onChange={(e)=>setScoreB(e.target.value)} className="w-14 bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs text-center" aria-label="Score B" />
      <select value={winnerId} onChange={(e)=>onSave(match, scoreA, scoreB, e.target.value)} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs max-w-[150px]" aria-label="Gewinner">
        <option value="">Gewinner wählen</option>
        <option value={a.id}>{a.display_name || "A"}</option>
        <option value={b.id}>{b.display_name || "B"}</option>
      </select>
      <button type="button" onClick={()=>onSave(match, scoreA, scoreB, winnerId)} className="px-2 py-1 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-[10px] font-bold uppercase">Speichern</button>
    </div>
  );
}

function Fld({ label, value, onChange, type="text", testId }) {
  return (<label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div><input type={type} value={value ?? ""} onChange={(e)=>onChange(e.target.value)} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"/></label>);
}
function Txt({ label, value, onChange, testId }) {
  return (<label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div><MarkdownEditor value={value ?? ""} onChange={onChange} rows={5} testId={testId} /></label>);
}

function PrizeEditor({ value = [], onChange }) {
  const add = (place) => onChange([...(value || []), { place, label: place === "last" ? "Letzter Platz" : `Platz ${place}`, value: "" }]);
  const update = (i, patch) => {
    const next = [...(value || [])];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  return (
    <div className="border border-[#FFD700]/20 bg-[#FFD700]/5 rounded-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700]">Platzierungs-Preise</div>
        <div className="flex gap-3">
          <button type="button" onClick={() => add((value?.length || 0) + 1)} className="text-xs font-bold uppercase tracking-wider text-[#29B6E8]">+ Platz</button>
          <button type="button" onClick={() => add("last")} className="text-xs font-bold uppercase tracking-wider text-[#FFD700]">+ Letzter</button>
        </div>
      </div>
      {(value || []).map((p, i) => (
        <div key={i} className="grid grid-cols-12 gap-2">
          <select value={p.place} onChange={(e)=>update(i, { place: e.target.value === "last" ? "last" : Number(e.target.value) || 1 })} className="col-span-2 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm">
            {[1,2,3,4,5,6,7,8].map((n) => <option key={n} value={n}>{n}.</option>)}
            <option value="last">Letzter</option>
          </select>
          <input value={p.label || ""} onChange={(e)=>update(i, { label: e.target.value })} className="col-span-4 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Label" />
          <input value={p.value || ""} onChange={(e)=>update(i, { value: e.target.value })} className="col-span-5 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Preis" />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="col-span-1 text-white/40 hover:text-[#FF3B30]">×</button>
        </div>
      ))}
    </div>
  );
}
