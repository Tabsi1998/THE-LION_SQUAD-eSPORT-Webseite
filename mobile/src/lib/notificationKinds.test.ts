import { isQuietDigest, notificationKindLabel } from "./notificationKinds";
import { upperDe } from "./format";

// Geräteprüfung vor 1.4.0 (#1296): die Glocke zeigt Arten in Worten statt Rohwerten, Großbuchstaben stehen im Text
// selbst.

test("Arten in Worten - bekannt, über das Thema, über den Anfang, nie roh", () => {
  expect(notificationKindLabel("tournament_update")).toBe("Turnier geändert");
  expect(notificationKindLabel("TOURNAMENT_UPDATE")).toBe("Turnier geändert");
  expect(notificationKindLabel("level")).toBe("Level");
  expect(notificationKindLabel("team_chat_mention")).toBe("Erwähnung");
  expect(notificationKindLabel("helper_call")).toBe("Helfer gesucht");
  expect(notificationKindLabel("gallery_event")).toBe("Fotos");
  expect(notificationKindLabel("gallery_submission")).toBe("Eingesandte Fotos");
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

test("Liga-Spieltag und Belohnungen haben eigene Wörter (#2173)", () => {
  expect(notificationKindLabel("match_call")).toBe("Aufruf");
  expect(notificationKindLabel("match_schedule")).toBe("Termin");
  expect(notificationKindLabel("league_reward")).toBe("Belohnung");
  expect(notificationKindLabel("league_broadcast")).toBe("Liga-Leitung");
  expect(notificationKindLabel("league_irgendwas")).toBe("Liga");
});

test("Hinweis der Turnierleitung heißt wie im Web (#1166, #2393)", () => {
  expect(notificationKindLabel("tournament_notice")).toBe("Hinweis der Turnierleitung");
  expect(notificationKindLabel("tournament_notice", { category: "tournament_updates" })).toBe("Hinweis der Turnierleitung");
});

test("Sammelmeldung nach der Ruhezeit (#2444): eigenes Wort und erkannt", () => {
  expect(notificationKindLabel("quiet_digest")).toBe("Ruhezeit");
  expect(isQuietDigest({ kind: "quiet_digest" })).toBe(true);
  expect(isQuietDigest({ kind: "QUIET_DIGEST" })).toBe(true);
  expect(isQuietDigest({ kind: "direct_message" })).toBe(false);
  expect(isQuietDigest(null)).toBe(false);
});
