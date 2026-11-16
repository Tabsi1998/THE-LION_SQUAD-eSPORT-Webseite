// Benachrichtigungen in drei Stufen (#1204): je Thema „Push“ (App und Browser, #1163), „Nur App“ (Glocke) oder „Aus“ - eine
// Sicht auf die gespeicherten Schalter `in_app:<thema>`, `push:<thema>`, `browser:<thema>`. Was eine Stufe setzt, kommt vom
// Server (`levels` in /users/me/notification-preferences); hier steht nur, wie Schalter und Stellung zusammenhängen - gleich
// wie in backend/services/notification_preferences.py.

export const TOPIC_MODE_CHANNELS = ["in_app", "push", "browser"];
export const TOPIC_MODES = {
  push: { in_app: true, push: true, browser: true },
  app: { in_app: true, push: false, browser: false },
  off: { in_app: false, push: false, browser: false },
};
export const MODE_ORDER = ["push", "app", "off"];
export const MODE_LABELS = { push: "Push", app: "Nur App", off: "Aus" };
// Die Themen der Liste in der Reihenfolge des Servers (LEVEL_TOPICS) - gilt, bis die Antwort da ist.
export const LEVEL_TOPIC_KEYS = [
  "match_reminders", "tournament_updates", "prize_updates", "achievements", "billing_updates",
  "membership_updates", "community_messages", "news_events", "club_internal", "helper_shifts",
];
export const CUSTOM_LEVEL = "custom";

const has = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

/** Der Stand eines Themas ohne eigenen Kanal-Schalter - wie `normalized_preferences` am Server. */
function topicDefault(pref, topic, newsletter) {
  if (topic.requiresNewsletter && !newsletter) return false;
  if (has(pref, topic.k)) return !!pref[topic.k];
  if (topic.requiresNewsletter) return !!newsletter;
  return topic.defaultOn !== false;
}

/** Ist ein Thema auf einem Kanal an? Browser folgt dem Push, solange er nichts Eigenes hat (#1163). */
export function channelTopicValue(pref, channel, topic, newsletter) {
  const key = `${channel}:${topic.k}`;
  if (channel === "email" && topic.requiresNewsletter && !newsletter) return false;
  if (has(pref, key)) return !!pref[key];
  if (channel === "browser" && has(pref, `push:${topic.k}`)) return !!pref[`push:${topic.k}`];
  return topicDefault(pref, topic, newsletter);
}

export function topicState(pref, topic, newsletter) {
  return Object.fromEntries(TOPIC_MODE_CHANNELS.map((channel) => [channel, channelTopicValue(pref, channel, topic, newsletter)]));
}

/** Die Stellung eines Themas. Alte Mischstände (Push an, Glocke aus) zeigen „Push“. */
export function modeOfState(state) {
  if (state.push || state.browser) return "push";
  return state.in_app ? "app" : "off";
}

export function isExactState(state) {
  return Object.values(TOPIC_MODES).some((mode) => TOPIC_MODE_CHANNELS.every((channel) => mode[channel] === !!state[channel]));
}

export function topicModes(pref, topics, newsletter) {
  return Object.fromEntries(topics.map((topic) => [topic.k, modeOfState(topicState(pref, topic, newsletter))]));
}

/** Die Stufe, die genau passt - sonst „custom“ (Eigene Auswahl). */
export function levelOf(levels, pref, topics, newsletter) {
  if (!Array.isArray(levels) || !levels.length) return null;
  if (!topics.every((topic) => isExactState(topicState(pref, topic, newsletter)))) return CUSTOM_LEVEL;
  const modes = topicModes(pref, topics, newsletter);
  const match = levels.find((level) => topics.every((topic) => (level.modes || {})[topic.k] === modes[topic.k]));
  return match ? match.key : CUSTOM_LEVEL;
}

export function modePatch(topicKey, mode) {
  const values = TOPIC_MODES[mode];
  return Object.fromEntries(TOPIC_MODE_CHANNELS.map((channel) => [`${channel}:${topicKey}`, values[channel]]));
}

export function levelPatch(level) {
  return Object.entries(level?.modes || {}).reduce((patch, [topicKey, mode]) => ({ ...patch, ...modePatch(topicKey, mode) }), {});
}

// Ruhezeit (#1206): von–bis in Wiener Zeit, Standard aus, Vorschlag 22:00 bis 7:00.
export const QUIET_SUGGESTION = { start: "22:00", end: "07:00" };
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isClock(value) {
  return typeof value === "string" && CLOCK.test(value);
}

export function quietHoursForm(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    enabled: !!raw.enabled,
    start: isClock(raw.start) ? raw.start : QUIET_SUGGESTION.start,
    end: isClock(raw.end) ? raw.end : QUIET_SUGGESTION.end,
  };
}

// Wie MIN_GAP_MINUTES in backend/services/quiet_hours_rules.py.
export const QUIET_MIN_GAP_MINUTES = 15;
const minutesOf = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

/** Was an einer Ruhezeit nicht stimmt - null: passt. Auch eine ausgeschaltete behält gültige Zeiten. */
export function quietHoursProblem(quiet) {
  if (!isClock(quiet?.start) || !isClock(quiet?.end)) return "Bitte eine Uhrzeit wie 22:00 angeben.";
  const gap = (minutesOf(quiet.start) - minutesOf(quiet.end) + 24 * 60) % (24 * 60);
  if (gap < QUIET_MIN_GAP_MINUTES) return `Zwischen Ende und Beginn der Ruhezeit müssen mindestens ${QUIET_MIN_GAP_MINUTES} Minuten liegen.`;
  return null;
}

export function crossesMidnight(quiet) {
  return isClock(quiet?.start) && isClock(quiet?.end) && quiet.start > quiet.end;
}
