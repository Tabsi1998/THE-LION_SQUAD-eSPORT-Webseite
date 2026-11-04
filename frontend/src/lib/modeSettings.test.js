import { describe, expect, test } from "vitest";
import {
  durationInput, durationText, entryPayload, entryToForm, moveRow, parseDuration, ruleTimeLimitSeconds, settingPayload, settingProblem,
  settingToForm, settingValueText, settingsDiff, settingsMissing,
} from "./modeSettings";

// Zeiten und Einstellungen je Modus (#2271). Erfundene Werte.

describe("Zeiten", () => {
  test.each([
    ["1:30", 90], ["0:45", 45], ["90 s", 90], ["90s", 90], ["2 min", 120], ["5", 300], ["1,5", 90], ["", null], ["abc", undefined], ["1:75", undefined],
  ])("„%s“ sind %s Sekunden", (input, seconds) => {
    expect(parseDuration(input)).toBe(seconds);
  });

  test("bei Sekunden-Einstellungen ist eine bloße Zahl Sekunden", () => {
    expect(parseDuration("45", "seconds")).toBe(45);
    expect(parseDuration("1:30", "seconds")).toBe(90);
  });

  test("Eingabe und Anzeige", () => {
    expect(durationInput(600)).toBe("10");
    expect(durationInput(90)).toBe("1:30");
    expect(durationInput(45, "seconds")).toBe("45");
    expect(durationInput(90, "seconds")).toBe("1:30");
    expect(durationText(600)).toBe("10 Min.");
    expect(durationText(105)).toBe("1:45 Min.");
  });

  test("Altbestand in Minuten wird gelesen wie Sekunden", () => {
    expect(ruleTimeLimitSeconds({ time_limit_minutes: 10 })).toBe(600);
    expect(ruleTimeLimitSeconds({ time_limit_seconds: 90 })).toBe(90);
    expect(ruleTimeLimitSeconds({})).toBeNull();
  });
});

describe("Einstellungen", () => {
  test("Formular hin und zurück", () => {
    const stored = [
      { key: "uhr", label: "Uhr", value: 45, unit: "seconds", group: "Lobby" },
      { key: "rueck", label: "Rückblende", value: false, unit: "toggle" },
      { key: "grenze", label: "Grenze", value: 2.5, unit: "points" },
      { key: "karte", label: "Karte", value: "klein" },
    ];
    const form = entryToForm({ settings: stored, rules_text: "Regel" });
    expect(form.settings[0].value).toBe("45");
    expect(form.settings[2].value).toBe("2,5");
    expect(entryPayload(form)).toEqual({ settings: stored, rules_text: "Regel" });
  });

  test("1:30 bei Sekunden geht als 90", () => {
    expect(settingPayload({ label: "Uhr", value: "1:30", unit: "seconds" })).toEqual({ label: "Uhr", value: 90, unit: "seconds" });
  });

  test.each([
    [{ label: "", value: "x" }, "braucht eine Bezeichnung"],
    [{ label: "Uhr", value: "bald", unit: "seconds" }, "Minuten:Sekunden"],
    [{ label: "Grenze", value: "viel", unit: "points" }, "eine Zahl"],
    [{ label: "Text", value: "" }, "einen Wert"],
    [{ label: "Text", value: "x".repeat(121) }, "höchstens 120"],
  ])("%o meldet „%s“", (row, message) => {
    expect(settingProblem(row)).toContain(message);
  });

  test("an/aus braucht keinen Text", () => {
    expect(settingProblem({ label: "Rückblende", value: false, unit: "toggle" })).toBe("");
  });

  test("leer heißt nichts", () => {
    expect(entryPayload({ settings: [{ label: "", value: "" }], rules_text: " " })).toBeNull();
  });

  test("Werte zum Lesen", () => {
    expect(settingValueText({ value: 45, unit: "seconds" })).toBe("0:45 Min.");
    expect(settingValueText({ value: true, unit: "toggle" })).toBe("an");
    expect(settingValueText({ value: 250, unit: "points" })).toBe("250 Punkte");
    expect(settingToForm({ label: "A", value: true, unit: "toggle" }).value).toBe(true);
  });

  test("umsortieren", () => {
    expect(moveRow(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveRow(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });

  test("Abweichung der Season je Einstellung", () => {
    const game = { settings: [{ key: "uhr", label: "Uhr", value: 45, unit: "seconds" }, { key: "grenze", label: "Grenze", value: 250, unit: "points" }] };
    const season = { settings: [{ key: "uhr", label: "Uhr", value: 40, unit: "seconds" }, { key: "neu", label: "Neu", value: "x" }] };
    expect(settingsDiff(season, game)).toEqual({ uhr: "changed", neu: "added" });
    expect(settingsMissing(season, game).map((row) => row.key)).toEqual(["grenze"]);
    expect(settingsDiff(game, game)).toEqual({});
  });
});
