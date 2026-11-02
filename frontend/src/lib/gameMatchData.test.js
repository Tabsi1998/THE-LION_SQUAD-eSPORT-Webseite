import { describe, expect, it } from "vitest";
import {
  STATION_DEVICE_OPTIONS,
  gameMatchDataPayload,
  gameMatchDataToForm,
  gamePresets,
  gameSavedText,
  modeKey,
  modeRemovalQuestion,
  parsePointsTable,
  removedModes,
} from "./gameMatchData";
import { durationSourceText } from "./matchDuration";

// Modus entfernen (#2129, SP2): erkennt, was wirklich verschwindet, und fragt mit Zahlen.
describe("Modus entfernen", () => {
  const BEFORE = [{ mode: "stellung", label: "Hardpoint" }, { mode: "snd", label: "Suchen & Zerstören" }];

  it("rechnet die Kennung wie der Server", () => {
    expect(modeKey("Grand Prix (4 Rennen)")).toBe("grand_prix_4_rennen");
    expect(modeKey("Suchen & Zerstören")).toBe("suchen_zerstoren");
  });

  it("erkennt nur, was wirklich verschwindet", () => {
    const kept = { match_modes: [{ mode: "stellung", label: "Neuer Name" }, { mode: "snd", label: "Suchen" }] };
    expect(removedModes(BEFORE, kept)).toEqual([]);
    expect(removedModes(BEFORE, { match_modes: [{ mode: "snd", label: "Suchen" }] }).map((mode) => mode.mode)).toEqual(["stellung"]);
    expect(removedModes(BEFORE, { match_modes: [] })).toHaveLength(2);
    // Zeile gelöscht und unter demselben Namen neu angelegt: gleiche Kennung, nichts entfernt.
    expect(removedModes([{ mode: "snd", label: "Suchen" }], { match_modes: [{ label: "SND" }] })).toEqual([]);
    expect(removedModes(undefined, { match_modes: [{ label: "Neu" }] })).toEqual([]);
  });

  it("fragt mit der Zahl der Maps und sagt, was bleibt", () => {
    const usage = { modes: { stellung: { maps: 12, pools: 2, seasons: 1 } } };
    const question = modeRemovalQuestion([BEFORE[0]], usage);
    expect(question.title).toBe("Modus „Hardpoint“ entfernen?");
    expect(question.description).toContain("12 Maps verlieren diesen Modus");
    expect(question.description).toContain("2 gespeicherte Map-Pools und 1 Season nutzen ihn weiter");
    expect(modeRemovalQuestion([BEFORE[0]], { modes: { stellung: { maps: 1, pools: 0, seasons: 0 } } }).description).toContain("1 Map verliert diesen Modus und steht");
    expect(modeRemovalQuestion(BEFORE, { modes: { stellung: { maps: 1 }, snd: { maps: 2 } } }).title).toBe("2 Modi entfernen?");
  });

  it("ohne Betroffene keine Frage, ohne Zählung trotzdem eine", () => {
    expect(modeRemovalQuestion([BEFORE[0]], { modes: { stellung: { maps: 0, pools: 0, seasons: 0 } } })).toBeNull();
    expect(modeRemovalQuestion([], { modes: {} })).toBeNull();
    expect(modeRemovalQuestion([BEFORE[0]], null).description).toContain("Die Maps verlieren diesen Modus");
  });

  it("die Meldung nach dem Speichern nennt Bereinigte und Maps ohne Modus", () => {
    expect(gameSavedText({})).toBe("Spiel gespeichert.");
    expect(gameSavedText({ maps_cleaned: 2, maps_without_mode: 1 })).toBe("Spiel gespeichert. Modus aus 2 Maps entfernt. 1 Map hat noch keinen Modus – ordne sie unter Maps zu.");
  });
});

// Spiel-Daten (#1554): Formular ↔ API und die Vorbelegung im Turnierformular.

const MK8 = {
  id: "mk8",
  match_modes: [
    { mode: "gp4", label: "Grand Prix 4 Rennen", minutes: 12, per_game: false },
    { mode: "race", label: "Einzelrennen", minutes: 4, per_game: true },
  ],
  players_per_run_local: 4,
  players_per_run_online: 12,
  station_devices: ["switch"],
  setup_minutes: 3,
  points_table: [15, 12, 10, 9],
  default_best_of: 3,
};

describe("Punktetabelle", () => {
  it.each([
    ["15, 12, 10, 9", [15, 12, 10, 9]],
    ["4-3-2-1", [4, 3, 2, 1]],
    ["15 12 10;9", [15, 12, 10, 9]],
    ["", []],
    ["   ", []],
  ])("liest „%s“", (text, points) => {
    expect(parsePointsTable(text)).toEqual({ points, error: "" });
  });

  it("sagt, was nicht passt", () => {
    expect(parsePointsTable("15, zwölf").error).toMatch(/zwölf/);
    expect(parsePointsTable("15, 1001").error).toMatch(/0 bis 1000/);
    expect(parsePointsTable(Array.from({ length: 65 }, () => "1").join(",")).error).toMatch(/64/);
  });
});

