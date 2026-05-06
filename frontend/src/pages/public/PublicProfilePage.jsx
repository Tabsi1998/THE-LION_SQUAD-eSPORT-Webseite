import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, formatMs, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { AchievementGroupsView } from "@/components/tls/AchievementGroups";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import {
  Trophy, Flag, Users as UsersIcon, Medal, Shield, Calendar,
  MapPin, Zap, TrendingUp, Lock, ExternalLink,
} from "lucide-react";

export default function PublicProfilePage() {
  const { username } = useParams();
  const [profile, setProfile] = useState(null);
  const [achievementsData, setAchievementsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/users/public/${username}`);
      setProfile(data);
      if (data?.id) {
        try {
          const { data: ach } = await api.get(`/achievements/user/${data.id}`);
          setAchievementsData(ach);
        } catch { setAchievementsData(null); }
      }
    } catch { setProfile(null); }
    setLoading(false);
  }, [username]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["users", "achievements", "tournaments", "f1", "teams"]);

  if (loading) return <PublicLayout><div className="p-20 text-center font-display tracking-widest text-white/40">LADE PROFIL …</div></PublicLayout>;
  if (!profile) return <PublicLayout><div className="p-20 text-center">
    <h1 className="font-heading text-3xl uppercase">Spieler nicht gefunden</h1>
    <Link to="/" className="inline-block mt-4 text-[#29B6E8] hover:underline">← Zurück zur Startseite</Link>
  </div></PublicLayout>;

  const s = profile.stats || {};
  const level = profile.achievement_level || { level: s.level || 1, progress: 0, points: s.points || 0, next_level_points: 100 };
  const isPrivate = profile.privacy_public_profile === false;
  const joinedDate = profile.created_at ? new Date(profile.created_at) : null;

  return (
    <PublicLayout>
      {/* Hero */}
      <div className="relative border-b border-white/10 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-20 -left-10 w-[500px] h-[500px] rounded-full bg-[#29B6E8] blur-[160px] opacity-10" />
          <div className="absolute -bottom-20 -right-10 w-[400px] h-[400px] rounded-full bg-[#FFD700] blur-[160px] opacity-5" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Spieler", to: "/players" }, { label: profile.display_name || profile.username }]} className="mb-6" />
          <div className="flex flex-col md:flex-row gap-8 items-start">
            <div className="shrink-0">
              {profile.avatar_url ? (
                <img src={resolveMediaUrl(profile.avatar_url)} alt={profile.display_name} className="w-32 h-32 md:w-40 md:h-40 rounded-sm border-2 border-[#29B6E8]/40 object-cover" />
              ) : (
                <div className="w-32 h-32 md:w-40 md:h-40 rounded-sm border-2 border-[#29B6E8]/40 bg-gradient-to-br from-[#29B6E8]/20 to-[#121212] flex items-center justify-center font-display font-black text-5xl text-[#29B6E8]">
                  {(profile.display_name || profile.username || "?").slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">
                <span>THE LION SQUAD · Spieler</span>
                {isPrivate && <span className="inline-flex items-center gap-1 text-white/40"><Lock className="w-3 h-3" /> Privat</span>}
              </div>
              <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase leading-[0.95] tracking-tight truncate">
                {profile.display_name || profile.username}
              </h1>
              <div className="mt-2 text-white/50 text-sm flex flex-wrap items-center gap-3">
                <span>@{profile.username}</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-[#29B6E8]/40 text-[#29B6E8] text-[10px] uppercase tracking-widest rounded-sm">
                  <Zap className="w-3 h-3" /> Level {level.level}
                </span>
                {profile.country && <span>· <MapPin className="w-3.5 h-3.5 inline mr-1" />{profile.country}</span>}
                {joinedDate && <span>· <Calendar className="w-3.5 h-3.5 inline mr-1" />Mitglied seit {joinedDate.toLocaleDateString("de-DE", { month: "long", year: "numeric" })}</span>}
                {profile.role && profile.role !== "player" && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-[#FFD700]/40 text-[#FFD700] text-[10px] uppercase tracking-widest rounded-sm">
                    <Shield className="w-3 h-3" /> {profile.role.replace("_", " ")}
                  </span>
                )}
              </div>
              {profile.bio && <p className="mt-4 text-white/80 text-base max-w-2xl leading-relaxed">{profile.bio}</p>}
              {/* Setup chips */}
              {((profile.main_platforms?.length || 0) + (profile.input_devices?.length || 0) + (profile.gaming_subscriptions?.length || 0) > 0) && (
                <div className="mt-4 flex flex-wrap gap-2" data-testid="profile-setup-chips">
                  {profile.main_platforms?.map((p) => (
                    <span key={p} className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 bg-[#29B6E8]/10 text-[#29B6E8] border border-[#29B6E8]/20 rounded-sm">{p}</span>
                  ))}
                  {profile.input_devices?.map((d) => (
                    <span key={d} className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 bg-white/5 text-white/70 border border-white/10 rounded-sm">{d.replace(/_/g, " ")}</span>
                  ))}
                  {profile.gaming_subscriptions?.length > 0 && (
                    <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 bg-[#FFD700]/10 text-[#FFD700] border border-[#FFD700]/20 rounded-sm">{profile.gaming_subscriptions.length} Abos</span>
                  )}
                </div>
              )}
              {profile.discord_name && (
                <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-[#5865F2]/10 border border-[#5865F2]/30 rounded-sm text-sm">
                  <span className="text-[#5865F2] text-[10px] uppercase tracking-widest font-bold">Discord</span>
                  <span className="text-white">{profile.discord_name}</span>
                </div>
              )}
              <div className="mt-4 max-w-md" data-testid="profile-level-progress">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-white/45 font-bold">
                  <span>Achievement-Level</span>
                  <span>{level.points} / {level.next_level_points} Punkte</span>
                </div>
                <div className="mt-2 h-2 rounded-sm bg-white/10 overflow-hidden">
                  <div className="h-full bg-[#29B6E8]" style={{ width: `${level.progress || 0}%` }} />
                </div>
              </div>
              {/* Quick stats */}
              <div className="mt-6 grid grid-cols-3 md:grid-cols-6 gap-3">
                <QuickStat icon={Zap} label="Level" value={level.level} color="#29B6E8" testId="profile-stat-level" />
                <QuickStat icon={Medal} label="Achievements" value={achievementsData?.awards?.length || 0} testId="profile-stat-badges" />
                <QuickStat icon={Zap} label="Punkte" value={s.points || 0} color="#29B6E8" testId="profile-stat-points" />
                <QuickStat icon={Trophy} label="Siege" value={s.wins || 0} color="#FFD700" testId="profile-stat-wins" />
                <QuickStat icon={Medal} label="Podium" value={s.top3 || 0} color="#C0C0C0" testId="profile-stat-top3" />
                <QuickStat icon={TrendingUp} label="Fast Laps" value={s.fast_laps || 0} testId="profile-stat-fastlaps" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-white/10 sticky top-0 bg-[#0A0A0A]/95 backdrop-blur-sm z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-1 overflow-x-auto">
          {[
            ["overview", "Übersicht"],
            ["badges", `Achievements (${achievementsData?.awards?.length || 0})`],
            ["tournaments", `Turniere (${profile.tournaments?.length || 0})`],
            ["fastlap", `Fast Lap (${profile.f1_bests?.length || 0})`],
            ["teams", `Teams (${profile.teams?.length || 0})`],
          ].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} data-testid={`profile-tab-${k}`}
              className={`px-4 py-3 text-xs font-bold uppercase tracking-wider whitespace-nowrap transition ${tab === k ? "text-[#29B6E8] border-b-2 border-[#29B6E8]" : "text-white/60 hover:text-white"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {isPrivate && (tab === "tournaments" || tab === "fastlap" || tab === "teams") && (
          <div className="py-20 text-center text-white/40">
            <Lock className="w-8 h-8 mx-auto mb-3 opacity-50" />
            <p>Diese Daten hat {profile.display_name} privat gestellt.</p>
          </div>
        )}

        {tab === "overview" && (
          <div className="grid lg:grid-cols-3 gap-8">
            {/* Recent achievements */}
            <div className="lg:col-span-2">
              <h2 className="font-heading text-2xl font-bold uppercase mb-4 flex items-center gap-2"><Medal className="w-5 h-5 text-[#FFD700]" /> Letzte Achievements</h2>
              {achievementsData?.awards?.length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2" data-testid="profile-recent-awards">
                  {achievementsData.awards.slice(0, 4).map((a) => (
                    <div key={a.code} className="flex items-center gap-3 p-3 border border-white/10 rounded-sm bg-[#0F0F10]" style={{ boxShadow: `inset 2px 0 0 ${a.level_color}` }}>
                      <div className="w-9 h-9 rounded-sm flex items-center justify-center border" style={{ borderColor: a.level_color + "55", backgroundColor: a.level_color + "12" }}>
                        <Medal className="w-4 h-4" style={{ color: a.level_color }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: a.level_color }}>{a.level_name}</div>
                        <div className="font-semibold truncate text-sm">{a.name}</div>
                      </div>
                      <div className="text-[10px] text-white/40 tabular-nums">+{a.points}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState text="Noch keine Achievements freigeschaltet." />
              )}
              {achievementsData?.awards?.length > 4 && (
                <button onClick={() => setTab("badges")} className="mt-4 text-sm font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">Alle Achievements ansehen →</button>
              )}
            </div>
            {/* Top tournaments */}
            {profile.show_twitch_embed && profile.twitch_handle && (
              <div className="mb-8" data-testid="public-profile-twitch-embed">
                <h2 className="font-heading text-2xl font-bold uppercase mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-[#9146FF]" viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>
                  Live auf Twitch
                </h2>
                <div className="border border-[#9146FF]/30 bg-black rounded-sm overflow-hidden aspect-video">
                  <iframe
                    title={`Twitch Stream ${profile.twitch_handle}`}
                    src={`https://player.twitch.tv/?channel=${profile.twitch_handle}&parent=${window.location.hostname}&muted=true`}
                    width="100%"
                    height="100%"
                    allowFullScreen
                    frameBorder="0"
                  />
                </div>
                <a href={`https://twitch.tv/${profile.twitch_handle}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-[#9146FF] hover:text-[#a86bff]">
                  <ExternalLink className="w-3 h-3" /> twitch.tv/{profile.twitch_handle}
                </a>
              </div>
            )}

            <div>
              <h2 className="font-heading text-2xl font-bold uppercase mb-4 flex items-center gap-2"><Trophy className="w-5 h-5 text-[#29B6E8]" /> Recent Turniere</h2>
              {profile.tournaments?.length ? (
                <div className="space-y-2">
                  {profile.tournaments.slice(0, 5).map((t) => <TournamentRow key={t.id} t={t} />)}
                </div>
              ) : (
                <EmptyState text="Noch keine Turniere gespielt." />
              )}
            </div>
          </div>
        )}

        {tab === "badges" && (
          <div>
            <AchievementGroupsView groups={achievementsData?.groups || []} emptyText="Noch keine Achievements freigeschaltet." />
          </div>
        )}

        {tab === "tournaments" && !isPrivate && (
          <div className="space-y-3">
            {profile.tournaments?.length ? (
              profile.tournaments.map((t) => <TournamentRow key={t.id} t={t} expanded />)
            ) : <EmptyState text="Keine Turniere." />}
          </div>
        )}

        {tab === "fastlap" && !isPrivate && (
          <div className="space-y-2">
            {profile.f1_bests?.length ? (
              profile.f1_bests.map((f, i) => (
                <div key={i} className={`flex items-center justify-between px-4 py-3 border rounded-sm ${f.is_leader ? "border-[#FFD700]/40 bg-[#FFD700]/5" : "border-white/10 bg-[#121212]"}`}>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold truncate">{f.challenge?.title || "—"}</div>
                    <div className="font-heading text-lg font-bold truncate">{f.track?.name || "—"}{f.track?.country ? ` · ${f.track.country}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {f.is_leader && <span className="text-[10px] uppercase tracking-widest text-[#FFD700] font-bold">Pole</span>}
                    <span className="font-display text-xl font-bold tabular-nums">{f.time_str}</span>
                  </div>
                </div>
              ))
            ) : <EmptyState text="Keine Fast-Lap-Zeiten eingetragen." />}
          </div>
        )}

        {tab === "teams" && !isPrivate && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {profile.teams?.length ? (
              profile.teams.map((tm) => (
                <Link key={tm.id} to={`/teams/${tm.id}`} className="border border-white/10 rounded-sm p-4 bg-[#121212] hover:border-[#29B6E8]/60 transition">
                  <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">[{tm.tag}]</div>
                  <div className="font-heading text-xl font-bold">{tm.name}</div>
                  {tm.description && <p className="mt-2 text-sm text-white/60 line-clamp-2">{tm.description}</p>}
                </Link>
              ))
            ) : <EmptyState text="Noch kein Team." />}
          </div>
        )}
      </div>
    </PublicLayout>
  );
}

