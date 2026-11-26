// Benachrichtigungen in drei Stufen (#2444, wie das Web #1204): je Thema „Push“, „Nur App“ (Glocke) oder „Aus“ - eine Sicht auf
// die gespeicherten Schalter `in_app:<thema>`, `push:<thema>`, `browser:<thema>`. Was eine Stufe setzt, kommt vom Server (`levels`
// in GET /users/me/notification-preferences); hier steht nur, wie Schalter und Stellung zusammenhängen - gleich wie in
// frontend/src/lib/notificationLevels.js und backend/services/notification_preferences.py.
// Dazu die Ruhezeit (#1206): von–bis in Wiener Zeit, mindestens 15 Minuten Lücke zwischen Ende und Beginn.

export type Prefs = Record<string, boolean>;
export type TopicMode = "push" | "app" | "off";
export type NotificationTopic = {
  k: string;
  l: string;
  d: string;
  defaultOn?: boolean;
  requiresNewsletter?: boolean;
  /** Nur diese Wege gibt es für das Thema (sonst alle). */
  channels?: string[];
};
export type NotificationLevel = { key: string; label: string; description?: string; modes?: Record<string, TopicMode> };
export type QuietHours = { enabled: boolean; start: string; end: string };

export const TOPIC_MODE_CHANNELS = ["in_app", "push", "browser"] as const;
export const TOPIC_MODES: Record<TopicMode, Record<(typeof TOPIC_MODE_CHANNELS)[number], boolean>> = {
  push: { in_app: true, push: true, browser: true },
  app: { in_app: true, push: false, browser: false },
  off: { in_app: false, push: false, browser: false },
};
export const MODE_ORDER: TopicMode[] = ["push", "app", "off"];
export const MODE_LABELS: Record<TopicMode, string> = { push: "Push", app: "Nur App", off: "Aus" };
export const CUSTOM_LEVEL = "custom";

/**
 * Die Themen mit denselben Namen und Texten wie im Web (frontend/src/pages/user/profile/constants.js, EMAIL_PREFERENCES) - die
 * Liste der Stufen, die Spalten unter „Weitere Wege“ und die bisherige Ansicht für ältere Server nehmen dieselben Wörter.
 */
export const NOTIFICATION_TOPICS: NotificationTopic[] = [
  { k: "match_reminders", l: "Spiele & Aufrufe", d: "Aufruf zum Spiel, Spielstart, Erinnerungen, Check-in, Veto und Ergebnisse deiner Spiele.", defaultOn: true },
  { k: "tournament_updates", l: "Turnier-Updates", d: "Anmeldung, Status, Hinweise der Turnierleitung, Liga-Rundnachrichten und Belohnungen der Liga.", defaultOn: true },
  { k: "prize_updates", l: "Gewinne & Abholung", d: "Gewinn bereit, übergeben oder Frist abgelaufen.", defaultOn: true },
  { k: "achievements", l: "Erfolge", d: "Freigeschaltete Erfolge, Kronen und neue Level – als Gratulation.", defaultOn: true, channels: ["in_app", "push", "browser", "discord"] },
  { k: "achievement_recap", l: "Wochenrückblick", d: "Montags eine kurze Mail mit deinen XP, deinem Level und neuen Erfolgen – nur, wenn du in der Woche etwas erreicht hast.", defaultOn: true, channels: ["email"] },
  { k: "billing_updates", l: "Rechnungen", d: "Neue Rechnung mit Betrag, Zahlungsziel und Link zum PDF in deinem Konto.", defaultOn: true, channels: ["in_app", "push", "browser", "email"] },
  { k: "membership_updates", l: "Vereinsmitgliedschaft", d: "Einladungen zum Antrag, Nummern und Vereinsvorteile. Entscheidungen über deine Mitgliedschaft bekommst du immer per Mail.", defaultOn: true },
  { k: "birthday_greetings", l: "Geburtstagsgruß", d: "Einmal im Jahr eine Geburtstagsmail vom Verein.", defaultOn: true },
  { k: "community_messages", l: "Nachrichten & Erwähnungen", d: "Direktnachrichten, Team-Chat-Erwähnungen und ähnliche Community-Hinweise.", defaultOn: true },
  { k: "news_events", l: "News & Events", d: "Neue Vereinsnews, neue Events und wichtige Ankündigungen.", requiresNewsletter: true },
  { k: "club_internal", l: "Vereinsintern", d: "Interne Events und News, die nur Mitglieder sehen.", defaultOn: true },
  { k: "helper_shifts", l: "Helferdienste", d: "Nur für Vereinsmitglieder: Aufrufe für offene Helferschichten und die Erinnerung am Vortag.", defaultOn: true, channels: ["in_app", "push", "browser", "discord"] },
];
// Die Themen der Stufen-Liste in der Reihenfolge des Servers (LEVEL_TOPICS) - gilt, falls die Antwort keine nennt.
export const LEVEL_TOPIC_KEYS = [
  "match_reminders", "tournament_updates", "prize_updates", "achievements", "billing_updates",
  "membership_updates", "community_messages", "news_events", "club_internal", "helper_shifts",
];
// Wie EXEMPTION_TEXTS in backend/services/quiet_hours_rules.py - falls die Antwort keine nennt.
export const QUIET_EXCEPTIONS_FALLBACK = [
  "Aufruf zu deinem Spiel und „Match startet jetzt“",
  "Liga: Check-in offen und Veto – ihr seid am Zug, für dein eigenes Spiel",
  "Für die Turnierleitung: „Braucht Aufmerksamkeit“, solange dein Turnier läuft",
];

