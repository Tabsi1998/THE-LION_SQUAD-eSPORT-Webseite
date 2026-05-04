import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MultiSelect } from "@/components/tls/MultiSelect";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { ExternalLink, Save, Crown, User, Globe, Gamepad2, Eye, Medal } from "lucide-react";
import { AchievementGroupsView } from "@/components/tls/AchievementGroups";

const TABS = [
  { k: "basic", label: "Grunddaten", icon: User },
  { k: "gaming", label: "Gaming", icon: Gamepad2 },
  { k: "socials", label: "Socials", icon: Globe },
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

export default function ProfilePage() {
  const { user, refresh, isClubMember } = useAuth();
  const [tab, setTab] = useState("basic");
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [achData, setAchData] = useState(null);
  const [completeness, setCompleteness] = useState(null);

  // Lazy-load achievements when tab is opened
  useEffect(() => {
    if (tab === "achievements" && !achData) {
      api.get("/achievements/me").then(({ data }) => setAchData(data)).catch(() => setAchData({ groups: [], awards: [] }));
      api.get("/users/me/profile-completeness").then(({ data }) => setCompleteness(data)).catch(() => null);
    }
  }, [tab, achData]);

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
        profile_visibility: user.profile_visibility || {},
      });
    }
  }, [user]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setVisibility = (field, level) => setForm((f) => ({
    ...f,
    profile_visibility: { ...(f.profile_visibility || {}), [field]: level },
  }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      // normalize favorite_games csv -> array
      if (typeof payload.favorite_games === "string") {
        payload.favorite_games = payload.favorite_games
          .split(",").map((s) => s.trim()).filter(Boolean);
      }
      // strip empty strings to avoid overwriting with ""
      Object.keys(payload).forEach((k) => {
        if (payload[k] === "" && k !== "bio") delete payload[k];
      });
      await api.patch("/users/me", payload);
      await refresh();
      toast.success("Profil gespeichert.");
    } catch (err) {
      toast.error("Fehler beim Speichern.");
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

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
                <Field label="Land"><Input value={form.country} onChange={(v) => set("country", v)} placeholder="AT, DE, CH" /></Field>
                <Field label="Stadt"><Input value={form.city} onChange={(v) => set("city", v)} /></Field>
              </Row>
              <Row>
                <Field label="Avatar"><ImageUpload value={form.avatar_url} onChange={(v) => set("avatar_url", v)} testId="profile-avatar" variant="square" /></Field>
                <Field label="Banner"><ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} testId="profile-banner" variant="wide" /></Field>
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
            </Section>
          )}

          {tab === "socials" && (
            <Section>
              <Row>
                <Field label="Discord Name"><Input value={form.discord_name} onChange={(v) => set("discord_name", v)} testId="profile-discord" /></Field>
                <Field label="Twitch"><Input value={form.twitch_handle} onChange={(v) => set("twitch_handle", v)} testId="profile-twitch" placeholder="thelionsquad_esports" /></Field>
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
                    <circle cx="18" cy="18" r="16" fill="none" stroke="#A855F7" strokeWidth="3" strokeDasharray={`${completeness?.score || 0} 100`} pathLength="100" strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="font-heading font-black text-sm">{completeness?.score || 0}%</span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#A855F7]">Profil-Pflege & Achievements</div>
                  <h2 className="font-heading text-2xl md:text-3xl font-black uppercase mt-1">Deine Achievements</h2>
                  <p className="text-sm text-white/55 mt-1">{achData ? `${achData.awards.length} freigeschaltet · ${achData.groups.reduce((s,g)=>s+g.tier_count,0)} im Katalog verfügbar` : "Lade …"}</p>
                </div>
              </div>

              {achData ? (
                <AchievementGroupsView groups={achData.groups} emptyText="Spiel mit, melde dich für Turniere an oder schalte Fast-Lap-Runden frei – dann tauchen hier deine ersten Achievements auf." />
              ) : (
                <div className="text-center py-20 text-white/40 font-display tracking-widest">LADE ACHIEVEMENTS …</div>
              )}
            </div>
          )}

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
                  <div className="text-sm text-white/60 mt-1">Ich willige separat ein, Newsletter und Vereinsinfos per E-Mail zu erhalten. Jederzeit widerrufbar.</div>
                </div>
              </label>

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

          {tab !== "achievements" && (
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
function Input({ value, onChange, placeholder, testId, type = "text" }) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid={testId}
      className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white"
    />
  );
}
