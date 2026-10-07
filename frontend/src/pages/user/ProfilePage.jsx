import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { gameLabel } from "@/lib/gameLabels";
import { buildDirtyPayload, hasPayloadChanges, sameValue } from "@/lib/dirtyPayload";
import { toast } from "sonner";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Save, Crown, UserCircle } from "lucide-react";
import { usePublicSiteSettings } from "@/hooks/usePublicSiteSettings";
import { EMAIL_PREFERENCES, NOTIFICATION_CHANNELS, TABS, notificationPreferenceKey, tabRedirect } from "./profile/constants";
import { profileFormPayload, profileToForm } from "./profile/form";
import { applyGroupLevel } from "./profile/visibility";
import { useAutosave } from "./profile/useAutosave";
import { ProfileNav } from "./profile/ProfileNav";
import { BasicTab } from "./profile/BasicTab";
import { GamingTab } from "./profile/GamingTab";
import { SocialsTab } from "./profile/SocialsTab";
import { linkErrorText, linkedText } from "@/lib/platformLinks";
import { PrivacyTab } from "./profile/PrivacyTab";
import { NotificationsTab } from "./profile/NotificationsTab";
import { SecurityTab } from "./profile/SecurityTab";
import { AppearanceTab } from "./profile/AppearanceTab";
import { AboutTab } from "./profile/AboutTab";

// Die Einstellungen (#1146): Rahmen, Formularzustand und Speichern. Jeder Reiter ist eine eigene Datei unter ./profile
// (#253, Regel aus #223). Dieselben Gruppen in derselben Reihenfolge wie in der App - Darstellung, Benachrichtigungen,
// Sicherheit, Privatsphäre, Konto, Über die App. Was keine Einstellung ist (Teams, Freunde, Erfolge, Ehrungen,
// Rechnungen), hat seinen Ort woanders; alte Links leiten dorthin weiter. Am PC steht das Menü links und der Inhalt nutzt
// die Breite; am Tablet und Handy bleibt die Reiterreihe oben.
//
// Reiter mit Textfeldern haben eine Speicherleiste; Privatsphäre und
// Benachrichtigungen bestehen nur aus Schaltern und Auswahlfeldern und
// speichern von selbst (#257).

const FORM_TABS = new Set(["basic", "gaming", "socials"]);
// ?tab=sessions war der eigene Reiter für Geräte; seit #258 steckt er in
// „Sicherheit“, alte Links landen dort.
const TAB_ALIASES = { sessions: "security" };

