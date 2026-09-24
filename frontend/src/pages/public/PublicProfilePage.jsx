import { countryName } from "@/lib/countries";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatLinkedAt } from "@/lib/platformLinks";
import { PlatformIcon as SocialIcon, platformMeta as socialMeta } from "@/lib/platformBrand";
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
  Monitor, Keyboard, BadgeCheck, Heart, Users, Sparkles, Copy,
} from "lucide-react";
import { toast } from "sonner";

// Öffentliches Profil, Umbau 24.09.: Banner als echtes Banner mit überlappendem Avatar, eine Zeile
// mit Level, Rolle und verknüpften Konten, eine Zahlenleiste, fünf Reiter (Übersicht, Achievements,
// Auszeichnungen, Referenzen mit Turnieren und Fast Laps, Teams). Die Übersicht zeigt links die
// Erfolge (Podestplätze, Auszeichnungen, Achievements, Referenzen) und rechts eine Konten-Karte,
// „Über“, Setup und Teams; der Twitch-Player steht nur, wenn der Stream gerade läuft. Konten stehen
// genau einmal - im Kasten „Konten“ (#527), oben nur ein Zähler.

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
  if (kind === "faceit") return `https://www.faceit.com/en/players/${handle}`;
  if (kind === "lichess") return `https://lichess.org/@/${handle}`;
  if (kind === "github") return `https://github.com/${handle}`;
  if (kind === "kick") return `https://kick.com/${handle}`;
  if (kind === "reddit") return `https://www.reddit.com/user/${handle}`;
  if (kind === "steam") {
    return /^\d{17}$/.test(handle)
      ? `https://steamcommunity.com/profiles/${handle}`
      : `https://steamcommunity.com/id/${handle}`;
  }
  return "";
}



// Verknüpfte Konten (#260): das Häkchen kommt vom Server, nie aus dem Text.
function isVerified(profile, platform) {
  return Array.isArray(profile?.verified_platforms) && profile.verified_platforms.includes(platform);
}

// Konten einmal sauber (#527): zwei Gruppen, jedes Konto genau einmal. Ein per Anmeldung bestätigtes
// Konto (linked_accounts) ersetzt den von Hand eingetragenen Namen derselben Plattform; das Häkchen
// kommt vom Server, nie aus dem Text. Was privat ist, fehlt hier ganz - der Server schickt das Feld
// dann gar nicht erst mit.
const SOCIAL_PLATFORMS = ["discord", "twitch", "youtube", "instagram", "tiktok", "x", "github", "kick", "reddit", "spotify", "website"];
const GAME_PLATFORMS = ["steam", "epic", "psn", "xbox", "nintendo", "ea", "riot", "battlenet", "faceit", "startgg", "roblox", "osu", "lichess"];
const MANUAL_FIELDS = {
  discord: "discord_name", twitch: "twitch_handle", youtube: "youtube_handle", instagram: "instagram_handle",
  tiktok: "tiktok_handle", x: "x_handle", website: "website", steam: "steam_id", epic: "epic_id", psn: "psn_id",
  xbox: "xbox_id", nintendo: "nintendo_fc", ea: "ea_id", riot: "riot_id", battlenet: "battlenet_id",
  faceit: "faceit_handle", startgg: "startgg_handle", roblox: "roblox_handle", osu: "osu_handle", lichess: "lichess_handle", github: "github_handle", kick: "kick_handle", reddit: "reddit_handle", spotify: "spotify_handle",
};

function manualUrl(platform, value) {
  if (platform === "website") return externalUrl(value);
  if (platform === "twitch") return normalizeTwitchChannel(value) ? `https://www.twitch.tv/${normalizeTwitchChannel(value)}` : "";
  if (platform === "xbox") return `https://www.xbox.com/play/user/${encodeURIComponent(String(value).trim())}`;
  return socialUrl(platform, value);
}

