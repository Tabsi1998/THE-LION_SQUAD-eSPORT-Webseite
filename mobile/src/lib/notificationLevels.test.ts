import {
  CUSTOM_LEVEL, LEVEL_TOPIC_KEYS, NOTIFICATION_TOPICS, QUIET_EXCEPTIONS_FALLBACK, crossesMidnight, isClock, levelOf, levelPatch, levelTopics, modePatch,
  normalizeClockInput, quietHoursForm, quietHoursProblem, quietSummary, readNotificationServer, shiftClock, topicModes, type NotificationLevel,
} from "./notificationLevels";

// Stufen, Themen und Ruhezeit in der App (#2444) - dieselben Regeln wie frontend/src/lib/notificationLevels.js (#1204/#1206).

const PUSHED: Record<string, string[]> = {
  all: LEVEL_TOPIC_KEYS,
  important: ["match_reminders", "tournament_updates", "billing_updates", "membership_updates", "community_messages", "helper_shifts"],
  few: ["match_reminders", "billing_updates"],
};
/** Die Stufen wie vom Server (backend/services/notification_preferences.py, NOTIFICATION_LEVELS). */
const SERVER_LEVELS: NotificationLevel[] = [
  { key: "all", label: "Alles", description: "Jedes Thema per Push – nichts verpasst." },
  { key: "important", label: "Wichtiges", description: "Spiele, Turniere, Rechnungen, Mitgliedschaft, Nachrichten an dich und Helferdienste per Push. Der Rest liegt in der Glocke." },
  { key: "few", label: "Wenig", description: "Nur Spiele und Aufrufe sowie Rechnungen per Push. Alles andere liegt in der Glocke." },
].map((level) => ({ ...level, modes: Object.fromEntries(LEVEL_TOPIC_KEYS.map((topic) => [topic, PUSHED[level.key].includes(topic) ? "push" : "app"])) as NotificationLevel["modes"] }));

const topics = levelTopics();

describe("Stufen und Themen", () => {
  test("Wörter wie im Web: „Spiele & Aufrufe“ und der neue Text bei Turnier-Updates", () => {
    const byKey = Object.fromEntries(NOTIFICATION_TOPICS.map((topic) => [topic.k, topic]));
    expect(byKey.match_reminders.l).toBe("Spiele & Aufrufe");
    expect(byKey.tournament_updates.d).toBe("Anmeldung, Status, Hinweise der Turnierleitung, Liga-Rundnachrichten und Belohnungen der Liga.");
    expect(topics.map((topic) => topic.k)).toEqual(LEVEL_TOPIC_KEYS);
  });

  test("eine Stufe setzt genau die drei Schalter je Thema - und wird danach erkannt", () => {
    for (const level of SERVER_LEVELS) {
      const prefs = levelPatch(level);
      expect(Object.keys(prefs)).toHaveLength(LEVEL_TOPIC_KEYS.length * 3);
      expect(levelOf(SERVER_LEVELS, prefs, topics, true)).toBe(level.key);
    }
    const few = levelPatch(SERVER_LEVELS[2]);
    expect(few["push:match_reminders"]).toBe(true);
    expect(few["push:news_events"]).toBe(false);
    expect(few["in_app:news_events"]).toBe(true);
    expect(few["browser:news_events"]).toBe(false);
  });

  test("eine eigene Stellung zeigt „Eigene Auswahl“, ohne Stufen vom Server gibt es keine", () => {
    const prefs = { ...levelPatch(SERVER_LEVELS[0]), ...modePatch("achievements", "off") };
    expect(topicModes(prefs, topics, true).achievements).toBe("off");
    expect(levelOf(SERVER_LEVELS, prefs, topics, true)).toBe(CUSTOM_LEVEL);
    // Ein Mischstand (Push an, Glocke aus) zeigt „Push“ und gilt als eigene Auswahl.
    const mixed = { ...levelPatch(SERVER_LEVELS[0]), "in_app:achievements": false };
    expect(topicModes(mixed, topics, true).achievements).toBe("push");
    expect(levelOf(SERVER_LEVELS, mixed, topics, true)).toBe(CUSTOM_LEVEL);
    expect(levelOf([], prefs, topics, true)).toBeNull();
  });

  test("ohne Newsletter-Zustimmung sind News & Events aus; Browser folgt dem Push", () => {
    expect(topicModes({}, topics, false).news_events).toBe("off");
    expect(topicModes({}, topics, true).news_events).toBe("push");
    expect(topicModes({ "push:achievements": false, "in_app:achievements": true }, topics, true).achievements).toBe("app");
  });
});

