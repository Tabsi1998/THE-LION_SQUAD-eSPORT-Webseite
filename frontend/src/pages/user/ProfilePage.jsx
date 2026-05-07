import { useCallback, useEffect, useState } from "react";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MultiSelect } from "@/components/tls/MultiSelect";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink, Save, Crown, User, Globe, Gamepad2, Eye, Medal, Users, Plus, Trash2, Pencil, Target, RefreshCw, Sparkles, Bell, Mail } from "lucide-react";
import { AchievementGroupsView } from "@/components/tls/AchievementGroups";

const TABS = [
  { k: "basic", label: "Grunddaten", icon: User },
  { k: "gaming", label: "Gaming", icon: Gamepad2 },
  { k: "socials", label: "Socials", icon: Globe },
  { k: "teams", label: "Teams", icon: Users },
  { k: "achievements", label: "Achievements", icon: Medal },
  { k: "privacy", label: "Privatsphäre", icon: Eye },
];

const PLATFORMS = [
  { value: "PC", label: "PC" },
  { value: "PS5", label: "PlayStation 5" },
  { value: "PS4", label: "PlayStation 4" },
  { value: "Xbox", label: "Xbox Series" },
  { value: "Xbox_One", label: "Xbox One" },
  { value: "Switch2", label: "Switch 2" },
  { value: "Switch", label: "Switch" },
  { value: "Mobile", label: "Mobile" },
  { value: "Steam_Deck", label: "Steam Deck" },
  { value: "VR", label: "VR" },
];

const INPUT_DEVICES = [
  { value: "keyboard_mouse", label: "Tastatur + Maus" },
  { value: "controller", label: "Controller" },
  { value: "wheel", label: "Lenkrad" },
  { value: "fightstick", label: "Fightstick" },
  { value: "mobile_touch", label: "Touch / Mobile" },
  { value: "arcade", label: "Arcade Stick" },
];

const SUBSCRIPTIONS = [
  { value: "nintendo_online", label: "Nintendo Online" },
  { value: "nintendo_online_expansion", label: "Nintendo Online + Expansion" },
  { value: "ps_plus_essential", label: "PS Plus Essential" },
  { value: "ps_plus_extra", label: "PS Plus Extra" },
  { value: "ps_plus_premium", label: "PS Plus Premium" },
  { value: "xbox_game_pass", label: "Xbox Game Pass" },
  { value: "xbox_game_pass_ultimate", label: "Xbox Game Pass Ultimate" },
  { value: "ea_play", label: "EA Play" },
  { value: "ea_play_pro", label: "EA Play Pro" },
  { value: "ubisoft_plus", label: "Ubisoft+" },
  { value: "geforce_now", label: "GeForce NOW" },
];

const VISIBILITY = [
  { k: "public", l: "Öffentlich" },
  { k: "community", l: "Nur registrierte Community" },
  { k: "members", l: "Nur Vereinsmitglieder" },
  { k: "admins", l: "Nur Admins" },
  { k: "private", l: "Privat" },
];

const GENDER_OPTIONS = [
  ["", "Keine Angabe"],
  ["male", "Männlich"],
  ["female", "Weiblich"],
  ["diverse", "Divers"],
];

const EMAIL_PREFERENCES = [
  { k: "match_reminders", l: "Match-Erinnerungen", d: "Startzeiten, Match-Hub und Check-in-nahe Hinweise.", defaultOn: true },
  { k: "tournament_updates", l: "Turnier-Updates", d: "Anmeldung, Status, Ergebnisse und wichtige Turnierinfos.", defaultOn: true },
  { k: "prize_updates", l: "Gewinne & Abholung", d: "Gewinn bereit, übergeben oder Frist abgelaufen.", defaultOn: true },
  { k: "membership_updates", l: "Vereinsmitgliedschaft", d: "Bewerbung, Mitgliedsstatus und Vereinsvorteile.", defaultOn: true },
  { k: "news_events", l: "News & Events", d: "Neue Vereinsnews, neue Events und wichtige Ankündigungen.", requiresNewsletter: true },
];

