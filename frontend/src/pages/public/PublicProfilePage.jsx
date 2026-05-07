import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, formatMs, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { AchievementGroupsView } from "@/components/tls/AchievementGroups";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { AccountLevelPill, AccountLevelProgress, accountLevelFrameClass } from "@/components/tls/AccountLevel";
import { useCookieConsent } from "@/components/tls/CookieConsent";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import {
  Trophy, Flag, Users as UsersIcon, Medal, Shield, Calendar,
  MapPin, Zap, TrendingUp, Lock, ExternalLink, Radio, Gamepad2, Globe,
} from "lucide-react";

function normalizeTwitchChannel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw.replace(/^@/, "")}`);
    if (/(^|\.)twitch\.tv$/i.test(parsed.hostname)) {
      return (parsed.pathname.split("/").filter(Boolean)[0] || "").replace(/^@/, "").toLowerCase();
    }
  } catch {
    // Fall through to handle cleanup below.
  }
  return raw.replace(/^@/, "").replace(/^twitch\.tv\//i, "").replace(/^www\.twitch\.tv\//i, "").split(/[/?#]/)[0].toLowerCase();
}

function twitchPlayerSrc(channel) {
  const params = new URLSearchParams({
    channel,
    parent: window.location.hostname,
    muted: "true",
    autoplay: "false",
  });
  return `https://player.twitch.tv/?${params.toString()}`;
}

function externalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function cleanHandle(value) {
  return String(value || "").trim().replace(/^@/, "");
}

function socialUrl(platform, value) {
  const kind = String(platform || "").toLowerCase();
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const handle = cleanHandle(raw);
  if (kind === "youtube") return `https://www.youtube.com/@${handle}`;
  if (kind === "instagram") return `https://www.instagram.com/${handle}`;
  if (kind === "tiktok") return `https://www.tiktok.com/@${handle}`;
  if (kind === "x" || kind === "twitter") return `https://x.com/${handle}`;
  if (kind === "steam") {
    return /^\d{17}$/.test(handle)
      ? `https://steamcommunity.com/profiles/${handle}`
      : `https://steamcommunity.com/id/${handle}`;
  }
  return "";
}