const has = (object: object | null | undefined, key: string) => Object.prototype.hasOwnProperty.call(object || {}, key);

/** Der Stand eines Themas ohne eigenen Kanal-Schalter - wie `normalized_preferences` am Server. */
function topicDefault(pref: Prefs, topic: NotificationTopic, newsletter: boolean) {
  if (topic.requiresNewsletter && !newsletter) return false;
  if (has(pref, topic.k)) return Boolean(pref[topic.k]);
  if (topic.requiresNewsletter) return newsletter;
  return topic.defaultOn !== false;
}

/** Ist ein Thema auf einem Kanal an? Browser folgt dem Push, solange er nichts Eigenes hat (#1163). */
export function channelTopicValue(pref: Prefs, channel: string, topic: NotificationTopic, newsletter: boolean): boolean {
  const key = `${channel}:${topic.k}`;
  if (channel === "email" && topic.requiresNewsletter && !newsletter) return false;
  if (has(pref, key)) return Boolean(pref[key]);
  if (channel === "browser" && has(pref, `push:${topic.k}`)) return Boolean(pref[`push:${topic.k}`]);
  return topicDefault(pref, topic, newsletter);
}

export function topicState(pref: Prefs, topic: NotificationTopic, newsletter: boolean) {
  return Object.fromEntries(TOPIC_MODE_CHANNELS.map((channel) => [channel, channelTopicValue(pref, channel, topic, newsletter)])) as Record<(typeof TOPIC_MODE_CHANNELS)[number], boolean>;
}

/** Die Stellung eines Themas. Alte Mischstände (Push an, Glocke aus) zeigen „Push“. */
export function modeOfState(state: Record<string, boolean>): TopicMode {
  if (state.push || state.browser) return "push";
  return state.in_app ? "app" : "off";
}

export function isExactState(state: Record<string, boolean>): boolean {
  return Object.values(TOPIC_MODES).some((mode) => TOPIC_MODE_CHANNELS.every((channel) => mode[channel] === Boolean(state[channel])));
}

export function topicModes(pref: Prefs, topics: NotificationTopic[], newsletter: boolean): Record<string, TopicMode> {
  return Object.fromEntries(topics.map((topic) => [topic.k, modeOfState(topicState(pref, topic, newsletter))]));
}

/** Die Stufe, die genau passt - sonst „custom“ (Eigene Auswahl); ohne Stufen vom Server `null`. */
export function levelOf(levels: NotificationLevel[] | null | undefined, pref: Prefs, topics: NotificationTopic[], newsletter: boolean): string | null {
  if (!Array.isArray(levels) || !levels.length) return null;
  if (!topics.every((topic) => isExactState(topicState(pref, topic, newsletter)))) return CUSTOM_LEVEL;
  const modes = topicModes(pref, topics, newsletter);
  const match = levels.find((level) => topics.every((topic) => (level.modes || {})[topic.k] === modes[topic.k]));
  return match ? match.key : CUSTOM_LEVEL;
}

export function modePatch(topicKey: string, mode: TopicMode): Prefs {
  const values = TOPIC_MODES[mode];
  return Object.fromEntries(TOPIC_MODE_CHANNELS.map((channel) => [`${channel}:${topicKey}`, values[channel]]));
}

export function levelPatch(level: NotificationLevel | null | undefined): Prefs {
  return Object.entries(level?.modes || {}).reduce<Prefs>((patch, [topicKey, mode]) => ({ ...patch, ...modePatch(topicKey, mode) }), {});
}