const ACHIEVEMENT_ACTIONS = {
  profile_completion: "Profil weiter ausfüllen",
  tournaments_joined: "Bei Turnieren mitmachen",
  tournaments_won: "Turniere gewinnen",
  matches_played: "Matches spielen",
  matches_won: "Matches gewinnen",
  f1_laps_submitted: "Fast-Lap-Zeiten einreichen",
  f1_podiums: "Fast-Lap-Podium holen",
  f1_wins: "Fast-Lap-Challenge gewinnen",
  discord_messages: "Im Discord aktiv sein",
  twitch_live_sessions: "Mit Twitch live gehen",
  twitch_stream_minutes: "Streamzeit sammeln",
  membership_days: "Vereinsmitgliedschaft pflegen",
};

function flattenAchievementTiers(data) {
  return (data?.groups || []).flatMap((group) =>
    (group.tiers || []).map((tier) => ({
      ...tier,
      group_code: group.code,
      group_name: group.name,
      group_category: group.category,
      group_accent: group.accent_color || "#29B6E8",
    }))
  );
}

function achievementInsights(data) {
  const tiers = flattenAchievementTiers(data);
  const earned = tiers.filter((tier) => tier.earned);
  const openProgress = tiers
    .filter((tier) => !tier.earned && !tier.manual_only && tier.condition_status !== "planned" && Number(tier.target || 0) > 0)
    .sort((a, b) => {
      const byPercent = Number(b.percent || 0) - Number(a.percent || 0);
      if (byPercent) return byPercent;
      const aMissing = Number(a.target || 0) - Number(a.current || 0);
      const bMissing = Number(b.target || 0) - Number(b.current || 0);
      if (aMissing !== bMissing) return aMissing - bMissing;
      return Number(b.points || 0) - Number(a.points || 0);
    });
  const manual = tiers.filter((tier) => !tier.earned && tier.manual_only);
  const planned = tiers.filter((tier) => !tier.earned && tier.condition_status === "planned");
  const points = (data?.awards || []).reduce((sum, award) => sum + Number(award.points || 0), 0);
  return {
    tiers,
    earned,
    openProgress,
    manual,
    planned,
    points,
    total: tiers.length,
    earnedPercent: tiers.length ? Math.round((earned.length / tiers.length) * 100) : 0,
  };
}

