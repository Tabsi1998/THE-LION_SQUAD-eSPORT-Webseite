import { countryName } from "@/lib/countries";
import { useCallback, useEffect, useState } from "react";
import { useTilt } from "@/hooks/useTilt";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatLinkedAt } from "@/lib/platformLinks";
import { PlatformIcon as SocialIcon, platformMeta as socialMeta } from "@/lib/platformBrand";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { AchievementGroupsView } from "@/components/tls/AchievementGroups";
import { PublicSeasonFinds } from "@/components/tls/PublicSeasonFinds";
import { AchievementIcon } from "@/components/tls/AchievementIcon";
import { Badge } from "@/components/achievements/Badge";
import { categoryProgress } from "@/pages/user/profile/AchievementPanels";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { AccountLevelPill, AccountLevelProgress } from "@/components/tls/AccountLevel";
import { LevelAvatarFrame, useCrownFor } from "@/components/tls/LevelAvatarFrame";
import { SeasonHighlightCard } from "@/components/tls/SeasonHighlightCard";
import { AwardBanner } from "@/components/tls/AwardBanner";
import { HonourCard, HonoursPanel } from "@/pages/user/profile/HonoursPanel";
import { OwnAchievements, PrivateBox } from "@/pages/public/profile/OwnProfileParts";
import { RecordCard, ReferenceWithPath } from "@/pages/public/profile/TournamentPath";
import { useCookieConsent } from "@/components/tls/CookieConsent";
import { ExternalMediaNotice } from "@/components/tls/ExternalMediaNotice";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { gameLabel } from "@/lib/gameLabels";
import { seoTextPreview } from "@/lib/textPreview";
import { headNameClass } from "@/lib/headName";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import {
  Trophy, Flag, Medal, Calendar,
  MapPin, Zap, TrendingUp, Lock, ExternalLink, Radio, Gamepad2, Globe,
  MessageSquare, UserPlus, UserCheck, X, Info, Cake, Crown,
  Monitor, Keyboard, BadgeCheck, Heart, Users, Sparkles, Copy, Award, Settings, Target,
} from "lucide-react";
import { toast } from "sonner";
import { formatMonth, formatWhen } from "@/lib/datetime";
import { asInstant } from "@/lib/vienna";
import { showLapTime } from "@/lib/laptime";
import { CountUp } from "@/components/tls/motion/CountUp";
import { StaggerIn } from "@/components/tls/motion/StaggerIn";
import { LeagueSeasonHistory } from "@/components/tls/league/LeagueSeasonHistory";
import { LeagueOverallStanding } from "@/components/tls/league/LeagueOverallStanding";
import { LeagueCurrent } from "@/components/tls/league/LeagueCurrent";
import { LeagueSeasonLine } from "@/components/tls/league/LeagueSeasonLine";
import { LeagueMomentHint } from "@/components/tls/league/LeagueMomentHint";
import { RewardChip } from "@/components/tls/rewards/RewardChip";
import { EmblemRow, TrophyCabinet } from "@/components/tls/rewards/TrophyCabinet";
import { InternalTag } from "@/components/tls/InternalTag";
import { ShortCaps } from "@/components/tls/ShortCaps";

import { ROLE_COLORS } from "@/lib/categoryColors";
// Öffentliches Profil, Umbau 24.09.: Banner als echtes Banner mit überlappendem Avatar, eine Zeile
// mit Level, Rolle und verknüpften Konten, eine Zahlenleiste und dieselben Reiter wie in der App (#1149): Übersicht,
// Erfolge, Auszeichnungen, Referenzen mit Turnieren und Fast Laps, Teams, für Mitglieder Ehrungen. Das eigene Profil
// zeigt dazu „Nur für dich“ (Rechnungen, Gewinne, was fehlt), die eigenen Erfolge mit Fortschritt, das Zahnrad zu den
// Einstellungen und den Schalter „So sehen dich andere“. Die Übersicht zeigt links die
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
  const date = asInstant(raw);
  if (Number.isNaN(date.getTime())) return "";
  return formatWhen(date, { time: false });
}

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
  1: { color: ROLE_COLORS.honor, label: "Gold" },
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
  if (kind === "threads") return `https://www.threads.com/@${handle}`;
  if (kind === "facebook") return `https://www.facebook.com/${handle}`;
  if (kind === "linkedin") return `https://www.linkedin.com/in/${handle}`;
  if (kind === "snapchat") return `https://www.snapchat.com/add/${handle}`;
  if (kind === "pinterest") return `https://www.pinterest.com/${handle}/`;
  if (kind === "telegram") return `https://t.me/${handle}`;
  if (kind === "mastodon") return handle.includes("@") ? `https://${handle.split("@")[1]}/@${handle.split("@")[0]}` : "";
  if (kind === "bluesky") return `https://bsky.app/profile/${handle}`;
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
const SOCIAL_PLATFORMS = ["discord", "twitch", "youtube", "instagram", "tiktok", "x", "github", "kick", "reddit", "spotify", "threads", "facebook", "linkedin", "snapchat", "pinterest", "telegram", "mastodon", "bluesky", "website"];
const GAME_PLATFORMS = ["steam", "epic", "psn", "xbox", "nintendo", "ea", "riot", "battlenet", "faceit", "startgg", "roblox", "osu", "lichess", "wargaming", "bungie"];
const MANUAL_FIELDS = {
  discord: "discord_name", twitch: "twitch_handle", youtube: "youtube_handle", instagram: "instagram_handle",
  tiktok: "tiktok_handle", x: "x_handle", website: "website", steam: "steam_id", epic: "epic_id", psn: "psn_id",
  xbox: "xbox_id", nintendo: "nintendo_fc", ea: "ea_id", riot: "riot_id", battlenet: "battlenet_id",
  faceit: "faceit_handle", startgg: "startgg_handle", roblox: "roblox_handle", osu: "osu_handle", lichess: "lichess_handle", github: "github_handle", kick: "kick_handle", reddit: "reddit_handle", spotify: "spotify_handle",
  threads: "threads_handle", facebook: "facebook_handle", linkedin: "linkedin_handle", snapchat: "snapchat_handle", pinterest: "pinterest_handle", telegram: "telegram_handle", wargaming: "wargaming_handle", bungie: "bungie_handle", mastodon: "mastodon_handle", bluesky: "bluesky_handle",
};