function QuickStat({ icon: Icon, label, value, color = "#FFFFFF", testId }) {
  return (
    <div data-testid={testId} className="border border-white/10 rounded-sm bg-[#121212] px-3 py-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/40"><Icon className="w-3 h-3" /> {label}</div>
      <div className="mt-1 font-display font-bold text-2xl tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

function TournamentRow({ t, expanded = false }) {
  const date = t.start_date ? new Date(t.start_date) : null;
  return (
    <Link to={`/tournaments/${t.slug || t.id}`} data-testid={`profile-tournament-${t.slug}`} className="flex items-center justify-between gap-3 px-4 py-3 border border-white/10 rounded-sm bg-[#121212] hover:border-[#29B6E8]/60 transition">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <StatusBadge status={t.status} />
          {t.final_position === 1 && <span className="text-[10px] font-bold uppercase tracking-widest text-[#FFD700] border border-[#FFD700]/40 px-1.5 py-0.5 rounded-sm">Sieger</span>}
          {t.final_position > 1 && t.final_position <= 3 && <span className="text-[10px] font-bold uppercase tracking-widest text-[#CD7F32] border border-[#CD7F32]/40 px-1.5 py-0.5 rounded-sm">Top 3</span>}
        </div>
        <div className="mt-1 font-heading text-base font-bold truncate">{t.title}</div>
        <div className="text-xs text-white/50 mt-0.5 flex items-center gap-2">
          {t.game?.name && <span>{t.game.name}</span>}
          {date && <span>· {date.toLocaleDateString("de-DE")}</span>}
          {expanded && t.final_position && <span>· Endplatz: <span className="text-white">{t.final_position}</span></span>}
        </div>
      </div>
      <ExternalLink className="w-4 h-4 text-white/30 shrink-0" />
    </Link>
  );
}

function EmptyState({ text }) {
  return <div className="py-12 text-center text-white/40 font-display tracking-widest text-sm">{text}</div>;
}
