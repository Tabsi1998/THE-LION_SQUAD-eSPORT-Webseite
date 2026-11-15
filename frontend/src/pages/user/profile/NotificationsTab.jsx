import { useEffect, useRef, useState } from "react";
import { Bell, BellMinus, BellRing, ChevronDown, Moon, Sparkles } from "lucide-react";
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

// Benachrichtigungen einfach einstellen (#1204, Fabians Wahl A): oben drei Stufen zum Antippen, darunter je Thema Push (gilt
// auch für den Browser, #1163), „Nur App“ oder „Aus“. Eine Stufe setzt alle Themen; eigene Änderungen zeigen „Eigene
// Auswahl“. Darunter die Ruhezeit (#1206) und, eingeklappt, „Weitere Wege“: E-Mail, Discord (#567, nur mit verknüpftem
// Konto) und die Kanäle ganz aus. Was eine Stufe setzt, sagt der Server - die Seite rechnet nur die Schalter dazu.
const LEVEL_ICONS = { all: BellRing, important: Bell, few: BellMinus };
const LEVEL_HINTS = { all: "Jedes Thema per Push", important: "Das Wichtige per Push", few: "Nur Spiele und Rechnungen" };
const FALLBACK_EXCEPTIONS = [
  "Aufruf zu deinem Spiel und „Match startet jetzt“",
  "Liga: Check-in offen und Veto – ihr seid am Zug, für dein eigenes Spiel",
  "Für die Turnierleitung: „Braucht Aufmerksamkeit“, solange dein Turnier läuft",
];
// Unter „Weitere Wege“: E-Mail und Discord je Thema, die übrigen Kanäle nur als Hauptschalter.
const MORE_COLUMNS = ["email", "discord"];

