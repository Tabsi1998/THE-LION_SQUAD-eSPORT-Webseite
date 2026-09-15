import { useCallback, useEffect, useState } from "react";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Check, Pencil, Plus, Trash2, UserPlus, Users, X } from "lucide-react";
import { TEAM_ROLE_LABELS } from "./constants";

const emptySquad = {
  name: "",
  description: "",
  tournament_id: "",
  season_id: "",
  member_ids: [],
  status: "active",
};
import { Field, Input, Row } from "./fields";

export function TeamsPanel() {
  const [teams, setTeams] = useState([]);
  const [invites, setInvites] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [squads, setSquads] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  const activeTeam = teams.find((t) => t.id === activeId);

  const loadTeams = useCallback(async () => {
    const { data } = await api.get("/teams/my");
    setTeams(data || []);
    setActiveId((cur) => cur || data?.[0]?.id || "");
  }, []);

  const loadInvites = useCallback(async () => {
    const { data } = await api.get("/teams/invites/my");
    setInvites(data || []);
  }, []);

  const loadMeta = useCallback(() => {
    api.get("/tournaments").then(({ data }) => setTournaments(data || [])).catch(() => {});
    api.get("/seasons").then(({ data }) => setSeasons(data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    loadTeams().catch(() => toast.error("Teams konnten nicht geladen werden."));
    loadInvites().catch(() => {});
    loadMeta();
  }, [loadInvites, loadMeta, loadTeams]);
  useApiInvalidation(() => {
    loadTeams();
    loadInvites();
    loadMeta();
  }, ["teams", "tournaments", "seasons", "admin/notifications"]);

  const loadSquads = useCallback(() => {
    if (!activeId) {
      setSquads([]);
      return;
    }
    return api.get(`/teams/${activeId}/squads`)
      .then(({ data }) => setSquads(data || []))
      .catch(() => setSquads([]));
  }, [activeId]);

  useEffect(() => { loadSquads(); }, [loadSquads]);
  useApiInvalidation(loadSquads, ["teams"]);

  const saveSquad = async (e) => {
    e.preventDefault();
    if (!activeTeam?.can_manage) return;
    setSaving(true);
    try {
      const payload = {
        ...editing,
        description: editing.description || null,
        tournament_id: editing.tournament_id || null,
        season_id: editing.season_id || null,
        member_ids: editing.member_ids || [],
      };
      if (editing.id) await api.patch(`/teams/${activeTeam.id}/squads/${editing.id}`, payload);
      else await api.post(`/teams/${activeTeam.id}/squads`, payload);
      toast.success("Squad gespeichert.");
      setEditing(null);
      loadSquads();
      loadTeams();
    } catch (err) {
      toast.error(formatRequestError(err, "Squad konnte nicht gespeichert werden.", { name: editing.name }));
    } finally {
      setSaving(false);
    }
  };

  const deleteSquad = async (squad) => {
    if (!await confirm({
      title: "Squad löschen?",
      description: `Squad "${squad.name}" wirklich löschen?`,
      confirmLabel: "Löschen",
    })) return;
    try {
      await api.delete(`/teams/${activeTeam.id}/squads/${squad.id}`);
      toast.success("Squad gelöscht.");
      setSquads((rows) => rows.filter((s) => s.id !== squad.id));
      loadTeams();
    } catch (err) {
      toast.error(formatRequestError(err, "Squad konnte nicht gelöscht werden."));
    }
  };

  const toggleMember = (uid) => {
    setEditing((f) => ({
      ...f,
      member_ids: f.member_ids?.includes(uid)
        ? f.member_ids.filter((x) => x !== uid)
        : [...(f.member_ids || []), uid],
    }));
  };

  const actOnInvite = async (invite, action) => {
    try {
      await api.post(`/teams/invites/${invite.id}/${action}`);
      toast.success(action === "accept" ? "Team-Einladung angenommen." : "Team-Einladung abgelehnt.");
      setInvites((rows) => rows.filter((row) => row.id !== invite.id));
      loadTeams();
    } catch (err) {
      toast.error(formatRequestError(err, "Einladung konnte nicht verarbeitet werden."));
    }
  };

  return (
    <div className="space-y-6" data-testid="profile-teams-tab">
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Team-Verwaltung</div>
          <h2 className="font-heading text-2xl md:text-3xl font-black uppercase mt-1">Meine Teams</h2>
          <p className="text-sm text-white/55 mt-1">Teams sind deine Organisation, Squads sind konkrete Lineups für Seasons oder Turniere.</p>
        </div>
        <Link to="/teams" className="inline-flex items-center gap-2 px-4 py-2 border border-[#29B6E8]/40 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#29B6E8]/10">
          <Plus className="w-3.5 h-3.5" /> Team erstellen
        </Link>
      </div>

      {invites.length > 0 && (
        <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">
            <UserPlus className="w-4 h-4" /> Offene Team-Einladungen
          </div>
          <div className="mt-4 grid md:grid-cols-2 gap-3">
            {invites.map((invite) => (
              <div key={invite.id} className="border border-white/10 bg-[#121212] rounded-sm p-4">
                <div className="text-[10px] uppercase tracking-widest text-white/45">Einladung von {invite.inviter?.display_name || invite.inviter?.username || "Teamleitung"}</div>
                <div className="mt-1 font-heading font-black uppercase">{invite.team?.name || "Team"}</div>
                {invite.team?.tag && <div className="text-xs text-[#29B6E8] font-bold">[{invite.team.tag}]</div>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => actOnInvite(invite, "accept")} className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold">
                    <Check className="w-3.5 h-3.5" /> Annehmen
                  </button>
                  <button type="button" onClick={() => actOnInvite(invite, "decline")} className="inline-flex items-center gap-1.5 px-3 py-2 border border-white/15 text-white/60 rounded-sm text-xs uppercase tracking-wider font-bold hover:text-white">
                    <X className="w-3.5 h-3.5" /> Ablehnen
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {teams.length === 0 ? (
        <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/45">
          <Users className="w-10 h-10 mx-auto opacity-40 mb-3" />
          <div className="font-heading font-bold text-lg">Noch kein Team</div>
          <Link to="/teams" className="mt-4 inline-flex px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs">Team erstellen oder beitreten</Link>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-5">
          <div className="space-y-2">
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => setActiveId(team.id)}
                className={`w-full text-left border rounded-sm p-3 bg-[#121212] flex items-center gap-3 ${activeId === team.id ? "border-[#29B6E8]" : "border-white/10 hover:border-white/25"}`}
                data-testid={`profile-team-${team.id}`}
              >
                <div className="w-12 h-12 bg-[#0A0A0A] border border-white/10 rounded-sm overflow-hidden flex items-center justify-center shrink-0">
                  {team.logo_url ? <img src={resolveMediaUrl(team.logo_url)} alt="" className="w-full h-full object-cover" /> : <span className="font-heading font-black text-[#29B6E8]">{team.tag}</span>}
                </div>
                <div className="min-w-0">
                  <div className="font-heading font-bold truncate">{team.name}</div>
                  <div className="text-[10px] uppercase tracking-widest text-white/45">{TEAM_ROLE_LABELS[team.my_role] || team.my_role}{team.squad_count ? ` · ${team.squad_count} ${team.squad_count === 1 ? "Squad" : "Squads"}` : ""}</div>
                </div>
              </button>
            ))}
          </div>

          <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
            {activeTeam && (
              <>
                {activeTeam.banner_url && (
                  <div className="relative -mx-5 -mt-5 mb-5 h-32 overflow-hidden border-b border-white/10">
                    <img src={resolveMediaUrl(activeTeam.banner_url)} alt="" className="w-full h-full object-cover opacity-80" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#121212] to-transparent" />
                  </div>
                )}
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">[{activeTeam.tag}]</div>
                    <h3 className="font-heading text-2xl font-black uppercase">{activeTeam.name}</h3>
                    <div className="text-xs text-white/50 mt-1">{activeTeam.members?.length || 0} Mitglieder · Deine Rolle: {TEAM_ROLE_LABELS[activeTeam.my_role] || activeTeam.my_role}</div>
                    {activeTeam.can_manage && <div className="mt-2 text-xs text-[#29B6E8]">Du kannst für dieses Team Squads/Subteams erstellen und bearbeiten.</div>}
                  </div>
                  <div className="flex gap-2">
                    <Link to={`/teams/${activeTeam.id}`} className="px-3 py-2 border border-white/15 text-white/70 hover:text-white rounded-sm text-xs uppercase font-bold">Teamseite</Link>
                    {activeTeam.can_manage && (
                      <button type="button" onClick={() => setEditing({ ...emptySquad, member_ids: activeTeam.member_ids || [] })} className="px-3 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase font-bold inline-flex items-center gap-1">
                        <Plus className="w-3.5 h-3.5" /> Squad
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-5 grid sm:grid-cols-2 gap-3">
                  {squads.map((squad) => (
                    <div key={squad.id} className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[10px] uppercase tracking-widest text-[#FFD700]">{squad.status}</div>
                          <h4 className="font-heading font-bold text-lg">{squad.name}</h4>
                        </div>
                        {activeTeam.can_manage && (
                          <div className="flex gap-1">
                            <button type="button" onClick={() => setEditing({ ...emptySquad, ...squad })} className="p-1 text-white/45 hover:text-[#29B6E8]"><Pencil className="w-3.5 h-3.5" /></button>
                            <button type="button" onClick={() => deleteSquad(squad)} className="p-1 text-white/45 hover:text-[#FF3B30]"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        )}
                      </div>
                      {squad.description && <p className="text-sm text-white/55 mt-2">{squad.description}</p>}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(squad.members || []).map((m) => (
                          <span key={m.id} className="px-2 py-1 border border-white/10 rounded-sm text-[10px] text-white/70">{m.display_name || m.username}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {squads.length === 0 && <div className="sm:col-span-2 text-center py-10 text-white/35 border border-dashed border-white/10 rounded-sm">Noch keine Squads für dieses Team.</div>}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {editing && activeTeam && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <form onSubmit={saveSquad} className="bg-[#121212] border border-white/10 rounded-sm w-full max-w-2xl mx-auto my-8">
            <div className="p-5 border-b border-white/10">
              <h3 className="font-heading text-2xl font-black uppercase">{editing.id ? "Squad bearbeiten" : "Squad erstellen"}</h3>
            </div>
            <div className="p-5 space-y-4">
              <Field label="Name"><Input value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} required testId="team-squad-name" /></Field>
              <Field label="Beschreibung"><textarea value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={3} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-white" /></Field>
              <Row>
                <Field label="Turnier">
                  <select value={editing.tournament_id || ""} onChange={(e) => setEditing({ ...editing, tournament_id: e.target.value })} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                    <option value="">Kein Turnier</option>
                    {tournaments.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </select>
                </Field>
                <Field label="Jahreswertung / Circuit">
                  <select value={editing.season_id || ""} onChange={(e) => setEditing({ ...editing, season_id: e.target.value })} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                    <option value="">Keine Jahreswertung</option>
                    {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              </Row>
              <Field label="Lineup / Mitspieler">
                <div className="grid sm:grid-cols-2 gap-2">
                  {(activeTeam.members || []).map((m) => (
                    <label key={m.id} className="flex items-center gap-2 border border-white/10 bg-[#0A0A0A] rounded-sm p-2 text-sm">
                      <input type="checkbox" checked={(editing.member_ids || []).includes(m.id)} onChange={() => toggleMember(m.id)} className="accent-[#29B6E8]" />
                      <span>{m.display_name || m.username}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Status">
                <select value={editing.status || "active"} onChange={(e) => setEditing({ ...editing, status: e.target.value })} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                  <option value="active">Aktiv</option>
                  <option value="archived">Archiviert</option>
                </select>
              </Field>
            </div>
            <div className="flex justify-end gap-2 p-5 border-t border-white/10">
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 border border-white/10 text-white/60 rounded-sm text-xs uppercase tracking-wider font-bold">Abbrechen</button>
              <button disabled={saving} className="px-5 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">{saving ? "Speichere…" : "Speichern"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

