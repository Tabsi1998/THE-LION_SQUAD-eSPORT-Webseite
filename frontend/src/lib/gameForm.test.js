import {
  GAME_TABS, gamePageUrl, generalPayload, generalToForm, idsPayload, idsToForm, newGamePayload, sameForm, tabFromHash,
} from "./gameForm";
import { gameMatchDataPayload, gameMatchDataToForm } from "./gameMatchData";

// Spielseite (#2249): Reiter per Adresse, und je Reiter genau seine Felder - kein Reiter überschreibt, was ein anderer pflegt.

test("Reiter per Adresse: #allgemein, #ids, #modi, #maps; Unbekanntes und leer heißen Allgemein", () => {
  expect(GAME_TABS.map((tab) => tab.key)).toEqual(["allgemein", "ids", "modi", "maps"]);
  expect(tabFromHash("#modi")).toBe("modi");
  expect(tabFromHash("#MAPS")).toBe("maps");
  expect(tabFromHash("#ids")).toBe("ids");
  expect(tabFromHash("")).toBe("allgemein");
  expect(tabFromHash("#gibts-nicht")).toBe("allgemein");
  expect(tabFromHash(undefined)).toBe("allgemein");
});

test("Adresse der Spielseite: Allgemein ohne Sprungmarke, sonst mit", () => {
  expect(gamePageUrl("g1")).toBe("/admin/games/g1");
  expect(gamePageUrl("g1", "allgemein")).toBe("/admin/games/g1");
  expect(gamePageUrl("g1", "maps")).toBe("/admin/games/g1#maps");
  expect(gamePageUrl("g 1", "modi")).toBe("/admin/games/g%201#modi");
});

const EDITION = {
  id: "g2", name: "Black Ops 7", slug: "black-ops-7", kind: "edition", parent_game_id: "g1", identity_source_game_id: "g0",
  inherit_player_ids: false, short_name: "BO7", logo_url: "/l.png", cover_url: "", discord_guild_id: "9", discord_role_name: "Alt",
  player_id_fields: [{ key: "activision_id", label: "Activision ID", required: true, pattern: "[^#]+#\\d+" }],
  match_modes: [{ mode: "snd", label: "Suchen" }],
};

test("Allgemein schickt nur Name, Art, Bilder und Discord - keine IDs, keine Modi", () => {
  const body = generalPayload({ ...generalToForm(EDITION), name: "  Black Ops 7  " });
  expect(body).toEqual({
    name: "Black Ops 7", slug: "black-ops-7", kind: "edition", parent_game_id: "g1", short_name: "BO7", logo_url: "/l.png",
    cover_url: "", discord_guild_id: "9", discord_role_name: null,
  });
  expect(body).not.toHaveProperty("match_modes");
  expect(body).not.toHaveProperty("player_id_fields");
});

test("Allgemein: keine Spielversion mehr - Hauptspiel und ID-Quelle fallen weg, Discord-Rolle gilt, leer heißt Vorgabe", () => {
  const body = generalPayload({ ...generalToForm(EDITION), kind: "standalone", discord_role_name: "  Crew " });
  expect(body).toMatchObject({ kind: "standalone", parent_game_id: null, identity_source_game_id: null, discord_role_name: "Crew" });
  expect(generalPayload({ ...generalToForm(EDITION), kind: "series", discord_role_name: "" }).discord_role_name).toBeNull();
  expect(generalPayload({ ...generalToForm(EDITION), discord_guild_id: "" }).discord_guild_id).toBeNull();
  expect(generalPayload({ ...generalToForm(EDITION), slug: "Neue Adresse!" }).slug).toBe("neue-adresse");
});

test("Spiel-IDs schicken nur die ID-Felder, bei Spielversionen dazu ID-Quelle und Erben", () => {
  const form = idsToForm(EDITION);
  expect(idsPayload(form, "edition")).toEqual({
    player_id_fields: [{ key: "activision_id", label: "Activision ID", help_text: "", required: true, pattern: "[^#]+#\\d+" }],
    identity_source_game_id: "g0", inherit_player_ids: false,
  });
  expect(idsPayload({ ...form, identity_source_game_id: "" }, "edition").identity_source_game_id).toBeNull();
  expect(idsPayload(form, "standalone")).toEqual({ player_id_fields: expect.any(Array) });
  // Ein Feld ohne Bezeichnung fällt weg, der Schlüssel entsteht aus der Bezeichnung, Auswahl wird zur Liste.
  const fields = idsPayload({ player_id_fields: [{ label: "Plattform", options: "PC, PS5 ,, Xbox" }, { label: "", key: "" }] }, "standalone").player_id_fields;
  expect(fields).toEqual([{ key: "plattform", label: "Plattform", help_text: "", required: true, options: ["PC", "PS5", "Xbox"] }]);
});