describe("Formular ↔ API", () => {
  it("ein altes Spiel ohne Spiel-Daten ergibt ein leeres Formular", () => {
    expect(gameMatchDataToForm({ name: "Alt" })).toEqual({
      match_modes: [], players_per_run_local: "", players_per_run_online: "", station_devices: [],
      setup_minutes: "", points_table: "", default_best_of: "",
    });
  });

  it("hin und zurück bleibt alles gleich", () => {
    const form = gameMatchDataToForm(MK8);
    expect(form.points_table).toBe("15, 12, 10, 9");
    expect(form.match_modes[1]).toEqual({ mode: "race", label: "Einzelrennen", minutes: "4", per_game: true });
    expect(gameMatchDataPayload(form)).toEqual({
      match_modes: MK8.match_modes,
      players_per_run_local: 4, players_per_run_online: 12, station_devices: ["switch"],
      setup_minutes: 3, points_table: [15, 12, 10, 9], default_best_of: 3,
    });
  });

  it("leere Felder heißen „keine Vorgabe“, leere Modus-Zeilen fallen weg", () => {
    const payload = gameMatchDataPayload({
      ...gameMatchDataToForm({}),
      match_modes: [{ mode: "", label: "  ", minutes: "", per_game: false }, { mode: "", label: "Bo3", minutes: "8", per_game: true }],
    });
    expect(payload.match_modes).toEqual([{ label: "Bo3", minutes: 8, per_game: true }]);
    expect(payload.players_per_run_local).toBeNull();
    expect(payload.setup_minutes).toBeNull();
    expect(payload.default_best_of).toBeNull();
    expect(payload.points_table).toEqual([]);
  });

  it("Geräte passen zu den Stationen", () => {
    expect(STATION_DEVICE_OPTIONS.map(([value]) => value)).toEqual(expect.arrayContaining(["switch", "switch2", "pc", "ps5", "xbox"]));
  });
});

describe("Vorbelegung im Turnierformular", () => {
  it("Dauer, Best-of und Laufgröße vom Spiel", () => {
    expect(gamePresets(MK8, { event_mode: "local" })).toEqual({ duration: { minutes: 15, source: "game", mode: MK8.match_modes[0] }, bestOf: 3, runSize: 4 });
    expect(gamePresets(MK8, { event_mode: "online" }).runSize).toBe(12);
    expect(gamePresets(MK8, { event_mode: "online", game_mode: "race", best_of: 3 }).duration.minutes).toBe(13);
  });

  it("ohne Spiel-Daten nichts", () => {
    expect(gamePresets({}, {})).toEqual({ duration: null, bestOf: null, runSize: null });
    expect(gamePresets(null, {})).toEqual({ duration: null, bestOf: null, runSize: null });
  });

  it("Text für „vom Spiel: 12 Min.“", () => {
    expect(durationSourceText({ minutes: 12, source: "game", mode: { label: "Grand Prix 4 Rennen" } })).toBe("vom Spiel: 12 Min. (Grand Prix 4 Rennen)");
    expect(durationSourceText({ minutes: 45, source: "tournament", mode: null })).toBe("vom Turnier: 45 Min.");
    expect(durationSourceText({ minutes: 20, source: "stage", mode: null })).toBe("von der Phase: 20 Min.");
    expect(durationSourceText({ minutes: 30, source: "default", mode: null })).toBe("Standard: 30 Min.");
  });
});

describe("Prüfung vor dem Speichern", () => {
  it("nennt, was fehlt", async () => {
    const { gameMatchDataProblem } = await import("./gameMatchData");
    const base = gameMatchDataToForm({});
    expect(gameMatchDataProblem(base)).toBe("");
    // Minuten sind freiwillig (#1616): ein Modus nur für Maps hat keine Dauer.
    expect(gameMatchDataProblem({ ...base, match_modes: [{ mode: "", label: "Grand Prix", minutes: "", per_game: false }] })).toBe("");
    expect(gameMatchDataProblem({ ...base, match_modes: [{ mode: "", label: "", minutes: "12", per_game: false }] })).toBe("Modus 1: bitte einen Namen eintragen.");
    expect(gameMatchDataProblem({ ...base, match_modes: [{ mode: "", label: "A", minutes: "601", per_game: false }] })).toBe("Modus „A“: Minuten von 1 bis 600 – oder leer lassen.");
    expect(gameMatchDataProblem({ ...base, match_modes: [{ mode: "", label: "A", minutes: "0", per_game: false }] })).toBe("Modus „A“: Minuten von 1 bis 600 – oder leer lassen.");
    expect(gameMatchDataProblem({ ...base, points_table: "1, x" })).toBe("Punktetabelle: „x“ ist keine ganze Zahl.");
  });
});

describe("Gerätenamen", () => {
  it("PS5 und Xbox heißen wie bei den Stationen", async () => {
    const { formatDeviceType } = await import("./tournamentLabels");
    expect(formatDeviceType("ps5")).toBe("PS5");
    expect(formatDeviceType("xbox")).toBe("Xbox");
  });
});