describe("Ruhezeit", () => {
  test("Uhrzeiten: gültig, ungültig und getippt", () => {
    expect(isClock("22:00")).toBe(true);
    expect(isClock("23:59")).toBe(true);
    for (const bad of ["24:00", "7:00", "22:60", "22-00", "", null, "ab:cd"]) expect(isClock(bad)).toBe(false);
    expect(normalizeClockInput("7:00")).toBe("07:00");
    expect(normalizeClockInput("0700")).toBe("07:00");
    expect(normalizeClockInput(" 22.30 ")).toBe("22:30");
    expect(normalizeClockInput("25:00")).toBe("25:00");
  });

  test("ungültige Uhrzeit und 15-Minuten-Lücke wie am Server", () => {
    expect(quietHoursProblem({ start: "25:00", end: "07:00" })).toBe("Bitte eine Uhrzeit wie 22:00 angeben.");
    expect(quietHoursProblem({ start: "22:00", end: "" })).toBe("Bitte eine Uhrzeit wie 22:00 angeben.");
    expect(quietHoursProblem({ start: "07:10", end: "07:00" })).toBe("Zwischen Ende und Beginn der Ruhezeit müssen mindestens 15 Minuten liegen.");
    expect(quietHoursProblem({ start: "07:00", end: "07:00" })).toMatch(/mindestens 15 Minuten/);
    expect(quietHoursProblem({ start: "07:15", end: "07:00" })).toBeNull();
    expect(quietHoursProblem({ start: "22:00", end: "07:00" })).toBeNull();
  });

  test("Vorschlag 22:00 bis 7:00, Viertelstunden über Mitternacht, Zusammenfassung", () => {
    expect(quietHoursForm(null)).toEqual({ enabled: false, start: "22:00", end: "07:00" });
    expect(quietHoursForm({ enabled: true, start: "21:30", end: "kaputt" })).toEqual({ enabled: true, start: "21:30", end: "07:00" });
    expect(shiftClock("23:50", 15)).toBe("00:05");
    expect(shiftClock("00:00", -15)).toBe("23:45");
    expect(shiftClock("kaputt", 15, "22:00")).toBe("22:15");
    expect(crossesMidnight({ start: "22:00", end: "07:00" })).toBe(true);
    expect(quietSummary({ enabled: true, start: "22:00", end: "07:00" })).toBe("Täglich 22:00 bis 07:00 Uhr, Wiener Zeit – über Mitternacht.");
    expect(quietSummary({ enabled: true, start: "13:00", end: "14:00" })).toBe("Täglich 13:00 bis 14:00 Uhr, Wiener Zeit.");
  });
});

describe("Antwort des Servers", () => {
  test("neuer Server: Stufen, Themen, Ruhezeit und Ausnahmen", () => {
    const info = readNotificationServer({
      preferences: { push: true }, level: "all", topics: LEVEL_TOPIC_KEYS, levels: SERVER_LEVELS, discord: { linked: true },
      quiet_hours: { enabled: true, start: "23:00", end: "06:30" }, quiet_hours_exceptions: ["Aufruf zu deinem Spiel"],
    });
    expect(info.levelsSupported).toBe(true);
    expect(info.levels.map((level) => level.key)).toEqual(["all", "important", "few"]);
    expect(info.quietHours).toEqual({ enabled: true, start: "23:00", end: "06:30" });
    expect(info.exceptions).toEqual(["Aufruf zu deinem Spiel"]);
    expect(info.discord).toEqual({ linked: true });
    expect(info.preferences).toEqual({ push: true });
  });

  test("älterer Server ohne die Felder: keine Stufen, die bisherige Ansicht", () => {
    const info = readNotificationServer({ preferences: { push: false }, discord: { linked: false } });
    expect(info.levelsSupported).toBe(false);
    expect(info.quietHours).toBeNull();
    expect(info.exceptions).toEqual(QUIET_EXCEPTIONS_FALLBACK);
    expect(info.preferences).toEqual({ push: false });
    // Ganz alt: nur die Schalter - auch `discord` ist dort ein Schalter.
    expect(readNotificationServer({ push: false, discord: true }).preferences).toEqual({ push: false, discord: true });
    expect(readNotificationServer(null).levelsSupported).toBe(false);
  });
});
