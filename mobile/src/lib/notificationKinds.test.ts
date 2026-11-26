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

test("Onyx erreicht heißt Krone wie die anderen Kronen-Meldungen (#2506)", () => {
  expect(notificationKindLabel("crown_onyx")).toBe("Krone");
  // Der Server schickt die Art mit dem Thema achievements - das Thema darf das Wort nicht überstimmen.
  expect(notificationKindLabel("crown_onyx", { category: "achievements" })).toBe("Krone");
  expect(notificationKindLabel("crown_gained", { category: "achievements" })).toBe("Krone");
});

// Nachzug aus #2125, #2127, #2128 (#2173): Team, Rechte, Mitgliedschaft und Event-Anmeldung haben eigene Wörter statt
// des Anfangs („Team“, „Event“) bzw. „Hinweis“.
test("Team, Rechte, Mitgliedschaft und Event-Anmeldung haben eigene Wörter (#2173)", () => {
  expect(notificationKindLabel("team_invite_declined")).toBe("Einladung abgelehnt");
  expect(notificationKindLabel("team_member_removed")).toBe("Aus dem Team entfernt");
  expect(notificationKindLabel("team_member_left")).toBe("Team verlassen");
  expect(notificationKindLabel("team_dissolved")).toBe("Team aufgelöst");
  expect(notificationKindLabel("team_restored")).toBe("Team wiederhergestellt");
  expect(notificationKindLabel("team_join_code_renewed")).toBe("Neuer Beitrittscode");
  expect(notificationKindLabel("rights_change")).toBe("Rechte geändert");
  expect(notificationKindLabel("membership_decision")).toBe("Mitgliedschaft entschieden");
  expect(notificationKindLabel("event_registration")).toBe("Event-Anmeldung");
});

// News-Kanal (#1532, Nachtrag in #2542): „Nur App“-News haben ein eigenes Wort statt des Themas.
test("news_app heißt „News“", () => {
  expect(notificationKindLabel("news_app")).toBe("News");
});
