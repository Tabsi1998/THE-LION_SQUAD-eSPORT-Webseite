import { describe, expect, it } from "vitest";
import {
  DAY_LABELS, TOPIC_KEYS, TOPIC_LABELS, dayOf, groupNotifications, similarKey, topicCounts, topicOf,
} from "./notificationGroups";
import { LEVEL_TOPIC_KEYS } from "./notificationLevels";

// Benachrichtigungen aufgeräumt (#1205, #1662): nach Tagen (Heute, Gestern, Früher), nach Themen zum Antippen und
// Gleichartiges gebündelt - Wiener Kalendertage, Thema vom Server.

const NOW = "2026-11-26T11:00:00Z"; // 12:00 in Wien
const note = (id, created_at, extra = {}) => ({ id, created_at, kind: "general", title: id, body: "", meta: {}, read: false, ...extra });
const result = (id, created_at, liga = "Liga 1", tid = "liga-1") => note(id, created_at, {
  kind: "match_result", topic: "match_reminders", title: "Ergebnis bestätigt", body: `${liga}: A 1:0 B`, meta: { tournament_id: tid },
});

describe("Themen", () => {
  it("kennt jedes Thema der Einstellungen und „Konto & System“", () => {
    expect(TOPIC_KEYS).toEqual([...LEVEL_TOPIC_KEYS, "account"]);
    expect(TOPIC_KEYS.every((key) => TOPIC_LABELS[key])).toBe(true);
  });

  it("nimmt das Thema vom Server - Unbekanntes landet unter Konto & System", () => {
    expect(topicOf({ topic: "prize_updates" })).toBe("prize_updates");
    expect(topicOf({ topic: "quatsch" })).toBe("account");
    expect(topicOf({})).toBe("account");
  });

  it("zählt die Themen in der Reihenfolge der Einstellungen", () => {
    const rows = [note("a", NOW, { topic: "prize_updates" }), note("b", NOW, { topic: "match_reminders" }), note("c", NOW, { topic: "prize_updates" })];
    expect(topicCounts(rows)).toEqual([{ key: "match_reminders", label: "Spiele & Aufrufe", count: 1 }, { key: "prize_updates", label: "Gewinne & Abholung", count: 2 }]);
  });
});

describe("Tage", () => {
  it("zählt nach dem Wiener Kalender", () => {
    expect(dayOf("2026-11-26T00:30:00Z", NOW)).toBe("today"); // 01:30 in Wien
    expect(dayOf("2026-11-25T22:59:00Z", NOW)).toBe("yesterday"); // 23:59 am 25.
    expect(dayOf("2026-11-24T23:30:00Z", NOW)).toBe("yesterday"); // 00:30 am 25.
    expect(dayOf("2026-11-24T22:00:00Z", NOW)).toBe("earlier");
    expect(DAY_LABELS).toEqual({ today: "Heute", yesterday: "Gestern", earlier: "Früher" });
  });
});

describe("Bündeln", () => {
  it("fasst Ergebnisse desselben Turniers am selben Tag zusammen", () => {
    expect(similarKey(result("r1", NOW))).toBe("results:liga-1");
    const groups = groupNotifications([
      result("r1", "2026-11-26T10:00:00Z"), result("r2", "2026-11-26T09:00:00Z"), result("r3", "2026-11-26T08:00:00Z"),
      result("x1", "2026-11-26T07:00:00Z", "Cup", "cup"),
    ], { now: NOW });
    expect(groups.map((group) => group.key)).toEqual(["today"]);
    const [liga, cup] = groups[0].bundles;
    expect(liga).toMatchObject({ id: "r1", count: 3, ids: ["r1", "r2", "r3"], title: "3 neue Ergebnisse in Liga 1", topic: "match_reminders" });
    expect(cup).toMatchObject({ id: "x1", count: 1, title: "Ergebnis bestätigt" });
  });

  it("bündelt nicht über den Tag hinweg und lässt Nachrichten wie bisher zusammen", () => {
    const groups = groupNotifications([
      result("r1", "2026-11-26T10:00:00Z"), result("r2", "2026-11-25T10:00:00Z"),
      note("d1", "2026-11-26T09:00:00Z", { kind: "direct_message", topic: "community_messages", title: "Neue Nachricht von Max", meta: { thread_user_id: "max" } }),
      note("d2", "2026-11-26T08:00:00Z", { kind: "direct_message", topic: "community_messages", title: "Neue Nachricht von Max", meta: { thread_user_id: "max" } }),
    ], { now: NOW });
    expect(groups.map((group) => [group.key, group.label, group.bundles.map((bundle) => bundle.title)])).toEqual([
      ["today", "Heute", ["Ergebnis bestätigt", "2 neue Nachrichten von Max"]],
      ["yesterday", "Gestern", ["Ergebnis bestätigt"]],
    ]);
  });

  it("fasst Erfolge eines Tages zusammen", () => {
    const rows = ["a1", "a2"].map((id, index) => note(id, `2026-11-26T0${index + 1}:00:00Z`, { kind: "achievement", topic: "achievements", title: "Erfolg freigeschaltet" }));
    expect(groupNotifications(rows, { now: NOW })[0].bundles[0]).toMatchObject({ count: 2, title: "2 neue Erfolge" });
  });

  it("filtert nach Thema und nach gelesen / ungelesen - ein Bündel ist ungelesen, solange eines darin ungelesen ist", () => {
    const rows = [result("r1", NOW), { ...result("r2", NOW), read: true }, note("p", NOW, { topic: "prize_updates", read: true })];
    const unread = groupNotifications(rows, { now: NOW, tab: "unread" });
    expect(unread[0].bundles.map((bundle) => [bundle.id, bundle.count, bundle.unreadCount])).toEqual([["r1", 2, 1]]);
    expect(groupNotifications(rows, { now: NOW, tab: "read" })[0].bundles.map((bundle) => bundle.id)).toEqual(["p"]);
    expect(groupNotifications(rows, { now: NOW, topic: "prize_updates" })[0].bundles.map((bundle) => bundle.id)).toEqual(["p"]);
  });

  it("ein Bündel trägt die Wichtigste seiner Meldungen", () => {
    const rows = [result("r1", NOW), { ...result("r2", NOW), importance: "urgent" }];
    expect(groupNotifications(rows, { now: NOW })[0].bundles[0].importance).toBe("urgent");
  });
});