export default function ProfilePage() {
  const { user, refresh, isClubMember } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "basic");
  // Sync tab → URL
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setParams({ tab }, { replace: true }); }, [tab]);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [evaluatingAchievements, setEvaluatingAchievements] = useState(false);
  const [achData, setAchData] = useState(null);
  const [completeness, setCompleteness] = useState(null);
  const [games, setGames] = useState([]);

  const loadAchievements = useCallback(async () => {
    const [achievements, profileCompleteness] = await Promise.allSettled([
      api.get("/achievements/me"),
      api.get("/users/me/profile-completeness"),
    ]);
    if (achievements.status === "fulfilled") setAchData(achievements.value.data);
    else setAchData({ groups: [], awards: [] });
    if (profileCompleteness.status === "fulfilled") setCompleteness(profileCompleteness.value.data);
  }, []);

  // Lazy-load achievements when tab is opened
  useEffect(() => {
    if (tab === "achievements" && !achData) {
      loadAchievements();
    }
  }, [tab, achData, loadAchievements]);
  useApiInvalidation(() => {
    if (tab === "achievements") {
      loadAchievements();
    } else {
      setAchData(null);
      setCompleteness(null);
    }
  }, ["achievements", "users"]);

  useEffect(() => {
    api.get("/games").then(({ data }) => setGames(data || [])).catch(() => setGames([]));
  }, []);

  useEffect(() => {
    if (user) {
      setForm({
        // basic
        display_name: user.display_name || "",
        first_name: user.first_name || "",
        last_name: user.last_name || "",
        nickname: user.nickname || "",
        bio: user.bio || "",
        birth_date: user.birth_date?.slice(0, 10) || "",
        gender: user.gender || "",
        country: user.country || "",
        city: user.city || "",
        avatar_url: user.avatar_url || "",
        banner_url: user.banner_url || "",
        // gaming
        favorite_games: (user.favorite_games || []).join(", "),
        main_platform: user.main_platform || "",
        main_platforms: user.main_platforms || (user.main_platform ? [user.main_platform] : []),
        preferred_role: user.preferred_role || "",
        input_device: user.input_device || "",
        input_devices: user.input_devices || (user.input_device ? [user.input_device] : []),
        gaming_subscriptions: user.gaming_subscriptions || [],
        game_ids: user.game_ids || {},
        // socials
        discord_name: user.discord_name || "",
        twitch_handle: user.twitch_handle || "",
        show_twitch_embed: user.show_twitch_embed ?? false,
        youtube_handle: user.youtube_handle || "",
        tiktok_handle: user.tiktok_handle || "",
        instagram_handle: user.instagram_handle || "",
        x_handle: user.x_handle || "",
        steam_id: user.steam_id || "",
        epic_id: user.epic_id || "",
        psn_id: user.psn_id || "",
        xbox_id: user.xbox_id || "",
        nintendo_fc: user.nintendo_fc || user.switch_code || "",
        ea_id: user.ea_id || "",
        riot_id: user.riot_id || "",
        battlenet_id: user.battlenet_id || "",
        website: user.website || "",
        // privacy
        privacy_public_profile: user.privacy_public_profile ?? true,
        newsletter_consent: !!user.newsletter_consent,
        notification_preferences: user.notification_preferences || {},
        profile_visibility: user.profile_visibility || {},
      });
    }
  }, [user]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setGameId = (gameSlug, fieldKey, value) => setForm((f) => ({
    ...f,
    game_ids: {
      ...(f.game_ids || {}),
      [gameSlug]: { ...((f.game_ids || {})[gameSlug] || {}), [fieldKey]: value },
    },
  }));
  const setVisibility = (field, level) => setForm((f) => ({
    ...f,
    profile_visibility: { ...(f.profile_visibility || {}), [field]: level },
  }));
  const setNotificationPreference = (field, enabled) => setForm((f) => ({
    ...f,
    notification_preferences: { ...(f.notification_preferences || {}), [field]: enabled },
  }));
  const notificationEnabled = (field) => {
    if (field === "news_events" && !form.newsletter_consent) return false;
    const pref = form.notification_preferences || {};
    const meta = EMAIL_PREFERENCES.find((item) => item.k === field);
    if (Object.prototype.hasOwnProperty.call(pref, field)) return !!pref[field];
    return !!meta?.defaultOn || (field === "news_events" && !!form.newsletter_consent);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.gender) payload.gender = null;
      // normalize favorite_games csv -> array
      if (typeof payload.favorite_games === "string") {
        payload.favorite_games = payload.favorite_games
          .split(",").map((s) => s.trim()).filter(Boolean);
      }
      await api.patch("/users/me", payload);
      await refresh();
      toast.success("Profil gespeichert.");
    } catch (err) {
      toast.error(formatRequestError(err, "Profil konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  };

  const evaluateAchievements = async () => {
    if (evaluatingAchievements) return;
    setEvaluatingAchievements(true);
    try {
      const { data } = await api.post("/achievements/evaluate");
      await loadAchievements();
      await refresh();
      toast.success(data?.newly_awarded ? `${data.newly_awarded} neue Achievements freigeschaltet.` : "Achievements aktualisiert.");
    } catch (err) {
      toast.error(formatRequestError(err, "Achievements konnten nicht aktualisiert werden."));
    } finally {
      setEvaluatingAchievements(false);
    }
  };

  if (!user) return null;

  const achInsights = achData ? achievementInsights(achData) : null;

  return (
    <PublicLayout>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">EINSTELLUNGEN</span>
            <h1 className="mt-2 font-heading text-3xl md:text-5xl font-black uppercase">Mein Profil</h1>
            <div className="mt-2 text-sm text-white/60">
              {isClubMember ? (
                <span className="inline-flex items-center gap-1.5"><Crown className="w-3.5 h-3.5 text-[#FFD700]" /> Vereinsmitglied</span>
              ) : (
                <span>Community-Spieler</span>
              )}
              <span className="mx-2 text-white/20">·</span>
              <span>@{user.username}</span>
            </div>
          </div>
          {user?.username && (
            <Link to={`/u/${user.username}`} data-testid="profile-view-public" className="inline-flex items-center gap-2 px-4 py-2 border border-[#29B6E8]/40 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#29B6E8]/10 transition">
              <ExternalLink className="w-3.5 h-3.5" /> Öffentliches Profil
            </Link>
          )}
        </div>

        <div className="mt-8 flex border-b border-white/10 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              data-testid={`profile-tab-${t.k}`}
              className={`px-5 py-3 text-xs uppercase tracking-wider font-bold border-b-2 transition flex items-center gap-2 whitespace-nowrap ${tab === t.k ? "border-[#29B6E8] text-[#29B6E8]" : "border-transparent text-white/50 hover:text-white"}`}
            >
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-8 space-y-5">
          {tab === "basic" && (
            <Section>
              <Row>
                <Field label="Display Name"><Input value={form.display_name} onChange={(v) => set("display_name", v)} testId="profile-display-name" /></Field>
                <Field label="Nickname"><Input value={form.nickname} onChange={(v) => set("nickname", v)} /></Field>
              </Row>
              <Row>
                <Field label="Vorname (privat)"><Input value={form.first_name} onChange={(v) => set("first_name", v)} /></Field>
                <Field label="Nachname (privat)"><Input value={form.last_name} onChange={(v) => set("last_name", v)} /></Field>
              </Row>
              <Field label="Bio">
                <textarea value={form.bio || ""} onChange={(e) => set("bio", e.target.value)} rows={4} data-testid="profile-bio" className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white" />
              </Field>
              <Row>
                <Field label="Geburtsdatum"><input type="date" value={form.birth_date} onChange={(e) => set("birth_date", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm" /></Field>
                <Field label="Geschlecht"><select value={form.gender || ""} onChange={(e) => set("gender", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-white">
                  {GENDER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select></Field>
              </Row>
              <Row>
                <Field label="Land"><Input value={form.country} onChange={(v) => set("country", v)} placeholder="AT, DE, CH" /></Field>
                <Field label="Stadt"><Input value={form.city} onChange={(v) => set("city", v)} /></Field>
              </Row>
              <Row>
                <Field label="Avatar"><ImageUpload value={form.avatar_url} onChange={(v) => set("avatar_url", v)} testId="profile-avatar" variant="square" allowLibrary /></Field>
                <Field label="Banner"><ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} testId="profile-banner" variant="wide" allowLibrary /></Field>
              </Row>
            </Section>
          )}

          {tab === "gaming" && (
            <Section>
              <Field label="Lieblingsspiele (Komma-getrennt)">
                <Input value={form.favorite_games} onChange={(v) => set("favorite_games", v)} placeholder="Mario Kart, F1, Rocket League" testId="profile-fav-games" />
              </Field>
              <Field label="Plattformen (mehrere möglich)">
                <MultiSelect options={PLATFORMS} value={form.main_platforms} onChange={(v) => set("main_platforms", v)} testId="profile-platforms" />
              </Field>
              <Field label="Eingabegeräte (mehrere möglich)">
                <MultiSelect options={INPUT_DEVICES} value={form.input_devices} onChange={(v) => set("input_devices", v)} testId="profile-input-devices" />
              </Field>
              <Field label="Gaming-Abos (Game Pass, PS Plus, EA Play, …)">
                <MultiSelect options={SUBSCRIPTIONS} value={form.gaming_subscriptions} onChange={(v) => set("gaming_subscriptions", v)} testId="profile-subs" />
              </Field>
              <Field label="Bevorzugte Rolle"><Input value={form.preferred_role} onChange={(v) => set("preferred_role", v)} placeholder="z.B. IGL, Support, Driver" /></Field>
              {games.some((g) => g.player_id_fields?.length) && (
                <div className="border border-white/10 rounded-sm bg-[#0A0A0A] p-5 space-y-4">
                  <div>
                    <h3 className="font-heading font-black uppercase">Spiel-IDs</h3>
                    <p className="text-xs text-white/50 mt-1">Diese IDs können bei Turnieren als Pflichtfelder verlangt werden. Sichtbar sind sie nicht automatisch öffentlich.</p>
                  </div>
                  {games.filter((g) => g.player_id_fields?.length).map((game) => (
                    <div key={game.id} className="border-t border-white/10 pt-4 first:border-t-0 first:pt-0">
                      <div className="text-[11px] uppercase tracking-widest font-bold text-[#29B6E8] mb-3">{game.name}</div>
                      <Row>
                        {game.player_id_fields.map((field) => (
                          <Field key={field.key} label={`${field.label}${field.required !== false ? " *" : ""}`}>
                            <Input value={form.game_ids?.[game.slug]?.[field.key] || ""} onChange={(v) => setGameId(game.slug, field.key, v)} placeholder={field.help_text || field.label} />
                          </Field>
                        ))}
                      </Row>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {tab === "socials" && (
            <Section>
              <Row>
                <Field label="Discord Name"><Input value={form.discord_name} onChange={(v) => set("discord_name", v)} testId="profile-discord" /></Field>
                <Field label="Twitch"><Input value={form.twitch_handle} onChange={(v) => set("twitch_handle", v)} testId="profile-twitch" placeholder="tabsi98 oder https://www.twitch.tv/tabsi98" /></Field>
              </Row>
              {form.twitch_handle && (
                <label className="flex items-start gap-3 p-3 border border-[#9146FF]/30 bg-[#9146FF]/5 rounded-sm">
                  <input type="checkbox" checked={form.show_twitch_embed || false} onChange={(e) => set("show_twitch_embed", e.target.checked)} data-testid="profile-twitch-embed" className="accent-[#9146FF] mt-1" />
                  <div className="text-sm">
                    <div className="font-bold text-white">Twitch-Live-Embed im öffentlichen Profil zeigen</div>
                    <div className="text-white/60 text-xs mt-1">Wenn du live bist, erscheint dein Stream als eingebetteter Player auf deinem öffentlichen Profil.</div>
                  </div>
                </label>
              )}
              <Row>
                <Field label="YouTube"><Input value={form.youtube_handle} onChange={(v) => set("youtube_handle", v)} /></Field>
                <Field label="Instagram"><Input value={form.instagram_handle} onChange={(v) => set("instagram_handle", v)} /></Field>
              </Row>
              <Row>
                <Field label="TikTok"><Input value={form.tiktok_handle} onChange={(v) => set("tiktok_handle", v)} /></Field>
                <Field label="X (Twitter)"><Input value={form.x_handle} onChange={(v) => set("x_handle", v)} /></Field>
              </Row>
              <Row>
                <Field label="Steam ID"><Input value={form.steam_id} onChange={(v) => set("steam_id", v)} testId="profile-steam" /></Field>
                <Field label="Epic"><Input value={form.epic_id} onChange={(v) => set("epic_id", v)} /></Field>
              </Row>
              <Row>
                <Field label="PSN"><Input value={form.psn_id} onChange={(v) => set("psn_id", v)} /></Field>
                <Field label="Xbox"><Input value={form.xbox_id} onChange={(v) => set("xbox_id", v)} /></Field>
              </Row>
              <Row>
                <Field label="Nintendo Friend Code"><Input value={form.nintendo_fc} onChange={(v) => set("nintendo_fc", v)} placeholder="SW-XXXX-XXXX-XXXX" /></Field>
                <Field label="EA ID"><Input value={form.ea_id} onChange={(v) => set("ea_id", v)} /></Field>
              </Row>
              <Row>
                <Field label="Riot ID"><Input value={form.riot_id} onChange={(v) => set("riot_id", v)} /></Field>
                <Field label="Battle.net"><Input value={form.battlenet_id} onChange={(v) => set("battlenet_id", v)} /></Field>
              </Row>
              <Field label="Website"><Input value={form.website} onChange={(v) => set("website", v)} placeholder="https://…" /></Field>
            </Section>
          )}

          {tab === "achievements" && (
            <div className="space-y-6" data-testid="profile-achievements-tab">
              <div className="border border-white/10 bg-[#121212] rounded-sm p-5 flex items-center gap-4 flex-wrap">
                <div className="relative w-14 h-14 shrink-0">
                  <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
                    <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                    <circle cx="18" cy="18" r="16" fill="none" stroke="#A855F7" strokeWidth="3" strokeDasharray={`${achInsights?.earnedPercent ?? completeness?.score ?? 0} 100`} pathLength="100" strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="font-heading font-black text-sm">{achInsights?.earnedPercent ?? 0}%</span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#A855F7]">Account-Level & Achievements</div>
                  <h2 className="font-heading text-2xl md:text-3xl font-black uppercase mt-1">Deine Achievements</h2>
                  <p className="text-sm text-white/55 mt-1">{achInsights ? `${achInsights.earned.length} freigeschaltet · ${achInsights.total} im Katalog · ${achInsights.points} Punkte` : "Lade …"}</p>
                </div>
                <button type="button" onClick={evaluateAchievements} disabled={evaluatingAchievements} data-testid="profile-achievements-evaluate" className="inline-flex items-center gap-2 px-4 py-2 border border-[#A855F7]/50 text-[#c084fc] font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#A855F7]/10 disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${evaluatingAchievements ? "animate-spin" : ""}`} /> Aktualisieren
                </button>
              </div>

              {achData ? (
                <>
                  <AchievementOverview insights={achInsights} profileScore={completeness?.score || 0} />
                  <AchievementGroupsView groups={achData.groups} emptyText="Spiel mit, melde dich für Turniere an oder schalte Fast-Lap-Runden frei – dann tauchen hier deine ersten Achievements auf." />
                </>
              ) : (
                <div className="text-center py-20 text-white/40 font-display tracking-widest">LADE ACHIEVEMENTS …</div>
              )}
            </div>
          )}

          {tab === "teams" && <TeamsPanel />}

          {tab === "privacy" && (
            <Section>
              <label className="flex items-start gap-3 p-4 border border-white/10 rounded-sm bg-[#0A0A0A]">
                <input type="checkbox" checked={form.privacy_public_profile} onChange={(e) => set("privacy_public_profile", e.target.checked)} data-testid="profile-privacy" className="accent-[#29B6E8] mt-1" />
                <div>
                  <div className="font-bold text-white">Öffentliches Profil</div>
                  <div className="text-sm text-white/60 mt-1">Wenn aktiv, sind Avatar, Bio, Achievements, Stats und öffentliche Socials für jeden sichtbar.</div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-4 border border-white/10 rounded-sm bg-[#0A0A0A]">
                <input type="checkbox" checked={form.newsletter_consent} onChange={(e) => set("newsletter_consent", e.target.checked)} className="accent-[#29B6E8] mt-1" />
                <div>
                  <div className="font-bold text-white">Newsletter</div>
                  <div className="text-sm text-white/60 mt-1">Ich willige separat ein, Newsletter, Event-Hinweise und Vereinsnews per E-Mail zu erhalten. Jederzeit widerrufbar.</div>
                </div>
              </label>

              <div className="border border-white/10 rounded-sm p-5 bg-[#0A0A0A]">
                <div className="flex items-start gap-3 mb-4">
                  <Bell className="w-5 h-5 text-[#29B6E8] mt-1 shrink-0" />
                  <div>
                    <h3 className="font-heading font-black uppercase mb-1">E-Mail-Benachrichtigungen</h3>
                    <p className="text-xs text-white/50">Wähle, welche optionalen E-Mails du bekommen möchtest. Account- und Sicherheitsmails bleiben immer aktiv.</p>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  {EMAIL_PREFERENCES.map((pref) => {
                    const disabled = pref.requiresNewsletter && !form.newsletter_consent;
                    const checked = notificationEnabled(pref.k);
                    return (
                      <label key={pref.k} className={`flex items-start gap-3 border rounded-sm p-3 ${checked ? "border-[#29B6E8]/45 bg-[#29B6E8]/5" : "border-white/10 bg-[#121212]"} ${disabled ? "opacity-55" : ""}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={(e) => setNotificationPreference(pref.k, e.target.checked)}
                          data-testid={`profile-mail-pref-${pref.k}`}
                          className="accent-[#29B6E8] mt-1"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-bold text-white text-sm">
                            <Mail className="w-3.5 h-3.5 text-[#29B6E8]" /> {pref.l}
                          </div>
                          <div className="text-xs text-white/50 mt-1">{disabled ? "Newsletter-Einwilligung zuerst aktivieren." : pref.d}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="border border-white/10 rounded-sm p-5 bg-[#0A0A0A]">
                <h3 className="font-heading font-black uppercase mb-1">Sichtbarkeit einzelner Felder</h3>
                <p className="text-xs text-white/50 mb-4">Wähle, wer welches Feld sehen darf. Standard: öffentlich.</p>
                <div className="space-y-2">
                  {[
                    { k: "discord", l: "Discord" },
                    { k: "email", l: "E-Mail" },
                    { k: "city", l: "Wohnort" },
                    { k: "country", l: "Land" },
                    { k: "birth_date", l: "Geburtsdatum" },
                    { k: "twitch", l: "Twitch" },
                    { k: "steam", l: "Steam" },
                    { k: "psn", l: "PSN" },
                    { k: "xbox", l: "Xbox" },
                    { k: "youtube", l: "YouTube" },
                    { k: "instagram", l: "Instagram" },
                    { k: "x", l: "X / Twitter" },
                    { k: "epic", l: "Epic" },
                    { k: "nintendo", l: "Nintendo Friend Code" },
                    { k: "ea", l: "EA ID" },
                    { k: "riot", l: "Riot ID" },
                    { k: "battlenet", l: "Battle.net" },
                    { k: "main_platforms", l: "Plattformen" },
                    { k: "input_devices", l: "Eingabegeräte" },
                    { k: "favorite_games", l: "Lieblingsspiele" },
                  ].map((f) => (
                    <div key={f.k} className="flex items-center justify-between gap-3">
                      <span className="text-sm text-white/80">{f.l}</span>
                      <select
                        value={form.profile_visibility?.[f.k] || "public"}
                        onChange={(e) => setVisibility(f.k, e.target.value)}
                        data-testid={`profile-vis-${f.k}`}
                        className="bg-[#121212] border border-white/10 px-2 py-1 rounded-sm text-xs"
                      >
                        {VISIBILITY.map((v) => <option key={v.k} value={v.k}>{v.l}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          )}

          {!["achievements", "teams"].includes(tab) && (
            <div className="pt-4 flex gap-3">
              <button type="submit" disabled={saving} data-testid="profile-save" className="inline-flex items-center gap-2 px-6 py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50 transition text-xs">
                <Save className="w-3.5 h-3.5" /> {saving ? "Speichere…" : "Speichern"}
              </button>
              <Link to="/privacy-account" className="inline-flex items-center gap-2 px-6 py-3 border border-white/15 text-white/70 hover:text-white font-bold uppercase tracking-wider rounded-sm text-xs">
                DSGVO / Daten
              </Link>
            </div>
          )}
        </form>
      </div>
    </PublicLayout>
  );
}

function AchievementOverview({ insights, profileScore }) {
  if (!insights) return null;
  const next = insights.openProgress.slice(0, 3);
  const nearlyDone = insights.openProgress.filter((tier) => Number(tier.percent || 0) >= 50).slice(0, 3);
  const manual = insights.manual.slice(0, 3);
  const planned = insights.planned.slice(0, 3);

  return (
    <div className="space-y-4" data-testid="achievement-overview">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <AchievementStat icon={Medal} label="Freigeschaltet" value={`${insights.earned.length}/${insights.total}`} color="#FFD700" />
        <AchievementStat icon={Sparkles} label="Punkte" value={insights.points.toLocaleString("de-DE")} color="#A855F7" />
        <AchievementStat icon={Target} label="Machbar" value={insights.openProgress.length} color="#00FF88" />
        <AchievementStat icon={User} label="Profilpflege" value={`${profileScore}%`} color="#29B6E8" />
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-4">
        <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#00FF88]">Nächste Ziele</div>
              <h3 className="font-heading text-xl font-black uppercase mt-1">Was als Nächstes lohnt</h3>
            </div>
            <Target className="w-5 h-5 text-[#00FF88]" />
          </div>
          {next.length ? (
            <div className="space-y-2">
              {next.map((tier) => <NextAchievementRow key={tier.code} tier={tier} />)}
            </div>
          ) : (
            <div className="border border-dashed border-white/10 rounded-sm p-8 text-sm text-white/45 text-center">
              Keine automatisch messbaren offenen Ziele. Schau bei manuellen oder geplanten Achievements nach.
            </div>
          )}
        </div>

        <div className="space-y-4">
          <SmallAchievementPanel
            title="Fast geschafft"
            empty="Noch kein Ziel über 50%."
            rows={nearlyDone}
            color="#FFD700"
          />
          <SmallAchievementPanel
            title="Manuell / Event"
            empty="Keine manuellen Ziele offen."
            rows={manual}
            color="#FF3B30"
            manual
          />
          <SmallAchievementPanel
            title="Geplant"
            empty="Keine geplanten Ziele offen."
            rows={planned}
            color="#FFFFFF"
            manual
          />
        </div>
      </div>
    </div>
  );
}

function AchievementStat({ icon: Icon, label, value, color }) {
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/45 font-bold">
        <Icon className="w-3.5 h-3.5" style={{ color }} /> {label}
      </div>
      <div className="mt-2 font-heading text-2xl font-black tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

function NextAchievementRow({ tier }) {
  const missing = Math.max(Number(tier.target || 0) - Number(tier.current || 0), 0);
  const action = ACHIEVEMENT_ACTIONS[tier.condition_key] || "Weiter aktiv bleiben";
  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3" data-testid={`next-achievement-${tier.code}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: tier.group_accent }}>{tier.group_name}</div>
          <div className="font-heading font-bold text-lg truncate">{tier.name}</div>
          <div className="text-xs text-white/50 mt-1">{action}{missing ? ` · noch ${missing.toLocaleString("de-DE")}` : ""}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-white/45 uppercase tracking-widest">+{tier.points}</div>
          {tier.member_only && <div className="mt-1 text-[9px] uppercase tracking-widest text-[#FFD700]">Verein</div>}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-white/5 rounded-sm overflow-hidden">
          <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, Number(tier.percent || 0)))}%`, backgroundColor: tier.group_accent }} />
        </div>
        <span className="text-[10px] text-white/45 tabular-nums">{tier.current}/{tier.target}</span>
      </div>
    </div>
  );
}

function SmallAchievementPanel({ title, rows, empty, color, manual = false }) {
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-heading font-black uppercase text-base">{title}</h3>
        <span className="text-[10px] uppercase tracking-widest text-white/35">{rows.length}</span>
      </div>
      {rows.length ? (
        <div className="space-y-2">
          {rows.map((tier) => (
            <div key={tier.code} className="border border-white/10 bg-[#0A0A0A] rounded-sm px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate">{tier.name}</div>
                  <div className="text-[10px] uppercase tracking-widest text-white/35 truncate">{manual ? tier.group_name : `${tier.current}/${tier.target}`}</div>
                </div>
                <span className="text-xs font-bold shrink-0" style={{ color }}>{manual ? "Event" : `${tier.percent}%`}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-white/40 border border-dashed border-white/10 rounded-sm p-4 text-center">{empty}</div>
      )}
    </div>
  );
}

const emptySquad = {
  name: "",
  description: "",
  tournament_id: "",
  season_id: "",
  member_ids: [],
  status: "active",
};

function TeamsPanel() {
  const [teams, setTeams] = useState([]);
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

  const loadMeta = useCallback(() => {
    api.get("/tournaments").then(({ data }) => setTournaments(data || [])).catch(() => {});
    api.get("/seasons").then(({ data }) => setSeasons(data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    loadTeams().catch(() => toast.error("Teams konnten nicht geladen werden."));
    loadMeta();
  }, [loadMeta, loadTeams]);
  useApiInvalidation(() => {
    loadTeams();
    loadMeta();
  }, ["teams", "tournaments", "seasons"]);

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
      toast.success("Squad geloescht.");
      setSquads((rows) => rows.filter((s) => s.id !== squad.id));
      loadTeams();
    } catch (err) {
      toast.error(formatRequestError(err, "Squad konnte nicht geloescht werden."));
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
                  <div className="text-[10px] uppercase tracking-widest text-white/45">{team.my_role} · {team.squad_count || 0} Squads</div>
                </div>
              </button>
            ))}
          </div>

          <div className="border border-white/10 bg-[#121212] rounded-sm p-5">
            {activeTeam && (
              <>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">[{activeTeam.tag}]</div>
                    <h3 className="font-heading text-2xl font-black uppercase">{activeTeam.name}</h3>
                    <div className="text-xs text-white/50 mt-1">{activeTeam.members?.length || 0} Mitglieder</div>
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
                <Field label="Season/Circuit">
                  <select value={editing.season_id || ""} onChange={(e) => setEditing({ ...editing, season_id: e.target.value })} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
                    <option value="">Keine Season</option>
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

function Section({ children }) { return <div className="space-y-4">{children}</div>; }
function Row({ children }) {
  const count = Array.isArray(children) ? children.length : 1;
  const cls = count === 3 ? "grid grid-cols-1 sm:grid-cols-3 gap-4" : "grid grid-cols-1 sm:grid-cols-2 gap-4";
  return <div className={cls}>{children}</div>;
}
function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      {children}
    </label>
  );
}
function Input({ value, onChange, placeholder, testId, type = "text", required = false }) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid={testId}
      required={required}
      className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white"
    />
  );
}