// Codex-Prüfung #2249, Fund 1: An einem gespeicherten Schlüssel hängen die IDs der Spieler (users.game_ids.<spiel>.<schlüssel>).
// Ein Schlüssel aus der Zeit vor der Verwaltung („PSN-ID“, „RiotID“, nichtlateinisch) darf beim Speichern nie umgeschrieben werden.
test("gespeicherte Schlüssel bleiben genau so, wie sie sind - auch nicht kanonische", () => {
  const saved = idsToForm({ player_id_fields: [
    { key: "PSN-ID", label: "PSN-ID", required: true },
    { key: "RiotID", label: "Riot ID" },
    { key: "ゲームID", label: "ゲームID", required: false },
  ] });
  const renamed = { ...saved, player_id_fields: saved.player_id_fields.map((field, index) => (index === 1 ? { ...field, label: "Riot-Konto" } : field)) };
  expect(idsPayload(renamed, "standalone").player_id_fields.map((field) => field.key)).toEqual(["PSN-ID", "RiotID", "ゲームID"]);
  // Ein neues Feld bekommt seinen Schlüssel aus der Bezeichnung.
  const added = { player_id_fields: [...saved.player_id_fields, { key: "", label: "Epic Konto", _new: true }] };
  expect(idsPayload(added, "standalone").player_id_fields.map((field) => field.key)).toEqual(["PSN-ID", "RiotID", "ゲームID", "epic_konto"]);
});

// Codex-Prüfung #2249, Fund 2: Speichern ersetzt die ganze Liste - was die Verwaltung an einem Feld nicht kennt, bleibt dran.
test("unbekannte Angaben an einem ID-Feld bleiben erhalten, nur Hilfsfelder der Oberfläche fallen weg", () => {
  const form = idsToForm({ player_id_fields: [
    { key: "probe", label: "Probe", required: true, pattern: "x+", source: "import", extra: { stufe: 2 } },
  ] });
  const changed = { player_id_fields: [{ ...form.player_id_fields[0], pattern: "", _keyTouched: true }, { key: "neu", label: "Neu", _new: true }] };
  const [kept, added] = idsPayload(changed, "standalone").player_id_fields;
  expect(kept).toEqual({ key: "probe", label: "Probe", help_text: "", required: true, source: "import", extra: { stufe: 2 } });
  expect(added).toEqual({ key: "neu", label: "Neu", help_text: "", required: true });
});

// Dasselbe Muster bei den Modi: Hin und zurück durch das Formular geht kein Feld verloren, das der Server speichert.
test("Modi: der Weg durchs Formular verliert kein gespeichertes Feld", () => {
  const modes = [
    { mode: "snd", label: "Suchen", minutes: 12, per_game: true, status: "inactive", description: "Bombe legen", players_per_side: 4, format: "Standard",
      result_rule: { kind: "rounds", target: 6, round_limit: 11, time_limit_minutes: 2, draw_allowed: true, overtime: true } },
    { mode: "zonen", label: "Zonen", minutes: null, per_game: false },
  ];
  expect(gameMatchDataPayload(gameMatchDataToForm({ match_modes: modes })).match_modes).toEqual(modes);
});

test("Neues Spiel: Name und Art genügen, die Adresse entsteht aus dem Namen", () => {
  expect(newGamePayload({ name: " Straßen Rennen ", kind: "standalone", parent_game_id: "g1" }))
    .toEqual({ name: "Straßen Rennen", slug: "strassen-rennen", kind: "standalone", parent_game_id: null });
  expect(newGamePayload({ name: "BO7", kind: "edition", parent_game_id: "g1" })).toMatchObject({ kind: "edition", parent_game_id: "g1" });
});

test("ungespeichert heißt: anders als der gespeicherte Stand", () => {
  const base = generalToForm(EDITION);
  expect(sameForm(base, generalToForm(EDITION))).toBe(true);
  expect(sameForm({ ...base, name: "Neu" }, base)).toBe(false);
});