function publicSocialLinks(profile, twitchUrl) {
  const links = [
    profile.discord_name && { platform: "discord", label: "Discord", value: profile.discord_name },
    twitchUrl && { platform: "twitch", label: "Twitch", value: normalizeTwitchChannel(profile.twitch_handle), url: twitchUrl },
    profile.youtube_handle && { platform: "youtube", label: "YouTube", value: cleanHandle(profile.youtube_handle), url: socialUrl("youtube", profile.youtube_handle) },
    profile.instagram_handle && { platform: "instagram", label: "Instagram", value: cleanHandle(profile.instagram_handle), url: socialUrl("instagram", profile.instagram_handle) },
    profile.tiktok_handle && { platform: "tiktok", label: "TikTok", value: cleanHandle(profile.tiktok_handle), url: socialUrl("tiktok", profile.tiktok_handle) },
    profile.x_handle && { platform: "x", label: "X", value: cleanHandle(profile.x_handle), url: socialUrl("x", profile.x_handle) },
    profile.website && { platform: "website", label: "Website", value: profile.website, url: externalUrl(profile.website) },
  ].filter(Boolean);

  const extra = (profile.socials || []).map((social) => ({
    platform: String(social.platform || "").toLowerCase(),
    label: social.platform,
    value: social.value || social.url,
    url: social.url || socialUrl(social.platform, social.value) || (/^https?:\/\//i.test(String(social.value || "")) ? externalUrl(social.value) : ""),
  })).filter((social) => social.value);

  const seen = new Set();
  return [...links, ...extra].filter((link) => {
    const key = `${String(link.platform || link.label).toLowerCase()}:${String(link.url || link.value).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function socialMeta(link) {
  const platform = String(link.platform || link.label || "").toLowerCase();
  if (platform.includes("discord")) return { key: "discord", label: "Discord", color: "#5865F2" };
  if (platform.includes("twitch")) return { key: "twitch", label: "Twitch", color: "#9146FF" };
  if (platform.includes("youtube")) return { key: "youtube", label: "YouTube", color: "#FF0000" };
  if (platform.includes("instagram")) return { key: "instagram", label: "Instagram", color: "#E4405F" };
  if (platform.includes("tiktok")) return { key: "tiktok", label: "TikTok", color: "#69C9D0" };
  if (platform === "x" || platform.includes("twitter")) return { key: "x", label: "X", color: "#FFFFFF" };
  if (platform.includes("website") || platform.includes("web")) return { key: "website", label: "Website", color: "#29B6E8" };
  return { key: "website", label: link.label || "Link", color: "#29B6E8" };
}

function SocialIcon({ kind, className = "w-4 h-4" }) {
  if (kind === "discord") return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.25-.192.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.956 2.42-2.157 2.42Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.946 2.42-2.157 2.42Z" /></svg>;
  if (kind === "twitch") return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" /></svg>;
  if (kind === "youtube") return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814ZM9.545 15.568V8.432L15.818 12z" /></svg>;
  if (kind === "instagram") return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069ZM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12s.014 3.668.072 4.948c.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24s3.668-.014 4.948-.072c4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948s-.014-3.667-.072-4.947c-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0Zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881Z" /></svg>;
  if (kind === "tiktok") return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.1Z" /></svg>;
  if (kind === "x") return <svg className={className} viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2h3.308l-7.227 8.26L22.827 22h-6.657l-5.214-6.817L4.99 22H1.68l7.73-8.835L1.254 2h6.826l4.713 6.231Zm-1.161 17.93h1.833L7.084 3.963H5.117Z" /></svg>;
  return <Globe className={className} />;
}

function publicGamingIds(profile) {
  return [
    profile.steam_id && { label: "Steam", value: profile.steam_id, url: socialUrl("steam", profile.steam_id) },
    profile.epic_id && { label: "Epic", value: profile.epic_id },
    profile.psn_id && { label: "PSN", value: profile.psn_id },
    profile.xbox_id && { label: "Xbox", value: profile.xbox_id },
    profile.nintendo_fc && { label: "Nintendo", value: profile.nintendo_fc },
    profile.ea_id && { label: "EA", value: profile.ea_id },
    profile.riot_id && { label: "Riot", value: profile.riot_id },
    profile.battlenet_id && { label: "Battle.net", value: profile.battlenet_id },
  ].filter(Boolean);
}

export default function PublicProfilePage() {
  const { username } = useParams();
  const [profile, setProfile] = useState(null);
  const [achievementsData, setAchievementsData] = useState(null);
  const [liveStreams, setLiveStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const { hasConsent, openSettings } = useCookieConsent();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/users/public/${username}`);
      setProfile(data);
      api.get("/streams/live").then(({ data: streams }) => setLiveStreams(Array.isArray(streams) ? streams : [])).catch(() => setLiveStreams([]));
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
  const avatarFrame = accountLevelFrameClass(level.level);
  const twitchChannel = normalizeTwitchChannel(profile.twitch_handle);
  const twitchUrl = twitchChannel ? `https://www.twitch.tv/${twitchChannel}` : "";
  const liveStream = twitchChannel
    ? liveStreams.find((stream) => stream.twitch_login === twitchChannel || stream.username === profile.username || stream.user_id === profile.id)
    : null;
  const socialLinks = publicSocialLinks(profile, twitchUrl);
  const gamingIds = publicGamingIds(profile);

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
                <img src={resolveMediaUrl(profile.avatar_url)} alt={profile.display_name} className={`w-32 h-32 md:w-40 md:h-40 rounded-sm border-2 ${avatarFrame} object-cover`} />
              ) : (
                <div className={`w-32 h-32 md:w-40 md:h-40 rounded-sm border-2 ${avatarFrame} bg-gradient-to-br from-[#29B6E8]/20 to-[#121212] flex items-center justify-center font-display font-black text-5xl text-[#29B6E8]`}>
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
                <AccountLevelPill level={level.level} />
                {liveStream && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-[#FF3B30]/50 text-[#FF3B30] text-[10px] uppercase tracking-widest rounded-sm">
                    <Radio className="w-3 h-3 animate-live" /> Live
                  </span>
                )}
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
              <div className="mt-4 max-w-md" data-testid="profile-level-progress">
                <AccountLevelProgress level={level.level} points={level.points} nextLevelPoints={level.next_level_points} progress={level.progress} />
              </div>
              {/* Quick stats */}
              <div className="mt-6 grid grid-cols-3 md:grid-cols-6 gap-3">
                <QuickStat icon={Zap} label="Level" value={level.level} color="#29B6E8" testId="profile-stat-level" />
                <QuickStat icon={Medal} label="Achievements" value={achievementsData?.awards?.length || 0} testId="profile-stat-badges" />
                {(twitchChannel || s.twitch_live_sessions > 0) && (
                  <QuickStat icon={Radio} label="Streams" value={s.twitch_live_sessions || 0} color="#9146FF" testId="profile-stat-streams" />
                )}
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
            <div className="space-y-6">
              {profile.show_twitch_embed && twitchChannel && (
                <div data-testid="public-profile-twitch-embed">
                  <h2 className="font-heading text-2xl font-bold uppercase mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-[#9146FF]" viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>
                    Live auf Twitch
                  </h2>
                  {hasConsent("external_media") ? (
                    <div className="border border-[#9146FF]/30 bg-black rounded-sm overflow-hidden aspect-video">
                      <iframe
                        title={`Twitch Stream ${twitchChannel}`}
                        src={twitchPlayerSrc(twitchChannel)}
                        width="100%"
                        height="100%"
                        allow="autoplay; fullscreen; picture-in-picture"
                        allowFullScreen
                        frameBorder="0"
                      />
                    </div>
                  ) : (
                    <div className="border border-[#9146FF]/30 bg-[#121212] rounded-sm p-6">
                      <div className="font-heading font-black uppercase">Twitch blockiert</div>
                      <p className="mt-2 text-sm text-white/60">Für Twitch-Einbettungen brauchen wir deine Zustimmung zu externen Medien.</p>
                      <button type="button" onClick={openSettings} className="mt-4 px-4 py-2 border border-[#9146FF]/50 text-[#b88cff] text-xs uppercase tracking-wider font-bold rounded-sm">Cookie-Einstellungen</button>
                    </div>
                  )}
                  <a href={twitchUrl} target="_blank" rel="noopener noreferrer" aria-label="Twitch öffnen" title="Twitch öffnen" className="mt-2 inline-flex h-9 w-9 items-center justify-center border border-[#9146FF]/40 text-[#9146FF] hover:border-[#9146FF] hover:text-[#b88cff] rounded-sm transition">
                    <SocialIcon kind="twitch" className="w-4 h-4" />
                  </a>
                  {liveStream && (
                    <div className="mt-2 text-xs text-white/55">
                      <span className="text-[#FF3B30] font-bold uppercase tracking-widest">Jetzt live:</span> {liveStream.title || "Stream läuft"}
                      {liveStream.viewer_count ? ` · ${liveStream.viewer_count} Zuschauer` : ""}
                    </div>
                  )}
                  {s.twitch_stream_minutes > 0 && (
                    <div className="mt-1 text-[11px] text-white/35">
                      Erkannte Streamzeit: {Math.round(s.twitch_stream_minutes / 60)} Stunden in {s.twitch_live_sessions || 0} Sessions.
                    </div>
                  )}
                  <p className="mt-1 text-[11px] text-white/35">
                    Falls Twitch eine Inhaltsklassifizierung blockiert, öffne den Stream direkt bei Twitch. Das kommt vom Twitch-Player, nicht vom TLS-Profil.
                  </p>
                </div>
              )}

              {socialLinks.length > 0 && <ProfileLinksCard links={socialLinks} />}
              {gamingIds.length > 0 && <GamingIdsCard ids={gamingIds} />}

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
          </div>
        )}

        {tab === "badges" && (
          <div>
            <AchievementGroupsView groups={achievementsData?.groups || []} earnedOnly emptyText="Noch keine Achievements freigeschaltet." />
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

function ProfileLinksCard({ links }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="public-profile-socials">
      <h2 className="font-heading text-xl font-bold uppercase mb-3 flex items-center gap-2">
        <Globe className="w-4 h-4 text-[#29B6E8]" /> Socials
      </h2>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => {
          const meta = socialMeta(link);
          const key = `${meta.key}:${link.url || link.value}`;
          const className = "inline-flex h-10 w-10 items-center justify-center border border-white/10 bg-[#0A0A0A] rounded-sm text-white/70 transition hover:bg-white/[0.03]";
          const style = { "--social-color": meta.color };
          if (link.url) {
            return (
              <a
                key={key}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${meta.label} öffnen`}
                title={`${meta.label} öffnen`}
                data-testid={`profile-social-${meta.key}`}
                className={`${className} hover:border-[var(--social-color)] hover:text-[var(--social-color)]`}
                style={style}
              >
                <SocialIcon kind={meta.key} />
              </a>
            );
          }
          return (
            <span
              key={key}
              aria-label={`${meta.label} angegeben`}
              title={`${meta.label} angegeben`}
              data-testid={`profile-social-${meta.key}`}
              className={`${className} cursor-default border-[var(--social-color)]/40 text-[var(--social-color)]`}
              style={style}
            >
              <SocialIcon kind={meta.key} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

function GamingIdsCard({ ids }) {
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="public-profile-gaming-ids">
      <h2 className="font-heading text-xl font-bold uppercase mb-3 flex items-center gap-2">
        <Gamepad2 className="w-4 h-4 text-[#FFD700]" /> Gaming IDs
      </h2>
      <div className="grid gap-2">
        {ids.map((id) => (
          <div key={`${id.label}:${id.value}`} className="border border-white/10 bg-[#0A0A0A] px-3 py-2 rounded-sm">
            <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{id.label}</div>
            {id.url ? (
              <a href={id.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 text-sm text-white/85 hover:text-[#29B6E8]">
                <span className="truncate">{id.value}</span><ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            ) : (
              <div className="mt-1 text-sm text-white/85 break-all">{id.value}</div>
            )}
          </div>
        ))}
      </div>
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
