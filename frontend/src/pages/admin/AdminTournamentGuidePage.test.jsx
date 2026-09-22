import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GUIDE_FORMATS, GUIDE_GAME_TYPES, GUIDE_STEPS, PRESET_FIELDS, presetFor, presetLink } from "@/lib/tournamentGuide";
import { RULE_PRESETS } from "@/lib/tournamentRulePresets";

// Turnier-Leitfaden (#228): drei Teile, jede Empfehlung nennt ihre Felder, jede Turnierform ein
// Format, das es hier gibt.

vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));

const AdminTournamentGuidePage = (await import("./AdminTournamentGuidePage")).default;

test("die drei Teile stehen auf der Seite", () => {
  render(<MemoryRouter><AdminTournamentGuidePage /></MemoryRouter>);
  expect(screen.getByTestId("guide-steps").querySelectorAll("li")).toHaveLength(GUIDE_STEPS.length);
  expect(screen.getByTestId("guide-game-types").querySelectorAll("tbody tr")).toHaveLength(GUIDE_GAME_TYPES.length);
  expect(screen.getByTestId("guide-formats").querySelectorAll("[data-testid^='guide-format-']")).toHaveLength(GUIDE_FORMATS.length);
  expect(screen.getByTestId("guide-step-check-in")).toHaveTextContent("30 bis 60 Minuten");
  expect(screen.getByTestId("guide-game-arcade-sport")).toHaveTextContent("3v3");
  expect(screen.getByTestId("guide-new-tournament")).toHaveAttribute("href", "/admin/tournaments/new");
});

test("jede Empfehlung nennt Felder, jede Turnierform ein bekanntes Format", () => {
  const formatKeys = new Set(GUIDE_FORMATS.map((format) => format.key));
  for (const step of GUIDE_STEPS) expect(step.fields.length, step.key).toBeGreaterThan(0);
  for (const kind of GUIDE_GAME_TYPES) expect(formatKeys.has(kind.format), `${kind.key} → ${kind.format}`).toBe(true);
});

// Schritt 2 (#368): jede Turnierform hat einen Knopf ins Formular, und die Voreinstellung setzt
// nur Felder, die es dort gibt - mit denselben Spielregel-Werten wie der RulePresetPicker.
test("jede Turnierform führt mit ihrer Voreinstellung ins Formular, und die setzt nur bekannte Felder", () => {
  render(<MemoryRouter><AdminTournamentGuidePage /></MemoryRouter>);
  const ruleValues = new Set(RULE_PRESETS.map((preset) => JSON.stringify(preset.values)));
  for (const kind of GUIDE_GAME_TYPES) {
    expect(screen.getByTestId(`guide-preset-${kind.key}`)).toHaveAttribute("href", presetLink(kind.key));
    const preset = presetFor(kind.key);
    expect(Object.keys(preset.values).sort(), kind.key).toEqual([...PRESET_FIELDS].sort());
    expect(preset.values.format, kind.key).toBe(kind.format);
    expect(preset.values.team_mode === "solo" ? preset.values.team_size === 1 : preset.values.team_size >= 2, kind.key).toBe(true);
    const rules = JSON.stringify({ event_mode: preset.values.event_mode, result_entry_mode: preset.values.result_entry_mode, schedule_mode: preset.values.schedule_mode });
    expect(ruleValues.has(rules), `${kind.key}: ${rules}`).toBe(true);
  }
  expect(presetFor("gibt-es-nicht")).toBeNull();
  expect(presetLink("arcade-sport")).toBe("/admin/tournaments/new?preset=arcade-sport");
});