/** Die Themen der Stufen-Liste: die Reihenfolge des Servers, die Wörter wie im Web. Unbekannte Schlüssel fallen weg. */
export function levelTopics(keys?: unknown): NotificationTopic[] {
  const list = Array.isArray(keys) && keys.length ? keys.map(String) : LEVEL_TOPIC_KEYS;
  return list.map((key) => NOTIFICATION_TOPICS.find((topic) => topic.k === key)).filter((topic): topic is NotificationTopic => Boolean(topic));
}

// ---------------------------------------------------------------- Ruhezeit (#1206)

export const QUIET_SUGGESTION = { start: "22:00", end: "07:00" };
// Wie MIN_GAP_MINUTES in backend/services/quiet_hours_rules.py.
export const QUIET_MIN_GAP_MINUTES = 15;
const DAY_MINUTES = 24 * 60;

/** „HH:MM“ (00:00 bis 23:59) - ohne Regex: zwei Ziffern, Doppelpunkt, zwei Ziffern. */
export function isClock(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 5 || value[2] !== ":") return false;
  const hours = value.slice(0, 2);
  const minutes = value.slice(3);
  if (![...hours, ...minutes].every((char) => char >= "0" && char <= "9")) return false;
  return Number(hours) <= 23 && Number(minutes) <= 59;
}

/** Eine Eingabe wie „7:00“, „07:00“ oder „0700“ als „07:00“ - sonst der Text, wie er ist (dann gilt er als ungültig). */
export function normalizeClockInput(text: string): string {
  const value = String(text || "").trim().replace(".", ":");
  const candidates = [value, `0${value}`, `${value.slice(0, 2)}:${value.slice(2)}`];
  if (value.length === 5) return value;
  if (value.length === 4 && value[1] === ":" && isClock(candidates[1])) return candidates[1];
  if (value.length === 4 && !value.includes(":") && isClock(candidates[2])) return candidates[2];
  return value;
}

export function quietHoursForm(value: unknown): QuietHours {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    enabled: Boolean(raw.enabled),
    start: isClock(raw.start) ? raw.start : QUIET_SUGGESTION.start,
    end: isClock(raw.end) ? raw.end : QUIET_SUGGESTION.end,
  };
}

const minutesOf = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const clockOf = (minutes: number) => {
  const total = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/** Eine Uhrzeit um `step` Minuten verschoben, über Mitternacht weiter; ungültig bleibt beim Vorschlag. */
export function shiftClock(value: string, step: number, fallback = QUIET_SUGGESTION.start): string {
  return clockOf(minutesOf(isClock(value) ? value : fallback) + step);
}

/** Was an einer Ruhezeit nicht stimmt - `null`: passt. Auch eine ausgeschaltete behält gültige Zeiten. */
export function quietHoursProblem(quiet: Partial<QuietHours> | null | undefined): string | null {
  if (!isClock(quiet?.start) || !isClock(quiet?.end)) return "Bitte eine Uhrzeit wie 22:00 angeben.";
  const gap = (minutesOf(quiet.start) - minutesOf(quiet.end) + DAY_MINUTES) % DAY_MINUTES;
  if (gap < QUIET_MIN_GAP_MINUTES) return `Zwischen Ende und Beginn der Ruhezeit müssen mindestens ${QUIET_MIN_GAP_MINUTES} Minuten liegen.`;
  return null;
}

export function crossesMidnight(quiet: Partial<QuietHours> | null | undefined): boolean {
  return isClock(quiet?.start) && isClock(quiet?.end) && quiet.start > quiet.end;
}

/** Die Zusammenfassung unter den Zeiten, wie im Web. */
export function quietSummary(quiet: QuietHours): string {
  return `Täglich ${quiet.start} bis ${quiet.end} Uhr, Wiener Zeit${crossesMidnight(quiet) ? " – über Mitternacht" : ""}.`;
}

// ---------------------------------------------------------------- Antwort des Servers

export type DiscordDmInfo = { linked?: boolean; blocked_at?: string | null; hint?: string | null };
export type NotificationServerInfo = {
  /** Kennt der Server Stufen und Ruhezeit (#1204/#1206)? Ältere Server: die bisherige Ansicht. */
  levelsSupported: boolean;
  preferences: Prefs;
  levels: NotificationLevel[];
  topics: NotificationTopic[];
  quietHours: QuietHours | null;
  exceptions: string[];
  discord: DiscordDmInfo | null;
  /** Sammel-Mail (#1662) - null bei Servern, die sie noch nicht kennen. */
  digest: DigestInfo | null;
};

// ---------------------------------------------------------------- Sammel-Mail (#1662)

export type DigestRhythm = "instant" | "daily" | "weekly";
export type DigestOption = { key: DigestRhythm; label: string; schedule: string };
/** `rhythm`: was gilt; `own`: die eigene Wahl (null = Vorgabe des Vereins); `default`: die Vorgabe des Vereins. */
export type DigestInfo = { rhythm: DigestRhythm; own: DigestRhythm | null; default: DigestRhythm; options: DigestOption[] };

const RHYTHMS = new Set<string>(["instant", "daily", "weekly"]);
const isRhythm = (value: unknown): value is DigestRhythm => typeof value === "string" && RHYTHMS.has(value);

/** Gilt, bis der Server antwortet - dieselben Texte wie backend/services/mail_digest_rules.py und das Web. */
export const DIGEST_FALLBACK: DigestInfo = {
  rhythm: "instant",
  own: null,
  default: "instant",
  options: [
    { key: "instant", label: "Sofort", schedule: "Jede Mail sofort" },
    { key: "daily", label: "Täglich", schedule: "Täglich um 07:00 Uhr" },
    { key: "weekly", label: "Wöchentlich", schedule: "Montags um 07:00 Uhr" },
  ],
};

/** Was der Rhythmus heißt - wie DIGEST_HINTS im Web (NotificationsTab). */
export const DIGEST_HINTS: Record<DigestRhythm, string> = {
  instant: "Jede Mail kommt einzeln, sobald etwas passiert.",
  daily: "Eine Mail am Tag mit allem, was seit der letzten kam – nach Themen sortiert.",
  weekly: "Eine Mail in der Woche mit allem, was seit der letzten kam – nach Themen sortiert.",
};

/** `mail_digest` aus GET /users/me/notification-preferences - null, wenn der Server es nicht schickt. */
export function readDigest(value: unknown): DigestInfo | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const options = (Array.isArray(raw.options) ? raw.options : [])
    .filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === "object" && isRhythm((option as Record<string, unknown>).key))
    .map((option) => {
      const key = option.key as DigestRhythm;
      const fallback = DIGEST_FALLBACK.options.find((item) => item.key === key) as DigestOption;
      return { key, label: typeof option.label === "string" && option.label ? option.label : fallback.label, schedule: typeof option.schedule === "string" && option.schedule ? option.schedule : fallback.schedule };
    });
  if (!options.length) return null;
  const fallbackDefault = isRhythm(raw.default) ? raw.default : "instant";
  const own = isRhythm(raw.own) ? raw.own : null;
  return { rhythm: isRhythm(raw.rhythm) ? raw.rhythm : own || fallbackDefault, own, default: fallbackDefault, options };
}

