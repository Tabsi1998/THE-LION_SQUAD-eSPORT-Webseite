import { mergePopup, popupBody, popupTitle, suppressedByOpenChat } from "./popups";
import type { UserNotification } from "../types";

// In-App-Banner (#251): bündeln, nur einer sichtbar, nicht im offenen Chat.

const message = (id: string, extra: Partial<UserNotification> = {}): UserNotification => ({
  id, kind: "direct_message", title: `Neue Nachricht von Lea ${id}`, body: `Hallo ${id}`, meta: { thread_user_id: "u-lea" }, ...extra,
});

test("zwei Meldungen in drei Sekunden werden eine Zeile „2 neue Benachrichtigungen“", () => {
  const first = mergePopup(null, message("1"), 1000);
  expect(popupTitle(first)).toBe("Neue Nachricht von Lea 1");
  expect(popupBody(first)).toBe("Hallo 1");

  const second = mergePopup(first, message("2"), 2500);
  expect(second.items.map((item) => item.id)).toEqual(["2", "1"]);
  expect(second.shownAt).toBe(1000);
  expect(popupTitle(second)).toBe("2 neue Benachrichtigungen");
  expect(popupBody(second)).toBe("Neue Nachricht von Lea 2");

  const later = mergePopup(second, message("3"), 9000);
  expect(later.items.map((item) => item.id)).toEqual(["3"]);
  expect(later.shownAt).toBe(9000);
});

test("dieselbe Meldung zweimal zählt einmal", () => {
  const state = mergePopup(mergePopup(null, message("1"), 1000), message("1", { body: "nochmal" }), 1500);
  expect(state.items).toHaveLength(1);
  expect(state.items[0].body).toBe("nochmal");
});

test("im offenen Chat mit derselben Person kein Banner, in anderen Chats schon", () => {
  expect(suppressedByOpenChat(message("1"), { name: "DirectThread", params: { userId: "u-lea" } })).toBe(true);
  expect(suppressedByOpenChat(message("1"), { name: "DirectThread", params: { userId: "u-max" } })).toBe(false);
  expect(suppressedByOpenChat(message("1"), { name: "Dashboard" })).toBe(false);
  expect(suppressedByOpenChat(message("1"), null)).toBe(false);
  const teamChat = message("t", { kind: "team_chat_message", meta: { team_id: "team-1" } });
  expect(suppressedByOpenChat(teamChat, { name: "TeamChat", params: { id: "team-1" } })).toBe(true);
  expect(suppressedByOpenChat(teamChat, { name: "TeamChat", params: { id: "team-2" } })).toBe(false);
  const tournamentChat = message("x", { kind: "tournament_chat_message", meta: { tournament_id: "tour-1" } });
  expect(suppressedByOpenChat(tournamentChat, { name: "TournamentChat", params: { id: "tour-1" } })).toBe(true);
});
