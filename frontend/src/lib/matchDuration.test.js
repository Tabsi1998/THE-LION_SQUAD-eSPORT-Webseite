import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATCH_DURATION_MINUTES,
  effectiveMatchDuration,
  expectedGames,
  gameDuration,
  gameMode,
  durationSourceText,
  matchDurationSource,
} from "./matchDuration";

// Dieselbe Kette wie backend/services/match_duration.py (#1552, #1554):
// Spiel → Spiel.settings → Phase → Turnier → Game (Modus) → 30.

const MK8 = {
  match_modes: [
    { mode: "gp4", label: "Grand Prix 4 Rennen", minutes: 12 },
    { mode: "race", label: "Einzelrennen", minutes: 4, per_game: true },
  ],
};

describe("effectiveMatchDuration", () => {
  it("ohne Werte gilt 30", () => {
    expect(DEFAULT_MATCH_DURATION_MINUTES).toBe(30);
    expect(effectiveMatchDuration()).toBe(30);
    expect(effectiveMatchDuration({}, {})).toBe(30);
  });

  it("jede Ebene schlägt die darunter", () => {
    const stage = { settings: { duration_minutes: 20 } };
    const tournament = { match_duration_minutes: 45 };
    expect(effectiveMatchDuration({}, { tournament, game: MK8 })).toBe(45);
    expect(effectiveMatchDuration({}, { stage, tournament, game: MK8 })).toBe(20);
    expect(effectiveMatchDuration({ settings: { duration_minutes: 25 } }, { stage, tournament })).toBe(25);
    expect(effectiveMatchDuration({ duration_minutes: 15, settings: { duration_minutes: 25 } }, { stage, tournament })).toBe(15);
  });

  it("das Game kommt nach dem Turnier und vor 30", () => {
    expect(effectiveMatchDuration({}, { tournament: {}, game: MK8 })).toBe(12);
    expect(effectiveMatchDuration({}, { game: { match_modes: [] } })).toBe(30);
  });

  it("Änderungen beim Speichern zählen, leer heißt: die Kette darunter", () => {
    expect(effectiveMatchDuration({ duration_minutes: 15 }, { updates: { duration_minutes: 40 } })).toBe(40);
    expect(effectiveMatchDuration({ duration_minutes: 15 }, { updates: { duration_minutes: "" }, tournament: { match_duration_minutes: 50 } })).toBe(50);
  });

  it.each(["", "abc", 0, -5, null, "0", true])("unbrauchbar (%s) fällt durch", (bad) => {
    expect(effectiveMatchDuration({ duration_minutes: bad }, { tournament: { match_duration_minutes: 35 } })).toBe(35);
  });

  it("liest Zahlen als Text", () => {
    expect(effectiveMatchDuration({ duration_minutes: "12" })).toBe(12);
  });
});

describe("Ebene Game", () => {
  it("Modus: Phase vor Turnier, sonst der erste, Unbekanntes → erster", () => {
    expect(gameMode(MK8).mode).toBe("gp4");
    expect(gameMode(MK8, { tournament: { game_mode: "race" } }).mode).toBe("race");
    expect(gameMode(MK8, { stage: { settings: { game_mode: "gp4" } }, tournament: { game_mode: "race" } }).mode).toBe("gp4");
    expect(gameMode(MK8, { tournament: { game_mode: "weg" } }).mode).toBe("gp4");
    expect(gameMode({})).toBeNull();
  });

  it.each([[1, 1], [3, 2.5], [5, 4], [7, 5.5], [2, 2], [null, 1], [0, 1], ["x", 1]])("Bo%s ≈ %s Spiele", (bestOf, games) => {
    expect(expectedGames(bestOf)).toBe(games);
  });

  it("Dauer je Einzelspiel × erwartete Spiele, aufgerundet", () => {
    expect(effectiveMatchDuration({}, { tournament: { game_mode: "race", best_of: 3 }, game: MK8 })).toBe(10);
    expect(effectiveMatchDuration({}, { tournament: { game_mode: "race", best_of: 5 }, game: MK8 })).toBe(16);
    const five = { match_modes: [{ mode: "m", label: "M", minutes: 5, per_game: true }] };
    expect(effectiveMatchDuration({}, { tournament: { best_of: 3 }, game: five })).toBe(13);
    expect(effectiveMatchDuration({ best_of: 3 }, { tournament: { game_mode: "race", best_of: 1 }, game: MK8 })).toBe(10);
  });

  it("Dauer je Spiel ignoriert Best-of", () => {
    expect(effectiveMatchDuration({}, { tournament: { best_of: 3 }, game: MK8 })).toBe(12);
  });

  it("Aufbauzeit kommt nur zur Dauer aus dem Game dazu", () => {
    const game = { ...MK8, setup_minutes: 3 };
    expect(gameDuration(game)).toBe(15);
    expect(effectiveMatchDuration({}, { tournament: { match_duration_minutes: 20 }, game })).toBe(20);
  });

  it("Kaputtes fällt auf 30", () => {
    expect(gameDuration({ match_modes: "kaputt" })).toBeNull();
    expect(gameDuration({ match_modes: [null] })).toBeNull();
    expect(effectiveMatchDuration({}, { game: { match_modes: [{ mode: "x", minutes: 0 }] } })).toBe(30);
  });

  it("sagt, woher die Dauer kommt - für „vom Spiel: 12 Min.“", () => {
    expect(matchDurationSource({}, { game: MK8 })).toEqual({ minutes: 12, source: "game", mode: MK8.match_modes[0] });
    expect(matchDurationSource({}, { tournament: { match_duration_minutes: 40 } })).toEqual({ minutes: 40, source: "tournament", mode: null });
    expect(matchDurationSource({}, {}).source).toBe("default");
  });
});