function linkedEntry(account) {
  const meta = socialMeta(account);
  // Ohne Steam-API-Schlüssel ist der Anzeigename die 17-stellige ID - dann steht „Steam-Profil“ groß und die ID klein.
  const numericName = /^\d{17}$/.test(String(account.display_name || ""));
  const title = numericName ? `${meta.label}-Profil` : (account.display_name || account.handle || meta.label);
  const since = formatLinkedAt(account.linked_at);
  const showHandle = Boolean(account.handle) && (numericName || account.handle !== account.display_name);
  return {
    platform: String(account.platform || "").toLowerCase(), key: meta.key, label: meta.label, color: meta.color, title,
    detail: [meta.label, showHandle ? account.handle : null, since ? `seit ${since}` : null].filter(Boolean).join(" · "),
    value: account.handle || account.display_name || "", url: account.url || "", verified: true, since,
  };
}

// Ein getippter Wert kann noch eine ganze Adresse sein (alte Eingaben): im Kasten steht der Name, nie die Adresse.
const HANDLE_SKIP = new Set(["c", "channel", "user", "id", "profiles", "www"]);
function handleFromValue(raw) {
  const value = String(raw || "").trim();
  if (!/^[a-z]+:[/][/]/i.test(value) && !/^(www[.])?[a-z0-9.-]+[.][a-z]{2,}[/]/i.test(value)) return cleanHandle(value);
  try {
    const url = new URL(/^[a-z]+:[/][/]/i.test(value) ? value : `https://${value}`);
    const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
    const meaningful = segments.filter((segment) => !HANDLE_SKIP.has(segment.toLowerCase()));
    return (meaningful[0] || url.hostname).replace(/^@/, "");
  } catch {
    return cleanHandle(value);
  }
}

function manualEntry(platform, rawValue, profile) {
  const meta = socialMeta({ platform });
  let value = String(rawValue || "").trim();
  if (platform === "twitch") value = normalizeTwitchChannel(rawValue);
  else if (platform === "website") value = value.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
  else if (SOCIAL_PLATFORMS.includes(platform)) value = handleFromValue(rawValue);
  if (!value) return null;
  return { platform, key: meta.key, label: meta.label, color: meta.color, title: value, detail: meta.label, value, url: manualUrl(platform, rawValue), verified: isVerified(profile, platform), since: "" };
}

