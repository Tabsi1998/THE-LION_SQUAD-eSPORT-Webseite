import { chatHref, chatPreview, chatTime, normalizeChatList } from "./chats";

// Die Liste der Chats (#1148): Zeit wie in der Vorschau (heute die Uhrzeit, „gestern“, sonst der Tag - in Wien), die
// Vorschauzeile und wohin ein Eintrag führt.

vi.mock("@/lib/api", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const NOW = new Date("2026-10-07T12:30:00Z");

test("heute die Uhrzeit, gestern „gestern“, sonst der Tag - gezählt in Wien", () => {
  expect(chatTime("2026-10-07T12:02:00Z", NOW)).toBe("14:02");
  expect(chatTime("2026-10-06T19:00:00Z", NOW)).toBe("gestern");
  // 23:30 in Wien am 5.10. ist schon der 5. - nicht der 6. wie in UTC gerechnet.
  expect(chatTime("2026-10-05T21:30:00Z", NOW)).toBe("05.10.");
  expect(chatTime("", NOW)).toBe("");
});

test("Vorschau und Ziel je Art; die Summe der Ungelesenen", () => {
  expect(chatPreview({ kind: "team", subtitle: "Team-Chat", last_message: { text: "Training", author: "LunaByte" } })).toBe("Team-Chat · LunaByte: Training");
  expect(chatPreview({ kind: "direct", subtitle: "Nachricht", last_message: { text: "gg", author: "Kiwi" } })).toBe("Nachricht: gg");
  expect(chatPreview({ kind: "team", subtitle: "Team-Chat" })).toBe("Team-Chat · Noch keine Nachricht");
  expect(chatHref({ kind: "direct", target_id: "u-2" })).toBe("/messages/u-2");
  expect(chatHref({ kind: "tournament", target_id: "t", slug: "fc-26-cup" })).toBe("/tournaments/fc-26-cup#chat");
  expect(normalizeChatList({ items: [{ key: "a", kind: "team", unread_count: 2 }, { key: "b", kind: "direct", unread_count: 1 }, null] }).unread_total).toBe(3);
});
