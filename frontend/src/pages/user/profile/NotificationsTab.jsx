import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bell, BellMinus, BellRing, Mail, Moon, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { loadWebPushConfig } from "@/lib/webPush";
import {
  CUSTOM_LEVEL, LEVEL_TOPIC_KEYS, MODE_LABELS, MODE_ORDER,
  crossesMidnight, levelOf, levelPatch, modePatch, quietHoursForm, topicModes,
} from "@/lib/notificationLevels";
import { BrowserPushCard } from "./BrowserPushCard";
import { EMAIL_PREFERENCES, NOTIFICATION_CHANNELS, notificationPreferenceKey } from "./constants";
import { FieldError, Section } from "./fields";
import { AutosaveStatus, ProfileSwitch, SwitchRow } from "./SwitchRow";
import "./notifications.css";

// Benachrichtigungen einfach einstellen (#1204, Fabians Wahl A): drei Stufen zum Antippen, je Thema Push (gilt auch für den
// Browser, #1163), „Nur App“ oder „Aus“. Seit dem Benachrichtigungs-Zentrum (#1662) in Reitern statt einer langen Seite:
// Themen · E-Mail (Sammel-Mail, E-Mail je Thema, Newsletter) · Ruhezeit (#1206) · Mehr (Discord #567, Kanäle ganz aus,
// Zeremonien). Der Reiter steht in der Adresse (``bereich``) - so führt der Link aus der Sammel-Mail direkt zur E-Mail.
const LEVEL_ICONS = { all: BellRing, important: Bell, few: BellMinus };
const LEVEL_HINTS = { all: "Jedes Thema per Push", important: "Das Wichtige per Push", few: "Nur Spiele und Rechnungen" };
const FALLBACK_EXCEPTIONS = [
  "Aufruf zu deinem Spiel und „Match startet jetzt“",
  "Liga: Check-in offen und Veto – ihr seid am Zug, für dein eigenes Spiel",
  "Für die Turnierleitung: „Braucht Aufmerksamkeit“, solange dein Turnier läuft",
  "Absage, neuer Termin oder Nachrücken – nur, wenn der Termin bis 2 Stunden nach dem Ende deiner Ruhezeit beginnt",
];
export const SECTIONS = [
  { key: "themen", label: "Themen" },
  { key: "mail", label: "E-Mail" },
  { key: "ruhezeit", label: "Ruhezeit" },
  { key: "mehr", label: "Mehr" },
];
const SECTION_KEYS = SECTIONS.map((section) => section.key);
// Sammel-Mail (#1662): gilt, bis der Server antwortet - dieselben Texte wie backend/services/mail_digest.py.
export const DIGEST_FALLBACK = {
  rhythm: "instant",
  own: null,
  default: "instant",
  options: [
    { key: "instant", label: "Sofort", schedule: "Jede Mail sofort" },
    { key: "daily", label: "Täglich", schedule: "Täglich um 07:00 Uhr" },
    { key: "weekly", label: "Wöchentlich", schedule: "Montags um 07:00 Uhr" },
  ],
};
const DIGEST_HINTS = {
  instant: "Jede Mail kommt einzeln, sobald etwas passiert.",
  daily: "Eine Mail am Tag mit allem, was seit der letzten kam – nach Themen sortiert.",
  weekly: "Eine Mail in der Woche mit allem, was seit der letzten kam – nach Themen sortiert.",
};