export default function ProfilePage() {
  const { user, refresh, isClubMember, logout } = useAuth();
  const siteSettings = usePublicSiteSettings();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedParam = params.get("tab") || "basic";
  // Alte Reiter, die keine Einstellungen sind (#1150): die Inbox ist /messages (mit ?to= direkt im Gespräch), Teams und
  // Freunde stehen unter Community, Erfolge, Ehrungen und Rechnungen im eigenen Profil bzw. unter /account/invoices.
  const redirectTarget = tabRedirect(requestedParam, params, user?.username);
  useEffect(() => {
    if (redirectTarget) navigate(redirectTarget, { replace: true });
  }, [redirectTarget, navigate]);
  const requestedTab = TAB_ALIASES[requestedParam] || requestedParam;
  const tab = TABS.some((item) => item.k === requestedTab) ? requestedTab : "basic";
  // Der Reiter steht in der Adresse (?tab=…, wie in Mails und Benachrichtigungen
  // verlinkt) und wird als eigener Verlaufseintrag gesetzt, damit „Zurück“ zum
  // vorigen Reiter führt statt aus dem Profil hinaus.
  const setTab = useCallback((nextTab) => {
    const next = new URLSearchParams(params);
    next.set("tab", nextTab);
    setParams(next);
  }, [params, setParams]);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [games, setGames] = useState([]);
  const initialProfileFormRef = useRef(null);
  const initialProfileUserIdRef = useRef("");
  const autosave = useAutosave({
    form,
    setForm,
    initialFormRef: initialProfileFormRef,
    initialUserIdRef: initialProfileUserIdRef,
    refresh,
  });

  useEffect(() => {
    api.get("/games").then(({ data }) => setGames(Array.isArray(data) ? data : [])).catch(() => setGames([]));
  }, []);

  useEffect(() => {
    if (user) {
      const nextForm = profileToForm(user);
      setForm((current) => {
        const sameUser = initialProfileUserIdRef.current === user.id;
        const hasUnsavedLocalChanges = initialProfileFormRef.current
          && !sameValue(profileFormPayload(current), profileFormPayload(initialProfileFormRef.current));
        if (sameUser && hasUnsavedLocalChanges) return current;
        initialProfileUserIdRef.current = user.id;
        initialProfileFormRef.current = nextForm;
        return nextForm;
      });
    }
  }, [user]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Verknüpfte Plattform-Konten (#260): Liste vom Server; „Verknüpfen“ schickt den Browser zur
  // Plattform, die Rückkehr landet mit ?linked= oder ?link_error= hier und wird einmal gemeldet.
  const [platformLinks, setPlatformLinks] = useState({ links: [], available: {}, platforms: {}, disabled: [] });
  const loadPlatformLinks = useCallback(async () => {
    try {
      const { data } = await api.get("/me/platform-links");
      setPlatformLinks({ links: data?.links || [], available: data?.available || {}, platforms: data?.platforms || {} });
    } catch {
      setPlatformLinks({ links: [], available: {}, platforms: {} });
    }
  }, []);
  useEffect(() => {
    if (tab === "socials") loadPlatformLinks();
  }, [tab, loadPlatformLinks]);
  const linkedParam = params.get("linked");
  const linkErrorParam = params.get("link_error");
  const linkDetailParam = params.get("link_detail");
  useEffect(() => {
    if (!linkedParam && !linkErrorParam) return;
    if (linkedParam) toast.success(linkedText(linkedParam));
    if (linkErrorParam) toast.error(linkErrorText(linkErrorParam, linkDetailParam || ""), { duration: 12000 });
    const next = new URLSearchParams(params);
    next.delete("linked");
    next.delete("link_error");
    next.delete("link_detail");
    setParams(next, { replace: true });
    refresh?.();
  }, [linkedParam, linkErrorParam, linkDetailParam, params, setParams, refresh]);
  const startPlatformLink = useCallback(async (platform, input = "") => {
    try {
      const { data } = await api.post(`/me/platform-links/${platform}/start`, input ? { input } : undefined);
      if (data?.url) window.location.assign(data.url);
    } catch (err) {
      toast.error(formatRequestError(err, "Die Verknüpfung konnte nicht gestartet werden."));
    }
  }, []);
  const unlinkPlatform = async (platform) => {
    try {
      await api.delete(`/me/platform-links/${platform}`);
      toast.success("Verknüpfung getrennt – der Eintrag bleibt, das Häkchen ist weg.");
      await loadPlatformLinks();
      refresh?.();
    } catch (err) {
      toast.error(formatRequestError(err, "Die Verknüpfung konnte nicht getrennt werden."));
    }
  };
  // Aus der App (#521): ?tab=socials&link=discord startet die Verknüpfung direkt, sobald die Plattformen
  // geladen sind - einmal, dann verschwindet der Parameter.
  const linkParam = params.get("link");
  const autoLinkStarted = useRef(false);
  useEffect(() => {
    if (!linkParam || autoLinkStarted.current || !platformLinks.platforms[linkParam]) return;
    autoLinkStarted.current = true;
    const next = new URLSearchParams(params);
    next.delete("link");
    setParams(next, { replace: true });
    // Mastodon/Bluesky fragen erst nach Instanz oder Handle - die Zeile ist da, der Start kommt von Hand.
    if (platformLinks.platforms[linkParam]?.input?.required) return;
    if (platformLinks.available[linkParam]) startPlatformLink(linkParam);
    else toast.error(`${platformLinks.platforms[linkParam]?.label || linkParam} ist auf der Website noch nicht eingerichtet.`);
  }, [linkParam, platformLinks, params, setParams, startPlatformLink]);
  // Schalter und Auswahlfelder auf Privatsphäre und Benachrichtigungen
  // speichern kurz nach dem letzten Klick von selbst.
  const setSetting = (k, v) => {
    set(k, v);
    autosave.schedule();
  };
  const setGameId = (gameSlug, fieldKey, value) => setForm((f) => ({
    ...f,
    game_ids: {
      ...(f.game_ids || {}),
      [gameSlug]: { ...((f.game_ids || {})[gameSlug] || {}), [fieldKey]: value },
    },
  }));
  const setVisibility = (field, level) => {
    setForm((f) => ({
      ...f,
      profile_visibility: { ...(f.profile_visibility || {}), [field]: level },
    }));
    autosave.schedule();
  };
  const setVisibilityGroup = (group, level) => {
    setForm((f) => ({ ...f, profile_visibility: applyGroupLevel(f.profile_visibility, group, level) }));
    autosave.schedule();
  };
  const setNotificationPreference = (field, enabled) => {
    setForm((f) => ({
      ...f,
      notification_preferences: { ...(f.notification_preferences || {}), [field]: enabled },
    }));
    autosave.schedule();
  };
  const gameIdGroups = (() => {
    const groups = new Map();
    games.forEach((game) => {
      const fields = game.effective_player_id_fields || game.player_id_fields || [];
      if (!fields.length) return;
      const sourceSlug = game.identity_game_slug || game.slug;
      const sourceName = game.identity_game_name || gameLabel(game);
      const key = `${sourceSlug}:${fields.map((field) => field.key).join("|")}`;
      const existing = groups.get(key) || {
        slug: sourceSlug,
        title: sourceName,
        games: [],
        fields,
      };
      existing.games.push(gameLabel(game));
      groups.set(key, existing);
    });
    return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
  })();
  const notificationEnabled = (field) => {
    if (field === "news_events" && !form.newsletter_consent) return false;
    const pref = form.notification_preferences || {};
    const meta = [...NOTIFICATION_CHANNELS, ...EMAIL_PREFERENCES].find((item) => item.k === field);
    if (Object.prototype.hasOwnProperty.call(pref, field)) return !!pref[field];
    return !!meta?.defaultOn || (field === "news_events" && !!form.newsletter_consent);
  };
  const notificationTopicEnabled = (channel, topic) => {
    const pref = form.notification_preferences || {};
    if (channel === "email" && topic.requiresNewsletter && !form.newsletter_consent) return false;
    const key = notificationPreferenceKey(channel, topic.k);
    if (Object.prototype.hasOwnProperty.call(pref, key)) return !!pref[key];
    if (Object.prototype.hasOwnProperty.call(pref, topic.k)) return !!pref[topic.k];
    if (topic.k === "news_events") return !!form.newsletter_consent;
    return topic.defaultOn !== false;
  };

  const submit = async (e) => {
    e.preventDefault();
    autosave.cancel();
    setSaving(true);
    try {
      const payload = buildDirtyPayload(
        profileFormPayload(form),
        profileFormPayload(initialProfileFormRef.current || {}),
      );
      if (!hasPayloadChanges(payload)) {
        toast.info("Keine Änderungen zum Speichern.");
        return;
      }
      const { data } = await api.patch("/users/me", payload);
      const savedForm = profileToForm(data);
      initialProfileUserIdRef.current = data.id;
      initialProfileFormRef.current = savedForm;
      setForm(savedForm);
      await refresh();
      toast.success("Profil gespeichert.");
    } catch (err) {
      toast.error(formatRequestError(err, "Profil konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  // Die Speicherleiste zeigt, ob auf den Text-Reitern noch etwas ungespeichert ist.
  const dirty = !!initialProfileFormRef.current
    && hasPayloadChanges(buildDirtyPayload(profileFormPayload(form), profileFormPayload(initialProfileFormRef.current)));
  return (
    <PublicLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">KONTO</span>
            <h1 className="mt-2 font-heading text-3xl md:text-5xl font-black uppercase">Einstellungen</h1>
          </div>
          <div className="text-sm text-white/60">
            {isClubMember ? (
              <span className="inline-flex items-center gap-1.5"><Crown className="w-3.5 h-3.5 text-[#FFD700]" /> Vereinsmitglied</span>
            ) : (
              <span>Community-Spieler</span>
            )}
            <span className="mx-2 text-white/20">·</span>
            <span>@{user.username}</span>
            {/* Zurück zum eigenen Profil (#1149) - dort steht auch „So sehen dich andere“. */}
            <Link to={`/u/${user.username}`} data-testid="settings-to-profile" className="ml-2 inline-flex items-center gap-1 px-2 py-1 border border-white/15 text-[11px] uppercase tracking-wider hover:border-[#29B6E8] hover:text-[#29B6E8]"><UserCircle className="w-3.5 h-3.5" /> Mein Profil</Link>
          </div>
        </div>

        <div className="mt-8 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10 lg:items-start">
          <ProfileNav tab={tab} onSelect={setTab} onLogout={async () => { if (await logout?.()) navigate("/"); }} />

          <form onSubmit={submit} className="mt-6 lg:mt-0 space-y-5 min-w-0">
            {tab === "basic" && <BasicTab form={form} set={set} />}
            {tab === "gaming" && <GamingTab form={form} set={set} setGameId={setGameId} gameIdGroups={gameIdGroups} />}
            {tab === "socials" && <SocialsTab form={form} set={set} links={platformLinks} onLink={startPlatformLink} onUnlink={unlinkPlatform} />}
            {tab === "appearance" && <AppearanceTab />}
            {tab === "about" && <AboutTab />}
            {tab === "security" && <SecurityTab user={user} refresh={refresh} siteSettings={siteSettings} />}
            {tab === "privacy" && (
              <PrivacyTab
                form={form}
                set={setSetting}
                setVisibility={setVisibility}
                setVisibilityGroup={setVisibilityGroup}
                autosave={autosave}
                disabled={platformLinks.disabled || []}
              />
            )}
            {tab === "notifications" && (
              <NotificationsTab
                form={form}
                set={setSetting}
                setNotificationPreference={setNotificationPreference}
                notificationEnabled={notificationEnabled}
                notificationTopicEnabled={notificationTopicEnabled}
                autosave={autosave}
              />
            )}

            {FORM_TABS.has(tab) && (
              <div className="sticky bottom-0 z-10 -mx-4 px-4 py-3 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 bg-[#050505]/95 backdrop-blur border-t border-white/10 flex flex-wrap items-center gap-3" data-testid="profile-save-bar">
                <button type="submit" disabled={saving} data-testid="profile-save" className="tls-btn tls-btn--primary inline-flex items-center gap-2 px-6 py-3 font-bold uppercase tracking-wider rounded-sm disabled:opacity-50 text-xs">
                  <Save className="w-3.5 h-3.5" /> {saving ? "Speichere…" : "Speichern"}
                </button>
                {dirty ? (
                  <span className="text-xs text-[#FFD700]" data-testid="profile-unsaved">Ungespeicherte Änderungen</span>
                ) : null}
              </div>
            )}
          </form>
        </div>
      </div>
    </PublicLayout>
  );
}
