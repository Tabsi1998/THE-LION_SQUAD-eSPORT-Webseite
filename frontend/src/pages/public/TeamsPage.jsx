import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Copy, Edit, Plus, Shield, Trash2, Users, UserPlus } from "lucide-react";

const emptyTeam = { name: "", tag: "", description: "", logo_url: "", discord_link: "" };

export default function TeamsPage() {
  const { id } = useParams();
  return id ? <TeamDetail id={id} /> : <TeamList />;
}

function TeamList() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    const { data } = await api.get("/teams");
    setList(data);
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["teams"]);

  return (
    <PublicLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Teams</span>
            <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase">Teams & Clans</h1>
            <p className="mt-3 text-white/60 max-w-xl">Erstelle dein Team, teile den Join-Code und verwalte Logo, Beschreibung und Discord-Link.</p>
          </div>
          {user ? (
            <button onClick={() => setEditing(emptyTeam)} data-testid="team-create-open" className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black rounded-sm font-bold uppercase tracking-wider text-xs hover:bg-[#1E95C2]">
              <Plus className="w-3.5 h-3.5" /> Team erstellen
            </button>
          ) : (
            <Link to="/login?next=/teams" className="px-4 py-2 border border-[#29B6E8]/40 text-[#29B6E8] rounded-sm font-bold uppercase tracking-wider text-xs">Login zum Erstellen</Link>
          )}
        </div>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {list.map((t) => <TeamCard key={t.id} team={t} />)}
          {list.length === 0 && <div className="col-span-full text-center py-20 text-white/40 font-display tracking-widest">KEINE TEAMS</div>}
        </div>
      </div>
      {editing && <TeamModal team={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </PublicLayout>
  );
}

function TeamCard({ team: t }) {
  return (
    <Link to={`/teams/${t.id}`} data-testid={`team-card-${t.tag}`} className="group block border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-5 bg-[#121212] transition">
      <div className="flex items-center gap-4">
        <TeamLogo team={t} size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">[{t.tag}]</div>
          <h3 className="font-heading text-xl font-bold group-hover:text-[#29B6E8] transition truncate">{t.name}</h3>
          <div className="text-xs text-white/50 inline-flex items-center gap-1 mt-0.5">
            <Users className="w-3.5 h-3.5" /> {t.member_count ?? t.member_ids?.length ?? 0} Mitglieder
          </div>
        </div>
      </div>
      {t.description && <p className="mt-3 text-sm text-white/60 line-clamp-2">{t.description}</p>}
    </Link>
  );
}

function TeamDetail({ id }) {
  const nav = useNavigate();
  const { user, isAdmin } = useAuth();
  const [team, setTeam] = useState(null);
  const [editing, setEditing] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const { data } = await api.get(`/teams/${id}`);
    setTeam(data);
  }, [id]);
  const refresh = useCallback(() => load().catch(() => setTeam(null)), [load]);

  useEffect(() => { refresh(); }, [refresh]);
  useApiInvalidation(refresh, ["teams"]);

  if (!team) return <PublicLayout><div className="p-20 text-center text-white/40 font-display tracking-widest">LADE TEAM …</div></PublicLayout>;

  const isMember = !!user && (team.is_member || team.member_ids?.includes(user.id));
  const canEdit = !!user && (team.can_manage || team.leader_id === user.id || team.co_leader_ids?.includes(user.id) || isAdmin);

  const join = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/teams/${team.id}/join`, { join_code: joinCode.trim() });
      toast.success("Du bist dem Team beigetreten.");
      setJoinCode("");
      load();
    } catch (err) { toast.error(formatRequestError(err, "Team-Beitritt fehlgeschlagen.")); }
  };

  const leave = async () => {
    try {
      await api.post(`/teams/${team.id}/leave`);
      toast.success("Team verlassen.");
      load();
    } catch (err) { toast.error(formatRequestError(err, "Team konnte nicht verlassen werden.")); }
  };

  const remove = async () => {
    if (!await confirm({
      title: "Team endgültig löschen?",
      description: "Das Team wird inklusive Verwaltung und Mitgliedschaften entfernt.",
      confirmLabel: "Endgültig löschen",
    })) return;
    try {
      await api.delete(`/teams/${team.id}`);
      toast.success("Team gelöscht.");
      nav("/teams");
    } catch (err) { toast.error(formatRequestError(err, "Team konnte nicht geloescht werden.")); }
  };

  const kickMember = async (m) => {
    if (!await confirm({
      title: "Mitglied entfernen?",
      description: `${m.display_name || m.username} wirklich aus dem Team entfernen?`,
      confirmLabel: "Entfernen",
    })) return;
    try {
      await api.delete(`/teams/${team.id}/members/${m.id}`);
      toast.success(`${m.display_name || m.username} entfernt.`);
      load();
    } catch (err) { toast.error(formatRequestError(err, "Mitglied konnte nicht entfernt werden.")); }
  };

  const setRole = async (m, role) => {
    try {
      await api.post(`/teams/${team.id}/members/${m.id}/role`, { role });
      toast.success(role === "co_leader" ? "Zum Co-Leader befördert." : "Co-Leader-Rolle entzogen.");
      load();
    } catch (err) { toast.error(formatRequestError(err, "Rolle konnte nicht geaendert werden.")); }
  };

  const transferLead = async (m) => {
    if (!await confirm({
      title: "Leadership übertragen?",
      description: `Leadership an ${m.display_name || m.username} übergeben? Du wirst automatisch Co-Leader.`,
      confirmLabel: "Übertragen",
      tone: "info",
    })) return;
    try {
      await api.post(`/teams/${team.id}/transfer-leader`, { new_leader_id: m.id });
      toast.success("Leadership übertragen.");
      load();
    } catch (err) { toast.error(formatRequestError(err, "Leadership konnte nicht uebertragen werden.")); }
  };

  const copyJoin = async () => {
    try {
      await navigator.clipboard.writeText(team.join_code || "");
      toast.success("Join-Code kopiert.");
    } catch { toast.error("Kopieren fehlgeschlagen."); }
  };

  return (
    <PublicLayout>
      <div className="border-b border-white/10 bg-grid-dense">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Link to="/teams" className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← Teams</Link>
          <div className="mt-5 flex flex-col md:flex-row gap-6 md:items-center">
            <TeamLogo team={team} size="lg" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">[{team.tag}]</div>
              <h1 className="font-heading text-4xl md:text-6xl font-black uppercase leading-tight">{team.name}</h1>
              {team.description && <p className="mt-3 text-white/70 max-w-2xl">{team.description}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 border border-white/10 rounded-sm text-xs text-white/60"><Users className="w-3.5 h-3.5" /> {team.member_count ?? team.member_ids?.length ?? 0} Mitglieder</span>
                {team.leader && <span className="inline-flex items-center gap-1.5 px-3 py-1 border border-[#FFD700]/30 text-[#FFD700] rounded-sm text-xs"><Shield className="w-3.5 h-3.5" /> Leader: {team.leader.display_name || team.leader.username}</span>}
              </div>
            </div>
            {canEdit && (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setEditing(team)} data-testid="team-edit-open" className="px-4 py-2 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-xs uppercase tracking-wider font-bold inline-flex items-center gap-2"><Edit className="w-3.5 h-3.5" /> Bearbeiten</button>
                <button onClick={remove} data-testid="team-delete" className="px-4 py-2 border border-[#FF3B30]/50 text-[#FF3B30] rounded-sm text-xs uppercase tracking-wider font-bold inline-flex items-center gap-2"><Trash2 className="w-3.5 h-3.5" /> Löschen</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <h2 className="font-heading text-2xl font-bold uppercase mb-4">Mitglieder</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {team.members?.map((m) => {
              const isLead = team.leader_id === m.id;
              const isCo = (team.co_leader_ids || []).includes(m.id);
              const isMe = user && user.id === m.id;
              const showKick = canEdit && !isLead && !isMe;
              const showRole = !!user && team.leader_id === user.id && !isLead;
              const showTransfer = !!user && team.leader_id === user.id && !isLead;
              const role = isLead ? "leader" : (isCo ? "co_leader" : "member");
              const roleLabel = isLead ? "Leader" : (isCo ? "Co-Leader" : "Mitglied");
              const roleColor = isLead ? "text-[#FFD700] border-[#FFD700]/40 bg-[#FFD700]/5" :
                                isCo ? "text-[#29B6E8] border-[#29B6E8]/40 bg-[#29B6E8]/5" :
                                "text-white/60 border-white/10 bg-white/5";
              return (
                <div key={m.id} data-testid={`team-member-row-${m.id}`}
                  className="border border-white/10 bg-[#121212] rounded-sm p-4 hover:border-[#29B6E8]/40 transition flex flex-col gap-2">
                  <Link to={`/u/${m.username}`} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-heading text-lg font-bold truncate">{m.display_name || m.username}</div>
                      <div className="text-xs text-white/45">@{m.username}</div>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 border rounded-sm text-[10px] font-bold uppercase tracking-wider ${roleColor}`}>{roleLabel}</span>
                  </Link>
                  {(showKick || showRole || showTransfer) && (
                    <div className="flex flex-wrap gap-1.5 pt-2 border-t border-white/5">
                      {showRole && !isCo && (
                        <button onClick={(e) => { e.preventDefault(); setRole(m, "co_leader"); }}
                          data-testid={`team-promote-${m.id}`}
                          className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider border border-[#29B6E8]/40 text-[#29B6E8] hover:bg-[#29B6E8]/10 rounded-sm">↑ Co-Leader</button>
                      )}
                      {showRole && isCo && (
                        <button onClick={(e) => { e.preventDefault(); setRole(m, "member"); }}
                          data-testid={`team-demote-${m.id}`}
                          className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider border border-white/15 text-white/60 hover:bg-white/5 rounded-sm">↓ Mitglied</button>
                      )}
                      {showTransfer && (
                        <button onClick={(e) => { e.preventDefault(); transferLead(m); }}
                          data-testid={`team-transfer-${m.id}`}
                          className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider border border-[#FFD700]/40 text-[#FFD700] hover:bg-[#FFD700]/10 rounded-sm">★ Leader machen</button>
                      )}
                      {showKick && (
                        <button onClick={(e) => { e.preventDefault(); kickMember(m); }}
                          data-testid={`team-kick-${m.id}`}
                          className="ml-auto px-2 py-1 text-[10px] font-bold uppercase tracking-wider border border-[#FF3B30]/40 text-[#FF3B30] hover:bg-[#FF3B30]/10 rounded-sm">Entfernen</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <aside className="space-y-4">
          {canEdit && (
            <div className="border border-[#FFD700]/25 bg-[#FFD700]/5 rounded-sm p-4">
              <div className="text-[11px] uppercase tracking-widest text-[#FFD700] font-bold">Join-Code</div>
              <div className="mt-2 flex gap-2">
                <code className="flex-1 bg-black/40 border border-white/10 px-3 py-2 rounded-sm text-sm">{team.join_code}</code>
                <button onClick={copyJoin} className="px-3 py-2 border border-[#FFD700]/40 text-[#FFD700] rounded-sm"><Copy className="w-4 h-4" /></button>
              </div>
            </div>
          )}
          {user && !isMember && (
            <form onSubmit={join} className="border border-white/10 bg-[#121212] rounded-sm p-4 space-y-3">
              <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">Team beitreten</div>
              <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Join-Code" required data-testid="team-join-code" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />
              <button data-testid="team-join-submit" className="w-full px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold inline-flex justify-center items-center gap-2"><UserPlus className="w-3.5 h-3.5" /> Beitreten</button>
            </form>
          )}
          {user && isMember && team.leader_id !== user.id && (
            <button onClick={leave} data-testid="team-leave" className="w-full px-4 py-2 border border-white/15 text-white/70 rounded-sm text-xs uppercase tracking-wider font-bold">Team verlassen</button>
          )}
          {team.discord_link && <a href={team.discord_link} target="_blank" rel="noreferrer" className="block px-4 py-3 border border-white/10 rounded-sm text-center text-sm font-bold uppercase tracking-wider hover:border-[#29B6E8]/60 hover:text-[#29B6E8]">Discord</a>}
        </aside>
      </div>
      {editing && <TeamModal team={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </PublicLayout>
  );
}

function TeamModal({ team, onClose, onSaved }) {
  const isNew = !team?.id;
  const [form, setForm] = useState({ ...emptyTeam, ...team });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        tag: form.tag.trim().toUpperCase(),
        description: form.description || null,
        logo_url: form.logo_url || null,
        discord_link: form.discord_link || null,
      };
      if (isNew) await api.post("/teams", payload);
      else await api.patch(`/teams/${team.id}`, payload);
      toast.success(isNew ? "Team erstellt." : "Team gespeichert.");
      onSaved();
    } catch (err) { toast.error(formatRequestError(err, isNew ? "Team konnte nicht erstellt werden." : "Team konnte nicht gespeichert werden.", { name: form.name })); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-xl bg-[#121212] border border-white/10 rounded-sm">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="font-heading font-black uppercase">{isNew ? "Team erstellen" : "Team bearbeiten"}</h2>
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white">×</button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Name"><Input value={form.name} onChange={(v) => set("name", v)} required testId="team-name" /></Field>
          <Field label="Tag"><Input value={form.tag} onChange={(v) => set("tag", v.toUpperCase().slice(0, 8))} required testId="team-tag" placeholder="TLS" /></Field>
          <Field label="Beschreibung"><textarea value={form.description || ""} onChange={(e) => set("description", e.target.value)} rows={3} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
          <Field label="Logo"><ImageUpload value={form.logo_url || ""} onChange={(v) => set("logo_url", v)} testId="team-logo" variant="square" allowLibrary /></Field>
          <Field label="Discord-Link"><Input value={form.discord_link || ""} onChange={(v) => set("discord_link", v)} placeholder="https://discord.gg/..." /></Field>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-white/10">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/10 text-white/60 rounded-sm text-xs uppercase tracking-wider font-bold">Abbrechen</button>
          <button disabled={saving} data-testid="team-save" className="px-5 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">{saving ? "Speichere…" : "Speichern"}</button>
        </div>
      </form>
    </div>
  );
}

function TeamLogo({ team, size = "md" }) {
  const cls = size === "lg" ? "w-28 h-28 text-3xl" : "w-16 h-16 text-xl";
  return (
    <div className={`${cls} bg-[#0A0A0A] border border-white/10 rounded-sm flex items-center justify-center shrink-0 overflow-hidden`}>
      {team.logo_url ? <img src={resolveMediaUrl(team.logo_url)} alt={team.name} className="w-full h-full object-cover" /> : <span className="font-heading font-black text-[#29B6E8]">{team.tag}</span>}
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>{children}</label>;
}

function Input({ value, onChange, placeholder, testId, required }) {
  return <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testId} required={required} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />;
}
