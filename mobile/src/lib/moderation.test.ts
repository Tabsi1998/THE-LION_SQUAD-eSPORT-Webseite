import { detailsValid, reportPayload, senderOf } from "./moderation";

// Melden in der App (#414): der Aufruf entspricht dem der Website; im Gruppenchat darf keine
// message_id mitgehen, weil der Server nur Direktnachrichten dem Gespräch zuordnet.

jest.mock("./api", () => ({ api: { post: jest.fn(), delete: jest.fn(), get: jest.fn() } }));

test("Beschreibung braucht fünf Zeichen; Direktnachricht geht als message_id mit", () => {
  expect(detailsValid("kurz")).toBe(false);
  expect(detailsValid("  beleidigt mich  ")).toBe(true);
  expect(reportPayload({ targetUserId: "u-2", category: "harassment", details: " beleidigt mich ", direct: true, message: { id: "m-1", message: "…", sender_id: "u-2" } }))
    .toEqual({ target_user_id: "u-2", category: "harassment", details: "beleidigt mich", message_id: "m-1" });
  expect(reportPayload({ targetUserId: "u-2", category: "other", details: "Profilbild" }))
    .toEqual({ target_user_id: "u-2", category: "other", details: "Profilbild", message_id: null });
});

test("im Gruppenchat wandert der Nachrichtentext in die Beschreibung, keine message_id", () => {
  const payload = reportPayload({ targetUserId: "u-2", category: "spam", details: "Werbung im Teamchat", message: { id: "g-7", message: "Kauft hier!", user_id: "u-2" } });
  expect(payload.message_id).toBeNull();
  expect(payload.details).toBe("Werbung im Teamchat\n\nGemeldete Nachricht (g-7): „Kauft hier!“");
});

test("Absender: Direktnachricht sender_id, Chat user_id, Name aus author oder sender", () => {
  expect(senderOf({ id: "m", message: "", sender_id: "u-2", sender: { id: "u-2", display_name: "Max" } })).toEqual({ id: "u-2", name: "Max" });
  expect(senderOf({ id: "g", message: "", user_id: "u-3", author: { id: "u-3", username: "moe" } })).toEqual({ id: "u-3", name: "moe" });
  expect(senderOf({ id: "x", message: "" })).toBeNull();
});
