import { countryName } from "@/lib/countries";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatLinkedAt } from "@/lib/platformLinks";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { AchievementGroupsView } from "@/components/tls/AchievementGroups";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { AccountLevelPill, AccountLevelProgress } from "@/components/tls/AccountLevel";
import { LevelAvatarFrame, useCrownFor } from "@/components/tls/LevelAvatarFrame";
import { SeasonHighlightCard } from "@/components/tls/SeasonHighlightCard";
import { AwardBanner } from "@/components/tls/AwardBanner";
import { useCookieConsent } from "@/components/tls/CookieConsent";
import { ExternalMediaNotice } from "@/components/tls/ExternalMediaNotice";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { gameLabel } from "@/lib/gameLabels";
import { seoTextPreview } from "@/lib/textPreview";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  Trophy, Flag, Medal, Shield, Calendar,
  MapPin, Zap, TrendingUp, Lock, ExternalLink, Radio, Gamepad2, Globe,
  MessageSquare, UserPlus, UserCheck, X, Info, Cake, Crown,
  Monitor, Keyboard, BadgeCheck, Heart, Users, Sparkles,
} from "lucide-react";
import { toast } from "sonner";

// Öffentliches Profil, Umbau 24.09.: Banner als echtes Banner mit überlappendem Avatar, eine Zeile
// mit Level, Rolle und verknüpften Konten, eine Zahlenleiste, fünf Reiter (Übersicht, Achievements,
// Auszeichnungen, Referenzen mit Turnieren und Fast Laps, Teams). Die Übersicht zeigt links die
// Erfolge (Podestplätze, Auszeichnungen, Achievements, Referenzen) und rechts eine Konten-Karte,
// „Über“, Setup und Teams; der Twitch-Player steht nur, wenn der Stream gerade läuft.

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

function copyText(value, successMessage = "Kopiert.") {
  const text = String(value || "").trim();
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  navigator.clipboard.writeText(text)
    .then(() => toast.success(successMessage))
    .catch(() => toast.error("Konnte nicht kopiert werden."));
}

function formatPublicDate(value) {
  if (!value) return "";
  const raw = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
}

const ROLE_LABELS = {
  player: "Spieler",
  team_leader: "Teamleitung",
  moderator: "Moderator",
  tournament_admin: "Turnier-Admin",
  club_admin: "Club-Admin",
  superadmin: "Superadmin",
};

const MEMBERSHIP_TYPE_LABELS = {
  ordinary: "Ordentliches Mitglied",
  supporting: "Unterstützendes Mitglied",
  honorary: "Ehrenmitglied",
  youth: "Jugendmitglied",
  guest: "Gastmitglied",
  former: "Ehemaliges Mitglied",
};

const PLATFORM_LABELS = {
  PC: "PC",
  PS5: "PlayStation 5",
  PS4: "PlayStation 4",
  Xbox: "Xbox Series",
  Xbox_One: "Xbox One",
  Switch2: "Switch 2",
  Switch: "Switch",
  Mobile: "Mobile",
  Steam_Deck: "Steam Deck",
  VR: "VR",
};

const INPUT_DEVICE_LABELS = {
  keyboard_mouse: "Tastatur + Maus",
  controller: "Controller",
  wheel: "Lenkrad",
  fightstick: "Fightstick",
  mobile_touch: "Touch / Mobile",
  arcade: "Arcade Stick",
};

const SUBSCRIPTION_LABELS = {
  nintendo_online: "Nintendo Online",
  nintendo_online_expansion: "Nintendo Online + Expansion",
  ps_plus_essential: "PS Plus Essential",
  ps_plus_extra: "PS Plus Extra",
  ps_plus_premium: "PS Plus Premium",
  xbox_game_pass: "Xbox Game Pass",
  xbox_game_pass_ultimate: "Xbox Game Pass Ultimate",
  ea_play: "EA Play",
  ea_play_pro: "EA Play Pro",
  ubisoft_plus: "Ubisoft+",
  geforce_now: "GeForce NOW",
};

const RANK_TONES = {
  1: { color: "#FFD700", label: "Gold" },
  2: { color: "#C0C0C0", label: "Silber" },
  3: { color: "#CD7F32", label: "Bronze" },
};

const REFERENCE_FILTERS = [
  ["all", "Alle"],
  ["tournament", "Turniere"],
  ["fastlap", "Fast Lap"],
  ["season", "Jahreswertung"],
];

function labelValue(value, labels = {}) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return labels[raw] || raw.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function listItems(value, labels = {}) {
  const rawItems = Array.isArray(value) ? value : (value ? [value] : []);
  return rawItems.filter(Boolean).map((item) => labelValue(item, labels));
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
    profile.discord_name && { platform: "discord", label: "Discord", value: profile.discord_name, verified: isVerified(profile, "discord") },
    twitchUrl && { platform: "twitch", label: "Twitch", value: normalizeTwitchChannel(profile.twitch_handle), url: twitchUrl, verified: isVerified(profile, "twitch") },
    profile.youtube_handle && { platform: "youtube", label: "YouTube", value: cleanHandle(profile.youtube_handle), url: socialUrl("youtube", profile.youtube_handle), verified: isVerified(profile, "youtube") },
    profile.instagram_handle && { platform: "instagram", label: "Instagram", value: cleanHandle(profile.instagram_handle), url: socialUrl("instagram", profile.instagram_handle) },
    profile.tiktok_handle && { platform: "tiktok", label: "TikTok", value: cleanHandle(profile.tiktok_handle), url: socialUrl("tiktok", profile.tiktok_handle), verified: isVerified(profile, "tiktok") },
    profile.x_handle && { platform: "x", label: "X", value: cleanHandle(profile.x_handle), url: socialUrl("x", profile.x_handle), verified: isVerified(profile, "x") },
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
  if (platform.includes("steam")) return { key: "steam", label: "Steam", color: "#66C0F4" };
  if (platform.includes("battle")) return { key: "battlenet", label: "Battle.net", color: "#148EFF" };
  if (platform.includes("riot")) return { key: "riot", label: "Riot Games", color: "#D13639" };
  if (platform.includes("xbox")) return { key: "xbox", label: "Xbox", color: "#107C10" };
  if (platform.includes("epic")) return { key: "epic", label: "Epic Games", color: "#C8C8C8" };
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
  if (kind === "steam") return <Gamepad2 className={className} />;
  if (kind === "battlenet") return <Globe className={className} />;
  if (kind === "riot") return <Zap className={className} />;
  if (kind === "xbox") return <Gamepad2 className={className} />;
  if (kind === "epic") return <Flag className={className} />;
  return <Globe className={className} />;
}

// Verknüpfte Konten (#260): das Häkchen kommt vom Server, nie aus dem Text.
function isVerified(profile, platform) {
  return Array.isArray(profile?.verified_platforms) && profile.verified_platforms.includes(platform);
}