// PlayStation (#891): getippt bleibt getippt, aber ein Klick führt zu Sonys Web-Profil profile.playstation.com/<Online-ID>.
// Verlinkt wird nur eine gültige Online-ID (3–16 Zeichen, Buchstabe vorne, dann Buchstaben, Ziffern, - und _); eine
// eingefügte Profil-Adresse zählt als ihre ID. Alles andere bleibt Text zum Kopieren.
export function psnProfileUrl(value) {
  const id = String(value || "").trim().replace(/^https?:\/\/(www\.)?profile\.playstation\.com\//i, "").split(/[/?#]/)[0];
  return /^[A-Za-z][A-Za-z0-9_-]{2,15}$/.test(id) ? `https://profile.playstation.com/${id}` : "";
}

function manualUrl(platform, value) {
  if (platform === "website") return externalUrl(value);
  if (platform === "twitch") return normalizeTwitchChannel(value) ? `https://www.twitch.tv/${normalizeTwitchChannel(value)}` : "";
  if (platform === "xbox") return `https://www.xbox.com/play/user/${encodeURIComponent(String(value).trim())}`;
  if (platform === "psn") return psnProfileUrl(value);
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

/** Der Schalter „So sehen dich andere“ (#1149) - ein echter Schalter, mit Tastatur bedienbar. */
function AsOthersSwitch({ on, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="So sehen dich andere"
      onClick={() => onChange(!on)}
      data-testid="profile-as-others-switch"
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition ${on ? "border-[#29B6E8] bg-[#29B6E8]/40" : "border-white/20 bg-white/10"}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full transition-transform ${on ? "translate-x-6 bg-[#29B6E8]" : "translate-x-1 bg-white/60"}`} />
    </button>
  );
}

/** Reiter aus der Adresse - auch die alten Namen von /profile (#1149, #1150). */
const TAB_ALIASES = { achievements: "badges", erfolge: "badges", badges: "badges", awards: "awards", trophaeen: "awards", trophies: "awards", honours: "honours", references: "references", teams: "teams", overview: "overview" };

export default function PublicProfilePage() {
  const { username } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [profile, setProfile] = useState(null);
  // „So sehen dich andere“ (#1149): das eigene Profil, wie es jemand ohne Anmeldung sieht.
  const [asOthers, setAsOthers] = useState(false);
  const [achievementsData, setAchievementsData] = useState(null);
  const [liveStreams, setLiveStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  // Reiter aus der Adresse (#1149): ?tab=achievements (früher /profile?tab=achievements), honours, references …
  const [tab, setTab] = useState(() => TAB_ALIASES[searchParams.get("tab") || ""] || "overview");
  // Leichtes 3D im Profilkopf (#1078): der Rahmen für Bild und Name neigt sich mit der Maus.
  const tiltRef = useTilt();
  const [referenceFilter, setReferenceFilter] = useState("all");
  const seoDescription = seoTextPreview(profile?.bio, "Community-Profil bei THE LION SQUAD eSports.");
  useDocumentTitle(profile?.display_name || profile?.username || "Community-Profil", seoDescription, {
    image: profile?.avatar_url || profile?.banner_url,
    type: "profile",
    robots: "noindex, follow",
    canonical: profile?.username ? `${window.location.origin}/u/${encodeURIComponent(profile.username)}` : undefined,
  });
  const { hasConsent } = useCookieConsent();

  // `quiet`: Nachladen nach einer gemeldeten Änderung ohne „LADE PROFIL …“. Sonst hängt die Seite ihre Reiter aus und
  // wieder ein - die eigenen Erfolge werten beim Einhängen aus, der POST meldet wieder eine Änderung, und das Profil
  // lädt ohne Ende neu. Scheitert ein stilles Nachladen (kurz kein Netz, Serverfehler), bleibt der bisherige Stand stehen -
  // sonst stünde „Spieler nicht gefunden“ da.
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const { data } = await api.get(`/users/public/${encodeURIComponent(username)}`, asOthers ? { params: { view_as: "public" } } : undefined);
      setProfile(data);
      api.get("/streams/live").then(({ data: streams }) => setLiveStreams(Array.isArray(streams) ? streams : [])).catch(() => { if (!quiet) setLiveStreams([]); });
      if (data?.id) {
        try {
          const { data: ach } = await api.get(`/achievements/user/${data.id}`);
          setAchievementsData(ach);
        } catch { if (!quiet) setAchievementsData(null); }
      }
    } catch { if (!quiet) setProfile(null); }
    setLoading(false);
  }, [asOthers, username]);
  useEffect(() => { load(); }, [load]);
  const reload = useCallback(() => load({ quiet: true }), [load]);
  useApiInvalidation(reload, ["users", "achievements", "tournaments", "f1", "teams"]);
  const crown = useCrownFor(profile?.id);
  const [showHighlight, setShowHighlight] = useState(false);
  // Banner, Titel und Embleme wählen (#2425): eine Wahl nach der anderen - ein Doppelklick schickt nichts doppelt.
  const { submitting: choosing, submitOnce: chooseOnce } = useSubmissionGuard();

  if (loading) return <PublicLayout><div className="p-20 text-center font-display tracking-widest text-white/40">LADE PROFIL …</div></PublicLayout>;
  // Das eigene Profil ist privat (oder „So sehen dich andere“ zeigt nichts): der Kasten bleibt, dazu der Weg zur Einstellung.
  if (!profile && user && (user.username || "").toLowerCase() === String(username || "").toLowerCase()) {
    return (
      <PublicLayout>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 space-y-6" data-testid="profile-own-private">
          <h1 className={`tls-type-title ${headNameClass(user.display_name || user.username)}`}>{user.display_name || user.username}</h1>
          <div className="flex items-center justify-between gap-4 border border-white/10 bg-[#121212] rounded-sm px-4 py-3" data-testid="profile-as-others">
            <span><span className="block font-bold tls-type-small">So sehen dich andere</span><span className="block tls-type-small text-white/50">{asOthers ? "Nur, was deine Privatsphäre allen zeigt." : "Aus: du siehst auch „Nur für dich“."}</span></span>
            <AsOthersSwitch on={asOthers} onChange={setAsOthers} />
          </div>
          {asOthers ? null : <PrivateBox />}
          <div className="border border-dashed border-white/15 rounded-sm px-6 py-10 text-center text-white/55">
            <Lock className="w-7 h-7 mx-auto mb-3 opacity-60" />
            <p className="font-bold text-white/80">Dein Profil ist privat</p>
            <p className="mt-1 tls-type-body">Andere sehen dein Profil nicht. Öffentlich stellst du es unter <Link to="/mein-bereich/datenschutz" className="text-[#29B6E8] hover:underline">Mein Bereich → Datenschutz</Link>.</p>
          </div>
        </div>
      </PublicLayout>
    );
  }
  if (!profile) return <PublicLayout><div className="p-20 text-center">
    <h1 className="tls-type-title"><ShortCaps>Spieler nicht gefunden</ShortCaps></h1>
    <Link to="/" className="inline-block mt-4 text-[#29B6E8] hover:underline">← Zurück zur Startseite</Link>
  </div></PublicLayout>;

  const s = profile.stats || {};
  const level = profile.achievement_level || { level: s.level || 1, progress: 0, points: s.points || 0, next_level_points: 100 };
  const isPrivate = profile.privacy_public_profile === false;
  const joinedDate = profile.created_at ? asInstant(profile.created_at) : null;
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
  const leagueHistory = Array.isArray(profile.league_history) ? profile.league_history : [];
  const leagueOverall = Array.isArray(profile.league_overall) ? profile.league_overall : [];
  const leagueCurrent = Array.isArray(profile.league_current) ? profile.league_current : [];
  const leagueMoments = Array.isArray(profile.league_moments) ? profile.league_moments : [];
  // Ehrungen (#848): nur, was der Verein freigibt und die Person selbst zeigt - sonst gibt es den Reiter nicht.
  const honours = Array.isArray(profile.honours) ? profile.honours : [];
  const badges = Array.isArray(achievementsData?.awards) ? achievementsData.awards : [];
  // Erfolge II (#619): Angeheftete zuerst, der Schalter „Erfolge öffentlich“ und die geheimen Funde.
  const pinned = Array.isArray(achievementsData?.pinned) ? achievementsData.pinned : [];
  const achievementsHidden = achievementsData?.achievements_hidden === true;
  const hiddenFound = Number(achievementsData?.hidden?.earned || 0);
  // Stand je Kategorie vom Server (#2339, Review N2) - dieselbe Rechnung wie auf der Erfolge-Seite.
  const categoryBars = categoryProgress(achievementsData?.progress).filter((row) => row.earned > 0);
  const teams = Array.isArray(profile.teams) ? profile.teams : [];
  const tournaments = Array.isArray(profile.tournaments) ? profile.tournaments : [];
  const fastLaps = Array.isArray(profile.f1_bests) ? profile.f1_bests : [];
  // Turniere mit Ergebnis sind Referenzen; hier bleiben laufende, kommende und solche ohne Ergebnis.
  const openTournaments = tournaments.filter((t) => !referenceTargets.has(t.slug) && !referenceTargets.has(t.id));
  const relationship = profile.relationship || { status: user?.id === profile.id ? "self" : "anonymous" };
  const isOwnProfile = user?.id === profile.id;
  // Das eigene Profil ohne „So sehen dich andere“: mit Kasten, eigenen Erfolgen und Ehrungen mit Schalter.
  const ownMode = isOwnProfile && !asOthers;
  const displayName = profile.display_name || profile.username;
  const referenceKinds = new Set(referenceItems.map((item) => item.kind || "tournament"));
  const referenceFilters = REFERENCE_FILTERS.filter(([key]) => key === "all" || referenceKinds.has(key));
  const filteredReferences = referenceFilter === "all" ? referenceItems : referenceItems.filter((item) => (item.kind || "tournament") === referenceFilter);
  const showTwitchLive = Boolean(profile.show_twitch_embed && twitchChannel && liveStream);
  const showTwitchChannel = Boolean(profile.show_twitch_embed && twitchChannel && !liveStream);
  const hasOverviewContent = highlights.length > 0 || awards.length > 0 || badges.length > 0 || pinned.length > 0 || referenceItems.length > 0 || leagueHistory.length > 0 || leagueOverall.length > 0 || showTwitchLive;

  // Auszeichnung als Profilbanner (#230): nur eigene; der Server prüft das und die Seite lädt neu. ``slot = "title"``: eine Belohnung der
  // Art „Titel“ steht neben dem Namen (F.4, #2214).
  const featureAward = (awardId, slot = "banner") => chooseOnce(async () => {
    const query = slot === "title" ? "?slot=title" : "";
    try {
      if (awardId) await api.post(`/me/awards/${awardId}/feature${query}`);
      else await api.delete(`/me/awards/feature${query}`);
      toast.success(slot === "title" ? (awardId ? "Als Titel gesetzt." : "Titel entfernt.") : (awardId ? "Als Profilbanner gesetzt." : "Profilbanner entfernt."));
      await load({ quiet: true });
    } catch (err) {
      toast.error(formatRequestError(err, "Das hat nicht geklappt."));
    }
  });

  // Bis zu drei Embleme neben dem Namen (Nr. 34c, #2425): nur eigene Embleme und Medaillen; der Server prüft Anzahl und Besitz.
  // Erst nach dem Nachladen ist die nächste Wahl frei - sonst rechnete ein schneller zweiter Klick mit der alten Liste.
  const featureEmblems = (awardIds) => chooseOnce(async () => {
    try {
      await api.put("/me/awards/emblems", { award_ids: awardIds });
      toast.success(awardIds.length ? "Embleme gespeichert." : "Embleme entfernt.");
      await load({ quiet: true });
    } catch (err) {
      toast.error(formatRequestError(err, "Das hat nicht geklappt."));
    }
  });

  const updateFriendship = async (action) => {
    if (!user) {
      nav(`/login?next=${encodeURIComponent(`/u/${encodeURIComponent(profile.username)}`)}`);
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
      nav(`/login?next=${encodeURIComponent(`/u/${encodeURIComponent(profile.username)}`)}`);
      return;
    }
    nav(`/messages/${encodeURIComponent(profile.id)}`);
  };

  const headerStats = [
    { key: "points", icon: Zap, label: "Punkte", value: s.points || 0, color: "#29B6E8" },
    { key: "badges", icon: Medal, label: "Erfolge", value: badges.length },
    { key: "wins", icon: Trophy, label: "Siege", value: s.wins || 0, color: ROLE_COLORS.honor, glory: true },
    { key: "top3", icon: Medal, label: "Podium", value: s.top3 || 0, color: "#C0C0C0", glory: true },
    { key: "tournaments", icon: Flag, label: "Turniere", value: s.tournaments || tournaments.length || 0 },
    { key: "fastlaps", icon: TrendingUp, label: "Fast Laps", value: s.fast_laps || 0 },
    ...((twitchChannel || s.twitch_live_sessions > 0) ? [{ key: "streams", icon: Radio, label: "Streams", value: s.twitch_live_sessions || 0, color: "#9146FF" }] : []),
  ].filter(nonZeroStat);

  // Dieselben Reiter in derselben Reihenfolge wie in der App (#1149); Mitglieder zusätzlich „Ehrungen“.
  // Profile ohne Nullen (#1268): kein „(0)“; leere Reiter sehen andere gar nicht, das eigene Profil behält sie mit
  // einem Satz, was man tun kann.
  const referenceCount = referenceStats.total || referenceItems.length;
  const tabs = profileTabs({
    own: ownMode,
    badges: badges.length,
    awards: awards.length,
    references: referenceCount,
    referencesContent: referenceCount + openTournaments.length + fastLaps.length,
    teams: teams.length,
    honours: honours.length,
    clubMember: Boolean(profile.is_club_member),
  });
  // Ein Reiter aus der Adresse, den es (für diese Sicht) nicht gibt, fällt auf die Übersicht zurück.
  const activeTab = tabs.some(([key]) => key === tab) ? tab : "overview";

  const lockedTab = isPrivate && (activeTab === "references" || activeTab === "teams");

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
          <Breadcrumbs items={[{ label: "Start", to: "/" }, { label: "Spieler", to: "/players" }, { label: displayName }]} />
        </div>
        <div className="relative h-44 sm:h-56 lg:h-72 overflow-hidden bg-[#0F0F10]" data-testid="profile-banner">
          {profile.banner_url ? (
            <img src={resolveMediaUrl(profile.banner_url)} alt="" className="absolute inset-0 w-full h-full object-cover object-[50%_30%]" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#29B6E8]/30 via-[#0A0A0A] to-brand/15">
              <div className="absolute -top-10 left-1/4 w-[420px] h-[420px] rounded-full bg-[#29B6E8] blur-[160px] opacity-20" />
              <div className="absolute -bottom-20 right-1/4 w-[360px] h-[360px] rounded-full bg-brand blur-[160px] opacity-10" />
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
          {/* Leichtes 3D (#1078): Bild und Name neigen sich mit der Maus um höchstens 3 Grad - nur hier, nur am PC. */}
          {/* Am Tablet (bis 1279 px) stehen die Knöpfe in einer eigenen Zeile unter Bild und Name - sonst bliebe für den
              Namen nur ein schmaler Streifen mit einem Buchstaben je Zeile (#1218). */}
          {/* Der Kopf ragt in den Banner. Er nimmt dort keine Klicks an, damit die Auszeichnung im Banner bedienbar bleibt
              (#1454); Name und Knöpfe schon. */}
          <div ref={tiltRef} className="tls-tilt pointer-events-none relative -mt-14 sm:-mt-16 lg:-mt-20 flex flex-col md:flex-row md:flex-wrap xl:flex-nowrap md:items-end gap-4 md:gap-6" data-testid="profile-tilt">
            <div className="tls-tilt__deep shrink-0">
              <LevelAvatarFrame level={level.level} prestige={level.prestige} crown={crown} size="profile" testId="profile-avatar-frame">
                {profile.avatar_url ? (
                  <img src={resolveMediaUrl(profile.avatar_url)} alt={displayName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-[#29B6E8]/20 to-[#121212] flex items-center justify-center tls-type-hero tls-type-num text-[#29B6E8]">
                    {(displayName || "?").slice(0, 2).toUpperCase()}
                  </div>
                )}
              </LevelAvatarFrame>
            </div>
            <div className="tls-tilt__mid pointer-events-auto flex-1 min-w-0 md:pb-1">
              <div className="flex flex-wrap items-center gap-2 tls-type-label text-[#29B6E8]">
                <span>THE LION SQUAD · Spieler</span>
                {isPrivate && <span className="inline-flex items-center gap-1 text-white/40"><Lock className="w-3 h-3" /> Privat</span>}
              </div>
              {/* Langer Name (#1218): höchstens zwei Zeilen, eine Stufe kleiner, erst dann „…“. */}
              <h1 className={`mt-1 tls-type-title ${headNameClass(displayName)}`} title={displayName} data-testid="profile-head-name">
                {displayName}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 tls-type-small text-white/55" data-testid="profile-identity">
                <span>@{profile.username}</span>
                {/* Titel neben dem Namen (F.4, #2214): eine gewählte Belohnung der Art „Titel“. */}
                <RewardChip award={profile.featured_title} testId="profile-featured-title" />
                <EmblemRow emblems={profile.featured_emblems} testId="profile-featured-emblems" />
                <AccountLevelPill level={level.level} />
                <ClubProfileHint profile={profile} />
                {liveStream && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-live/50 text-live tls-type-label rounded-sm" data-testid="profile-live-pill">
                    <Radio className="w-3 h-3 animate-live" /> Live
                  </span>
                )}
                {profile.country && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{countryName(profile.country)}</span>}
                {joinedDate && <span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />Dabei seit {formatMonth(joinedDate)}</span>}
              </div>
            </div>
            <div className="pointer-events-auto flex flex-wrap gap-2 md:pb-1 md:basis-full xl:basis-auto xl:justify-end shrink-0" data-testid="profile-actions">
              {!isOwnProfile && (
                <>
                  <button
                    type="button"
                    onClick={openMessage}
                    className="tls-btn tls-btn--primary inline-flex items-center gap-2 px-4 py-2 rounded-sm tls-type-label"
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Nachricht
                  </button>
                  {relationship.status === "accepted" ? (
                    <button type="button" onClick={() => updateFriendship("remove")} className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-4 py-2 rounded-sm tls-type-label">
                      <UserCheck className="w-3.5 h-3.5" /> Freunde
                    </button>
                  ) : relationship.incoming ? (
                    <>
                      <button type="button" onClick={() => updateFriendship("accept")} className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-4 py-2 rounded-sm tls-type-label">
                        <UserCheck className="w-3.5 h-3.5" /> Annehmen
                      </button>
                      <button type="button" onClick={() => updateFriendship("decline")} className="tls-btn tls-btn--quiet inline-flex items-center gap-2 px-4 py-2 rounded-sm tls-type-label">
                        <X className="w-3.5 h-3.5" /> Ablehnen
                      </button>
                    </>
                  ) : relationship.outgoing ? (
                    <button type="button" onClick={() => updateFriendship("remove")} className="tls-btn tls-btn--quiet inline-flex items-center gap-2 px-4 py-2 rounded-sm tls-type-label">
                      <UserPlus className="w-3.5 h-3.5" /> Anfrage offen
                    </button>
                  ) : (
                    <button type="button" onClick={() => updateFriendship("request")} className="tls-btn tls-btn--quiet inline-flex items-center gap-2 px-4 py-2 rounded-sm tls-type-label">
                      <UserPlus className="w-3.5 h-3.5" /> Freund hinzufügen
                    </button>
                  )}
                </>
              )}
              {isOwnProfile && (
                <Link to="/mein-bereich/profil" data-testid="profile-settings" aria-label="Profil bearbeiten" title="Profil bearbeiten" className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-4 py-2 rounded-sm tls-type-label">
                  <Settings className="w-3.5 h-3.5" /> Einstellungen
                </Link>
              )}
              <button
                type="button"
                onClick={() => setShowHighlight(true)}
                data-testid="highlight-card-open"
                className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-4 py-2 rounded-sm tls-type-label"
              >
                <Sparkles className="w-3.5 h-3.5" /> Highlight-Karte
              </button>
            </div>
          </div>

          {profile.bio && <p className="mt-4 max-w-3xl text-white/80 tls-type-body leading-relaxed" data-testid="profile-bio">{profile.bio}</p>}

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-center">
            <div data-testid="profile-level-progress">
              <AccountLevelProgress level={level.level} points={level.xp ?? level.points} nextLevelPoints={level.next_level_xp ?? level.next_level_points} progress={level.progress} title={level.title} unit={level.xp != null ? "XP" : "Punkte"} />
            </div>
            {accounts.verifiedCount > 0 && (
              <a href="#konten" onClick={() => setTab("overview")} data-testid="profile-accounts-count"
                className="inline-flex items-center gap-1.5 self-start lg:justify-self-end tls-type-label text-ok hover:text-white">
                <BadgeCheck className="w-4 h-4" /> {accounts.verifiedCount === 1 ? "1 Konto verknüpft" : `${accounts.verifiedCount} Konten verknüpft`}
              </a>
            )}
          </div>

          {headerStats.length > 0 ? (
            // Kennzahlen im Kopf (#1969): die Kacheln steigen gestaffelt auf, die Zahlen zählen hoch.
            <StaggerIn className="mt-6 pb-6 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3" data-testid="profile-stats">
              {headerStats.map((stat) => <QuickStat key={stat.key} icon={stat.icon} label={stat.label} value={stat.value} color={stat.color} glory={stat.glory} testId={`profile-stat-${stat.key}`} />)}
            </StaggerIn>
          ) : <div className="pb-6" />}
          {isOwnProfile && (
            <div className="mb-6 flex items-center justify-between gap-4 border border-white/10 bg-[#121212] rounded-sm px-4 py-3 max-w-xl" data-testid="profile-as-others">
              <span>
                <span className="block font-bold tls-type-small">So sehen dich andere</span>
                <span className="block tls-type-small text-white/50">{asOthers ? "Nur, was deine Privatsphäre allen zeigt – ohne Anmeldung." : "Aus: du siehst alles, auch „Nur für dich“."}</span>
              </span>
              <AsOthersSwitch on={asOthers} onChange={setAsOthers} />
            </div>
          )}
        </div>
      </header>

      {/* Reiter */}
      <div className="border-b border-white/10 sticky top-0 bg-[#0A0A0A]/95 backdrop-blur-sm z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-1 tls-swipe pb-0">
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} data-testid={`profile-tab-${k}`}
              className={`px-4 py-3 tls-type-label whitespace-nowrap transition ${activeTab === k ? "text-[#29B6E8] border-b-2 border-[#29B6E8]" : "text-white/60 hover:text-white"}`}>
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

        {activeTab === "overview" && (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="space-y-8 min-w-0" data-testid="profile-overview-main">
              {ownMode && <PrivateBox />}
              {showTwitchLive && (
                <TwitchLiveCard channel={twitchChannel} url={twitchUrl} stream={liveStream} hasConsent={hasConsent} />
              )}

              {highlights.length > 0 && (
                <section data-testid="profile-highlights">
                  <SectionTitle icon={Trophy} color={ROLE_COLORS.honor} kicker="Podest" title="Highlights" />
                  <div className={`grid gap-3 ${highlights.length > 1 ? "md:grid-cols-2 xl:grid-cols-3" : ""}`}>
                    {highlights.map((item) => <HighlightCard key={item.id} item={item} />)}
                  </div>
                </section>
              )}

              {awards.length > 0 && (
                <section data-testid="profile-awards-preview">
                  <SectionTitle icon={Medal} color={ROLE_COLORS.honor} kicker="Turniere und Liga" title="Trophäen" action={awards.length > 2 ? { label: "Alle ansehen", onClick: () => setTab("awards") } : null} />
                  <div className="grid gap-3 md:grid-cols-2">
                    {awards.slice(0, 2).map((award) => (
                      <AwardBanner key={award.id} award={award} linkTo={award.tournament?.slug ? `/tournaments/${award.tournament.slug}` : null} />
                    ))}
                  </div>
                </section>
              )}

              {pinned.length > 0 && (
                <section data-testid="profile-pinned-awards">
                  <SectionTitle icon={Medal} color={ROLE_COLORS.honor} kicker="Angeheftet" title="Lieblingserfolge" action={{ label: "Alle ansehen", onClick: () => setTab("badges") }} />
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {pinned.map((a) => <PinnedAwardCard key={a.code} award={a} />)}
                  </div>
                </section>
              )}

              {achievementsHidden && (
                <div className="border border-dashed border-white/15 rounded-sm px-4 py-3 tls-type-small text-white/50 flex items-center gap-2" data-testid="profile-achievements-private">
                  <Lock className="w-3.5 h-3.5 shrink-0" /> {displayName} zeigt Erfolge nicht öffentlich.
                </div>
              )}

              {badges.length > 0 && (
                <section>
                  <SectionTitle icon={Medal} color="#29B6E8" kicker="Zuletzt" title="Erfolge" action={badges.length > 6 ? { label: "Alle ansehen", onClick: () => setTab("badges") } : null} />
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2" data-testid="profile-recent-awards">
                    {badges.slice(0, 6).map((a) => (
                      <div key={a.code} className="flex items-center gap-3 p-3 border border-white/10 rounded-sm bg-[#121212]" style={{ boxShadow: `inset 2px 0 0 ${a.material_color || a.level_color}` }}>
                        <Badge material={a.material} level={a.level} rank={a.rank} art={a.art} icon={a.icon || a.group_icon} size="md" title={a.name} />
                        <div className="min-w-0 flex-1">
                          <div className="tls-type-small font-bold" style={{ color: a.level_color }}>{a.level_name}</div>
                          <div className="font-semibold truncate tls-type-small">{a.name}</div>
                        </div>
                        <div className="tls-type-small tls-type-num text-quiet">+{a.points}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Aktuelle Ligen (#1630): Co-Teams in laufenden Staffeln mit Liga-Abzeichen (#1638), Platz von N, Zone, nächstem Spiel. */}
              <LeagueCurrent rows={leagueCurrent} nameOf={(row) => row.display_name || row.squad_name} testId="profile-league-current" />
              {/* Saisonende-Moment (#1639): je Co-Team der letzte bestätigte Ausgang; die Person selbst spielt ihn noch einmal ab. */}
              <LeagueMomentHint rows={leagueMoments} canReplay={ownMode} testId="profile-league-moments" />
              {/* Saisonverlauf als Linie (#1630): Platz je Season auf der Leiter aus Liga N und Platz. */}
              <LeagueSeasonLine rows={leagueHistory} testId="profile-season-line" />
              {/* Season-Historie (F.2, #1627): Liga N, Platz, Meister - wo die Person eingesetzt war. */}
              <LeagueSeasonHistory rows={leagueHistory} showTeam testId="profile-league-history" />
              {/* Gesamtwertung über Seasons (F.5, #2215): Platz in der Spielerwertung je Zeitraum. */}
              <LeagueOverallStanding rows={leagueOverall} testId="profile-league-overall" />

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
                  <div className="tls-type-card text-white/70">Noch keine Erfolge</div>
                  <p className="mt-2 tls-type-small text-white/45 max-w-md mx-auto">Turniere, Fast Laps und Achievements erscheinen hier, sobald {displayName} mitspielt.</p>
                </div>
              )}
            </div>

            <aside className="space-y-4 min-w-0" data-testid="profile-sidebar">
              {showTwitchChannel && <TwitchChannelCard channel={twitchChannel} url={twitchUrl} stats={s} />}
              {(accounts.socials.length > 0 || accounts.games.length > 0) && <AccountsCard groups={accounts} />}
              <AboutCard profile={profile} joinedDate={joinedDate} />
              {/* Bilanz gegen Gegner (#1193): die fünf häufigsten - öffentlich nur Gegner mit öffentlichem Profil. */}
              <RecordCard username={profile.username} publicView={!ownMode} />
              <SetupCard profile={profile} />
              {teams.length > 0 && <TeamsCard teams={teams} />}
            </aside>
          </div>
        )}

        {activeTab === "badges" && ownMode && <OwnAchievements />}
        {activeTab === "badges" && !ownMode && (
          <div className="space-y-6">
            {achievementsHidden ? (
              <div className="border border-dashed border-white/15 rounded-sm px-6 py-14 text-center" data-testid="profile-achievements-private">
                <Lock className="w-8 h-8 mx-auto mb-3 text-white/25" />
                <div className="tls-type-card text-white/70">Erfolge sind privat</div>
                <p className="mt-2 tls-type-small text-white/45 max-w-md mx-auto">{displayName} zeigt Erfolge nicht öffentlich.</p>
              </div>
            ) : (
              <>
                {(categoryBars.length > 0 || hiddenFound > 0) && (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2" data-testid="profile-category-bars">
                    {categoryBars.map((row) => (
                      <div key={row.key} className="border border-white/10 rounded-sm bg-[#121212] px-3 py-2.5" data-testid={`profile-category-bar-${row.key}`}>
                        <div className="flex items-center gap-2">
                          <AchievementIcon name={row.icon} fallback="trophy" className="w-3.5 h-3.5 shrink-0" style={{ color: row.accent }} />
                          <span className="tls-type-label truncate">{row.label}</span>
                          <span className="ml-auto tls-type-label text-white/50 tabular-nums shrink-0">{row.earned} von {row.total}</span>
                        </div>
                        <div className="mt-2 h-1 bg-white/5 rounded-sm overflow-hidden">
                          <div className="h-full" style={{ width: `${row.total ? Math.round((row.earned / row.total) * 100) : 0}%`, backgroundColor: row.accent }} />
                        </div>
                      </div>
                    ))}
                    {hiddenFound > 0 && (
                      <div className="border border-[#A855F7]/30 rounded-sm bg-[#0F0A16] px-3 py-2.5 tls-type-small text-[#c084fc]" data-testid="profile-hidden-found">
                        {hiddenFound === 1 ? "Ein geheimer Erfolg gefunden" : `${hiddenFound} geheime Erfolge gefunden`}
                      </div>
                    )}
                  </div>
                )}
                <AchievementGroupsView groups={achievementsData?.groups || []} earnedOnly emptyText="Noch keine Erfolge freigeschaltet." />
              </>
            )}
            {/* Saison-Fundstücke (#678): eigener Schalter der Person, unabhängig von „Erfolge öffentlich“ - nur die Summen. */}
            <PublicSeasonFinds userId={profile.id} own={isOwnProfile} />
          </div>
        )}

        {/* Trophäen (#2425, Nr. 59; früher „Auszeichnungen“, #230): Turnier-Pokale und Liga-Belohnungen in einer Vitrine mit Filtern -
            keine Referenzen (die sind die Turnier-Historie). Das eigene Profil wählt hier Banner, Titel und bis zu drei Embleme. */}
        {activeTab === "awards" && (
          <div className="space-y-4" data-testid="public-profile-awards">
            <h2 className="tls-type-section flex items-center gap-2"><Trophy className="w-5 h-5 text-honor" /> Trophäen</h2>
            <TrophyCabinet awards={awards} testId="profile-trophies"
              owner={ownMode ? {
                featuredId: profile.featured_award?.id, titleId: profile.featured_title?.id,
                emblemIds: (profile.featured_emblems || []).map((award) => award.id),
                onFeature: (id) => featureAward(id), onTitle: (id) => featureAward(id, "title"), onEmblems: featureEmblems, busy: choosing,
                emblemHint: "Bis zu drei Embleme oder Medaillen stehen neben deinem Namen.",
              } : null}
              empty={isOwnProfile ? "Noch keine Trophäen – sie entstehen, wenn ein Turnier seine Ergebnisse veröffentlicht oder eine Liga-Staffel abgeschlossen wird." : "Noch keine Trophäen aus öffentlichen Wettbewerben."} />
          </div>
        )}

        {/* Ehrungen (#848, eigener Reiter): aus der Mitgliederakte - Ehrenmitgliedschaft, Verdienstnadel, Jubiläum.
            Keine Auszeichnungen: die kommen aus Turnieren. */}
        {activeTab === "honours" && ownMode && <HonoursPanel />}
        {activeTab === "honours" && !ownMode && honours.length > 0 && (
          <div className="space-y-3" data-testid="public-profile-honours">
            <h2 className="tls-type-section flex items-center gap-2"><Award className="w-5 h-5 text-honor" /> Ehrungen</h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {honours.map((honour) => <HonourCard key={`${honour.kind}-${honour.given_on}-${honour.title}`} honour={honour} />)}
            </ul>
          </div>
        )}

        {/* Referenzen: die Turnier- und Fast-Lap-Historie mit Filter; Teilnahmen und Bestzeiten darunter. */}
        {activeTab === "references" && !isPrivate && (
          <div className="space-y-8">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3" data-testid="profile-reference-stats">
              {[
                { key: "total", icon: Trophy, label: "Referenzen", value: referenceCount, color: "#29B6E8" },
                { key: "wins", icon: Crown, label: "Siege", value: referenceStats.wins || 0, color: ROLE_COLORS.honor, glory: true },
                { key: "podiums", icon: Medal, label: "Podien", value: referenceStats.podiums || 0, color: "#C0C0C0", glory: true },
                { key: "tournaments", icon: Flag, label: "Turniere", value: referenceStats.tournaments || 0 },
                { key: "fastlaps", icon: Radio, label: "Fast Laps", value: referenceStats.fastlaps || 0 },
              ].filter(nonZeroStat).map((stat) => <QuickStat key={stat.key} icon={stat.icon} label={stat.label} value={stat.value} color={stat.color} glory={stat.glory} testId={`profile-reference-stat-${stat.key}`} />)}
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
                        className={`px-3 py-1.5 border rounded-sm tls-type-label transition ${referenceFilter === key ? "border-[#29B6E8] text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/15 text-white/60 hover:text-white"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid gap-3" data-testid="public-profile-references">
                  {/* Turnierweg (#1193): jedes Turnier lässt sich aufklappen. */}
                  {filteredReferences.map((item) => (
                    <ReferenceWithPath key={item.id} item={item} username={profile.username} own={ownMode} publicView={!ownMode}>
                      <ReferenceRow item={item} expanded />
                    </ReferenceWithPath>
                  ))}
                </div>
              </section>
            ) : ownMode ? <EmptyState text="Noch keine Referenzen" action={{ to: "/tournaments", label: "Turniere entdecken" }} testId="profile-references-empty" /> : <EmptyState text="Keine öffentlichen Referenzen." />}

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
                <SectionTitle icon={Radio} color={ROLE_COLORS.brand} kicker="Bestzeiten" title={`Fast Lap (${fastLaps.length})`} />
                <div className="space-y-2">
                  {fastLaps.map((f, i) => (
                    <div key={i} data-testid={`profile-fastlap-${f.challenge?.slug || f.challenge?.id || i}`}
                      className={`flex items-center justify-between gap-3 px-4 py-3 border rounded-sm ${f.is_leader ? "border-honor/40 bg-honor/5" : "border-white/10 bg-[#121212]"}`}>
                      <div className="min-w-0">
                        {/* Umbrechen statt abschneiden: am Handy rutscht das Etikett unter den Titel (#2521). */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                          <div className="min-w-0 max-w-full tls-type-label text-[#29B6E8] truncate">{f.challenge?.title || "—"}</div>
                          {/* Vereinsintern (#2521): eine Bestzeit aus einer Challenge, die Gäste nicht sehen. */}
                          {f.internal ? <InternalTag testId={`internal-tag-fastlap-${f.challenge?.id || i}`} /> : null}
                        </div>
                        <div className="tls-type-card truncate">{f.track?.name || "—"}{f.track?.country ? ` · ${f.track.country}` : ""}</div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {f.is_leader && <span className="tls-type-label text-honor">Pole</span>}
                        <span className="tls-type-card tls-type-num">{showLapTime(f.time_str)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === "teams" && !isPrivate && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {teams.length ? (
              teams.map((tm) => (
                <Link key={tm.id} to={`/teams/${tm.id}`} className="tls-card border border-white/10 rounded-sm p-4 bg-[#121212]">
                  <div className="tls-type-label text-[#29B6E8]">[{tm.tag}]</div>
                  <div className="tls-type-card">{tm.name}</div>
                  {tm.description && <p className="mt-2 tls-type-body text-white/60 line-clamp-2">{tm.description}</p>}
                </Link>
              ))
            ) : <EmptyState text="Noch kein Team" action={ownMode ? { to: "/teams", label: "Teams entdecken" } : null} testId="profile-teams-empty" />}
          </div>
        )}
      </div>
    </PublicLayout>
  );
}

// Angeheftete Erfolge (#619): die bis zu sechs Lieblingsstufen, in der Reihenfolge der Person.
function PinnedAwardCard({ award }) {
  const color = award.material_color || award.level_color || ROLE_COLORS.honor;
  return (
    <div className="flex items-center gap-3 p-3 border rounded-sm bg-[#121212]" style={{ borderColor: `${color}55`, boxShadow: `inset 0 0 0 1px ${color}14` }} data-testid={`profile-pinned-${award.code}`}>
      <Badge material={award.material} level={award.level} rank={award.rank} art={award.art} icon={award.icon || award.group_icon} size="lg" title={award.name} />
      <div className="min-w-0 flex-1">
        <div className="tls-type-small font-bold truncate" style={{ color }}>{award.material_name || award.level_name}</div>
        <div className="font-semibold truncate tls-type-small">{award.name}</div>
        <div className="tls-type-small text-quiet truncate">{award.group_name}</div>
      </div>
    </div>
  );
}

function SectionTitle({ icon: Icon, color = "#29B6E8", kicker, title, action = null }) {
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
      <div>
        {kicker && <div className="tls-type-label" style={{ color }}>{kicker}</div>}
        <h2 className="mt-1 tls-type-section flex items-center gap-2">
          <Icon className="w-5 h-5" style={{ color }} /> {title}
        </h2>
      </div>
      {action && (
        <button type="button" onClick={action.onClick} className="tls-type-label text-[#29B6E8] hover:text-white">
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
        <h2 className="tls-type-section flex items-center gap-2">
          <SocialIcon kind="twitch" className="w-5 h-5 text-[#9146FF]" /> Live auf Twitch
        </h2>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 border border-live/50 text-live tls-type-label rounded-sm">
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
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2 tls-type-small text-white/55">
        <span className="truncate min-w-0">{stream.title || "Stream läuft"}</span>
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#9146FF] hover:text-white tls-type-label">
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
          <span className="block font-bold tls-type-small text-white truncate group-hover:text-[#b88cff]">{channel}</span>
          <span className="block tls-type-small text-white/50 truncate">Twitch · gerade offline{hours > 0 ? ` · ${hours} Std. in ${stats.twitch_live_sessions || 0} Streams` : ""}</span>
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="tls-type-label" style={{ color: tone.color }}>{tone.label} · {referenceKindLabel(item.kind)}</span>
            {item.internal ? <InternalTag testId={`internal-tag-highlight-${item.id}`} /> : null}
          </div>
          <div className="mt-1 tls-type-card leading-tight break-words">{item.title || "Referenz"}</div>
          <div className="mt-1 tls-type-small text-white/50 flex flex-wrap gap-x-2 gap-y-0.5">
            {item.subtitle && <span className="break-words">{item.subtitle}</span>}
            {date && <span>{date}</span>}
            {item.time_str && <span className="tabular-nums text-white/70">{showLapTime(item.time_str)}</span>}
          </div>
        </div>
        <div className="tls-type-title tls-type-num leading-none shrink-0" style={{ color: tone.color }}>#{item.rank}</div>
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
        <h2 className="tls-type-section flex items-center gap-2"><Globe className="w-4 h-4 text-[#29B6E8]" /> Konten</h2>
        <p className="tls-type-small text-quiet mt-1 flex items-start gap-1.5"><BadgeCheck className="w-3.5 h-3.5 mt-0.5 text-ok shrink-0" aria-hidden="true" /><span>Mit Haken: per Anmeldung bei der Plattform bestätigt – der Link führt zum echten Konto.</span></p>
      </div>
      {groups.socials.length > 0 && <AccountGroup title="Socials" icon={Globe} color="#29B6E8" entries={groups.socials} testId="public-profile-socials" />}
      {groups.games.length > 0 && <AccountGroup title="Spielkonten" icon={Gamepad2} color={ROLE_COLORS.brand} entries={groups.games} testId="public-profile-gaming-ids" />}
    </section>
  );
}

function AccountGroup({ title, icon: Icon, color, entries, testId }) {
  return (
    <div data-testid={testId}>
      <h3 className="tls-type-label text-quiet mb-2 flex items-center gap-2"><Icon className="w-3.5 h-3.5" style={{ color }} /> {title}</h3>
      <div className="grid grid-cols-1 gap-2">{entries.map((entry) => <AccountRow key={`${entry.key}:${entry.value}`} entry={entry} />)}</div>
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
        <span className="flex items-center gap-1.5 font-bold text-white tls-type-small">
          <span className="truncate">{entry.title}</span>
          {entry.verified && <BadgeCheck className="w-4 h-4 text-ok shrink-0" aria-label="verifiziert" data-testid={`profile-account-${entry.key}-verified`}><title>{verifiedTitle}</title></BadgeCheck>}
        </span>
        <span className="block tls-type-small text-white/50 [overflow-wrap:anywhere]">{entry.detail}</span>
      </span>
      {entry.url ? <ExternalLink className="w-4 h-4 text-white/40 shrink-0" aria-hidden="true" /> : <Copy className="w-4 h-4 text-white/40 shrink-0" aria-hidden="true" />}
    </>
  );
  const className = `flex items-center gap-3 border rounded-sm px-3 py-2.5 bg-[#0A0A0A] transition text-left w-full min-w-0 ${entry.verified ? "border-[var(--social-color)]/60" : "border-white/10 hover:border-[var(--social-color)]/50"}`;
  const style = { "--social-color": entry.color };
  if (entry.url) {
    return <a href={entry.url} target="_blank" rel="noopener noreferrer" title={`${entry.label} öffnen`} data-testid={`profile-account-${entry.key}`} className={className} style={style}>{inner}</a>;
  }
  return <button type="button" onClick={() => copyText(entry.value, `${entry.label} kopiert.`)} title={`${entry.label} kopieren`} data-testid={`profile-account-${entry.key}`} className={className} style={style}>{inner}</button>;
}

// Vereinsprofil (#1267, kein Zusammenführen): ein kleiner Hinweis „Vereinsmitglied · Funktion“ mit Link zur offiziellen
// Vereinsseite. Der Server liefert Adresse und Funktion nur, wenn ein aktives Vereinsprofil mit dem Konto verbunden ist.
export function ClubProfileHint({ profile }) {
  const slug = profile?.club_profile_slug;
  if (!slug) return null;
  const role = String(profile.club_role_title || "").trim();
  const label = role && role !== "Mitglied" ? `Vereinsmitglied · ${role}` : "Vereinsmitglied";
  return (
    <Link
      to={`/members/${encodeURIComponent(slug)}`}
      data-testid="profile-club-hint"
      title="Zum Vereinsprofil"
      className="inline-flex items-center gap-1 max-w-full px-2 py-0.5 border border-honor/40 text-honor tls-type-label rounded-sm hover:bg-honor/10 focus-visible:bg-honor/10 transition"
    >
      <Crown className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function AboutCard({ profile, joinedDate }) {
  const birthday = formatPublicDate(profile.birth_date);
  const location = [profile.city, profile.country ? countryName(profile.country) : ""].filter(Boolean).join(", ");
  const membership = profile.membership?.membership_type
    ? labelValue(profile.membership.membership_type, MEMBERSHIP_TYPE_LABELS)
    : (profile.is_club_member ? "Vereinsmitglied" : "");
  const rows = [
    { label: "Dabei seit", value: joinedDate ? formatMonth(joinedDate) : "", icon: Calendar, tone: "green" },
    { label: "Geburtstag", value: birthday, icon: Cake, tone: "gold" },
    { label: "Ort", value: location, icon: MapPin, tone: "blue" },
    { label: "Mitgliedschaft", value: membership, icon: Crown, tone: "gold" },
  ].filter((row) => row.value);
  if (!rows.length) return null;
  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="public-profile-info">
      <h2 className="tls-type-section flex items-center gap-2">
        <Info className="w-4 h-4 text-[#29B6E8] shrink-0" /> <span className="min-w-0 [overflow-wrap:anywhere]">Über {profile.display_name || profile.username}</span>
      </h2>
      <dl className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 min-w-0">
            <span className={`w-9 h-9 rounded-sm border flex items-center justify-center shrink-0 ${PROFILE_TONES[row.tone] || PROFILE_TONES.white}`}>
              <row.icon className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <dt className="tls-type-label text-quiet">{row.label}</dt>
              <dd className="tls-type-small text-white/90 break-words">{row.value}</dd>
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
    // Freitext (#2126): genau so, wie die Person ihn eingetragen hat.
    { label: "Rolle", items: profile.preferred_role ? [profile.preferred_role] : [], icon: Target, tone: "white" },
    { label: "Lieblingsspiele", items: listItems(profile.favorite_games), icon: Heart, tone: "violet" },
  ].filter((group) => group.items.length);
  if (!groups.length) return null;
  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="public-profile-setup">
      <h2 className="tls-type-section flex items-center gap-2">
        <Gamepad2 className="w-4 h-4 text-brand" /> Setup & Games
      </h2>
      <div className="mt-3 space-y-3">
        {groups.map((group) => (
          <div key={group.label} className="min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`w-7 h-7 rounded-sm border flex items-center justify-center shrink-0 ${PROFILE_TONES[group.tone] || PROFILE_TONES.white}`}>
                <group.icon className="w-3.5 h-3.5" />
              </span>
              <span className="tls-type-label text-quiet">{group.label}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((item) => (
                <span key={item} className="inline-flex max-w-full items-center break-words rounded-sm border border-white/10 bg-white/[0.03] px-2 py-1 tls-type-small text-white/75">{item}</span>
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
      <h2 className="tls-type-section flex items-center gap-2">
        <Users className="w-4 h-4 text-[#29B6E8]" /> Teams
      </h2>
      <div className="mt-3 grid gap-2">
        {teams.map((tm) => (
          <Link key={tm.id} to={`/teams/${tm.id}`} className="flex items-center gap-3 border border-white/10 bg-[#0A0A0A] rounded-sm px-3 py-2 hover:border-[#29B6E8]/60 transition min-w-0">
            <span className="tls-type-label text-[#29B6E8] shrink-0">[{tm.tag}]</span>
            <span className="font-bold truncate">{tm.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

const PROFILE_TONES = {
  blue: "border-[#29B6E8]/35 bg-[#29B6E8]/10 text-[#29B6E8]",
  gold: "border-honor/35 bg-honor/10 text-honor",
  green: "border-ok/35 bg-ok/10 text-ok",
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
        <div className={`w-10 h-10 rounded-sm border flex items-center justify-center shrink-0 ${isFastlap || isSeason ? "border-honor/35 bg-honor/10 text-honor" : "border-[#29B6E8]/35 bg-[#29B6E8]/10 text-[#29B6E8]"}`}>
          {isFastlap ? <Radio className="w-5 h-5" /> : <Trophy className="w-5 h-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`tls-type-label ${isFastlap || isSeason ? "text-honor" : "text-[#29B6E8]"}`}>{referenceKindLabel(item.kind)}</span>
            {isSeason && item.points != null && <span className="tls-type-label text-honor border border-honor/35 px-1.5 py-0.5 rounded-sm">{item.points} Jahrespunkte</span>}
            {item.time_str && <span className="tls-type-label text-white/70 border border-white/10 px-1.5 py-0.5 rounded-sm break-all">{showLapTime(item.time_str)}</span>}
            {item.internal ? <InternalTag testId={`internal-tag-reference-${item.id}`} /> : null}
          </div>
          <div className="mt-1 tls-type-card break-words">{item.title || "Referenz"}</div>
          <div className="tls-type-small text-white/50 mt-0.5 flex items-center gap-x-2 gap-y-1 flex-wrap">
            {item.subtitle && <span className="break-words">{item.subtitle}</span>}
            {date && <span>{date}</span>}
            {expanded && item.status && <StatusBadge status={item.status} />}
            {expanded && item.participant_count && <span>{item.participant_count} Teilnehmer</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end sm:shrink-0 sm:text-right w-full sm:w-auto border-t border-white/10 pt-3 sm:border-0 sm:pt-0">
        <div>
          <div className="tls-type-card tls-type-num" style={{ color: rankColor }}>{rank}</div>
          <div className="tls-type-label text-quiet">Rang</div>
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
      <div className="flex items-center gap-1.5 tls-type-label text-quiet min-w-0"><Icon className="w-3 h-3 shrink-0" /> <span className="truncate">{label}</span></div>
      <div className="mt-1 tls-type-section tls-type-num break-words" style={{ color }}><CountUp value={value} /></div>
    </div>
  );
}

function TournamentRow({ t, expanded = false }) {
  const date = t.start_date ? asInstant(t.start_date) : null;
  return (
    <Link to={`/tournaments/${t.slug || t.id}`} data-testid={`profile-tournament-${t.slug}`} className="flex items-center justify-between gap-3 px-4 py-3 border border-white/10 rounded-sm bg-[#121212] hover:border-[#29B6E8]/60 transition">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge status={t.status} />
          {/* Vereinsintern (#2521): eine Teilnahme, die Gäste nicht sehen. */}
          {t.internal ? <InternalTag testId={`internal-tag-tournament-${t.id}`} /> : null}
          {t.final_position === 1 && <span className="tls-type-label text-honor border border-honor/40 px-1.5 py-0.5 rounded-sm">Sieger</span>}
          {t.final_position > 1 && t.final_position <= 3 && <span className="tls-type-label text-[#CD7F32] border border-[#CD7F32]/40 px-1.5 py-0.5 rounded-sm">Top 3</span>}
        </div>
        <div className="mt-1 tls-type-card truncate">{t.title}</div>
        <div className="tls-type-small text-white/50 mt-0.5 flex items-center gap-2 flex-wrap">
          {t.game && <span>{gameLabel(t.game)}</span>}
          {date && <span>· {formatWhen(date, { time: false })}</span>}
          {expanded && t.final_position && <span>· Endplatz: <span className="text-white">{t.final_position}</span></span>}
        </div>
      </div>
      <ExternalLink className="w-4 h-4 text-white/30 shrink-0" />
    </Link>
  );
}

function EmptyState({ text, action = null, testId }) {
  return (
    <div className="py-12 text-center text-quiet tls-type-label" data-testid={testId}>
      {text}
      {action && <> – <Link to={action.to} className="text-[#29B6E8] hover:underline">{action.label}</Link></>}
    </div>
  );
}

/** Kennzahlen nur über null (#1268). */
function nonZeroStat(stat) {
  return Number(stat.value) > 0;
}

/**
 * Reiter des Profils (#1149, #1268): Anzahl nur über null; für andere nur Reiter mit Inhalt, im eigenen Profil alle
 * (Ehrungen für Mitglieder), damit dort ein Satz sagen kann, was man tun kann.
 */
export function profileTabs({ own, badges = 0, awards = 0, references = 0, referencesContent = references, teams = 0, honours = 0, clubMember = false }) {
  const count = (value) => (value > 0 ? ` (${value})` : "");
  return [
    ["overview", "Übersicht", true],
    ["badges", `Erfolge${count(badges)}`, own || badges > 0],
    ["awards", `Trophäen${count(awards)}`, own || awards > 0],
    ["references", `Referenzen${count(references)}`, own || referencesContent > 0],
    ["teams", `Teams${count(teams)}`, own || teams > 0],
    ["honours", `Ehrungen${count(honours)}`, honours > 0 || (own && clubMember)],
  ].filter(([, , shown]) => shown).map(([key, label]) => [key, label]);
}