/** Was gerade gilt: die eigene Wahl - ohne sie die Vorgabe des Vereins. */
export function digestRhythm(info: DigestInfo, own: DigestRhythm | null | undefined): DigestRhythm {
  return own || info.default || "instant";
}

const MODES = new Set<string>(MODE_ORDER);

/** Die Antwort von GET /users/me/notification-preferences gelesen - neue und ältere Server (nur `preferences` oder nur Schalter). */
export function readNotificationServer(data: unknown): NotificationServerInfo {
  const raw = data && typeof data === "object" ? data as Record<string, any> : {};
  const isObject = (value: unknown) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  // Ganz alte Server antworten nur mit den Schaltern selbst (dort ist `discord` ein Schalter, kein Objekt).
  const flat = !isObject(raw.preferences) && !isObject(raw.discord) && !Array.isArray(raw.levels);
  const preferences = (isObject(raw.preferences) ? raw.preferences : flat ? raw : {}) as Prefs;
  const levels: NotificationLevel[] = Array.isArray(raw.levels)
    ? raw.levels
      .filter((level: any) => level && typeof level.key === "string" && level.key)
      .map((level: any) => ({
        key: level.key,
        label: String(level.label || level.key),
        description: typeof level.description === "string" ? level.description : "",
        modes: Object.fromEntries(Object.entries(level.modes || {}).filter(([, mode]) => MODES.has(String(mode)))) as Record<string, TopicMode>,
      }))
    : [];
  const exceptions = Array.isArray(raw.quiet_hours_exceptions) ? raw.quiet_hours_exceptions.filter((text: unknown) => typeof text === "string" && text) : [];
  return {
    levelsSupported: levels.length > 0,
    preferences: { ...preferences },
    levels,
    topics: levelTopics(raw.topics),
    quietHours: raw.quiet_hours && typeof raw.quiet_hours === "object" ? quietHoursForm(raw.quiet_hours) : null,
    exceptions: exceptions.length ? exceptions : QUIET_EXCEPTIONS_FALLBACK,
    discord: raw.discord && typeof raw.discord === "object" ? raw.discord as DiscordDmInfo : null,
    digest: readDigest(raw.mail_digest),
  };
}