function publicGamingIds(profile) {
  return [
    profile.steam_id && { label: "Steam", value: profile.steam_id, url: socialUrl("steam", profile.steam_id), verified: isVerified(profile, "steam") },
    profile.epic_id && { label: "Epic", value: profile.epic_id, verified: isVerified(profile, "epic") },
    profile.psn_id && { label: "PSN", value: profile.psn_id },
    profile.xbox_id && { label: "Xbox", value: profile.xbox_id, url: `https://www.xbox.com/play/user/${encodeURIComponent(profile.xbox_id)}`, verified: isVerified(profile, "xbox") },
    profile.nintendo_fc && { label: "Nintendo", value: profile.nintendo_fc },
    profile.ea_id && { label: "EA", value: profile.ea_id },
    profile.riot_id && { label: "Riot", value: profile.riot_id, verified: isVerified(profile, "riot") },
    profile.battlenet_id && { label: "Battle.net", value: profile.battlenet_id, verified: isVerified(profile, "battlenet") },
  ].filter(Boolean);
}

// Podestplätze zuerst nach Rang, dann nach Datum - die drei besten stehen als Highlights oben.
export function podiumHighlights(items, limit = 3) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => Number(item?.rank) >= 1 && Number(item.rank) <= 3)
    .sort((a, b) => (Number(a.rank) - Number(b.rank)) || (new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()))
    .slice(0, limit);
}

