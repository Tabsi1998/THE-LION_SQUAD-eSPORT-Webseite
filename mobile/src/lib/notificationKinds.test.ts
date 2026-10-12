import { notificationKindLabel } from "./notificationKinds";
import { upperDe } from "./format";

// Geräteprüfung vor 1.4.0 (#1296): die Glocke zeigt Arten in Worten statt Rohwerten, Großbuchstaben stehen im Text
// selbst.

test("Arten in Worten - bekannt, über das Thema, über den Anfang, nie roh", () => {
  expect(notificationKindLabel("tournament_update")).toBe("Turnier geändert");
  expect(notificationKindLabel("TOURNAMENT_UPDATE")).toBe("Turnier geändert");
  expect(notificationKindLabel("level")).toBe("Level");
  expect(notificationKindLabel("team_chat_mention")).toBe("Erwähnung");
  expect(notificationKindLabel("helper_call")).toBe("Helfer gesucht");
  expect(notificationKindLabel("brand_new_thing", { category: "prize_updates" })).toBe("Gewinn");
  expect(notificationKindLabel("tournament_seeding_done")).toBe("Turnier");
  expect(notificationKindLabel("something_else")).toBe("Hinweis");
  expect(notificationKindLabel(null)).toBe("Hinweis");
});

test("Großbuchstaben im Text selbst, deutsch", () => {
  expect(upperDe("Anmeldung offen")).toBe("ANMELDUNG OFFEN");
  expect(upperDe("Straße")).toBe("STRASSE");
  expect(upperDe(null)).toBe("");
});
