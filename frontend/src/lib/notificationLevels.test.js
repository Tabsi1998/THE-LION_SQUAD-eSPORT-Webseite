import { EMAIL_PREFERENCES } from "@/pages/user/profile/constants";
import {
  CUSTOM_LEVEL, LEVEL_TOPIC_KEYS, channelTopicValue, crossesMidnight, isExactState, levelOf, levelPatch, modeOfState, modePatch,
  quietHoursForm, quietHoursProblem, topicModes, topicState,
} from "./notificationLevels";

// Stufen und Themen (#1204) und Ruhezeit (#1206) - dieselben Regeln wie backend/services/notification_preferences.py.
const topics = LEVEL_TOPIC_KEYS.map((key) => EMAIL_PREFERENCES.find((topic) => topic.k === key));
const modes = (pushed) => Object.fromEntries(LEVEL_TOPIC_KEYS.map((key) => [key, pushed.includes(key) ? "push" : "app"]));
const LEVELS = [
  { key: "all", modes: modes(LEVEL_TOPIC_KEYS) },
  { key: "few", modes: modes(["match_reminders", "billing_updates"]) },
];

test("jedes Thema der Liste ist ein Thema der Einstellungen", () => {
  expect(topics.every(Boolean)).toBe(true);
});

test("ohne Schalter: Standard wie am Server, News nur mit Newsletter", () => {
  expect(topicModes({}, topics, false).news_events).toBe("off");
  expect(topicModes({}, topics, true).news_events).toBe("push");
  expect(levelOf(LEVELS, {}, topics, false)).toBe(CUSTOM_LEVEL);
  expect(levelOf(LEVELS, {}, topics, true)).toBe("all");
  expect(levelOf([], {}, topics, true)).toBeNull();
});

test("eine Stufe setzt drei Schalter je Thema, eine eigene Stellung ist „Eigene Auswahl“", () => {
  const pref = levelPatch(LEVELS[1]);
  expect(Object.keys(pref)).toHaveLength(LEVEL_TOPIC_KEYS.length * 3);
  expect(levelOf(LEVELS, pref, topics, false)).toBe("few");
  const own = { ...pref, ...modePatch("achievements", "off") };
  expect(levelOf(LEVELS, own, topics, false)).toBe(CUSTOM_LEVEL);
  expect(topicModes(own, topics, false).achievements).toBe("off");
});

test("Browser folgt dem Push, solange er nichts Eigenes hat (#1163)", () => {
  const topic = topics.find((item) => item.k === "achievements");
  expect(channelTopicValue({ "push:achievements": false }, "browser", topic, false)).toBe(false);
  expect(channelTopicValue({ "push:achievements": false, "browser:achievements": true }, "browser", topic, false)).toBe(true);
  expect(topicModes({ "push:achievements": false }, topics, false).achievements).toBe("app");
});

test("alte Mischstände zeigen Push, sind aber keine der drei Stellungen", () => {
  const topic = topics.find((item) => item.k === "prize_updates");
  const state = topicState({ "in_app:prize_updates": false }, topic, true);
  expect(modeOfState(state)).toBe("push");
  expect(isExactState(state)).toBe(false);
  expect(levelOf(LEVELS, { "in_app:prize_updates": false }, topics, true)).toBe(CUSTOM_LEVEL);
});

test("Ruhezeit: Standard aus mit Vorschlag 22:00 bis 7:00, ungültige Zeiten fallen auf den Vorschlag", () => {
  expect(quietHoursForm(undefined)).toEqual({ enabled: false, start: "22:00", end: "07:00" });
  expect(quietHoursForm({ enabled: true, start: "13:00", end: "25:00" })).toEqual({ enabled: true, start: "13:00", end: "07:00" });
  expect(crossesMidnight({ start: "22:00", end: "07:00" })).toBe(true);
  expect(crossesMidnight({ start: "13:00", end: "15:00" })).toBe(false);
});

test("Ruhezeit prüfen wie am Server: Uhrzeit und mindestens 15 Minuten Lücke", () => {
  expect(quietHoursProblem({ enabled: true, start: "22:00", end: "07:00" })).toBeNull();
  expect(quietHoursProblem({ enabled: true, start: "", end: "07:00" })).toMatch(/Uhrzeit/);
  expect(quietHoursProblem({ enabled: false, start: "07:05", end: "07:00" })).toMatch(/15 Minuten/);
  expect(quietHoursProblem({ enabled: true, start: "07:15", end: "07:00" })).toBeNull();
  expect(quietHoursProblem({ enabled: true, start: "07:00", end: "07:00" })).toMatch(/15 Minuten/);
});
