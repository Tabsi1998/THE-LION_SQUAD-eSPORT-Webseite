import { bundleNotifications, bundleTitle, notificationTarget, previewText } from "./notifications";

// Benachrichtigungen (#255): jede fuehrt an ihr Ziel, gleichartige werden
// gebuendelt, die neueste ist die Vorschau.

function note(id, overrides = {}) {
  return { id, title: "Benachrichtigung", body: "", url: "", kind: "general", meta: {}, read: false, created_at: "2026-09-16T10:00:00Z", ...overrides };
}

test("die Zielzuordnung folgt der App: Nachricht, Match, Team, Turnier, Freunde, Gewinne", () => {
  expect(notificationTarget(note("a", { kind: "direct_message", url: "/profile?tab=inbox&to=u-2", meta: { thread_user_id: "u-2" } }))).toBe("/messages/u-2");
  expect(notificationTarget(note("b", { kind: "match_reminder", url: "/matches/m-1", meta: { match_id: "m-1" } }))).toBe("/matches/m-1");
  expect(notificationTarget(note("c", { kind: "team_chat_message", url: "/teams/t-1", meta: { team_id: "t-1" } }))).toBe("/teams/t-1");
  expect(notificationTarget(note("d", { kind: "tournament_chat_message", url: "/tournaments/cup/chat", meta: { tournament_id: "t-9" } }))).toBe("/tournaments/cup");
  expect(notificationTarget(note("e", { kind: "friend_request", url: "/profile?tab=friends", meta: { requester_id: "u-3" } }))).toBe("/profile?tab=friends");
  expect(notificationTarget(note("f", { kind: "prize_pending", url: "/me/prizes", meta: { pickup_id: "p-1" } }))).toBe("/my/prizes");
  expect(notificationTarget(note("g", { kind: "crown_gained", url: "/achievements" }))).toBe("/achievements");
});

test("alte Pfade werden umgeschrieben und Adressen nach draussen bleiben", () => {
  expect(notificationTarget(note("a", { kind: "admin_push_test", url: "/profile?tab=inbox" }))).toBe("/messages");
  expect(notificationTarget(note("b", { kind: "general", url: "/profile?tab=inbox&to=u-7" }))).toBe("/messages/u-7");
  expect(notificationTarget(note("c", { kind: "access_link_invite", url: "https://lionsquad.at/invite/abc" }))).toBe("https://lionsquad.at/invite/abc");
  expect(notificationTarget(note("d", { kind: "general", url: "" }))).toBe("");
});

test("drei Nachrichten desselben Absenders innerhalb einer Stunde werden eine Zeile mit der letzten als Vorschau", () => {
  const rows = [
    note("n1", { kind: "direct_message", title: "Neue Nachricht von TheLostFriday", body: "Erste", meta: { thread_user_id: "u-2" }, created_at: "2026-09-16T10:00:00Z", read: true }),
    note("n2", { kind: "direct_message", title: "Neue Nachricht von TheLostFriday", body: "Zweite", meta: { thread_user_id: "u-2" }, created_at: "2026-09-16T10:20:00Z" }),
    note("n3", { kind: "direct_message", title: "Neue Nachricht von TheLostFriday", body: "Okay, ja i seh a die sticker nit amol 😂", meta: { thread_user_id: "u-2" }, created_at: "2026-09-16T10:40:00Z" }),
    note("n4", { kind: "direct_message", title: "Neue Nachricht von Anna", body: "Hallo", meta: { thread_user_id: "u-3" }, created_at: "2026-09-16T10:30:00Z" }),
    note("n5", { kind: "friend_request", title: "Freundschaftsanfrage von Anna", meta: { requester_id: "u-3" }, created_at: "2026-09-16T09:00:00Z" }),
  ];
  const bundles = bundleNotifications(rows);
  expect(bundles.map((bundle) => bundle.id)).toEqual(["n3", "n4", "n5"]);
  const friday = bundles[0];
  expect(friday.count).toBe(3);
  expect(friday.ids).toEqual(["n3", "n2", "n1"]);
  expect(friday.title).toBe("3 neue Nachrichten von TheLostFriday");
  expect(friday.body).toBe("Okay, ja i seh a die sticker nit amol 😂");
  expect(friday.read).toBe(false);
  expect(friday.unreadCount).toBe(2);
  expect(friday.target).toBe("/messages/u-2");
  expect(bundles[1].count).toBe(1);
  expect(bundles[1].title).toBe("Neue Nachricht von Anna");
});

test("liegt mehr als eine Stunde dazwischen, entsteht ein neues Buendel", () => {
  const rows = [
    note("a", { kind: "direct_message", title: "Neue Nachricht von Bob", meta: { thread_user_id: "u-2" }, created_at: "2026-09-16T12:00:00Z" }),
    note("b", { kind: "direct_message", title: "Neue Nachricht von Bob", meta: { thread_user_id: "u-2" }, created_at: "2026-09-16T10:30:00Z" }),
    note("c", { kind: "direct_message", title: "Neue Nachricht von Bob", meta: { thread_user_id: "u-2" }, created_at: "2026-09-16T10:00:00Z" }),
  ];
  const bundles = bundleNotifications(rows);
  expect(bundles.map((bundle) => bundle.count)).toEqual([1, 2]);
});

test("Buendel-Titel kennen Team-, Turnier- und Matchnachrichten, sonst ein Zaehler", () => {
  expect(bundleTitle("Neue Teamnachricht [GRD]", 4)).toBe("4 neue Teamnachrichten [GRD]");
  expect(bundleTitle("Neue Turniernachricht: Sommercup", 2)).toBe("2 neue Turniernachrichten: Sommercup");
  expect(bundleTitle("Neue Matchnachricht: Finale", 2)).toBe("2 neue Matchnachrichten: Finale");
  expect(bundleTitle("Kronen-Wechsel", 2)).toBe("2× Kronen-Wechsel");
  expect(bundleTitle("Einzeln", 1)).toBe("Einzeln");
});

test("die Vorschau ist eine Zeile und wird gekuerzt", () => {
  expect(previewText("  Hallo\n\nWelt  ")).toBe("Hallo Welt");
  expect(previewText("x".repeat(120), 20)).toBe(`${"x".repeat(19)}…`);
});