export function NotificationsTab({
  form, set, setLater = set, setNotificationPreference, setNotificationPreferences, notificationEnabled, notificationTopicEnabled,
  autosave, user = null,
}) {
  const [server, setServer] = useState(null);
  const [webPush, setWebPush] = useState(null);
  const [webPushStamp, setWebPushStamp] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [lit, setLit] = useState({ round: 0, keys: [] });
  const levelRefs = useRef({});
  useEffect(() => {
    let active = true;
    api.get("/users/me/notification-preferences")
      .then(({ data }) => { if (active) setServer(data || {}); })
      .catch(() => { if (active) setServer({ discord: { linked: false } }); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    loadWebPushConfig().then((config) => { if (active) setWebPush(config); });
    return () => { active = false; };
  }, [webPushStamp]);

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
  const quiet = quietHoursForm(form.quiet_hours);
  const exceptions = Array.isArray(server?.quiet_hours_exceptions) && server.quiet_hours_exceptions.length ? server.quiet_hours_exceptions : FALLBACK_EXCEPTIONS;
  const channels = NOTIFICATION_CHANNELS.filter((channel) => (channel.k !== "discord" || discord?.linked) && (channel.k !== "browser" || webPush?.enabled));
  const moreColumns = channels.filter((channel) => MORE_COLUMNS.includes(channel.k));
  const pushOff = !notificationEnabled("push");

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
  // Pfeiltasten in der Stufen-Reihe wie bei Optionsfeldern: weiter zur nächsten Stufe und dorthin den Fokus.
  const onLevelKey = (event, index) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step || !levels.length) return;
    event.preventDefault();
    const next = levels[(index + step + levels.length) % levels.length];
    pickLevel(next);
    levelRefs.current[next.key]?.focus();
  };
  const setQuiet = (patch, later = false) => (later ? setLater : set)("quiet_hours", { ...quiet, ...patch });

  return (
    <Section>
      <div className="tls-notify space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-white/60">Wähle, wie viel bei dir ankommt. Konto- und Sicherheitsmails bleiben immer aktiv.</p>
          <AutosaveStatus status={autosave.status} message={autosave.message} onRetry={autosave.retry} />
        </div>

        <section className="tls-notify-card" aria-labelledby="notification-level-title" data-testid="notification-levels" data-level={level || "loading"}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 id="notification-level-title" className="tls-notify-card__title font-heading">Stufe</h3>
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
          ) : server ? null : (
            <div className="grid grid-cols-3 gap-2" aria-hidden="true" data-testid="notification-levels-loading">
              {[0, 1, 2].map((index) => <div key={index} className="h-[5.5rem] border border-white/10 rounded-sm bg-white/[0.03] animate-pulse" />)}
            </div>
          )}
          <p className="text-xs text-white/55 mt-3 min-h-[2.5em]" data-testid="notification-level-description">
            {level === CUSTOM_LEVEL
              ? "Du hast einzelne Themen selbst gestellt. Tippe eine Stufe an, dann setzt sie alle Themen neu."
              : currentLevel?.description || ""}
          </p>
        </section>

        <section className="tls-notify-card" aria-labelledby="notification-topics-title">
          <h3 id="notification-topics-title" className="tls-notify-card__title font-heading">Themen</h3>
          <p className="text-xs text-white/50 mt-1 mb-2">Push heißt: aufs Handy in der LionsAPP und in den Browser, wenn du ihn angemeldet hast. „Nur App“ legt es still in die Glocke.</p>
          {pushOff ? (
            <div className="flex flex-wrap items-center justify-between gap-3 my-3 p-3 border border-warn/40 rounded-sm text-sm text-warn" data-testid="notification-push-off">
              <span>Push aufs Handy ist bei dir ganz aus – die Themen kommen nur in die Glocke.</span>
              <button type="button" onClick={() => setNotificationPreference("push", true)} className="tls-hit min-h-11 px-3 border border-warn/40 rounded-sm font-bold uppercase tracking-wider text-xs hover:bg-warn/10" data-testid="notification-push-on">
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
                    <div className="text-xs text-white/50 mt-0.5">{topic.d}</div>
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
                        onClick={() => pickMode(topic, option)}
                        className="tls-seg__option"
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

        <section className="tls-notify-card" aria-labelledby="notification-quiet-title" data-testid="notification-quiet" data-enabled={quiet.enabled ? "true" : "false"}>
          <div className="flex items-start gap-3">
            <Moon className="tls-quiet__moon w-5 h-5 text-white/45 mt-1 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h3 id="notification-quiet-title" className="tls-notify-card__title font-heading">Ruhezeit</h3>
              <p className="text-xs text-white/50 mt-1">Kein Push, keine Browser-Meldung und keine Discord-Nachricht – alles wartet in der Glocke. Danach kommt eine Sammelmeldung, wenn etwas kam.</p>
            </div>
            <ProfileSwitch
              label="Ruhezeit"
              checked={quiet.enabled}
              onCheckedChange={(enabled) => setQuiet({ enabled })}
              testId="notification-quiet-toggle"
              className="mt-1"
            />
          </div>
          <div className="tls-reveal" data-open={quiet.enabled ? "true" : "false"} inert={!quiet.enabled}>
            <div className="tls-reveal__inner">
              <div className="grid grid-cols-2 gap-3 mt-4 max-w-sm">
                <label className="block">
                  <span className="text-[11px] uppercase tracking-widest font-bold text-white/45">Von</span>
                  <input type="time" step="300" value={quiet.start} onChange={(event) => setQuiet({ start: event.target.value }, true)} className="tls-quiet__time mt-1" data-testid="notification-quiet-start" />
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-widest font-bold text-white/45">Bis</span>
                  <input type="time" step="300" value={quiet.end} onChange={(event) => setQuiet({ end: event.target.value }, true)} className="tls-quiet__time mt-1" data-testid="notification-quiet-end" />
                </label>
              </div>
              <FieldError message={autosave.fieldErrors?.quiet_hours} testId="notification-quiet-error" />
              <p className="text-sm text-white/70 mt-3" data-testid="notification-quiet-summary">
                Täglich {quiet.start} bis {quiet.end} Uhr, Wiener Zeit{crossesMidnight(quiet) ? " – über Mitternacht" : ""}.
              </p>
              <div className="mt-3 text-[11px] uppercase tracking-widest font-bold text-white/45">Kommt trotzdem sofort</div>
              <ul className="mt-1 space-y-1 text-xs text-white/60 list-disc pl-4" data-testid="notification-quiet-exceptions">
                {exceptions.map((text) => <li key={text}>{text}</li>)}
              </ul>
              <p className="text-xs text-white/45 mt-2">E-Mails kommen wie bisher.</p>
            </div>
          </div>
        </section>

        <section className="tls-notify-card !p-0">
          <button type="button" aria-expanded={moreOpen} aria-controls="notification-more-panel" onClick={() => setMoreOpen((open) => !open)} className="tls-more__toggle" data-testid="notification-more-ways">
            <span className="min-w-0">
              <span className="tls-notify-card__title font-heading block">Weitere Wege</span>
              <span className="text-xs text-white/50 block mt-1">E-Mail, Discord und Kanäle ganz abschalten.</span>
            </span>
            <ChevronDown className="tls-more__chevron" aria-hidden="true" />
          </button>
          <div id="notification-more-panel" className="tls-reveal" data-open={moreOpen ? "true" : "false"} inert={!moreOpen} data-testid="notification-more-panel">
            <div className="tls-reveal__inner">
              <div className="px-5 pb-5 space-y-4">
                <div className="grid sm:grid-cols-2 gap-3">
                  {channels.map((channel) => (
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
                  <p className="text-xs text-white/45" data-testid="profile-notification-discord-unlinked">Discord als Weg: erst im Reiter Socials „Mit Discord verknüpfen“ – dann kommen Benachrichtigungen auf Wunsch als Direktnachricht vom Vereins-Bot.</p>
                ) : null}
                {discord?.linked && discord?.hint ? (
                  <p className="text-[11px] text-[#FFD700]" data-testid="profile-notification-discord-hint">{discord.hint}</p>
                ) : null}
                <div className="tls-swipe pb-0 md:overflow-visible -mx-5 px-5 md:[mask-image:none] md:[-webkit-mask-image:none]">
                  <table className="w-full min-w-[320px] text-sm border-separate border-spacing-0">
                    <thead className="text-[10px] uppercase tracking-widest text-white/45">
                      <tr>
                        <th scope="col" className="text-left px-3 py-3 border-b border-white/10">Thema</th>
                        {moreColumns.map((channel) => {
                          const enabled = notificationEnabled(channel.k);
                          return (
                            <th key={channel.k} scope="col" className={`text-center px-3 py-3 border-b border-white/10 ${enabled ? "" : "opacity-40"}`} data-testid={`profile-notification-column-${channel.k}`}>
                              {channel.l}
                              {enabled ? null : <span className="block normal-case tracking-normal font-normal text-[10px]">Weg aus</span>}
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
                            {topic.requiresNewsletter && !newsletter ? (
                              <div className="text-[11px] text-[#FFD700] mt-1">Per E-Mail nur mit Newsletter-Zustimmung (unten).</div>
                            ) : null}
                          </td>
                          {moreColumns.map((channel) => {
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
                <SwitchRow
                  label="Newsletter"
                  description="Ich willige separat ein, Newsletter, Event-Hinweise und Vereinsnews per E-Mail zu erhalten. Jederzeit widerrufbar."
                  checked={newsletter}
                  onCheckedChange={(checked) => set("newsletter_consent", checked)}
                  testId="profile-newsletter"
                />
              </div>
            </div>
          </div>
        </section>

        <div className="tls-notify-card" data-testid="profile-ceremony-card">
          <div className="flex items-start gap-3 mb-4">
            <Sparkles className="w-5 h-5 text-[#FFD700] mt-1 shrink-0" />
            <div>
              <h3 className="font-heading font-black uppercase mb-1">Zeremonien</h3>
              <p className="text-xs text-white/50">Wie ein freigeschalteter Erfolg gefeiert wird: mit Klang und voller Bewegung oder dezent, nur mit Einblenden.</p>
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
            <span className="text-[11px] uppercase tracking-widest font-bold text-white/45">Lautstärke · <span data-testid="profile-ceremony-volume-value">{Number(form.ceremony_volume ?? 80)} %</span></span>
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
    </Section>
  );
}
