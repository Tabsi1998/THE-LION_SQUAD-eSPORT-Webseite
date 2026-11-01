import { banState, effectiveAreas, invitationText, rightsChange, rightsHistoryLine } from "./userRights";

// Alle Benutzer (#1357): die Rückfrage sagt in einem Satz, was eine Person bekommt oder verliert.

test("Rechte-Verlauf in Worten (#2125)", () => {
  expect(rightsHistoryLine({ action: "user.role_change", from: "player", to: "moderator" })).toBe("Rolle: Spieler → Moderator");
  expect(rightsHistoryLine({ action: "user.role_change", to: "moderator" })).toBe("Rolle: Moderator");
  expect(rightsHistoryLine({ action: "user.areas_change", from: [], to: ["club", "content"] })).toBe("Freigaben: keine → Vereinsverwaltung, Redaktion");
  expect(rightsHistoryLine({ action: "board.assign", joined: true, title: "Kassier:in", field: "holder" })).toBe("Vorstand: wird Kassier:in");
  expect(rightsHistoryLine({ action: "board.assign", joined: false, title: "Kassier:in", field: "deputy" })).toBe("Vorstand: nicht mehr Vertretung für Kassier:in");
  expect(rightsHistoryLine({ action: "board.status", title: "Kassier:in", active: false })).toBe("Vorstand: Posten Kassier:in ist inaktiv");
  expect(rightsHistoryLine({ action: "board.delete", title: "Beirat" })).toBe("Vorstand: Posten Beirat gelöscht");
  expect(rightsHistoryLine({ action: "neu" })).toBe("Rechte geändert");
});

test("Bereiche aus Rolle und Freigaben in fester Reihenfolge", () => {
  expect(effectiveAreas("player", ["club", "content"])).toEqual(["content", "club"]);
  expect(effectiveAreas("tournament_admin", ["finance"])).toEqual(["tournaments", "finance", "moderation"]);
  expect(effectiveAreas("player", ["system"])).toEqual([]);
});

test("eine Freigabe nennt, worauf die Person Zugriff bekommt", () => {
  const change = rightsChange({ name: "Erika Beispiel", fromRole: "player", toRole: "player", fromGrants: [], toGrants: ["club"] });
  expect(change.changed).toBe(true);
  expect(change.grantsChanged).toBe(true);
  expect(change.roleChanged).toBe(false);
  expect(change.risky).toBe(true);
  expect(change.sentence).toBe("Erika Beispiel bekommt damit Zugriff auf Vereinsverwaltung (Mitgliederdaten, Anträge, Dokumente und Benutzer).");
});

test("Superadmin bekommt einen eigenen, deutlichen Satz", () => {
  const change = rightsChange({ name: "Max Muster", fromRole: "club_admin", toRole: "superadmin" });
  expect(change.sentence).toContain("Max Muster wird Superadmin und bekommt damit Zugriff auf alles");
  expect(change.risky).toBe(true);
});

test("Rolle zurück auf Spieler: was verloren geht, steht da", () => {
  const change = rightsChange({ name: "Pia Pokal", fromRole: "tournament_admin", toRole: "player" });
  expect(change.sentence).toBe("Pia Pokal bekommt die Rolle „Spieler“. Pia Pokal verliert damit den Zugriff auf Turnierleitung (Turniere, Events, Stationen, Fast Lap, Jahreswertung und Gewinne) und Moderation (Meldungen, Wortfilter und Verwarnungen).");
  expect(change.risky).toBe(false);
});

test("ohne Änderung keine Rückfrage", () => {
  expect(rightsChange({ name: "Leo", fromRole: "player", toRole: "player", fromGrants: ["club"], toGrants: ["club"] }).changed).toBe(false);
});

test("Einladung zum Mitgliedsantrag: der Stand als Satz", () => {
  const day = (value) => value.slice(8, 10) + "." + value.slice(5, 7) + "." + value.slice(0, 4);
  expect(invitationText({ status: "open", created_at: "2026-10-01T10:00:00+00:00" }, day)).toBe("Zum Mitgliedsantrag eingeladen am 01.10.2026 – noch offen.");
  expect(invitationText({ status: "applied", applied_at: "2026-10-03T10:00:00+00:00" }, day)).toBe("Antrag gestellt am 03.10.2026.");
  expect(invitationText(null, day)).toBe("");
});

test("Sperren: eigenes Konto, Superadmin-Konten und Admin-Konten ohne Superadmin sind gesperrt - mit Grund", () => {
  const me = { id: "me" };
  expect(banState({ target: { id: "me" }, me, isSuperAdmin: true }).text).toBe("Das eigene Konto lässt sich nicht sperren.");
  expect(banState({ target: { id: "x", role: "superadmin", ban_protected: true }, me, isSuperAdmin: true }).text).toBe("Superadmin-Konten lassen sich nicht bannen – zuerst die Rolle ändern.");
  expect(banState({ target: { id: "x", role: "player", ban_protected: true }, me, isSuperAdmin: false }).text).toBe("Konto mit Adminbereich – sperren kann nur der Superadmin.");
  expect(banState({ target: { id: "x", role: "player", ban_protected: true }, me, isSuperAdmin: true }).canAct).toBe(true);
  expect(banState({ target: { id: "x", role: "player", ban_protected: false }, me, isSuperAdmin: false }).canAct).toBe(true);
});