// ---------------------------------------------------------------- Wächter

const SRC = path.join(process.cwd(), "src");
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;
const SOURCE_FILE = /\.(jsx?|tsx?)$/;
const COPY = /duration_minutes\s*(\|\||\?\?)/;

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return SOURCE_FILE.test(name) && !TEST_FILE.test(name) ? [full] : [];
  });
}

describe("Puffer je Spiel (#1557)", () => {
  it("kommt auf Game, Phase, Turnier und Vorgabe - wie im Backend", () => {
    const tournament = { match_buffer_minutes: 5 };
    expect(effectiveMatchDuration({}, { tournament })).toBe(35);
    expect(effectiveMatchDuration({}, { tournament, game: MK8 })).toBe(17);
    expect(effectiveMatchDuration({}, { tournament: { ...tournament, match_duration_minutes: 20 } })).toBe(25);
    expect(effectiveMatchDuration({}, { tournament, stage: { settings: { duration_minutes: 10 } } })).toBe(15);
  });

  it("eine Dauer am Spiel selbst ist die ganze Dauer, ohne Puffer", () => {
    const tournament = { match_buffer_minutes: 5 };
    expect(effectiveMatchDuration({ duration_minutes: 12 }, { tournament })).toBe(12);
    expect(effectiveMatchDuration({ settings: { duration_minutes: 12 } }, { tournament })).toBe(12);
  });

  it("ohne brauchbaren Puffer kommt nichts dazu", () => {
    for (const bad of [null, "", 0, -3, "x", true]) {
      expect(effectiveMatchDuration({}, { tournament: { match_buffer_minutes: bad }, game: MK8 })).toBe(12);
    }
  });

  it("sagt Herkunft und Puffer getrennt: „vom Spiel: 12 Min. + 8 Min. Puffer“", () => {
    const source = matchDurationSource({}, { tournament: { match_buffer_minutes: 8 }, game: MK8 });
    expect(source).toMatchObject({ minutes: 20, source: "game", buffer: 8 });
    expect(durationSourceText(source)).toBe("vom Spiel: 12 Min. (Grand Prix 4 Rennen) + 8 Min. Puffer");
  });
});

describe("Wächter: eine Dauer-Kette", () => {
  it("keine Datei außer lib/matchDuration.js baut die Kette nach", () => {
    const found = [];
    for (const file of sourceFiles(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (rel === "lib/matchDuration.js") continue;
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        if (COPY.test(line)) found.push(`${rel}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(found, "Dauer-Kette kopiert statt effectiveMatchDuration zu nutzen").toEqual([]);
  });
});

describe("eigener Wert im Formular", async () => {
  const { ownDurationInput, ownDurationPayload } = await import("./matchDuration");
  it("leer heißt erben", () => {
    expect(ownDurationInput(null)).toBe("");
    expect(ownDurationInput(0)).toBe("");
    expect(ownDurationInput(12)).toBe("12");
    expect(ownDurationPayload("")).toBeNull();
    expect(ownDurationPayload("45")).toBe(45);
  });
});
