import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MentionTextarea } from "@/components/tls/MentionTextarea";
import { MentionText } from "@/components/tls/MentionText";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { LevelAvatarFrame } from "@/components/tls/LevelAvatarFrame";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { toast } from "sonner";
import { Copy, Crown, Edit, Lock, MessageSquare, Plus, Search, Send, Shield, Star, Swords, Trash2, TrendingUp, Trophy, Users, UserPlus, Zap } from "lucide-react";

const emptyTeam = { name: "", tag: "", description: "", logo_url: "", banner_url: "", discord_link: "" };
const TEAM_ROLE_LABELS = { leader: "Leader", co_leader: "Co-Leader", member: "Mitglied" };

export default function TeamsPage() {
  const { id } = useParams();
  return id ? <TeamDetail id={id} /> : <TeamList />;
}

function TeamList() {
  useDocumentTitle(
    "Teams & Clans",
    "Teams, Squads und Clans der THE LION SQUAD Gaming Community: Profile, Mitglieder, Join-Codes und eSports Organisation."
  );

  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [levels, setLevels] = useState({});
  const [crowns, setCrowns] = useState({});
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    const { data } = await api.get("/teams?limit=90");
    setList(data);
    try {
      const { data: lvl } = await api.get("/teams/levels");
      setLevels(lvl?.levels || {});
      setCrowns(lvl?.crowns || {});
    } catch {}
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
            <p className="mt-3 text-white/60 max-w-xl">Erstelle dein Team, teile den Join-Code und verwalte Logo, Banner, Beschreibung und Discord-Link.</p>
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
          {list.map((t) => <TeamCard key={t.id} team={t} levelInfo={levels[t.id]} crown={crowns[t.id] || null} />)}
          {list.length === 0 && <div className="col-span-full text-center py-20 text-white/40 font-display tracking-widest">KEINE TEAMS</div>}
        </div>
      </div>
      {editing && <TeamModal team={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </PublicLayout>
  );
}

function TeamCard({ team: t, levelInfo, crown = null }) {
  return (
    <Link to={`/teams/${t.id}`} data-testid={`team-card-${t.tag}`} className="group block border border-white/10 hover:border-[#29B6E8]/60 rounded-sm bg-[#121212] overflow-hidden transition">
      <div className="relative h-28 bg-[#0A0A0A] border-b border-white/10 overflow-hidden">
        {t.banner_url ? (
          <img src={resolveMediaUrl(t.banner_url)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover opacity-75 group-hover:opacity-95 group-hover:scale-[1.02] transition duration-500" />
        ) : (
          <div className="w-full h-full bg-grid-dense" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#121212] via-[#121212]/20 to-transparent" />
      </div>
      <div className="relative -mt-8 p-5">
        <div className="flex items-center gap-4">
          {levelInfo ? (
            <LevelAvatarFrame level={levelInfo.level} crown={crown} compact team showBadge={false} testId={`team-frame-${t.tag}`} className="w-16 h-16 shrink-0">
              <TeamLogo team={t} bare />
            </LevelAvatarFrame>
          ) : (
            <TeamLogo team={t} size="md" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold flex items-center gap-2">
              <span>[{t.tag}]</span>
              {levelInfo && (
                <span data-testid={`team-level-chip-${t.tag}`} className="px-1.5 py-0.5 border border-[#29B6E8]/40 rounded-full text-[9px] font-black bg-[#29B6E8]/10">LVL {levelInfo.level}</span>
              )}
              {crown === "gold" && (
                <span data-testid={`team-crown-chip-${t.tag}`} className="px-1.5 py-0.5 border border-[#FFD700]/50 rounded-full text-[9px] font-black bg-[#FFD700]/10 text-[#FFD700] inline-flex items-center gap-1">
                  <Crown className="w-2.5 h-2.5" /> #1
                </span>
              )}
            </div>
            <h3 className="font-heading text-xl font-bold group-hover:text-[#29B6E8] transition truncate">{t.name}</h3>
            <div className="text-xs text-white/50 inline-flex items-center gap-1 mt-0.5">
              <Users className="w-3.5 h-3.5" /> {t.member_count ?? t.member_ids?.length ?? 0} Mitglieder
              {levelInfo && <span className="text-white/35">· {levelInfo.points} Pkt.</span>}
            </div>
          </div>
        </div>
        {t.description && <p className="mt-3 text-sm text-white/60 line-clamp-2">{t.description}</p>}
      </div>
    </Link>
  );
}

function TeamDetail({ id }) {
  useDocumentTitle(
    "Teamprofil",
    "Teamprofil der THE LION SQUAD Gaming Community mit Mitgliedern, Squads und eSports Infos.",
    { canonical: `${window.location.origin}/teams/${id}` }
  );

  const nav = useNavigate();
  const { user, isAdmin } = useAuth();
  const [team, setTeam] = useState(null);
  const [levelInfo, setLevelInfo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [joinCode, setJoinCode] = useState("");
  const { submitting: mutating, submitOnce } = useSubmissionGuard();
  const [actionError, setActionError] = useState("");
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const { data } = await api.get(`/teams/${id}`);
    setTeam(data);
    try {
      const { data: lvl } = await api.get(`/teams/${id}/level`);
      setLevelInfo(lvl);
    } catch {}
  }, [id]);
  const refresh = useCallback(() => load().catch(() => setTeam(null)), [load]);

  useEffect(() => { refresh(); }, [refresh]);
  useApiInvalidation(refresh, ["teams"]);

  if (!team) return <PublicLayout><PublicLoadingState label="Lade Team" /></PublicLayout>;

  const isMember = !!user && (team.is_member || team.member_ids?.includes(user.id));
  const canEdit = !!user && (team.can_manage || team.leader_id === user.id || team.co_leader_ids?.includes(user.id) || isAdmin);

  const runAction = async (task, fallback) => {
    setActionError("");
    const attempt = await submitOnce(task);
    if (!attempt.started || !attempt.error) return attempt.started;
    const message = formatRequestError(attempt.error, fallback);
    setActionError(message);
    toast.error(message);
    return false;
  };

  const join = async (e) => {
    e.preventDefault();
    await runAction(async () => {
      await api.post(`/teams/${team.id}/join`, { join_code: joinCode.trim() });
      toast.success("Du bist dem Team beigetreten.");
      setJoinCode("");
      await load();
    }, "Team-Beitritt fehlgeschlagen.");
  };

  const leave = async () => {
    await runAction(async () => {
      await api.post(`/teams/${team.id}/leave`);
      toast.success("Team verlassen.");
      await load();
    }, "Team konnte nicht verlassen werden.");
  };

  const remove = async () => {
    await runAction(async () => {
      if (!await confirm({
        title: "Team endgültig löschen?",
        description: "Das Team wird inklusive Verwaltung und Mitgliedschaften entfernt.",
        confirmLabel: "Endgültig löschen",
      })) return;
      await api.delete(`/teams/${team.id}`);
      toast.success("Team gelöscht.");
      nav("/teams");
    }, "Team konnte nicht gelöscht werden.");
  };

  const kickMember = async (m) => {
    await runAction(async () => {
      if (!await confirm({
        title: "Mitglied entfernen?",
        description: `${m.display_name || m.username} wirklich aus dem Team entfernen?`,
        confirmLabel: "Entfernen",
      })) return;
      await api.delete(`/teams/${team.id}/members/${m.id}`);
      toast.success(`${m.display_name || m.username} entfernt.`);
      await load();
    }, "Mitglied konnte nicht entfernt werden.");
  };

  const setRole = async (m, role) => {
    await runAction(async () => {
      await api.post(`/teams/${team.id}/members/${m.id}/role`, { role });
      toast.success(role === "co_leader" ? "Zum Co-Leader befördert." : "Co-Leader-Rolle entzogen.");
      await load();
    }, "Rolle konnte nicht geändert werden.");
  };

  const transferLead = async (m) => {
    await runAction(async () => {
      if (!await confirm({
        title: "Leadership übertragen?",
        description: `Leadership an ${m.display_name || m.username} übergeben? Du wirst automatisch Co-Leader.`,
        confirmLabel: "Übertragen",
        tone: "info",
      })) return;
      await api.post(`/teams/${team.id}/transfer-leader`, { new_leader_id: m.id });
      toast.success("Leadership übertragen.");
      await load();
    }, "Leadership konnte nicht übertragen werden.");
  };

  const copyJoin = async () => {
    try {
      await navigator.clipboard.writeText(team.join_code || "");
      toast.success("Join-Code kopiert.");
    } catch { toast.error("Kopieren fehlgeschlagen."); }
  };

  return (
    <PublicLayout>
      <div className="relative border-b border-white/10 bg-grid-dense overflow-hidden">
        {team.banner_url && <img src={resolveMediaUrl(team.banner_url)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/65 via-[#0A0A0A]/82 to-[#0A0A0A]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <Link to="/teams" className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← Teams</Link>
          <div className="mt-5 flex flex-col md:flex-row gap-6 md:items-center">
            {levelInfo ? (
              <LevelAvatarFrame level={levelInfo.level} crown={levelInfo.crown || null} team testId="team-detail-frame" className="w-28 h-28 shrink-0 mt-8 md:mt-4">
                <TeamLogo team={team} bare />
              </LevelAvatarFrame>
            ) : (
              <TeamLogo team={team} size="lg" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold flex items-center gap-2 flex-wrap">
                <span>[{team.tag}]</span>
                {levelInfo && (
                  <span data-testid="team-detail-level-chip" className="px-2 py-0.5 border border-[#29B6E8]/40 rounded-full text-[10px] font-black bg-[#29B6E8]/10 tracking-widest">TEAM-LEVEL {levelInfo.level}</span>
                )}
                {levelInfo?.crown === "gold" && (
                  <span data-testid="team-detail-crown-chip" className="px-2 py-0.5 border border-[#FFD700]/50 rounded-full text-[10px] font-black bg-[#FFD700]/10 text-[#FFD700] tracking-widest inline-flex items-center gap-1">
                    <Crown className="w-3 h-3" /> PUNKTEBESTES TEAM
                  </span>
                )}
              </div>
              <h1 className="font-heading text-4xl md:text-6xl font-black uppercase leading-tight">{team.name}</h1>
              {team.description && <p className="mt-3 text-white/70 max-w-2xl">{team.description}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 border border-white/10 rounded-sm text-xs text-white/60"><Users className="w-3.5 h-3.5" /> {team.member_count ?? team.member_ids?.length ?? 0} Mitglieder</span>
                {team.leader && <span className="inline-flex items-center gap-1.5 px-3 py-1 border border-[#FFD700]/30 text-[#FFD700] rounded-sm text-xs"><Shield className="w-3.5 h-3.5" /> Leader: {team.leader.display_name || team.leader.username}</span>}
              </div>
            </div>
            {canEdit && (
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setEditing(team)} disabled={mutating} data-testid="team-edit-open" className="px-4 py-2 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-xs uppercase tracking-wider font-bold inline-flex items-center gap-2 disabled:opacity-50"><Edit className="w-3.5 h-3.5" /> Bearbeiten</button>
                <button onClick={remove} disabled={mutating} data-testid="team-delete" className="px-4 py-2 border border-[#FF3B30]/50 text-[#FF3B30] rounded-sm text-xs uppercase tracking-wider font-bold inline-flex items-center gap-2 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /> Löschen</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {levelInfo && <TeamLevelPanel info={levelInfo} />}
          <section>
            <div className="mb-4">
              <h2 className="font-heading text-2xl font-bold uppercase">Mitglieder</h2>
              {canEdit && <p className="mt-1 text-xs text-white/45">Leader können Rollen vergeben und die Leitung übertragen. Co-Leader dürfen Teamdaten pflegen, Mitglieder einladen, Team-Chat nutzen und Squads/Subteams verwalten.</p>}
            </div>
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
                        <button disabled={mutating} onClick={(e) => { e.preventDefault(); setRole(m, "co_leader"); }}
                          data-testid={`team-promote-${m.id}`}
                          className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider border border-[#29B6E8]/40 text-[#29B6E8] hover:bg-[#29B6E8]/10 rounded-sm">↑ Co-Leader</button>
                      )}
                      {showRole && isCo && (
                        <button disabled={mutating} onClick={(e) => { e.preventDefault(); setRole(m, "member"); }}
                          data-testid={`team-demote-${m.id}`}
                          className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider border border-white/15 text-white/60 hover:bg-white/5 rounded-sm">↓ Mitglied</button>
                      )}
                      {showTransfer && (
                        <button disabled={mutating} onClick={(e) => { e.preventDefault(); transferLead(m); }}
                          data-testid={`team-transfer-${m.id}`}
                          className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider border border-[#FFD700]/40 text-[#FFD700] hover:bg-[#FFD700]/10 rounded-sm">★ Leader machen</button>
                      )}
                      {showKick && (
                        <button disabled={mutating} onClick={(e) => { e.preventDefault(); kickMember(m); }}
                          data-testid={`team-kick-${m.id}`}
                          className="ml-auto px-2 py-1 text-[10px] font-bold uppercase tracking-wider border border-[#FF3B30]/40 text-[#FF3B30] hover:bg-[#FF3B30]/10 rounded-sm">Entfernen</button>
                      )}
                    </div>
                  )}
                </div>
              );
              })}
            </div>
          </section>
          {(isMember || canEdit) && <TeamChat team={team} user={user} />}
        </div>
        <aside className="space-y-4">
          {actionError && <AuthFormAlert id="team-action-error">{actionError}</AuthFormAlert>}
          {canEdit && (
            <div className="border border-[#FFD700]/25 bg-[#FFD700]/5 rounded-sm p-4">
              <div className="text-[11px] uppercase tracking-widest text-[#FFD700] font-bold">Join-Code</div>
              <div className="mt-2 flex gap-2">
                <code className="flex-1 bg-black/40 border border-white/10 px-3 py-2 rounded-sm text-sm">{team.join_code}</code>
                <button onClick={copyJoin} className="px-3 py-2 border border-[#FFD700]/40 text-[#FFD700] rounded-sm"><Copy className="w-4 h-4" /></button>
              </div>
            </div>
          )}
          {canEdit && <InviteMemberPanel team={team} />}
          {user && !isMember && (
            <form onSubmit={join} className="border border-white/10 bg-[#121212] rounded-sm p-4 space-y-3">
              <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">Team beitreten</div>
              <input value={joinCode} onChange={(e) => { setJoinCode(e.target.value); setActionError(""); }} placeholder="Join-Code" required data-testid="team-join-code" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />
              <button disabled={mutating} data-testid="team-join-submit" className="w-full px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold inline-flex justify-center items-center gap-2 disabled:opacity-50"><UserPlus className="w-3.5 h-3.5" /> {mutating ? "Prüfe…" : "Beitreten"}</button>
            </form>
          )}
          {user && isMember && team.leader_id !== user.id && (
            <button onClick={leave} disabled={mutating} data-testid="team-leave" className="w-full px-4 py-2 border border-white/15 text-white/70 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">Team verlassen</button>
          )}
          {team.discord_link && <a href={team.discord_link} target="_blank" rel="noreferrer" className="block px-4 py-3 border border-white/10 rounded-sm text-center text-sm font-bold uppercase tracking-wider hover:border-[#29B6E8]/60 hover:text-[#29B6E8]">Discord</a>}
        </aside>
      </div>
      {editing && <TeamModal team={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </PublicLayout>
  );
}

function TeamChat({ team, user }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const { submitting: loading, submitOnce } = useSubmissionGuard();
  const [sendError, setSendError] = useState("");
  const scrollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/teams/${team.id}/chat`);
      setMessages(data || []);
    } catch {
      setMessages([]);
    }
  }, [team.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [load]);
  useApiInvalidation(load, ["teams"]);

  useEffect(() => {
    const box = scrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const message = text.trim();
    if (!message) return;
    setSendError("");
    const attempt = await submitOnce(async () => {
      const { data } = await api.post(`/teams/${team.id}/chat`, { message });
      setMessages((rows) => [...rows, data]);
      setText("");
    });
    if (attempt.started && attempt.error) {
      const messageText = formatRequestError(attempt.error, "Nachricht konnte nicht gesendet werden.");
      setSendError(messageText);
      toast.error(messageText);
    }
  };

  return (
    <section data-testid="team-chat">
      <h2 className="font-heading text-2xl font-bold uppercase mb-4 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-[#29B6E8]" /> Team-Chat
      </h2>
      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <div ref={scrollRef} className="max-h-96 overflow-y-auto p-4 space-y-3">
          {messages.map((message) => {
            const mine = message.user_id === user?.id;
            return (
              <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] border rounded-sm px-3 py-2 ${mine ? "border-[#29B6E8]/40 bg-[#29B6E8]/10" : "border-white/10 bg-[#0A0A0A]"}`}>
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/40">
                    <span className={mine ? "text-[#29B6E8]" : "text-white/55"}>{message.author?.display_name || message.author?.username || "Benutzer"}</span>
                    {message.created_at && <span>{new Date(message.created_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</span>}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-sm text-white/85"><MentionText text={message.message} /></div>
                </div>
              </div>
            );
          })}
          {messages.length === 0 && <div className="text-center py-10 text-sm text-white/35">Noch keine Nachrichten im Team-Chat.</div>}
        </div>
        <div className="border-t border-white/10 p-3 flex gap-2">
          <MentionTextarea
            value={text}
            onValueChange={(value) => { setText(value); setSendError(""); }}
            scope="team"
            scopeId={team.id}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={1500}
            placeholder="Nachricht schreiben, mit @username erwähnen..."
            className="flex-1 min-w-0"
            textareaClassName="h-10 max-h-28 w-full resize-none bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm focus:outline-none focus:border-[#29B6E8]"
          />
          <button type="button" onClick={send} disabled={loading || !text.trim()} className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-45">
            <Send className="w-3.5 h-3.5" /> Senden
          </button>
        </div>
        {sendError && <div className="border-t border-white/10 p-3"><AuthFormAlert id="team-chat-error">{sendError}</AuthFormAlert></div>}
      </div>
    </section>
  );
}

function InviteMemberPanel({ team }) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const { submitting: inviting, submitOnce } = useSubmissionGuard();
  const [inviteError, setInviteError] = useState("");

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setCandidates([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/teams/${team.id}/invite-candidates?q=${encodeURIComponent(needle)}`);
        setCandidates(data || []);
      } catch {
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query, team.id]);

  const invite = async (user) => {
    setInviteError("");
    const attempt = await submitOnce(async () => {
      await api.post(`/teams/${team.id}/invites`, { user_id: user.id });
      toast.success(`${user.display_name || user.username} eingeladen.`);
      setCandidates((rows) => rows.map((row) => row.id === user.id ? { ...row, has_pending_invite: true } : row));
    });
    if (attempt.started && attempt.error) {
      const message = formatRequestError(attempt.error, "Einladung konnte nicht gesendet werden.");
      setInviteError(message);
      toast.error(message);
    }
  };

  return (
    <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-4 space-y-3">
      <div>
        <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">Mitglieder einladen</div>
        <p className="mt-1 text-xs text-white/45">Benutzer suchen und eine Team-Einladung in deren Inbox senden.</p>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setInviteError(""); }}
          placeholder="Username suchen"
          className="w-full bg-[#0A0A0A] border border-white/10 pl-9 pr-3 py-2 rounded-sm text-sm"
        />
      </div>
      <div className="space-y-2">
        {loading && <div className="text-xs text-white/40">Suche läuft...</div>}
        {candidates.map((candidate) => (
          <div key={candidate.id} className="flex items-center gap-2 border border-white/10 bg-[#0A0A0A] rounded-sm p-2">
            <div className="min-w-0 flex-1">
              <div className="font-bold text-sm truncate">{candidate.display_name || candidate.username}</div>
              <div className="text-xs text-white/40 truncate">@{candidate.username}</div>
            </div>
            <button
              type="button"
              disabled={candidate.has_pending_invite || inviting}
              onClick={() => invite(candidate)}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#29B6E8]/40 text-[#29B6E8] rounded-sm text-[10px] uppercase tracking-wider font-bold disabled:opacity-45 disabled:pointer-events-none"
            >
              <UserPlus className="w-3.5 h-3.5" /> {candidate.has_pending_invite ? "Offen" : "Einladen"}
            </button>
          </div>
        ))}
        {query.trim().length >= 2 && !loading && candidates.length === 0 && <div className="text-xs text-white/35">Keine passenden Benutzer gefunden.</div>}
        {inviteError && <AuthFormAlert id="team-invite-error">{inviteError}</AuthFormAlert>}
      </div>
    </div>
  );
}

function TeamModal({ team, onClose, onSaved }) {
  const isNew = !team?.id;
  const [form, setForm] = useState({ ...emptyTeam, ...team });
  const { submitting: saving, submitOnce } = useSubmissionGuard();
  const [submitError, setSubmitError] = useState("");
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setSubmitError(""); };

  const submit = async (e) => {
    e.preventDefault();
    const payload = {
        name: form.name.trim(),
        tag: form.tag.trim().toUpperCase(),
        description: form.description || null,
        logo_url: form.logo_url || null,
        banner_url: form.banner_url || null,
        discord_link: form.discord_link || null,
    };
    setSubmitError("");
    const attempt = await submitOnce(async () => {
      if (isNew) await api.post("/teams", payload);
      else await api.patch(`/teams/${team.id}`, payload);
      toast.success(isNew ? "Team erstellt." : "Team gespeichert.");
      onSaved();
    });
    if (attempt.started && attempt.error) {
      const message = formatRequestError(attempt.error, isNew ? "Team konnte nicht erstellt werden." : "Team konnte nicht gespeichert werden.", { name: form.name });
      setSubmitError(message);
      toast.error(message);
    }
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
          <Field label="Banner"><ImageUpload value={form.banner_url || ""} onChange={(v) => set("banner_url", v)} testId="team-banner" variant="wide" allowLibrary /></Field>
          <Field label="Discord-Link"><Input value={form.discord_link || ""} onChange={(v) => set("discord_link", v)} placeholder="https://discord.gg/..." /></Field>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-white/10">
          {submitError && <div className="mr-auto"><AuthFormAlert id="team-submit-error">{submitError}</AuthFormAlert></div>}
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 border border-white/10 text-white/60 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">Abbrechen</button>
          <button disabled={saving} data-testid="team-save" className="px-5 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">{saving ? "Speichere…" : "Speichern"}</button>
        </div>
      </form>
    </div>
  );
}

function TeamLogo({ team, size = "md", bare = false }) {
  const cls = bare ? "w-full h-full" : `${size === "lg" ? "w-28 h-28 text-3xl" : "w-16 h-16 text-xl"} bg-[#0A0A0A] border border-white/10 rounded-sm`;
  return (
    <div className={`${cls} flex items-center justify-center shrink-0 overflow-hidden ${bare ? "text-xl bg-[#0A0A0A]" : ""}`}>
      {team.logo_url ? <img src={resolveMediaUrl(team.logo_url)} alt={team.name} className="w-full h-full object-cover" /> : <span className="font-heading font-black text-[#29B6E8]">{team.tag}</span>}
    </div>
  );
}

const TEAM_ACH_ICONS = {
  flag: Shield, users: Users, zap: Zap, swords: Swords, trophy: Trophy,
  "trending-up": TrendingUp, shield: Shield, crown: Star,
};

function TeamLevelPanel({ info }) {
  const span = Math.max((info.next_level_points || 1) - (info.current_level_points || 0), 1);
  const inLevel = Math.max((info.points || 0) - (info.current_level_points || 0), 0);
  return (
    <section data-testid="team-level-panel" className="border border-[#29B6E8]/25 bg-[#121212] rounded-sm p-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-[#29B6E8] font-bold">Team-Level</div>
          <div className="mt-1 font-heading text-3xl font-black" data-testid="team-level-value">LEVEL {info.level}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black text-white" data-testid="team-points-value">{info.points} <span className="text-sm text-white/40 font-bold">PUNKTE</span></div>
          <div className="text-[11px] text-white/40">{inLevel} / {span} bis Level {info.level + 1}</div>
        </div>
      </div>
      <div className="mt-3 h-2.5 bg-black/50 border border-white/10 rounded-full overflow-hidden">
        <div
          data-testid="team-level-progress"
          className="h-full bg-gradient-to-r from-[#29B6E8] to-[#7FDBFF] rounded-full transition-all duration-700"
          style={{ width: `${info.progress || 0}%` }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/50">
        <span className="px-2 py-1 border border-white/10 rounded-sm">Mitglieder-Achievements: <b className="text-white/80">{info.member_points}</b></span>
        <span className="px-2 py-1 border border-white/10 rounded-sm">Turniere: <b className="text-white/80">{info.tournament_points}</b> ({info.tournaments} Teilnahmen{info.wins ? `, ${info.wins} Siege` : ""})</span>
      </div>
      <div className="mt-5">
        <div className="text-[11px] uppercase tracking-widest text-white/50 font-bold mb-2">Team-Achievements</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {(info.achievements || []).map((a) => {
            const Icon = a.earned ? (TEAM_ACH_ICONS[a.icon] || Trophy) : Lock;
            return (
              <div
                key={a.code}
                data-testid={`team-achievement-${a.code}`}
                data-earned={a.earned ? "true" : "false"}
                title={a.description}
                className={`px-3 py-2.5 border rounded-sm flex items-center gap-2.5 transition ${
                  a.earned
                    ? "border-[#FFD700]/35 bg-[#FFD700]/5 text-white"
                    : "border-white/15 bg-black/30 text-white/45"
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${a.earned ? "text-[#FFD700]" : "text-white/35"}`} />
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate">{a.name}</div>
                  <div className="text-[10px] truncate opacity-70">{a.description}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }) {
  return <label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>{children}</label>;
}

function Input({ value, onChange, placeholder, testId, required }) {
  return <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testId} required={required} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" />;
}
