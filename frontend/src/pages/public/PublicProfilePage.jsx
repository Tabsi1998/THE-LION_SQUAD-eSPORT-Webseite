import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, formatMs } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { BadgeGrid, BadgeCard } from "@/components/tls/BadgeGrid";
import { StatusBadge } from "@/components/tls/StatusBadge";
import {
  Trophy, Flag, Users as UsersIcon, Medal, Shield, Calendar,
  MapPin, Zap, TrendingUp, Lock, ExternalLink,
} from "lucide-react";

export default function PublicProfilePage() {
  const { username } = useParams();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/users/public/${username}`);
        setProfile(data);
      } catch { setProfile(null); }
      setLoading(false);
    })();
  }, [username]);

  if (loading) return <PublicLayout><div className="p-20 text-center font-display tracking-widest text-white/40">LADE PROFIL …</div></PublicLayout>;
  if (!profile) return <PublicLayout><div className="p-20 text-center">
    <h1 className="font-heading text-3xl uppercase">Spieler nicht gefunden</h1>
    <Link to="/" className="inline-block mt-4 text-[#29B6E8] hover:underline">← Zurück zur Startseite</Link>
  </div></PublicLayout>;

  const s = profile.stats || {};
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
          <div className="flex flex-col md:flex-row gap-8 items-start">
            <div className="shrink-0">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.display_name} className="w-32 h-32 md:w-40 md:h-40 rounded-sm border-2 border-[#29B6E8]/40 object-cover" />
              ) : (
                <div className="w-32 h-32 md:w-40 md:h-40 rounded-sm border-2 border-[#29B6E8]/40 bg-gradient-to-br from-[#29B6E8]/20 to-[#121212] flex items-center justify-center font-display font-black text-5xl text-[#29B6E8]">
                  {(profile.display_name || profile.username || "?").slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">
                <span>TLS ARENA · Spieler</span>
                {isPrivate && <span className="inline-flex items-center gap-1 text-white/40"><Lock className="w-3 h-3" /> Privat</span>}
              </div>
              <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase leading-[0.95] tracking-tight truncate">
                {profile.display_name || profile.username}
              </h1>
              <div className="mt-2 text-white/50 text-sm flex flex-wrap items-center gap-3">
                <span>@{profile.username}</span>
                {profile.country && <span>· <MapPin className="w-3.5 h-3.5 inline mr-1" />{profile.country}</span>}
                {joinedDate && <span>· <Calendar className="w-3.5 h-3.5 inline mr-1" />Mitglied seit {joinedDate.toLocaleDateString("de-DE", { month: "long", year: "numeric" })}</span>}
                {profile.role && profile.role !== "player" && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-[#FFD700]/40 text-[#FFD700] text-[10px] uppercase tracking-widest rounded-sm">
                    <Shield className="w-3 h-3" /> {profile.role.replace("_", " ")}
                  </span>
                )}
              </div>
              {profile.bio && <p className="mt-4 text-white/80 text-base max-w-2xl leading-relaxed">{profile.bio}</p>}
              {profile.discord_name && (
                <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-[#5865F2]/10 border border-[#5865F2]/30 rounded-sm text-sm">
                  <span className="text-[#5865F2] text-[10px] uppercase tracking-widest font-bold">Discord</span>
                  <span className="text-white">{profile.discord_name}</span>
                </div>
              )}
              {/* Quick stats */}
              <div className="mt-6 grid grid-cols-3 md:grid-cols-6 gap-3">
                <QuickStat icon={Medal} label="Badges" value={s.badges || 0} data-testid="profile-stat-badges" />
                <QuickStat icon={Zap} label="Punkte" value={s.points || 0} color="#29B6E8" />
                <QuickStat icon={Trophy} label="Siege" value={s.wins || 0} color="#FFD700" />
                <QuickStat icon={Medal} label="Podium" value={s.top3 || 0} color="#C0C0C0" />
                <QuickStat icon={TrendingUp} label="Fast Laps" value={s.fast_laps || 0} />
                <QuickStat icon={Flag} label="Pole Pos." value={s.pole_positions || 0} color="#FFD700" />
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
            ["badges", `Badges (${s.badges || 0})`],
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
            {/* Recent badges */}
            <div className="lg:col-span-2">
              <h2 className="font-heading text-2xl font-bold uppercase mb-4 flex items-center gap-2"><Medal className="w-5 h-5 text-[#FFD700]" /> Letzte Badges</h2>
              {profile.badges?.length ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {profile.badges.slice(0, 6).map((b) => <BadgeCard key={b.code} badge={b} />)}
                </div>
              ) : (
                <EmptyState text="Noch keine Badges freigeschaltet." />
              )}
              {profile.badges?.length > 6 && (
                <button onClick={() => setTab("badges")} className="mt-4 text-sm font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">Alle Badges ansehen →</button>
              )}
            </div>
            {/* Top tournaments */}
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
            {profile.badges?.length ? (
              <BadgeGrid badges={profile.badges} />
            ) : (
              <EmptyState text="Noch keine Badges freigeschaltet." />
            )}
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

function QuickStat({ icon: Icon, label, value, color = "#FFFFFF" }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] px-3 py-3">
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
