import { describe, expect, it } from "vitest";
import {
  STATION_DEVICE_OPTIONS,
  gameMatchDataPayload,
  gameMatchDataToForm,
  gamePresets,
  parsePointsTable,
} from "./gameMatchData";
import { durationSourceText } from "./matchDuration";

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