export default function PublicProfilePage() {
  const { username } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [achievementsData, setAchievementsData] = useState(null);
  const [liveStreams, setLiveStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [referenceFilter, setReferenceFilter] = useState("all");
  const seoDescription = seoTextPreview(profile?.bio, "Community-Profil bei THE LION SQUAD eSports.");
  useDocumentTitle(profile?.display_name || profile?.username || "Community-Profil", seoDescription, {
    image: profile?.avatar_url || profile?.banner_url,
    type: "profile",
    robots: "noindex, follow",
    canonical: profile?.username ? `${window.location.origin}/u/${profile.username}` : undefined,
  });
  const { hasConsent } = useCookieConsent();

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
  const crown = useCrownFor(profile?.id);
  const [showHighlight, setShowHighlight] = useState(false);

  if (loading) return <PublicLayout><div className="p-20 text-center font-display tracking-widest text-white/40">LADE PROFIL …</div></PublicLayout>;
  if (!profile) return <PublicLayout><div className="p-20 text-center">
    <h1 className="font-heading text-3xl uppercase">Spieler nicht gefunden</h1>
    <Link to="/" className="inline-block mt-4 text-[#29B6E8] hover:underline">← Zurück zur Startseite</Link>
  </div></PublicLayout>;

  const s = profile.stats || {};
  const level = profile.achievement_level || { level: s.level || 1, progress: 0, points: s.points || 0, next_level_points: 100 };
  const isPrivate = profile.privacy_public_profile === false;
  const joinedDate = profile.created_at ? new Date(profile.created_at) : null;
  const twitchChannel = normalizeTwitchChannel(profile.twitch_handle);
  const twitchUrl = twitchChannel ? `https://www.twitch.tv/${twitchChannel}` : "";
  const liveStream = twitchChannel
    ? liveStreams.find((stream) => stream.twitch_login === twitchChannel || stream.username === profile.username || stream.user_id === profile.id)
    : null;
  const socialLinks = publicSocialLinks(profile, twitchUrl);
  const linkedAccounts = Array.isArray(profile?.linked_accounts) ? profile.linked_accounts : [];
  const gamingIds = publicGamingIds(profile);
  const profileReferences = Array.isArray(profile.references)
    ? { items: profile.references, stats: { total: profile.references.length, tournaments: 0, fastlaps: 0, wins: 0, podiums: 0 } }
    : (profile.references || { items: [], stats: { total: 0, tournaments: 0, fastlaps: 0, wins: 0, podiums: 0 } });
  const referenceItems = Array.isArray(profileReferences.items) ? profileReferences.items : [];
  const referenceStats = profileReferences.stats || {};
  const highlights = podiumHighlights(referenceItems);
  const referenceTargets = new Set(referenceItems.map((item) => item.target_id).filter(Boolean));
  const awards = Array.isArray(profile.awards) ? profile.awards : [];
  const badges = Array.isArray(achievementsData?.awards) ? achievementsData.awards : [];
  const teams = Array.isArray(profile.teams) ? profile.teams : [];
  const tournaments = Array.isArray(profile.tournaments) ? profile.tournaments : [];
  const fastLaps = Array.isArray(profile.f1_bests) ? profile.f1_bests : [];
  // Turniere mit Ergebnis sind Referenzen; hier bleiben laufende, kommende und solche ohne Ergebnis.
  const openTournaments = tournaments.filter((t) => !referenceTargets.has(t.slug) && !referenceTargets.has(t.id));
  const relationship = profile.relationship || { status: user?.id === profile.id ? "self" : "anonymous" };
  const isOwnProfile = user?.id === profile.id;
  const displayName = profile.display_name || profile.username;
  const referenceKinds = new Set(referenceItems.map((item) => item.kind || "tournament"));
  const referenceFilters = REFERENCE_FILTERS.filter(([key]) => key === "all" || referenceKinds.has(key));
  const filteredReferences = referenceFilter === "all" ? referenceItems : referenceItems.filter((item) => (item.kind || "tournament") === referenceFilter);
  const showTwitchLive = Boolean(profile.show_twitch_embed && twitchChannel && liveStream);
  const showTwitchChannel = Boolean(profile.show_twitch_embed && twitchChannel && !liveStream);
  const hasOverviewContent = highlights.length > 0 || awards.length > 0 || badges.length > 0 || referenceItems.length > 0 || showTwitchLive;

  // Auszeichnung als Profilbanner (#230): nur eigene; der Server prüft das und die Seite lädt neu.
  const featureAward = async (awardId) => {
    try {
      if (awardId) await api.post(`/me/awards/${awardId}/feature`);
      else await api.delete("/me/awards/feature");
      toast.success(awardId ? "Als Profilbanner gesetzt." : "Profilbanner entfernt.");
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Das hat nicht geklappt."));
    }
  };

  const updateFriendship = async (action) => {
    if (!user) {
      nav(`/login?next=/u/${encodeURIComponent(profile.username)}`);
      return;
    }
    try {
      if (action === "request") {
        const { data } = await api.post(`/friends/${profile.id}/request`);
        setProfile((cur) => ({ ...cur, relationship: data }));
        toast.success("Freundschaftsanfrage gesendet.");
      } else if (action === "accept") {
        await api.post(`/friends/${relationship.id}/accept`);
        setProfile((cur) => ({ ...cur, relationship: { ...relationship, status: "accepted", incoming: false, outgoing: false } }));
        toast.success("Freundschaftsanfrage angenommen.");
      } else if (action === "decline") {
        await api.post(`/friends/${relationship.id}/decline`);
        setProfile((cur) => ({ ...cur, relationship: { status: "declined", can_request: true } }));
        toast.success("Freundschaftsanfrage abgelehnt.");
      } else if (action === "remove") {
        await api.delete(`/friends/${profile.id}`);
        setProfile((cur) => ({ ...cur, relationship: { status: "removed", can_request: true } }));
        toast.success("Freundschaft entfernt.");
      }
    } catch (err) {
      toast.error(formatRequestError(err, "Freundschaft konnte nicht verarbeitet werden."));
    }
  };

  const openMessage = () => {
    if (!user) {
      nav(`/login?next=/u/${encodeURIComponent(profile.username)}`);
      return;
    }
    nav(`/messages/${encodeURIComponent(profile.id)}`);
  };

  const headerStats = [
    { key: "points", icon: Zap, label: "Punkte", value: s.points || 0, color: "#29B6E8" },
    { key: "badges", icon: Medal, label: "Achievements", value: badges.length },
    { key: "wins", icon: Trophy, label: "Siege", value: s.wins || 0, color: "#FFD700", glory: true },
    { key: "top3", icon: Medal, label: "Podium", value: s.top3 || 0, color: "#C0C0C0", glory: true },
    { key: "tournaments", icon: Flag, label: "Turniere", value: s.tournaments || tournaments.length || 0 },
    { key: "fastlaps", icon: TrendingUp, label: "Fast Laps", value: s.fast_laps || 0 },
    ...((twitchChannel || s.twitch_live_sessions > 0) ? [{ key: "streams", icon: Radio, label: "Streams", value: s.twitch_live_sessions || 0, color: "#9146FF" }] : []),
  ];

  const tabs = [
    ["overview", "Übersicht"],
    ["badges", `Achievements (${badges.length})`],
    ["awards", `Auszeichnungen (${awards.length})`],
    ["references", `Referenzen (${referenceStats.total || referenceItems.length})`],
    ["teams", `Teams (${teams.length})`],
  ];

  const lockedTab = isPrivate && (tab === "references" || tab === "teams");

  return (
    <PublicLayout>
      {showHighlight && (
        <SeasonHighlightCard
          profile={profile}
          level={level}
          stats={s}
          awards={badges}
          crown={crown}
          onClose={() => setShowHighlight(false)}
        />
      )}

      {/* Kopf: Banner, Avatar darüber, Name, Pillen, Aktionen, Level und verknüpfte Konten, Zahlen */}
      <header className="border-b border-white/10" data-testid="profile-hero">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Spieler", to: "/players" }, { label: displayName }]} />
        </div>
        <div className="relative h-44 sm:h-56 lg:h-72 overflow-hidden bg-[#0F0F10]" data-testid="profile-banner">
          {profile.banner_url ? (
            <img src={resolveMediaUrl(profile.banner_url)} alt="" className="absolute inset-0 w-full h-full object-cover object-[50%_30%]" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#29B6E8]/30 via-[#0A0A0A] to-[#FFD700]/15">
              <div className="absolute -top-10 left-1/4 w-[420px] h-[420px] rounded-full bg-[#29B6E8] blur-[160px] opacity-20" />
              <div className="absolute -bottom-20 right-1/4 w-[360px] h-[360px] rounded-full bg-[#FFD700] blur-[160px] opacity-10" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/35 to-transparent" />
          {/* Auszeichnung als Profilbanner (#230): das gewählte Banner liegt rechts unten im Bannerbereich. */}
          {profile.featured_award && (
            <div className="absolute inset-x-0 bottom-3 sm:bottom-5">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-end">
                <div className="w-full sm:max-w-md" data-testid="profile-featured-award">
                  <AwardBanner award={profile.featured_award} linkTo={profile.featured_award.tournament?.slug ? `/tournaments/${profile.featured_award.tournament.slug}` : null} />
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative -mt-14 sm:-mt-16 lg:-mt-20 flex flex-col md:flex-row md:items-end gap-4 md:gap-6">
            <div className="shrink-0">
              <LevelAvatarFrame level={level.level} crown={crown} className="w-28 h-28 sm:w-32 sm:h-32 lg:w-40 lg:h-40" testId="profile-avatar-frame">
                {profile.avatar_url ? (
                  <img src={resolveMediaUrl(profile.avatar_url)} alt={displayName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#29B6E8]/20 to-[#121212] flex items-center justify-center font-display font-black text-5xl text-[#29B6E8]">
                    {(displayName || "?").slice(0, 2).toUpperCase()}
                  </div>
                )}
              </LevelAvatarFrame>
            </div>
            <div className="flex-1 min-w-0 md:pb-1">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">
                <span>THE LION SQUAD · Spieler</span>
                {isPrivate && <span className="inline-flex items-center gap-1 text-white/40"><Lock className="w-3 h-3" /> Privat</span>}
              </div>
              <h1 className="mt-1 font-heading text-3xl sm:text-4xl lg:text-5xl font-black uppercase leading-none tracking-tight break-words">
                {displayName}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/55" data-testid="profile-identity">
                <span>@{profile.username}</span>
                <AccountLevelPill level={level.level} />
                {profile.role && profile.role !== "player" && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-[#FFD700]/40 text-[#FFD700] text-[10px] uppercase tracking-widest rounded-sm font-bold">
                    <Shield className="w-3 h-3" /> {labelValue(profile.role, ROLE_LABELS)}
                  </span>
                )}
                {liveStream && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-[#FF3B30]/50 text-[#FF3B30] text-[10px] uppercase tracking-widest rounded-sm font-bold" data-testid="profile-live-pill">
                    <Radio className="w-3 h-3 animate-live" /> Live
                  </span>
                )}
                {profile.country && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{countryName(profile.country)}</span>}
                {joinedDate && <span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />Dabei seit {joinedDate.toLocaleDateString("de-DE", { month: "long", year: "numeric" })}</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 md:pb-1 md:justify-end shrink-0" data-testid="profile-actions">
              {!isOwnProfile && (
                <>
                  <button
                    type="button"
                    onClick={openMessage}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold hover:bg-[#1E95C2]"
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Nachricht
                  </button>
                  {relationship.status === "accepted" ? (
                    <button type="button" onClick={() => updateFriendship("remove")} className="inline-flex items-center gap-2 px-4 py-2 border border-[#FFD700]/45 text-[#FFD700] rounded-sm text-xs uppercase tracking-wider font-bold hover:bg-[#FFD700]/10">
                      <UserCheck className="w-3.5 h-3.5" /> Freunde
                    </button>
                  ) : relationship.incoming ? (
                    <>
                      <button type="button" onClick={() => updateFriendship("accept")} className="inline-flex items-center gap-2 px-4 py-2 border border-[#00FF88]/45 text-[#00FF88] rounded-sm text-xs uppercase tracking-wider font-bold hover:bg-[#00FF88]/10">
                        <UserCheck className="w-3.5 h-3.5" /> Annehmen
                      </button>
                      <button type="button" onClick={() => updateFriendship("decline")} className="inline-flex items-center gap-2 px-4 py-2 border border-white/15 text-white/60 rounded-sm text-xs uppercase tracking-wider font-bold hover:text-white">
                        <X className="w-3.5 h-3.5" /> Ablehnen
                      </button>
                    </>
                  ) : relationship.outgoing ? (
                    <button type="button" onClick={() => updateFriendship("remove")} className="inline-flex items-center gap-2 px-4 py-2 border border-white/15 text-white/60 rounded-sm text-xs uppercase tracking-wider font-bold hover:text-white">
                      <UserPlus className="w-3.5 h-3.5" /> Anfrage offen
                    </button>
                  ) : (
                    <button type="button" onClick={() => updateFriendship("request")} className="inline-flex items-center gap-2 px-4 py-2 border border-white/15 text-white/70 rounded-sm text-xs uppercase tracking-wider font-bold hover:text-white hover:border-[#29B6E8]/45">
                      <UserPlus className="w-3.5 h-3.5" /> Freund hinzufügen
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={() => setShowHighlight(true)}
                data-testid="highlight-card-open"
                className="inline-flex items-center gap-2 px-4 py-2 border border-[#FFD700]/40 text-[#FFD700] rounded-sm text-xs uppercase tracking-wider font-bold hover:bg-[#FFD700]/10"
              >
                <Sparkles className="w-3.5 h-3.5" /> Highlight-Karte
              </button>
            </div>
          </div>

          {profile.bio && <p className="mt-4 max-w-3xl text-white/80 text-base leading-relaxed" data-testid="profile-bio">{profile.bio}</p>}

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-center">
            <div data-testid="profile-level-progress">
              <AccountLevelProgress level={level.level} points={level.points} nextLevelPoints={level.next_level_points} progress={level.progress} />
            </div>
            {linkedAccounts.length > 0 && <VerifiedChips accounts={linkedAccounts} />}
          </div>

          <div className="mt-6 pb-6 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3" data-testid="profile-stats">
            {headerStats.map((stat) => <QuickStat key={stat.key} icon={stat.icon} label={stat.label} value={stat.value} color={stat.color} glory={stat.glory} testId={`profile-stat-${stat.key}`} />)}
          </div>
        </div>
      </header>

      {/* Reiter */}
      <div className="border-b border-white/10 sticky top-0 bg-[#0A0A0A]/95 backdrop-blur-sm z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-1 overflow-x-auto">
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} data-testid={`profile-tab-${k}`}
              className={`px-4 py-3 text-xs font-bold uppercase tracking-wider whitespace-nowrap transition ${tab === k ? "text-[#29B6E8] border-b-2 border-[#29B6E8]" : "text-white/60 hover:text-white"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10">
        {lockedTab && (
          <div className="py-20 text-center text-white/40">
            <Lock className="w-8 h-8 mx-auto mb-3 opacity-50" />
            <p>Diese Daten hat {displayName} privat gestellt.</p>
          </div>
        )}

        {tab === "overview" && (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="space-y-8 min-w-0" data-testid="profile-overview-main">
              {showTwitchLive && (
                <TwitchLiveCard channel={twitchChannel} url={twitchUrl} stream={liveStream} hasConsent={hasConsent} />
              )}

              {highlights.length > 0 && (
                <section data-testid="profile-highlights">
                  <SectionTitle icon={Trophy} color="#FFD700" kicker="Podest" title="Highlights" />
                  <div className={`grid gap-3 ${highlights.length > 1 ? "md:grid-cols-2 xl:grid-cols-3" : ""}`}>
                    {highlights.map((item) => <HighlightCard key={item.id} item={item} />)}
                  </div>
                </section>
              )}

              {awards.length > 0 && (
                <section data-testid="profile-awards-preview">
                  <SectionTitle icon={Medal} color="#FFD700" kicker="Turniere" title="Auszeichnungen" action={awards.length > 2 ? { label: "Alle ansehen", onClick: () => setTab("awards") } : null} />
                  <div className="grid gap-3 md:grid-cols-2">
                    {awards.slice(0, 2).map((award) => (
                      <AwardBanner key={award.id} award={award} linkTo={award.tournament?.slug ? `/tournaments/${award.tournament.slug}` : null} />
                    ))}
                  </div>
                </section>
              )}

              {badges.length > 0 && (
                <section>
                  <SectionTitle icon={Medal} color="#29B6E8" kicker="Zuletzt" title="Achievements" action={badges.length > 6 ? { label: "Alle ansehen", onClick: () => setTab("badges") } : null} />
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2" data-testid="profile-recent-awards">
                    {badges.slice(0, 6).map((a) => (
                      <div key={a.code} className="flex items-center gap-3 p-3 border border-white/10 rounded-sm bg-[#121212]" style={{ boxShadow: `inset 2px 0 0 ${a.level_color}` }}>
                        <div className="w-9 h-9 rounded-sm flex items-center justify-center border shrink-0" style={{ borderColor: a.level_color + "55", backgroundColor: a.level_color + "12" }}>
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
                </section>
              )}

              {referenceItems.length > 0 && (
                <section data-testid="profile-references-preview">
                  <SectionTitle icon={Flag} color="#29B6E8" kicker="Laufbahn" title="Referenzen" action={referenceItems.length > 5 ? { label: "Alle ansehen", onClick: () => setTab("references") } : null} />
                  <div className="space-y-2">
                    {referenceItems.slice(0, 5).map((item) => <ReferenceRow key={item.id} item={item} />)}
                  </div>
                </section>
              )}

              {!hasOverviewContent && (
                <div className="border border-dashed border-white/15 rounded-sm px-6 py-14 text-center" data-testid="profile-overview-empty">
                  <Trophy className="w-8 h-8 mx-auto mb-3 text-white/25" />
                  <div className="font-heading text-xl font-bold uppercase text-white/70">Noch keine Erfolge</div>
                  <p className="mt-2 text-sm text-white/45 max-w-md mx-auto">Turniere, Fast Laps und Achievements erscheinen hier, sobald {displayName} mitspielt.</p>
                </div>
              )}
            </div>

            <aside className="space-y-4 min-w-0" data-testid="profile-sidebar">
              {showTwitchChannel && <TwitchChannelCard channel={twitchChannel} url={twitchUrl} stats={s} />}
              {(linkedAccounts.length > 0 || socialLinks.length > 0 || gamingIds.length > 0) && (
                <AccountsCard linked={linkedAccounts} socials={socialLinks} ids={gamingIds} />
              )}
              <AboutCard profile={profile} joinedDate={joinedDate} />
              <SetupCard profile={profile} />
              {teams.length > 0 && <TeamsCard teams={teams} />}
            </aside>
          </div>
        )}

        {tab === "badges" && (
          <div>
            <AchievementGroupsView groups={achievementsData?.groups || []} earnedOnly emptyText="Noch keine Achievements freigeschaltet." />
          </div>
        )}

        {/* Auszeichnungen (#230, eigener Reiter): Banner und Trophäen aus veröffentlichten Turnieren -
            keine Referenzen (die sind die Turnier-Historie). Das eigene Profil kann eines als Profilbanner wählen. */}
        {tab === "awards" && (
          <div className="space-y-3" data-testid="public-profile-awards">
            <h2 className="font-heading text-2xl font-bold uppercase flex items-center gap-2"><Trophy className="w-5 h-5 text-[#FFD700]" /> Auszeichnungen</h2>
            {awards.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {awards.map((award) => (
                  <AwardBanner
                    key={award.id}
                    award={award}
                    linkTo={award.tournament?.slug ? `/tournaments/${award.tournament.slug}` : null}
                    action={isOwnProfile ? (
                      <button
                        type="button"
                        onClick={(event) => { event.preventDefault(); featureAward(profile.featured_award?.id === award.id ? null : award.id); }}
                        data-testid={`award-feature-${award.id}`}
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 border rounded-sm ${profile.featured_award?.id === award.id ? "border-[#FFD700]/60 text-[#FFD700]" : "border-white/20 text-white/60 hover:text-white"}`}
                      >
                        {profile.featured_award?.id === award.id ? "Profilbanner ✓" : "Als Profilbanner"}
                      </button>
                    ) : null}
                  />
                ))}
              </div>
            ) : (
              <EmptyState text={isOwnProfile ? "Noch keine Auszeichnungen – sie entstehen, wenn ein Turnier seine Ergebnisse veröffentlicht." : "Noch keine Auszeichnungen aus öffentlichen Turnieren."} />
            )}
          </div>
        )}

        {/* Referenzen: die Turnier- und Fast-Lap-Historie mit Filter; Teilnahmen und Bestzeiten darunter. */}
        {tab === "references" && !isPrivate && (
          <div className="space-y-8">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3" data-testid="profile-reference-stats">
              <QuickStat icon={Trophy} label="Referenzen" value={referenceStats.total || referenceItems.length} color="#29B6E8" />
              <QuickStat icon={Crown} label="Siege" value={referenceStats.wins || 0} color="#FFD700" glory />
              <QuickStat icon={Medal} label="Podien" value={referenceStats.podiums || 0} color="#C0C0C0" glory />
              <QuickStat icon={Flag} label="Turniere" value={referenceStats.tournaments || 0} />
              <QuickStat icon={Radio} label="Fast Laps" value={referenceStats.fastlaps || 0} />
            </div>
            {referenceItems.length ? (
              <section>
                {referenceFilters.length > 2 && (
                  <div className="flex flex-wrap gap-2 mb-4" data-testid="profile-reference-filters">
                    {referenceFilters.map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setReferenceFilter(key)}
                        data-testid={`profile-reference-filter-${key}`}
                        className={`px-3 py-1.5 border rounded-sm text-[10px] font-bold uppercase tracking-wider transition ${referenceFilter === key ? "border-[#29B6E8] text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/15 text-white/60 hover:text-white"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid gap-3" data-testid="public-profile-references">
                  {filteredReferences.map((item) => <ReferenceRow key={item.id} item={item} expanded />)}
                </div>
              </section>
            ) : <EmptyState text="Keine öffentlichen Referenzen." />}

            {openTournaments.length > 0 && (
              <section data-testid="public-profile-tournaments">
                <SectionTitle icon={Flag} color="#29B6E8" kicker="Ohne Ergebnis" title={`Weitere Teilnahmen (${openTournaments.length})`} />
                <div className="space-y-2">
                  {openTournaments.map((t) => <TournamentRow key={t.id} t={t} expanded />)}
                </div>
              </section>
            )}

            {fastLaps.length > 0 && (
              <section data-testid="public-profile-fastlaps">
                <SectionTitle icon={Radio} color="#FFD700" kicker="Bestzeiten" title={`Fast Lap (${fastLaps.length})`} />
                <div className="space-y-2">
                  {fastLaps.map((f, i) => (
                    <div key={i} className={`flex items-center justify-between gap-3 px-4 py-3 border rounded-sm ${f.is_leader ? "border-[#FFD700]/40 bg-[#FFD700]/5" : "border-white/10 bg-[#121212]"}`}>
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold truncate">{f.challenge?.title || "—"}</div>
                        <div className="font-heading text-lg font-bold truncate">{f.track?.name || "—"}{f.track?.country ? ` · ${f.track.country}` : ""}</div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {f.is_leader && <span className="text-[10px] uppercase tracking-widest text-[#FFD700] font-bold">Pole</span>}
                        <span className="font-display text-xl font-bold tabular-nums">{f.time_str}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {tab === "teams" && !isPrivate && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {teams.length ? (
              teams.map((tm) => (
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

function SectionTitle({ icon: Icon, color = "#29B6E8", kicker, title, action = null }) {
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
      <div>
        {kicker && <div className="text-[11px] uppercase tracking-[0.3em] font-bold" style={{ color }}>{kicker}</div>}
        <h2 className="mt-1 font-heading text-2xl font-bold uppercase flex items-center gap-2">
          <Icon className="w-5 h-5" style={{ color }} /> {title}
        </h2>
      </div>
      {action && (
        <button type="button" onClick={action.onClick} className="text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">
          {action.label} →
        </button>
      )}
    </div>
  );
}

// Verknüpfte Konten im Kopf: ein Chip je bestätigtem Konto mit Plattformfarbe und Häkchen.
function VerifiedChips({ accounts }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="profile-verified-chips">
      <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold inline-flex items-center gap-1"><BadgeCheck className="w-3.5 h-3.5 text-[#00FF88]" /> Verknüpft</span>
      {accounts.map((account) => {
        const meta = socialMeta(account);
        const numericName = /^\d{17}$/.test(String(account.display_name || ""));
        const text = numericName ? meta.label : (account.display_name || account.handle || meta.label);
        const className = "inline-flex items-center gap-1.5 border rounded-sm px-2.5 py-1.5 text-xs font-bold bg-[#0A0A0A] border-[var(--social-color)]/60 text-white shadow-[0_0_14px_-6px_var(--social-color)] transition";
        const style = { "--social-color": meta.color };
        const inner = (
          <>
            <SocialIcon kind={meta.key} className="w-3.5 h-3.5 text-[var(--social-color)]" />
            <span className="truncate max-w-[10rem]">{text}</span>
            <BadgeCheck className="w-3.5 h-3.5 text-[#00FF88] shrink-0" aria-label="verifiziert" />
          </>
        );
        if (account.url) {
          return (
            <a key={account.platform} href={account.url} target="_blank" rel="noopener noreferrer" title={`${meta.label}-Konto öffnen`} data-testid={`profile-verified-${account.platform}`} className={`${className} hover:border-[var(--social-color)] hover:bg-white/[0.03]`} style={style}>
              {inner}
            </a>
          );
        }
        return <span key={account.platform} data-testid={`profile-verified-${account.platform}`} className={className} style={style}>{inner}</span>;
      })}
    </div>
  );
}

function TwitchLiveCard({ channel, url, stream, hasConsent }) {
  return (
    <section data-testid="public-profile-twitch-embed" className="border border-[#9146FF]/40 rounded-sm bg-[#121212] overflow-hidden min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/10">
        <h2 className="font-heading text-xl font-bold uppercase flex items-center gap-2">
          <SocialIcon kind="twitch" className="w-5 h-5 text-[#9146FF]" /> Live auf Twitch
        </h2>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 border border-[#FF3B30]/50 text-[#FF3B30] text-[10px] uppercase tracking-widest rounded-sm font-bold">
          <Radio className="w-3 h-3 animate-live" /> Live{stream.viewer_count ? ` · ${stream.viewer_count} Zuschauer` : ""}
        </span>
      </div>
      {hasConsent("external_media") ? (
        <div className="w-full bg-black aspect-video min-h-[180px] sm:min-h-0">
          <iframe
            title={`Twitch Stream ${channel}`}
            src={twitchPlayerSrc(channel)}
            className="block w-full h-full border-0"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="p-4">
          <ExternalMediaNotice
            service="Twitch"
            reason="Der Twitch-Player wird erst nach Zustimmung zu externen Medien geladen."
            url={url}
            accent="#9146FF"
            compact
            testId="profile-twitch-consent-notice"
          />
        </div>
      )}
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-white/55">
        <span className="truncate min-w-0">{stream.title || "Stream läuft"}</span>
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#9146FF] hover:text-white font-bold uppercase tracking-wider text-[10px]">
          Bei Twitch öffnen <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </section>
  );
}

// Twitch ohne laufenden Stream: kein schwarzer Player, nur der Kanal mit Streamzeit und Link.
function TwitchChannelCard({ channel, url, stats }) {
  const hours = Math.round((stats.twitch_stream_minutes || 0) / 60);
  return (
    <section data-testid="profile-twitch-offline" className="border border-[#9146FF]/30 rounded-sm bg-[#121212] p-4">
      <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 group">
        <span className="w-10 h-10 shrink-0 rounded-sm flex items-center justify-center border-2 border-[#9146FF] text-[#9146FF] bg-black/40">
          <SocialIcon kind="twitch" className="w-5 h-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-sm text-white truncate group-hover:text-[#b88cff]">{channel}</span>
          <span className="block text-[11px] text-white/50 truncate">Twitch · gerade offline{hours > 0 ? ` · ${hours} Std. in ${stats.twitch_live_sessions || 0} Streams` : ""}</span>
        </span>
        <ExternalLink className="w-4 h-4 text-white/40 shrink-0" aria-hidden="true" />
      </a>
    </section>
  );
}

function HighlightCard({ item }) {
  const tone = RANK_TONES[Number(item.rank)] || { color: "#29B6E8", label: "Platz" };
  const target = referenceTarget(item);
  const date = formatPublicDate(item.date);
  const body = (
    <div
      data-testid={`profile-highlight-${item.id}`}
      className="relative overflow-hidden border rounded-sm bg-[#121212] p-4 h-full transition hover:bg-white/[0.03]"
      style={{ borderColor: `${tone.color}55`, boxShadow: `inset 3px 0 0 ${tone.color}` }}
    >
      <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-20 pointer-events-none" style={{ backgroundColor: tone.color }} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: tone.color }}>{tone.label} · {referenceKindLabel(item.kind)}</div>
          <div className="mt-1 font-heading text-lg font-black uppercase leading-tight break-words">{item.title || "Referenz"}</div>
          <div className="mt-1 text-xs text-white/50 flex flex-wrap gap-x-2 gap-y-0.5">
            {item.subtitle && <span className="break-words">{item.subtitle}</span>}
            {date && <span>{date}</span>}
            {item.time_str && <span className="tabular-nums text-white/70">{item.time_str}</span>}
          </div>
        </div>
        <div className="font-display font-black text-4xl tabular-nums leading-none shrink-0" style={{ color: tone.color }}>#{item.rank}</div>
      </div>
    </div>
  );
  if (!target) return body;
  return <Link to={target} className="block h-full">{body}</Link>;
}

function AccountsCard({ linked, socials, ids }) {
  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4 space-y-4" data-testid="public-profile-accounts">
      <h2 className="font-heading text-xl font-bold uppercase flex items-center gap-2">
        <Globe className="w-4 h-4 text-[#29B6E8]" /> Konten
      </h2>
      {linked.length > 0 && <LinkedAccountsCard accounts={linked} embedded />}
      {socials.length > 0 && <SocialsRow links={socials} />}
      {ids.length > 0 && <GamingIdsList ids={ids} />}
    </section>
  );
}

function AboutCard({ profile, joinedDate }) {
  const birthday = formatPublicDate(profile.birth_date);
  const location = [profile.city, profile.country ? countryName(profile.country) : ""].filter(Boolean).join(", ");
  const membership = profile.membership?.membership_type
    ? labelValue(profile.membership.membership_type, MEMBERSHIP_TYPE_LABELS)
    : (profile.is_club_member ? "Vereinsmitglied" : "");
  const rows = [
    { label: "Dabei seit", value: joinedDate ? joinedDate.toLocaleDateString("de-DE", { month: "long", year: "numeric" }) : "", icon: Calendar, tone: "green" },
    { label: "Geburtstag", value: birthday, icon: Cake, tone: "gold" },
    { label: "Ort", value: location, icon: MapPin, tone: "blue" },
    { label: "Mitgliedschaft", value: membership, icon: Crown, tone: "gold" },
  ].filter((row) => row.value);
  if (!rows.length) return null;
  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="public-profile-info">
      <h2 className="font-heading text-xl font-bold uppercase flex items-center gap-2">
        <Info className="w-4 h-4 text-[#29B6E8]" /> Über {profile.display_name || profile.username}
      </h2>
      <dl className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 min-w-0">
            <span className={`w-9 h-9 rounded-sm border flex items-center justify-center shrink-0 ${PROFILE_TONES[row.tone] || PROFILE_TONES.white}`}>
              <row.icon className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <dt className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{row.label}</dt>
              <dd className="text-sm text-white/90 break-words">{row.value}</dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SetupCard({ profile }) {
  const groups = [
    { label: "Plattformen", items: listItems(profile.main_platforms?.length ? profile.main_platforms : profile.main_platform, PLATFORM_LABELS), icon: Monitor, tone: "blue" },
    { label: "Eingabe", items: listItems(profile.input_devices, INPUT_DEVICE_LABELS), icon: Keyboard, tone: "gold" },
    { label: "Abos", items: listItems(profile.gaming_subscriptions, SUBSCRIPTION_LABELS), icon: BadgeCheck, tone: "green" },
    { label: "Lieblingsspiele", items: listItems(profile.favorite_games), icon: Heart, tone: "violet" },
  ].filter((group) => group.items.length);
  if (!groups.length) return null;
  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="public-profile-setup">
      <h2 className="font-heading text-xl font-bold uppercase flex items-center gap-2">
        <Gamepad2 className="w-4 h-4 text-[#FFD700]" /> Setup & Games
      </h2>
      <div className="mt-3 space-y-3">
        {groups.map((group) => (
          <div key={group.label} className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`w-7 h-7 rounded-sm border flex items-center justify-center shrink-0 ${PROFILE_TONES[group.tone] || PROFILE_TONES.white}`}>
                <group.icon className="w-3.5 h-3.5" />
              </span>
              <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{group.label}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => (
                <span key={item} className="inline-flex items-center rounded-sm border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-white/75">{item}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TeamsCard({ teams }) {
  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="public-profile-teams">
      <h2 className="font-heading text-xl font-bold uppercase flex items-center gap-2">
        <Users className="w-4 h-4 text-[#29B6E8]" /> Teams
      </h2>
      <div className="mt-3 grid gap-2">
        {teams.map((tm) => (
          <Link key={tm.id} to={`/teams/${tm.id}`} className="flex items-center gap-3 border border-white/10 bg-[#0A0A0A] rounded-sm px-3 py-2 hover:border-[#29B6E8]/60 transition min-w-0">
            <span className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold shrink-0">[{tm.tag}]</span>
            <span className="font-heading font-bold truncate">{tm.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

const PROFILE_TONES = {
  blue: "border-[#29B6E8]/35 bg-[#29B6E8]/10 text-[#29B6E8]",
  gold: "border-[#FFD700]/35 bg-[#FFD700]/10 text-[#FFD700]",
  green: "border-[#10B981]/35 bg-[#10B981]/10 text-[#10B981]",
  violet: "border-[#A855F7]/35 bg-[#A855F7]/10 text-[#A855F7]",
  white: "border-white/15 bg-white/[0.04] text-white/75",
};

function referenceTarget(item) {
  if (!item?.target_id) return "";
  if (item.kind === "fastlap") return `/fastlap/${item.target_id}`;
  if (item.kind === "season") return `/seasons/${item.target_id}`;
  return `/tournaments/${item.target_id}`;
}

function referenceKindLabel(kind) {
  if (kind === "season") return "Jahreswertung";
  return kind === "fastlap" ? "Fast Lap" : "Turnier";
}

function ReferenceRow({ item, expanded = false }) {
  const isFastlap = item.kind === "fastlap";
  const isSeason = item.kind === "season";
  const target = referenceTarget(item);
  const rank = item.rank ? `#${item.rank}` : "-";
  const rankColor = RANK_TONES[Number(item.rank)]?.color || "#FFFFFF";
  const date = formatPublicDate(item.date);
  const content = (
    <div data-testid={`profile-reference-${item.id}`} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:px-4 sm:py-3 border border-white/10 rounded-sm bg-[#121212] hover:border-[#29B6E8]/60 transition min-w-0 overflow-hidden">
      <div className="flex items-start gap-3 min-w-0 flex-1 w-full">
        <div className={`w-10 h-10 rounded-sm border flex items-center justify-center shrink-0 ${isFastlap || isSeason ? "border-[#FFD700]/35 bg-[#FFD700]/10 text-[#FFD700]" : "border-[#29B6E8]/35 bg-[#29B6E8]/10 text-[#29B6E8]"}`}>
          {isFastlap ? <Radio className="w-5 h-5" /> : <Trophy className="w-5 h-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-bold uppercase tracking-widest ${isFastlap || isSeason ? "text-[#FFD700]" : "text-[#29B6E8]"}`}>{referenceKindLabel(item.kind)}</span>
            {isSeason && item.points != null && <span className="text-[10px] font-bold uppercase tracking-widest text-[#FFD700] border border-[#FFD700]/35 px-1.5 py-0.5 rounded-sm">{item.points} Jahrespunkte</span>}
            {item.time_str && <span className="text-[10px] font-bold uppercase tracking-widest text-white/70 border border-white/10 px-1.5 py-0.5 rounded-sm break-all">{item.time_str}</span>}
          </div>
          <div className="mt-1 font-heading text-base font-bold break-words">{item.title || "Referenz"}</div>
          <div className="text-xs text-white/50 mt-0.5 flex items-center gap-x-2 gap-y-1 flex-wrap">
            {item.subtitle && <span className="break-words">{item.subtitle}</span>}
            {date && <span>{date}</span>}
            {expanded && item.status && <StatusBadge status={item.status} />}
            {expanded && item.participant_count && <span>{item.participant_count} Teilnehmer</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end sm:shrink-0 sm:text-right w-full sm:w-auto border-t border-white/10 pt-3 sm:border-0 sm:pt-0">
        <div>
          <div className="font-display text-xl font-bold tabular-nums" style={{ color: rankColor }}>{rank}</div>
          <div className="text-[10px] uppercase tracking-widest text-white/35 font-bold">Rang</div>
        </div>
        {target && <ExternalLink className="w-4 h-4 text-white/30 shrink-0" />}
      </div>
    </div>
  );
  if (!target) return content;
  return <Link to={target} className="block">{content}</Link>;
}

function QuickStat({ icon: Icon, label, value, color = "#FFFFFF", glory = false, testId }) {
  const glorious = glory && Number(value) > 0;
  return (
    <div
      data-testid={testId}
      className={`border border-white/10 rounded-sm bg-[#121212] px-3 py-3 min-w-0 ${glorious ? "tls-stat-glory" : ""}`}
      style={glorious ? { "--glory-c": color } : undefined}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/40 min-w-0"><Icon className="w-3 h-3 shrink-0" /> <span className="truncate">{label}</span></div>
      <div className="mt-1 font-display font-bold text-xl sm:text-2xl tabular-nums break-words" style={{ color }}>{value}</div>
    </div>
  );
}

// Verknüpfte Konten (#260): jedes per Anmeldung bestätigte Konto bekommt einen Rahmen in der
// Plattformfarbe, den Anzeigenamen, das Datum und die offizielle Adresse - man sieht, dass es echt
// ist und wohin es geht. `embedded` stellt die Liste als Abschnitt in die Konten-Karte.
export function LinkedAccountsCard({ accounts, embedded = false }) {
  return (
    <div className={embedded ? "" : "border border-[#00FF88]/25 rounded-sm bg-[#121212] p-4"} data-testid="public-profile-linked">
      <h3 className={`${embedded ? "text-[10px] uppercase tracking-widest text-[#00FF88]" : "font-heading text-xl uppercase"} font-bold mb-1 flex items-center gap-2`}>
        <BadgeCheck className="w-4 h-4 text-[#00FF88]" /> Verknüpfte Konten
      </h3>
      <p className="text-[11px] text-white/45 mb-3">Per Anmeldung bei der Plattform bestätigt – der Link führt zum echten Konto.</p>
      <div className="grid gap-2">
        {accounts.map((account) => {
          const meta = socialMeta(account);
          const since = formatLinkedAt(account.linked_at);
          // Ohne Steam-API-Schlüssel ist der Anzeigename die 17-stellige ID - dann steht „Steam-Profil“ groß und die ID klein.
          const numericName = /^\d{17}$/.test(String(account.display_name || ""));
          const title = numericName ? `${meta.label}-Profil` : (account.display_name || account.handle);
          const detail = [meta.label, account.handle && (numericName || account.handle !== account.display_name) ? account.handle : null, since ? `seit ${since}` : null].filter(Boolean).join(" · ");
          const inner = (
            <>
              <span className="w-10 h-10 shrink-0 rounded-sm flex items-center justify-center border-2 border-[var(--social-color)] text-[var(--social-color)] bg-black/40">
                <SocialIcon kind={meta.key} className="w-5 h-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-bold text-white text-sm">
                  <span className="truncate">{title}</span>
                  <BadgeCheck className="w-4 h-4 text-[#00FF88] shrink-0" aria-label="verifiziert" data-testid={`linked-account-${account.platform}-verified`} />
                </span>
                <span className="block text-[11px] text-white/50 truncate">{detail}</span>
              </span>
              {account.url && <ExternalLink className="w-4 h-4 text-white/40 shrink-0" aria-hidden="true" />}
            </>
          );
          const className = "flex items-center gap-3 border rounded-sm px-3 py-2.5 border-[var(--social-color)]/50 bg-[#0A0A0A] shadow-[0_0_18px_-6px_var(--social-color)] transition";
          const style = { "--social-color": meta.color };
          if (account.url) {
            return (
              <a key={account.platform} href={account.url} target="_blank" rel="noopener noreferrer" title={`${meta.label}-Konto öffnen`} data-testid={`linked-account-${account.platform}`} className={`${className} hover:border-[var(--social-color)] hover:bg-white/[0.03]`} style={style}>
                {inner}
              </a>
            );
          }
          return <div key={account.platform} data-testid={`linked-account-${account.platform}`} className={className} style={style}>{inner}</div>;
        })}
      </div>
    </div>
  );
}

function SocialsRow({ links }) {
  return (
    <div data-testid="public-profile-socials">
      <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-2 flex items-center gap-2"><Globe className="w-3.5 h-3.5 text-[#29B6E8]" /> Socials</h3>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => {
          const meta = socialMeta(link);
          const key = `${meta.key}:${link.url || link.value}`;
          const className = `relative inline-flex h-10 w-10 items-center justify-center border bg-[#0A0A0A] rounded-sm transition hover:bg-white/[0.03] ${link.verified ? "border-[var(--social-color)] text-[var(--social-color)] shadow-[0_0_14px_-4px_var(--social-color)]" : "border-white/10 text-white/70"}`;
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
                {link.verified && <BadgeCheck className="absolute -top-1.5 -right-1.5 w-4 h-4 text-[#00FF88] bg-[#0A0A0A] rounded-full" aria-label="verifiziert" data-testid={`profile-social-${meta.key}-verified`} />}
              </a>
            );
          }
          return (
            <button
              key={key}
              type="button"
              onClick={() => copyText(link.value, `${meta.label} kopiert.`)}
              aria-label={`${meta.label} kopieren`}
              title={`${meta.label} kopieren`}
              data-testid={`profile-social-${meta.key}`}
              className={`${className} border-[var(--social-color)]/40 text-[var(--social-color)] hover:border-[var(--social-color)]`}
              style={style}
            >
              <SocialIcon kind={meta.key} />
              {link.verified && <BadgeCheck className="absolute -top-1.5 -right-1.5 w-4 h-4 text-[#00FF88] bg-[#0A0A0A] rounded-full" aria-label="verifiziert" data-testid={`profile-social-${meta.key}-verified`} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GamingIdsList({ ids }) {
  return (
    <div data-testid="public-profile-gaming-ids">
      <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-2 flex items-center gap-2"><Gamepad2 className="w-3.5 h-3.5 text-[#FFD700]" /> Gaming-IDs</h3>
      <div className="grid gap-2">
        {ids.map((id) => (
          <div key={`${id.label}:${id.value}`} className="border border-white/10 bg-[#0A0A0A] px-3 py-2 rounded-sm flex items-center justify-between gap-3 min-w-0">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold inline-flex items-center gap-1">{id.label}{id.verified && <BadgeCheck className="w-3 h-3 text-[#00FF88]" aria-label="verifiziert" data-testid={`profile-gaming-${id.label.toLowerCase()}-verified`} />}</div>
              {id.url ? (
                <a href={id.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 flex max-w-full items-center gap-1 text-sm text-white/85 hover:text-[#29B6E8]">
                  <span className="truncate">{id.value}</span><ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              ) : (
                <div className="mt-0.5 text-sm text-white/85 break-all">{id.value}</div>
              )}
            </div>
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
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={t.status} />
          {t.final_position === 1 && <span className="text-[10px] font-bold uppercase tracking-widest text-[#FFD700] border border-[#FFD700]/40 px-1.5 py-0.5 rounded-sm">Sieger</span>}
          {t.final_position > 1 && t.final_position <= 3 && <span className="text-[10px] font-bold uppercase tracking-widest text-[#CD7F32] border border-[#CD7F32]/40 px-1.5 py-0.5 rounded-sm">Top 3</span>}
        </div>
        <div className="mt-1 font-heading text-base font-bold truncate">{t.title}</div>
        <div className="text-xs text-white/50 mt-0.5 flex items-center gap-2 flex-wrap">
          {t.game && <span>{gameLabel(t.game)}</span>}
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
