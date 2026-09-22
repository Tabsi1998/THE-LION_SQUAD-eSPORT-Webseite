import { friendButton, friendLabel, friendRequest, normalizeFriends } from "./friends";

// Freundschaften in der App (#240): Knopf je Zustand, Aufruf je Aktion, Liste ohne Leerzeilen.

test("der Knopf folgt dem Zustand vom Server", () => {
  expect(friendButton(null)).toEqual({ label: "Freund hinzufügen", action: "request" });
  expect(friendButton({ status: "none", can_request: true })).toMatchObject({ action: "request" });
  expect(friendButton({ status: "pending", outgoing: true })).toEqual({ label: "Anfrage gesendet", action: "cancel" });
  expect(friendButton({ id: "f1", status: "pending", incoming: true })).toMatchObject({ action: "accept", secondary: { action: "decline" } });
  expect(friendButton({ status: "accepted" })).toEqual({ label: "Freunde", action: "remove" });
  expect(friendButton({ status: "self" }).action).toBe("none");
  expect(friendButton({ status: "declined", can_request: true }).action).toBe("request");
  expect(friendButton({ status: "blocked", can_request: false }).action).toBe("none");
});

test("jede Aktion hat ihren Aufruf - Annehmen und Ablehnen brauchen die Anfrage", () => {
  expect(friendRequest("request", "u2")).toEqual({ method: "post", path: "/friends/u2/request" });
  expect(friendRequest("accept", "u2", "f1")).toEqual({ method: "post", path: "/friends/f1/accept" });
  expect(friendRequest("decline", "u2", "f1")).toEqual({ method: "post", path: "/friends/f1/decline" });
  expect(friendRequest("accept", "u2")).toBeNull();
  expect(friendRequest("cancel", "u2")).toEqual({ method: "delete", path: "/friends/u2" });
  expect(friendRequest("remove", "u2")).toEqual({ method: "delete", path: "/friends/u2" });
  expect(friendRequest("none", "u2")).toBeNull();
});

test("die Liste lässt Zeilen ohne Nutzer weg und nennt Anzeigename oder Nutzername", () => {
  const rows = normalizeFriends({ friends: [{ id: "f1", status: "accepted", user: { id: "u2", username: "max" } }, { id: "f2", status: "accepted", user: null }], incoming: undefined });
  expect(rows.friends.map((row) => row.id)).toEqual(["f1"]);
  expect(rows.incoming).toEqual([]);
  expect(friendLabel({ id: "u2", username: "max" })).toBe("max");
  expect(friendLabel({ id: "u2", username: "max", display_name: "Max M." })).toBe("Max M.");
  expect(friendLabel(null)).toBe("Spieler");
});