function TopicTable({ columns, newsletter, notificationEnabled, notificationTopicEnabled, setNotificationPreference, testId }) {
  return (
    <div className="tls-swipe pb-0 md:overflow-visible -mx-5 px-5 md:[mask-image:none] md:[-webkit-mask-image:none]" data-testid={testId}>
      <table className="w-full min-w-[280px] tls-type-small border-separate border-spacing-0">
        <thead className="tls-type-label text-white/45">
          <tr>
            <th scope="col" className="text-left px-3 py-3 border-b border-white/10">Thema</th>
            {columns.map((channel) => {
              const enabled = notificationEnabled(channel.k);
              return (
                <th key={channel.k} scope="col" className={`text-center px-3 py-3 border-b border-white/10 ${enabled ? "" : "opacity-40"}`} data-testid={`profile-notification-column-${channel.k}`}>
                  {channel.l}
                  {enabled ? null : <span className="block tls-type-small font-normal">Weg aus</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {EMAIL_PREFERENCES.map((topic) => (
            <tr key={topic.k}>
              <td className="px-3 py-3 align-top border-b border-white/10">
                <div className="font-bold text-white">{topic.l}</div>
                {topic.requiresNewsletter && !newsletter && columns.some((channel) => channel.k === "email") ? (
                  <div className="tls-type-small text-[#FFD700] mt-1">Per E-Mail nur mit Newsletter-Zustimmung (unten).</div>
                ) : null}
              </td>
              {columns.map((channel) => {
                const key = notificationPreferenceKey(channel.k, topic.k);
                if (topic.channels && !topic.channels.includes(channel.k)) {
                  return <td key={key} className="px-3 py-3 text-center align-top border-b border-white/10 text-white/25" data-testid={`profile-notification-${channel.k}-${topic.k}-none`}>–</td>;
                }
                const channelEnabled = notificationEnabled(channel.k);
                const disabled = !channelEnabled || (channel.k === "email" && topic.requiresNewsletter && !newsletter);
                return (
                  <td key={key} className={`px-3 py-3 text-center align-top border-b border-white/10 ${channelEnabled ? "" : "opacity-40"}`}>
                    <ProfileSwitch
                      label={`${topic.l} per ${channel.l}`}
                      checked={channelEnabled && notificationTopicEnabled(channel.k, topic)}
                      disabled={disabled}
                      onCheckedChange={(value) => setNotificationPreference(key, value)}
                      testId={`profile-notification-${channel.k}-${topic.k}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NotificationsTab({
  form, set, setLater = set, setNotificationPreference, setNotificationPreferences, notificationEnabled, notificationTopicEnabled,
  autosave, user = null,
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [server, setServer] = useState(null);
  const [webPush, setWebPush] = useState(null);
  const [webPushStamp, setWebPushStamp] = useState(0);
  const [lit, setLit] = useState({ round: 0, keys: [] });
  const [loadRound, setLoadRound] = useState(0);
  const levelRefs = useRef({});
  const sectionRefs = useRef({});
  useEffect(() => {
    let active = true;
    api.get("/users/me/notification-preferences")
      .then(({ data }) => { if (active) setServer(data || {}); })
      // Laden gescheitert (#1204): ein Hinweis mit „Erneut versuchen“ statt einer leeren Stufen-Karte.
      .catch(() => { if (active) setServer({ discord: { linked: false }, failed: true }); });
    return () => { active = false; };
  }, [loadRound]);
  const reload = () => {
    setServer(null);
    setLoadRound((value) => value + 1);
  };
  useEffect(() => {
    let active = true;
    loadWebPushConfig().then((config) => { if (active) setWebPush(config); });
    return () => { active = false; };
  }, [webPushStamp]);

  const requested = searchParams.get("bereich");
  const section = SECTION_KEYS.includes(requested) ? requested : "themen";
  const sectionIndex = SECTION_KEYS.indexOf(section);
  const pickSection = (key) => {
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      if (key === "themen") next.delete("bereich");
      else next.set("bereich", key);
      return next;
    }, { replace: true });
  };
  const quietError = autosave.fieldErrors?.quiet_hours;
  // Eine ungültige Ruhezeit (Verlassen mit offener Eingabe, #1048): dorthin, wo das Feld steht.
  useEffect(() => {
    if (quietError && section !== "ruhezeit") pickSection("ruhezeit");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur, wenn der Fehler neu auftaucht
  }, [quietError]);

  const discord = server ? server.discord || { linked: false } : null;
  const pref = form.notification_preferences || {};
  const newsletter = !!form.newsletter_consent;
  const topicKeys = Array.isArray(server?.topics) && server.topics.length ? server.topics : LEVEL_TOPIC_KEYS;
  const topics = topicKeys.map((key) => EMAIL_PREFERENCES.find((topic) => topic.k === key)).filter(Boolean);
  const levels = Array.isArray(server?.levels) ? server.levels : [];
  const level = levelOf(levels, pref, topics, newsletter);
  const modes = topicModes(pref, topics, newsletter);
  const levelIndex = levels.findIndex((item) => item.key === level);
  const currentLevel = levels[levelIndex];
  // Die Felder zeigen den echten Formularwert (auch ein geleertes Feld); Zusammenfassung nur mit gültigen Zeiten.
  const quietRaw = form.quiet_hours && typeof form.quiet_hours === "object" ? form.quiet_hours : quietHoursForm(null);
  const quiet = quietHoursForm(quietRaw);
  const exceptions = Array.isArray(server?.quiet_hours_exceptions) && server.quiet_hours_exceptions.length ? server.quiet_hours_exceptions : FALLBACK_EXCEPTIONS;
  const channels = NOTIFICATION_CHANNELS.filter((channel) => (channel.k !== "discord" || discord?.linked) && (channel.k !== "browser" || webPush?.enabled));
  const emailChannel = channels.filter((channel) => channel.k === "email");
  const discordChannel = channels.filter((channel) => channel.k === "discord");
  const otherChannels = channels.filter((channel) => channel.k !== "email");
  const pushOff = !notificationEnabled("push");
  const digest = server?.mail_digest && Array.isArray(server.mail_digest.options) ? server.mail_digest : DIGEST_FALLBACK;
  // Ohne eigene Wahl (null) gilt die Vorgabe des Vereins (#1662, Fabian 26.11.) - auch direkt nach „Vorgabe des Vereins nutzen“.
  const ownRhythm = "mail_digest" in form ? form.mail_digest : digest.own;
  const rhythm = ownRhythm || digest.default || "instant";
  const rhythmIndex = Math.max(0, digest.options.findIndex((option) => option.key === rhythm));
  const rhythmOption = digest.options[rhythmIndex] || DIGEST_FALLBACK.options[0];
  const defaultOption = digest.options.find((option) => option.key === digest.default);
  const emailOff = !notificationEnabled("email");

  const pickLevel = (next) => {
    if (!next) return;
    const changed = topics.filter((topic) => (next.modes || {})[topic.k] !== modes[topic.k]).map((topic) => topic.k);
    setNotificationPreferences(levelPatch(next));
    if (changed.length) setLit((value) => ({ round: value.round + 1, keys: changed }));
  };
  const pickMode = (topic, mode) => {
    if (modes[topic.k] === mode) return;
    setLit((value) => ({ ...value, keys: [] }));
    setNotificationPreferences(modePatch(topic.k, mode));
  };
  const arrowStep = (event) => (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0);
  // Pfeiltasten in der Stufen-Reihe wie bei Optionsfeldern: weiter zur nächsten Stufe und dorthin den Fokus.
  const onLevelKey = (event, index) => {
    const step = arrowStep(event);
    if (!step || !levels.length) return;
    event.preventDefault();
    const next = levels[(index + step + levels.length) % levels.length];
    pickLevel(next);
    levelRefs.current[next.key]?.focus();
  };
  const setQuiet = (patch, later = false) => (later ? setLater : set)("quiet_hours", { ...quietRaw, ...patch });
  // Themen wie die Stufen-Reihe (#1204): ein Tab-Stopp je Thema, Pfeiltasten wählen die Stellung daneben.
  const onModeKey = (event, topic) => {
    const step = arrowStep(event);
    if (!step) return;
    event.preventDefault();
    const index = MODE_ORDER.indexOf(modes[topic.k]);
    const next = MODE_ORDER[(index + step + MODE_ORDER.length) % MODE_ORDER.length];
    pickMode(topic, next);
    event.currentTarget.parentElement?.querySelector(`[data-mode-option="${next}"]`)?.focus();
  };
  const pickRhythm = (key) => {
    if (key !== rhythm) set("mail_digest", key);
  };
  const onRhythmKey = (event) => {
    const step = arrowStep(event);
    if (!step) return;
    event.preventDefault();
    const next = digest.options[(rhythmIndex + step + digest.options.length) % digest.options.length];
    pickRhythm(next.key);
    event.currentTarget.parentElement?.querySelector(`[data-rhythm-option="${next.key}"]`)?.focus();
  };
  const onSectionKey = (event, index) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = SECTIONS[(index + step + SECTIONS.length) % SECTIONS.length];
    pickSection(next.key);
    sectionRefs.current[next.key]?.focus();
  };
  const tableProps = { newsletter, notificationEnabled, notificationTopicEnabled, setNotificationPreference };

  return (
    <Section>
      <div className="tls-notify space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="tls-type-body text-white/60">Wähle, wie viel bei dir ankommt. Konto- und Sicherheitsmails bleiben immer aktiv.</p>
          <AutosaveStatus status={autosave.status} message={autosave.message} onRetry={autosave.retry} />
        </div>

        <div role="tablist" aria-label="Bereiche der Benachrichtigungen" className="tls-notify-tabs" style={{ "--tab-i": sectionIndex }} data-testid="notification-sections">
          <span className="tls-notify-tabs__bar" aria-hidden="true" />
          {SECTIONS.map((item, index) => (
            <button
              key={item.key}
              ref={(node) => { sectionRefs.current[item.key] = node; }}
              type="button"
              role="tab"
              id={`notification-section-${item.key}-tab`}
              aria-selected={section === item.key}
              aria-controls={`notification-section-${item.key}`}
              tabIndex={section === item.key ? 0 : -1}
              onClick={() => pickSection(item.key)}
              onKeyDown={(event) => onSectionKey(event, index)}
              className="tls-notify-tabs__tab"
              data-testid={`notification-section-${item.key}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {section === "themen" ? (
          <div role="tabpanel" id="notification-section-themen" aria-labelledby="notification-section-themen-tab" className="space-y-4">
            <section className="tls-notify-card" aria-labelledby="notification-level-title" data-testid="notification-levels" data-level={level || "loading"}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 id="notification-level-title" className="tls-notify-card__title tls-type-card">Stufe</h3>
                {level === CUSTOM_LEVEL ? <span className="tls-notify-chip" data-testid="notification-level-custom">Eigene Auswahl</span> : null}
              </div>
              {levels.length ? (
                <div role="radiogroup" aria-labelledby="notification-level-title" className="tls-level" style={{ "--level-i": Math.max(levelIndex, 0) }}>
                  <span className="tls-level__glide" aria-hidden="true" data-hidden={levelIndex < 0 ? "true" : "false"} />
                  {levels.map((item, index) => {
                    const Icon = LEVEL_ICONS[item.key] || Bell;
                    const checked = item.key === level;
                    return (
                      <button
                        key={item.key}
                        ref={(node) => { levelRefs.current[item.key] = node; }}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        tabIndex={checked || (levelIndex < 0 && index === 0) ? 0 : -1}
                        onClick={() => pickLevel(item)}
                        onKeyDown={(event) => onLevelKey(event, index)}
                        className="tls-level__card"
                        data-testid={`notification-level-${item.key}`}
                      >
                        <Icon className="tls-level__icon" aria-hidden="true" />
                        <span className="tls-level__label">{item.label}</span>
                        <span className="tls-level__hint">{LEVEL_HINTS[item.key] || ""}</span>
                      </button>
                    );
                  })}
                </div>
              ) : server?.failed ? (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-3 border border-warn/40 rounded-sm tls-type-small text-warn" data-testid="notification-load-failed">
                  <span>Die Stufen konnten nicht geladen werden. Deine Themen unten gelten weiter.</span>
                  <button type="button" onClick={reload} className="tls-hit min-h-11 px-3 border border-warn/40 rounded-sm tls-type-label hover:bg-warn/10" data-testid="notification-load-retry">
                    Erneut versuchen
                  </button>
                </div>
              ) : server ? null : (
                <div className="grid grid-cols-3 gap-2" aria-hidden="true" data-testid="notification-levels-loading">
                  {[0, 1, 2].map((index) => <div key={index} className="h-[5.5rem] border border-white/10 rounded-sm bg-white/[0.03] animate-pulse" />)}
                </div>
              )}
              <p className="tls-type-small text-white/55 mt-3 min-h-[2.5em]" data-testid="notification-level-description">
                {level === CUSTOM_LEVEL
                  ? "Du hast einzelne Themen selbst gestellt. Tippe eine Stufe an, dann setzt sie alle Themen neu."
                  : currentLevel?.description || ""}
              </p>
            </section>

            <section className="tls-notify-card" aria-labelledby="notification-topics-title">
              <h3 id="notification-topics-title" className="tls-notify-card__title tls-type-card">Themen</h3>
              <p className="tls-type-small text-white/50 mt-1 mb-2">Push heißt: aufs Handy in der LionsAPP und in den Browser, wenn du ihn angemeldet hast. „Nur App“ legt es still in die Glocke. Per E-Mail stellst du es im Reiter „E-Mail“ ein.</p>
              {pushOff ? (
                <div className="flex flex-wrap items-center justify-between gap-3 my-3 p-3 border border-warn/40 rounded-sm tls-type-small text-warn" data-testid="notification-push-off">
                  <span>Push aufs Handy ist bei dir ganz aus – die Themen kommen nur in die Glocke.</span>
                  <button type="button" onClick={() => setNotificationPreference("push", true)} className="tls-hit min-h-11 px-3 border border-warn/40 rounded-sm tls-type-label hover:bg-warn/10" data-testid="notification-push-on">
                    Push einschalten
                  </button>
                </div>
              ) : null}
              <ul className="tls-topics">
                {topics.map((topic) => {
                  const mode = modes[topic.k];
                  const litIndex = lit.keys.indexOf(topic.k);
                  return (
                    <li
                      key={topic.k}
                      className="tls-topic"
                      data-testid={`notification-topic-${topic.k}`}
                      data-mode={mode}
                      data-lit={litIndex >= 0 ? (lit.round % 2 ? "a" : "b") : undefined}
                      style={litIndex >= 0 ? { "--lit-delay": `${litIndex * 35}ms` } : undefined}
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-white" id={`notification-topic-${topic.k}-label`}>{topic.l}</div>
                        <div className="tls-type-small text-white/50 mt-0.5">{topic.d}</div>
                      </div>
                      <div role="radiogroup" aria-labelledby={`notification-topic-${topic.k}-label`} className="tls-seg" data-mode={mode} style={{ "--seg-i": MODE_ORDER.indexOf(mode) }}>
                        <span className="tls-seg__thumb" aria-hidden="true" />
                        {MODE_ORDER.map((option) => (
                          <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={mode === option}
                            aria-label={`${topic.l}: ${MODE_LABELS[option]}`}
                            tabIndex={mode === option ? 0 : -1}
                            data-mode-option={option}
                            onClick={() => pickMode(topic, option)}
                            onKeyDown={(event) => onModeKey(event, topic)}
                            className="tls-seg__option tls-wrap"
                            data-testid={`notification-topic-${topic.k}-${option}`}
                          >
                            {MODE_LABELS[option]}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {webPush?.enabled ? (
                <div className="mt-3">
                  <BrowserPushCard user={user} config={webPush} onChanged={() => setWebPushStamp((value) => value + 1)} />
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {section === "mail" ? (
          <div role="tabpanel" id="notification-section-mail" aria-labelledby="notification-section-mail-tab" className="space-y-4">
            <section className="tls-notify-card" aria-labelledby="notification-digest-title" data-testid="notification-digest" data-rhythm={rhythm}>
              <div className="flex items-start gap-3">
                <Mail className="w-5 h-5 text-white/45 mt-1 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <h3 id="notification-digest-title" className="tls-notify-card__title tls-type-card">Sammel-Mail</h3>
                  <p className="tls-type-small text-white/50 mt-1">Statt vieler Einzelmails eine am Tag oder in der Woche. Dringendes wie „Dein Spiel startet in 10 Minuten“ kommt immer sofort, Konto-Mails auch.</p>
                </div>
              </div>
              <div role="radiogroup" aria-labelledby="notification-digest-title" className="tls-seg mt-4 max-w-md" data-mode={rhythm} style={{ "--seg-i": rhythmIndex }}>
                <span className="tls-seg__thumb" aria-hidden="true" />
                {digest.options.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    role="radio"
                    aria-checked={rhythm === option.key}
                    tabIndex={rhythm === option.key ? 0 : -1}
                    data-rhythm-option={option.key}
                    onClick={() => pickRhythm(option.key)}
                    onKeyDown={onRhythmKey}
                    className="tls-seg__option tls-wrap"
                    data-testid={`notification-digest-${option.key}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="tls-type-small text-white/75 mt-3" data-testid="notification-digest-summary">
                <span className="font-bold text-white">{rhythmOption.schedule}.</span> {DIGEST_HINTS[rhythm] || ""}
              </p>
              {!ownRhythm && defaultOption ? (
                <p className="tls-type-small text-white/45 mt-1" data-testid="notification-digest-default">Vorgabe des Vereins: {defaultOption.label}.</p>
              ) : null}
              {ownRhythm && defaultOption ? (
                <button type="button" onClick={() => set("mail_digest", null)} className="tls-hit mt-2 min-h-11 tls-type-small font-bold text-[#29B6E8] hover:underline" data-testid="notification-digest-use-default">
                  Vorgabe des Vereins nutzen ({defaultOption.label})
                </button>
              ) : null}
              {emailOff ? (
                <p className="tls-type-small text-warn mt-2" data-testid="notification-digest-email-off">E-Mail ist bei dir unten ganz aus – dann kommt auch keine Sammel-Mail.</p>
              ) : null}
            </section>

            <section className="tls-notify-card" aria-labelledby="notification-email-title">
              <h3 id="notification-email-title" className="tls-notify-card__title tls-type-card">E-Mail je Thema</h3>
              <p className="tls-type-small text-white/50 mt-1 mb-3">Welche Themen überhaupt per Mail kommen – einzeln oder in der Sammel-Mail.</p>
              <div className="space-y-3">
                {emailChannel.map((channel) => (
                  <SwitchRow
                    key={channel.k}
                    label={channel.l}
                    description={channel.d}
                    checked={notificationEnabled(channel.k)}
                    onCheckedChange={(checked) => setNotificationPreference(channel.k, checked)}
                    testId={`profile-notification-channel-${channel.k}`}
                  />
                ))}
                <TopicTable columns={emailChannel} {...tableProps} testId="notification-email-table" />
                <SwitchRow
                  label="Newsletter"
                  description="Ich willige separat ein, Newsletter, Event-Hinweise und Vereinsnews per E-Mail zu erhalten. Jederzeit widerrufbar."
                  checked={newsletter}
                  onCheckedChange={(checked) => set("newsletter_consent", checked)}
                  testId="profile-newsletter"
                />
              </div>
            </section>
          </div>
        ) : null}

        {section === "ruhezeit" ? (
          <div role="tabpanel" id="notification-section-ruhezeit" aria-labelledby="notification-section-ruhezeit-tab">
            <section className="tls-notify-card" aria-labelledby="notification-quiet-title" data-testid="notification-quiet" data-enabled={quiet.enabled ? "true" : "false"}>
              <div className="flex items-start gap-3">
                <Moon className="tls-quiet__moon w-5 h-5 text-white/45 mt-1 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <h3 id="notification-quiet-title" className="tls-notify-card__title tls-type-card">Ruhezeit</h3>
                  <p className="tls-type-small text-white/50 mt-1">Kein Push, keine Browser-Meldung und keine Discord-Nachricht – alles wartet in der Glocke. Danach kommt eine Sammelmeldung, wenn etwas kam.</p>
                </div>
                <ProfileSwitch
                  label="Ruhezeit"
                  checked={quiet.enabled}
                  onCheckedChange={(enabled) => setQuiet({ enabled })}
                  testId="notification-quiet-toggle"
                  className="mt-1"
                />
              </div>
              <div className="tls-notify-reveal" data-open={quiet.enabled ? "true" : "false"} inert={!quiet.enabled}>
                <div className="tls-notify-reveal__inner">
                  <div className="grid grid-cols-2 gap-3 mt-4 max-w-sm">
                    <label className="block">
                      <span className="tls-type-label text-white/45">Von</span>
                      <input type="time" step="300" value={quietRaw.start ?? ""} onChange={(event) => setQuiet({ start: event.target.value }, true)} aria-invalid={quietError ? "true" : undefined} aria-describedby={quietError ? "notification-quiet-error" : undefined} className="tls-quiet__time mt-1" data-testid="notification-quiet-start" />
                    </label>
                    <label className="block">
                      <span className="tls-type-label text-white/45">Bis</span>
                      <input type="time" step="300" value={quietRaw.end ?? ""} onChange={(event) => setQuiet({ end: event.target.value }, true)} aria-invalid={quietError ? "true" : undefined} aria-describedby={quietError ? "notification-quiet-error" : undefined} className="tls-quiet__time mt-1" data-testid="notification-quiet-end" />
                    </label>
                  </div>
                  <div id="notification-quiet-error"><FieldError message={quietError} testId="notification-quiet-error" /></div>
                  {quietError ? null : (
                    <p className="tls-type-small text-white/70 mt-3" data-testid="notification-quiet-summary">
                      Täglich {quiet.start} bis {quiet.end} Uhr, Wiener Zeit{crossesMidnight(quiet) ? " – über Mitternacht" : ""}.
                    </p>
                  )}
                  <div className="mt-3 tls-type-label text-white/45">Kommt trotzdem sofort</div>
                  <ul className="mt-1 space-y-1 tls-type-small text-white/60 list-disc pl-4" data-testid="notification-quiet-exceptions">
                    {exceptions.map((text) => <li key={text}>{text}</li>)}
                  </ul>
                  <p className="tls-type-small text-white/45 mt-2">E-Mails kommen wie bisher – gesammelt, wenn du im Reiter „E-Mail“ eine Sammel-Mail gewählt hast.</p>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {section === "mehr" ? (
          <div role="tabpanel" id="notification-section-mehr" aria-labelledby="notification-section-mehr-tab" className="space-y-4">
            <section className="tls-notify-card" aria-labelledby="notification-channels-title" data-testid="notification-more-panel">
              <h3 id="notification-channels-title" className="tls-notify-card__title tls-type-card">Kanäle ganz abschalten</h3>
              <p className="tls-type-small text-white/50 mt-1 mb-3">Ein ausgeschalteter Kanal bringt gar nichts mehr – egal, wie die Themen stehen.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {otherChannels.map((channel) => (
                  <SwitchRow
                    key={channel.k}
                    label={channel.l}
                    description={channel.d}
                    checked={notificationEnabled(channel.k)}
                    onCheckedChange={(checked) => setNotificationPreference(channel.k, checked)}
                    testId={`profile-notification-channel-${channel.k}`}
                  />
                ))}
              </div>
              {discord && !discord.linked ? (
                <p className="tls-type-small text-white/45 mt-3" data-testid="profile-notification-discord-unlinked">Discord als Weg: erst im Reiter Socials „Mit Discord verknüpfen“ – dann kommen Benachrichtigungen auf Wunsch als Direktnachricht vom Vereins-Bot.</p>
              ) : null}
              {discord?.linked && discord?.hint ? (
                <p className="tls-type-small text-[#FFD700] mt-3" data-testid="profile-notification-discord-hint">{discord.hint}</p>
              ) : null}
              {discordChannel.length ? (
                <div className="mt-3"><TopicTable columns={discordChannel} {...tableProps} testId="notification-discord-table" /></div>
              ) : null}
            </section>

            <div className="tls-notify-card" data-testid="profile-ceremony-card">
              <div className="flex items-start gap-3 mb-4">
                <Sparkles className="w-5 h-5 text-[#FFD700] mt-1 shrink-0" />
                <div>
                  <h3 className="tls-type-card mb-1">Zeremonien</h3>
                  <p className="tls-type-small text-white/50">Wie ein freigeschalteter Erfolg gefeiert wird: mit Klang und voller Bewegung oder dezent, nur mit Einblenden.</p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <SwitchRow
                  label="Ton"
                  description="Klang je Material und Ablauf – erst nach einer Berührung der Seite, wie der Browser es verlangt."
                  checked={form.ceremony_sound !== false}
                  onCheckedChange={(checked) => set("ceremony_sound", checked)}
                  testId="profile-ceremony-sound"
                />
                <SwitchRow
                  label="Zeremonien dezent"
                  description="Kein Feuerwerk, keine Partikel, kurze Einblendung. Gilt auch, wenn dein Gerät weniger Bewegung wünscht."
                  checked={form.ceremony_mode === "subtle"}
                  onCheckedChange={(checked) => set("ceremony_mode", checked ? "subtle" : "full")}
                  testId="profile-ceremony-subtle"
                />
              </div>
              <label className="mt-3 block" htmlFor="profile-ceremony-volume">
                <span className="tls-type-label text-white/45">Lautstärke · <span data-testid="profile-ceremony-volume-value">{Number(form.ceremony_volume ?? 80)} %</span></span>
                <input
                  id="profile-ceremony-volume"
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={Number(form.ceremony_volume ?? 80)}
                  disabled={form.ceremony_sound === false}
                  onChange={(e) => set("ceremony_volume", Number(e.target.value))}
                  data-testid="profile-ceremony-volume"
                  className="mt-1 w-full accent-[#FFD700] disabled:opacity-40"
                />
              </label>
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
