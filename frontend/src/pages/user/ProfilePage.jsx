import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { gameLabel, isArchivedGame } from "@/lib/gameLabels";
import { toast } from "sonner";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useNavigationGuard } from "@/lib/navigationGuard";
import { Eye, LogOut } from "lucide-react";
import { usePublicSiteSettings } from "@/hooks/usePublicSiteSettings";
import { EMAIL_PREFERENCES, NOTIFICATION_CHANNELS, SETTINGS_GROUPS, TABS } from "./profile/constants";
import { applyGroupLevel } from "./profile/visibility";
import { useProfileSave } from "./profile/useAutosave";
import { ProfileNav } from "./profile/ProfileNav";
import { BasicTab } from "./profile/BasicTab";
import { GamingTab } from "./profile/GamingTab";
import { SocialsTab } from "./profile/SocialsTab";
import { linkErrorText, linkedText } from "@/lib/platformLinks";
import { PrivacyTab } from "./profile/PrivacyTab";
import { SecurityTab } from "./profile/SecurityTab";
import { AppearanceTab } from "./profile/AppearanceTab";
import { AboutTab } from "./profile/AboutTab";
import { CalendarTab } from "./profile/CalendarTab";
import { AutosaveStatus } from "./profile/SwitchRow";
import { channelTopicValue } from "@/lib/notificationLevels";
import { lazyPage } from "@/lib/chunkReload";
import { BereichSeite } from "./meinBereich/BereichSeite";
import { gruppe } from "@/lib/meinBereich";

// Benachrichtigungen (#1204) kommen erst beim Öffnen des Reiters - Stufen, Themen und Ruhezeit laden nicht mit jeder Einstellung.
// Über lazyPage wie überall: Nach einem Deploy fehlt der alte Teil, dann lädt die Seite einmal neu statt leer zu bleiben.
const NotificationsTab = lazyPage(() => import("./profile/NotificationsTab").then((module) => ({ default: module.NotificationsTab })));

// Die Einstellungen (#1146, seit #2059 in „Mein Bereich“): Formularzustand und Speichern für eine Gruppe - Profil,
// Benachrichtigungen, Konto & Sicherheit oder Datenschutz (`group`). Jeder Reiter ist eine eigene Datei unter ./profile
// (#253, Regel aus #223); die Reiter der Gruppe stehen oben, die Gruppen selbst in der Seitenleiste von „Mein Bereich“.
// `extraTabs` hängt Reiter ohne Formular an (Datenschutz: Einwilligungen, Daten herunterladen, Konto löschen) - sie
// stehen außerhalb des Formulars, das Speichern läuft trotzdem weiter. Ohne `group` stehen alle Einstellungs-Reiter da.
// Was keine Einstellung ist (Teams, Freunde, Erfolge, Ehrungen, Rechnungen), hat seinen Ort woanders; alte Adressen
// leiten dorthin weiter (lib/meinBereich.js).
//
// Alles speichert von selbst (#257, #1048), einen Knopf „Speichern“ gibt es nicht: Textfelder nach einer kurzen Pause
// oder beim Verlassen des Felds, Schalter und Auswahlfelder sofort. Reiter mit Textfeldern zeigen den Stand unten in
// einer ruhigen Leiste, Privatsphäre und Benachrichtigungen oben. Bewusst bestätigt werden weiter Passwort, E-Mail,
// Zwei-Faktor, Konto löschen und der Bild-Zuschnitt („Übernehmen“).

const FORM_TABS = new Set(["basic", "gaming", "socials"]);
// Regler speichern nach der Pause wie Text - jeder Zwischenwert beim Ziehen wäre sonst ein eigener Lauf.
const SLIDER_SETTINGS = new Set(["ceremony_volume"]);
// Beim Verlassen mit offener, ungültiger Eingabe (#1048, nach Codex-Prüfung): was fehlt und wo das Feld steht.
const LEAVE_REASONS = { display_name: "Name ist leer oder zu lang.", bio: "Bio ist zu lang.", website: "Website ist keine gültige Adresse.", quiet_hours: "Die Ruhezeit hat keine gültigen Zeiten." };
const FIELD_PLACES = {
  display_name: { tab: "basic", testId: "profile-display-name" },
  bio: { tab: "basic", testId: "profile-bio" },
  website: { tab: "socials", testId: "profile-website" },
  quiet_hours: { tab: "notifications", testId: "notification-quiet-end" },
};

function leaveDescription(issue) {
  const reasons = issue.fields.map((key) => LEAVE_REASONS[key] || "Eine Eingabe ist ungültig.");
  if (issue.failed) reasons.push("Das Speichern ist fehlgeschlagen.");
  return `Nicht gespeicherte Änderungen: ${reasons.join(" ")} Verwerfen und weiter?`;
}

// ?tab=sessions war der eigene Reiter für Geräte; seit #258 steckt er in
// „Sicherheit“, alte Links landen dort.
const TAB_ALIASES = { sessions: "security" };