export function accountGroups(profile) {
  if (!profile) return { socials: [], games: [], verifiedCount: 0 };
  const linked = new Map();
  for (const account of Array.isArray(profile.linked_accounts) ? profile.linked_accounts : []) {
    if (account && account.platform) linked.set(String(account.platform).toLowerCase(), linkedEntry(account));
  }
  const build = (platforms) => platforms
    .map((platform) => (linked.has(platform) ? linked.get(platform) : manualEntry(platform, profile[MANUAL_FIELDS[platform]], profile)))
    .filter(Boolean);
  const socials = build(SOCIAL_PLATFORMS);
  const games = build(GAME_PLATFORMS);
  // Weitere Socials (eigene Einträge unter Mein Profil → Socials) - ohne Doppelung zu den festen Feldern.
  const seen = new Set([...socials, ...games].map((entry) => `${entry.key}:${String(entry.url || entry.value).toLowerCase()}`));
  for (const social of profile.socials || []) {
    const platform = String(social.platform || "").toLowerCase();
    const value = social.value || social.url;
    if (!value || linked.has(platform)) continue;
    const meta = socialMeta({ platform, label: social.platform });
    const url = social.url || socialUrl(platform, social.value) || (/^https?:\/\//i.test(String(social.value || "")) ? externalUrl(social.value) : "");
    const dedupe = `${meta.key}:${String(url || value).toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    socials.push({ platform, key: meta.key, label: meta.label, color: meta.color, title: cleanHandle(value) || value, detail: meta.label, value, url, verified: false, since: "" });
  }
  // Bestätigte Konten neuer Plattformen, die noch keine feste Gruppe haben, stehen bei den Socials.
  for (const [platform, entry] of linked) {
    if (!SOCIAL_PLATFORMS.includes(platform) && !GAME_PLATFORMS.includes(platform)) socials.push(entry);
  }
  const verifiedCount = [...socials, ...games].filter((entry) => entry.verified).length;
  return { socials, games, verifiedCount };
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
  const accounts = accountGroups(profile);
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
            {accounts.verifiedCount > 0 && (
              <a href="#konten" onClick={() => setTab("overview")} data-testid="profile-accounts-count"
                className="inline-flex items-center gap-1.5 self-start lg:justify-self-end text-xs font-bold uppercase tracking-wider text-[#00FF88] hover:text-white">
                <BadgeCheck className="w-4 h-4" /> {accounts.verifiedCount === 1 ? "1 Konto verknüpft" : `${accounts.verifiedCount} Konten verknüpft`}
              </a>
            )}
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
              {(accounts.socials.length > 0 || accounts.games.length > 0) && <AccountsCard groups={accounts} />}
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

// Konten (#527): ein Kasten, zwei Gruppen. Rahmen in Plattformfarbe, Haken bei bestätigten Konten mit
// „verknüpft seit“, Link zum echten Konto - oder Kopieren, wenn die Plattform keine Profiladresse hat.
export function AccountsCard({ groups }) {
  return (
    <section id="konten" className="border border-white/10 rounded-sm bg-[#121212] p-4 space-y-4 scroll-mt-24" data-testid="public-profile-accounts">
      <div>
        <h2 className="font-heading text-xl font-bold uppercase flex items-center gap-2"><Globe className="w-4 h-4 text-[#29B6E8]" /> Konten</h2>
        <p className="text-[11px] text-white/45 mt-1 flex items-center gap-1"><BadgeCheck className="w-3.5 h-3.5 text-[#00FF88] shrink-0" /> per Anmeldung bei der Plattform bestätigt – der Link führt zum echten Konto.</p>
      </div>
      {groups.socials.length > 0 && <AccountGroup title="Socials" icon={Globe} color="#29B6E8" entries={groups.socials} testId="public-profile-socials" />}
      {groups.games.length > 0 && <AccountGroup title="Spielkonten" icon={Gamepad2} color="#FFD700" entries={groups.games} testId="public-profile-gaming-ids" />}
    </section>
  );
}

function AccountGroup({ title, icon: Icon, color, entries, testId }) {
  return (
    <div data-testid={testId}>
      <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-2 flex items-center gap-2"><Icon className="w-3.5 h-3.5" style={{ color }} /> {title}</h3>
      <div className="grid gap-2">{entries.map((entry) => <AccountRow key={`${entry.key}:${entry.value}`} entry={entry} />)}</div>
    </div>
  );
}

function AccountRow({ entry }) {
  const verifiedTitle = entry.since ? `verifiziert · verknüpft seit ${entry.since}` : "verifiziert";
  const inner = (
    <>
      <span className={`w-10 h-10 shrink-0 rounded-sm flex items-center justify-center border-2 text-[var(--social-color)] bg-black/40 ${entry.verified ? "border-[var(--social-color)]" : "border-[var(--social-color)]/40"}`}>
        <SocialIcon kind={entry.key} className="w-5 h-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-bold text-white text-sm">
          <span className="truncate">{entry.title}</span>
          {entry.verified && <BadgeCheck className="w-4 h-4 text-[#00FF88] shrink-0" aria-label="verifiziert" data-testid={`profile-account-${entry.key}-verified`}><title>{verifiedTitle}</title></BadgeCheck>}
        </span>
        <span className="block text-[11px] text-white/50 truncate">{entry.detail}</span>
      </span>
      {entry.url ? <ExternalLink className="w-4 h-4 text-white/40 shrink-0" aria-hidden="true" /> : <Copy className="w-4 h-4 text-white/40 shrink-0" aria-hidden="true" />}
    </>
  );
  const className = `flex items-center gap-3 border rounded-sm px-3 py-2.5 bg-[#0A0A0A] transition text-left w-full ${entry.verified ? "border-[var(--social-color)]/60 shadow-[0_0_18px_-6px_var(--social-color)]" : "border-white/10 hover:border-[var(--social-color)]/50"}`;
  const style = { "--social-color": entry.color };
  if (entry.url) {
    return <a href={entry.url} target="_blank" rel="noopener noreferrer" title={`${entry.label} öffnen`} data-testid={`profile-account-${entry.key}`} className={className} style={style}>{inner}</a>;
  }
  return <button type="button" onClick={() => copyText(entry.value, `${entry.label} kopiert.`)} title={`${entry.label} kopieren`} data-testid={`profile-account-${entry.key}`} className={className} style={style}>{inner}</button>;
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