// Ein Satz je Gruppe unter der Überschrift.
const GROUP_INTROS = {
  profil: "So erscheinst du auf der Website. Alles speichert von selbst.",
  benachrichtigungen: "Was wie zu dir kommt – in der Glocke, als Push, per Mail oder über Discord.",
  konto: "Anmelden und absichern, dazu Darstellung, Kalender-Abo und die App.",
  datenschutz: "Wer was von dir sieht, deine Einwilligungen und deine Daten.",
};

export default function ProfilePage({ group = null, extraTabs = [] }) {
  const { user, refresh, logout } = useAuth();
  const siteSettings = usePublicSiteSettings();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const meta = SETTINGS_GROUPS.find((item) => item.key === group) || null;
  const groupTabs = [...(meta ? meta.tabs : TABS), ...extraTabs];
  const requestedParam = params.get("tab") || "";
  const requestedTab = TAB_ALIASES[requestedParam] || requestedParam;
  const tab = groupTabs.some((item) => item.k === requestedTab) ? requestedTab : groupTabs[0].k;
  const extra = extraTabs.find((item) => item.k === tab) || null;
  const firstTab = groupTabs[0].k;
  // Der Reiter steht in der Adresse (?tab=…, wie in Mails und Benachrichtigungen
  // verlinkt) und wird als eigener Verlaufseintrag gesetzt, damit „Zurück“ zum
  // vorigen Reiter führt statt aus der Gruppe hinaus. Der erste Reiter braucht kein ?tab=.
  const setTab = useCallback((nextTab) => {
    const next = new URLSearchParams(params);
    if (nextTab === firstTab) next.delete("tab");
    else next.set("tab", nextTab);
    setParams(next);
  }, [params, setParams, firstTab]);
  // Formular und Speichern über eine Speicher-Warteschlange (#1048): jede Änderung speichert von selbst, nacheinander.
  const autosave = useProfileSave({ user, refresh });
  const { form, setForm, saveSoon, saveNow } = autosave;

  // Seite verlassen (Link, Zurück, Abmelden): Wartendes geht sofort ab. Bleibt etwas offen, das nicht gespeichert werden
  // kann (ungültig oder gescheitert), fragt ein Dialog: verwerfen und weiter, oder zurück zum Feld.
  const confirm = useConfirm();
  const { pathname } = useLocation();
  const askingRef = useRef(false);
  const confirmLeave = async () => {
    const issue = autosave.openIssue();
    if (!issue) return true;
    if (askingRef.current) return false;
    askingRef.current = true;
    let leave = false;
    try {
      leave = await confirm({
        title: "Nicht gespeicherte Änderungen",
        description: leaveDescription(issue),
        confirmLabel: "Verwerfen und weiter",
        cancelLabel: "Zurück zum Feld",
        tone: "danger",
      });
    } finally {
      askingRef.current = false;
    }
    if (leave) {
      autosave.discard();
      return true;
    }
    const place = FIELD_PLACES[issue.fields[0]];
    if (place) {
      if (place.tab !== tab) setTab(place.tab);
      setTimeout(() => document.querySelector(`[data-testid="${place.testId}"]`)?.focus(), 0);
    }
    return false;
  };
  useNavigationGuard({
    blocks: (nextPathname) => {
      // Ein anderer Reiter (?tab=) ist kein Verlassen.
      if (nextPathname === pathname) return false;
      if (autosave.openIssue()) return true;
      void autosave.savePending();
      return false;
    },
    onBlocked: (proceed) => {
      void confirmLeave().then((leave) => {
        if (leave) proceed();
      });
    },
  });
  const [games, setGames] = useState([]);

  useEffect(() => {
    api.get("/games").then(({ data }) => setGames(Array.isArray(data) ? data : [])).catch(() => setGames([]));
  }, []);

  // Text: speichert nach der Tipp-Pause (oder beim Verlassen des Felds, siehe onBlur am Formular).
  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    saveSoon();
  };
  // Schalter, Auswahl, Datum, Bild: speichert sofort.
  const setNow = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    void saveNow();
  };

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
  // Schalter und Auswahlfelder auf Privatsphäre und Benachrichtigungen speichern sofort, der Lautstärke-Regler nach der Pause.
  const setSetting = (k, v) => (SLIDER_SETTINGS.has(k) ? set(k, v) : setNow(k, v));
  const setGameId = (gameSlug, fieldKey, value) => {
    setForm((f) => ({
      ...f,
      game_ids: {
        ...(f.game_ids || {}),
        [gameSlug]: { ...((f.game_ids || {})[gameSlug] || {}), [fieldKey]: value },
      },
    }));
    saveSoon();
  };
  const setVisibility = (field, level) => {
    setForm((f) => ({
      ...f,
      profile_visibility: { ...(f.profile_visibility || {}), [field]: level },
    }));
    void saveNow();
  };
  const setVisibilityGroup = (group, level) => {
    setForm((f) => ({ ...f, profile_visibility: applyGroupLevel(f.profile_visibility, group, level) }));
    void saveNow();
  };
  const setNotificationPreference = (field, enabled) => {
    setForm((f) => ({
      ...f,
      notification_preferences: { ...(f.notification_preferences || {}), [field]: enabled },
    }));
    void saveNow();
  };
  // Eine Stufe oder eine Stellung (#1204) setzt mehrere Schalter auf einmal - ein Speichern.
  const setNotificationPreferences = (patch) => {
    setForm((f) => ({
      ...f,
      notification_preferences: { ...(f.notification_preferences || {}), ...patch },
    }));
    void saveNow();
  };
  const gameIdGroups = (() => {
    const groups = new Map();
    games.forEach((game) => {
      const fields = game.effective_player_id_fields || game.player_id_fields || [];
      if (!fields.length) return;
      const sourceSlug = game.identity_game_slug || game.slug;
      // Archiviert (#2129): niemand trägt dafür neu etwas ein - eine schon gespeicherte ID bleibt sichtbar und änderbar.
      if (isArchivedGame(game) && !Object.values(form.game_ids?.[sourceSlug] || {}).some(Boolean)) return;
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
  // Wie am Server (#1204): Browser folgt dem Push, solange er nichts Eigenes hat.
  const notificationTopicEnabled = (channel, topic) => channelTopicValue(form.notification_preferences || {}, channel, topic, !!form.newsletter_consent);

  if (!user) return null;

  const hasProfile = groupTabs.some((item) => item.k === "basic");
  const hasSecurity = groupTabs.some((item) => item.k === "security");
  const title = meta?.label || "Einstellungen";
  const heading = (group && gruppe(group)?.heading) || title;
  const logoutNow = async () => {
    // Offenes geht noch ins richtige Konto, danach wird abgemeldet - Ungültiges oder Gescheitertes erst nach Rückfrage.
    if (!(await confirmLeave())) return;
    if (autosave.pending || autosave.dirty) await saveNow();
    if (await logout?.()) navigate("/");
  };
  const actions = hasProfile || hasSecurity ? (
    <>
      {/* „So sehen andere mich“ (#1149, #2059): das eigene öffentliche Profil - es bleibt unter /u/<name>. */}
      {hasProfile ? (
        <Link to={`/u/${encodeURIComponent(user.username)}`} data-testid="settings-to-profile" className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
          <Eye className="w-3.5 h-3.5" aria-hidden="true" /> So sehen andere mich
        </Link>
      ) : null}
      {hasSecurity ? (
        <button type="button" onClick={logoutNow} data-testid="settings-logout" className="tls-btn tls-btn--danger inline-flex min-h-11 items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
          <LogOut className="w-3.5 h-3.5" aria-hidden="true" /> Abmelden
        </button>
      ) : null}
    </>
  ) : null;

  return (
    <BereichSeite
      title={heading}
      docTitle={groupTabs.length > 1 ? groupTabs.find((item) => item.k === tab)?.label : title}
      intro={GROUP_INTROS[group] || "Alles speichert von selbst."}
      actions={actions}
      tabKey={tab}
      reiter={<ProfileNav tabs={groupTabs} tab={tab} onSelect={setTab} label={title} />}
      testId={`mein-bereich-${group || "einstellungen"}`}
    >
      {extra ? (
        <div className="space-y-5 min-w-0" data-testid={`settings-extra-${extra.k}`}>{extra.render()}</div>
      ) : (
        /* Enter in einem Feld und das Verlassen eines Felds speichern sofort - es gibt keinen Speichern-Knopf. */
        <form
          onSubmit={(e) => { e.preventDefault(); void saveNow(); }}
          onBlur={() => { void autosave.savePending(); }}
          noValidate
          className="space-y-5 min-w-0"
        >
          {tab === "basic" && <BasicTab form={form} set={set} setNow={setNow} errors={autosave.fieldErrors} />}
          {tab === "gaming" && <GamingTab form={form} set={set} setNow={setNow} setGameId={setGameId} gameIdGroups={gameIdGroups} />}
          {tab === "socials" && <SocialsTab form={form} set={set} setNow={setNow} errors={autosave.fieldErrors} links={platformLinks} onLink={startPlatformLink} onUnlink={unlinkPlatform} />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "about" && <AboutTab />}
          {tab === "calendar" && <CalendarTab />}
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
            <Suspense fallback={<div className="h-64 border border-white/10 rounded-sm bg-[#0A0A0A] animate-pulse" data-testid="profile-notifications-loading" />}>
              <NotificationsTab
                form={form}
                set={setSetting}
                setLater={set}
                setNotificationPreference={setNotificationPreference}
                setNotificationPreferences={setNotificationPreferences}
                notificationEnabled={notificationEnabled}
                notificationTopicEnabled={notificationTopicEnabled}
                autosave={autosave}
                user={user}
              />
            </Suspense>
          )}

          {FORM_TABS.has(tab) && (
            <div className="sticky bottom-0 z-10 -mx-4 px-4 py-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 bg-[#050505]/95 backdrop-blur border-t border-white/10 flex min-h-11 flex-wrap items-center gap-3" data-testid="profile-autosave-bar">
              <AutosaveStatus status={autosave.status} message={autosave.message} onRetry={autosave.retry} />
            </div>
          )}
        </form>
      )}
    </BereichSeite>
  );
}
