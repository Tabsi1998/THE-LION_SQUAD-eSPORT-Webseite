import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Vorgabe der Woche in der Verwaltung der Season (#2326): im Kasten „Veto“, je Spielwoche eine Map, fehlende Wochen sichtbar, „Rotiert
// automatisch durch den Pool“ als Vorschlag, eigenes Speichern mit Historie. Erfundene Modi und Maps.

const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { SeasonVetoRulesPanel } = await import("./SeasonVetoRulesPanel");

const DEFAULTS = { enabled: false, team_a: "home", step_seconds: 60, steps: [] };
const MODES = [{ mode: "hp", label: "Stellung", maps: 2 }, { mode: "ctl", label: "Kontrolle", maps: 3 }];
const PLAIN = [{ kind: "pick", mode: "hp", team: "A", position: 1 }, { kind: "decider", mode: "ctl", team: null, position: 2 }];
const WITH_PRESET = [{ kind: "pick", mode: "hp", team: "A", position: 1 }, { kind: "preset", mode: "ctl", team: null, position: 2 }];
const rules = (steps) => ({ enabled: true, team_a: "home", step_seconds: 60, steps });
const RULES = { veto_rules: rules(WITH_PRESET), active: true, defaults: DEFAULTS, problems: [], modes: MODES, best_of: 2, game_mode_order: ["hp", "ctl"], map_repeat: "other_mode", has_checkin: true, staffeln: 1 };
const MAPS = [{ map_id: "hafen", name: "Hafen" }, { map_id: "kai", name: "Kai" }, { map_id: "ruine", name: "Ruine" }];
const WEEKS = [{ week: 1, start_day: "2026-11-10", end_day: "2026-11-16" }, { week: 2, start_day: "2026-11-17", end_day: "2026-11-23" }, { week: 3, start_day: "2026-11-24", end_day: "2026-11-30" }];
const missing = (weeks) => weeks.map((week) => ({ week, problems: ["Kontrolle: Die Vorgabe der Woche fehlt."] }));
const PRESETS = {
  active: true, weeks: WEEKS, modes: [{ mode: "ctl", label: "Kontrolle", position: 2, maps: MAPS }], presets: [{ week: 1, mode: "ctl", map_id: "kai" }],
  problems: missing([2, 3]), history: [],
  rotation: [{ week: 1, mode: "ctl", map_id: "hafen" }, { week: 2, mode: "ctl", map_id: "kai" }, { week: 3, mode: "ctl", map_id: "ruine" }],
};

function serve(rulesState, presetsState) {
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/veto-presets") ? presetsState : rulesState }));
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.put.mockReset();
});

test("ohne Schritt „Vorgabe“ gibt es den Block nicht - mit ihm stehen die Wochen im Kasten Veto, fehlende markiert", async () => {
  serve({ ...RULES, veto_rules: rules(PLAIN) }, PRESETS);
  const { unmount } = render(<SeasonVetoRulesPanel seasonId="s1" />);
  expect(await screen.findByTestId("veto-rules-steps")).toBeInTheDocument();
  expect(screen.queryByTestId("veto-presets-box")).toBeNull();
  expect(apiMock.get).not.toHaveBeenCalledWith("/admin/leagues/seasons/s1/veto-presets");
  unmount();

  serve(RULES, PRESETS);
  render(<SeasonVetoRulesPanel seasonId="s1" />);
  expect(await screen.findByTestId("veto-presets-weeks")).toBeInTheDocument();
  expect(screen.getByTestId("season-veto-rules")).toContainElement(screen.getByTestId("veto-presets-box"));
  expect(screen.getByTestId("veto-step-1-kind")).toHaveValue("preset");
  expect(screen.getByTestId("veto-step-1-sentence")).toHaveTextContent("Die Liga-Leitung gibt Map 2 je Spielwoche vor (Kontrolle)");
  expect(screen.queryByTestId("veto-step-1-team")).toBeNull();
  expect(screen.getByTestId("veto-presets-weeks").children).toHaveLength(3);
  expect(screen.getByTestId("veto-preset-week-1")).toHaveTextContent("Spielwoche 1");
  expect(screen.getByTestId("veto-preset-week-1")).toHaveTextContent("10.11.–16.11.");
  expect(screen.getByTestId("veto-preset-1-ctl")).toHaveValue("kai");
  expect(screen.getByTestId("veto-preset-week-1")).toHaveAttribute("data-missing", "false");
  expect(screen.getByTestId("veto-preset-week-2")).toHaveAttribute("data-missing", "true");
  expect(screen.getByTestId("veto-preset-week-2-missing")).toHaveTextContent("fehlt");
  expect(screen.getByTestId("veto-presets-missing")).toHaveTextContent("Es fehlen noch: Spielwoche 2 und 3.");
  expect(screen.getByTestId("veto-presets-save")).toBeDisabled();
});

test("Rotation füllt alle Wochen als Vorschlag, danach einzeln änderbar - Speichern schickt die Liste", async () => {
  serve(RULES, PRESETS);
  const saved = [{ week: 1, mode: "ctl", map_id: "hafen" }, { week: 2, mode: "ctl", map_id: "ruine" }, { week: 3, mode: "ctl", map_id: "ruine" }];
  apiMock.put.mockResolvedValue({ data: { ...PRESETS, presets: saved, problems: [], changed: 3, vetoes_started: 1,
    history: [{ at: "2026-11-11T13:00:00+00:00", by_name: "Ligaleitung", changes: [{ week: 1, mode: "ctl", from: "kai", to: "hafen" }, { week: 2, mode: "ctl", from: null, to: "ruine" }] }] } });
  render(<SeasonVetoRulesPanel seasonId="s1" />);
  fireEvent.click(await screen.findByTestId("veto-presets-rotate"));
  expect(screen.getByTestId("veto-preset-1-ctl")).toHaveValue("hafen");
  expect(screen.getByTestId("veto-preset-2-ctl")).toHaveValue("kai");
  expect(screen.getByTestId("veto-preset-3-ctl")).toHaveValue("ruine");
  expect(screen.queryByTestId("veto-presets-missing")).toBeNull();
  expect(screen.getByTestId("veto-presets-complete")).toBeInTheDocument();
  expect(screen.getByTestId("veto-presets-dirty")).toBeInTheDocument();
  expect(apiMock.put).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("veto-preset-2-ctl"), { target: { value: "ruine" } });
  fireEvent.click(screen.getByTestId("veto-presets-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/veto-presets", { presets: saved }));
  await waitFor(() => expect(screen.queryByTestId("veto-presets-dirty")).toBeNull());
  expect(screen.getByTestId("veto-presets-history")).toHaveTextContent("Verlauf (1 Änderung)");
  expect(screen.getByTestId("veto-presets-history-entry")).toHaveTextContent("Ligaleitung");
  expect(screen.getByTestId("veto-presets-history-entry")).toHaveTextContent("Spielwoche 1 · Kontrolle: Kai → Hafen");
  expect(screen.getByTestId("veto-presets-history-entry")).toHaveTextContent("Spielwoche 2 · Kontrolle: – → Ruine");
  // Eine Woche wieder leeren: Sie steht sofort als fehlend da.
  fireEvent.change(screen.getByTestId("veto-preset-3-ctl"), { target: { value: "" } });
  expect(screen.getByTestId("veto-presets-missing")).toHaveTextContent("Es fehlt noch: Spielwoche 3.");
});

test("ein Fehler des Servers und ein Problem des gespeicherten Stands stehen bei der Woche", async () => {
  serve(RULES, { ...PRESETS, presets: [{ week: 1, mode: "ctl", map_id: "weg" }, { week: 2, mode: "ctl", map_id: "kai" }, { week: 3, mode: "ctl", map_id: "hafen" }],
    problems: [{ week: 1, problems: ["Kontrolle: Die vorgegebene Map steht nicht im Pool des Modus."] }] });
  apiMock.put.mockRejectedValue({ response: { data: { detail: "Spielwoche 2: Die Map steht nicht im Pool für Kontrolle." } } });
  render(<SeasonVetoRulesPanel seasonId="s1" />);
  // Die Map der Woche 1 steht nicht mehr im Pool: Die Woche zählt wieder als fehlend, mit dem Satz des Servers.
  expect(await screen.findByTestId("veto-preset-week-1")).toHaveAttribute("data-missing", "true");
  expect(screen.getByTestId("veto-preset-week-1-problem")).toHaveTextContent("Kontrolle: Die vorgegebene Map steht nicht im Pool des Modus.");
  expect(screen.getByTestId("veto-preset-1-ctl")).toHaveValue("");
  expect(screen.queryByTestId("veto-preset-week-2-problem")).toBeNull();
  expect(screen.getByTestId("veto-presets-missing")).toHaveTextContent("Es fehlt noch: Spielwoche 1.");
  fireEvent.change(screen.getByTestId("veto-preset-2-ctl"), { target: { value: "ruine" } });
  fireEvent.click(screen.getByTestId("veto-presets-save"));
  expect(await screen.findByTestId("veto-presets-error")).toHaveTextContent("Spielwoche 2: Die Map steht nicht im Pool für Kontrolle.");
});

test("neu gewählte Art „Vorgabe“: erst das Veto speichern, dann lädt der Block die Wochen", async () => {
  let rulesState = { ...RULES, veto_rules: rules(PLAIN) };
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/veto-presets") ? (rulesState.veto_rules.steps[1].kind === "preset" ? PRESETS : { ...PRESETS, active: false, modes: [], presets: [], problems: [], rotation: [] }) : rulesState }));
  apiMock.put.mockImplementation(() => {
    rulesState = { ...RULES, staffeln_updated: 1 };
    return Promise.resolve({ data: rulesState });
  });
  render(<SeasonVetoRulesPanel seasonId="s1" />);
  fireEvent.change(await screen.findByTestId("veto-step-1-kind"), { target: { value: "preset" } });
  expect(await screen.findByTestId("veto-presets-save-first")).toHaveTextContent("Sobald das Veto damit an und gespeichert ist");
  expect(screen.queryByTestId("veto-presets-weeks")).toBeNull();
  fireEvent.click(screen.getByTestId("veto-rules-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/veto-rules", rules(WITH_PRESET)));
  expect(await screen.findByTestId("veto-presets-weeks")).toBeInTheDocument();
  expect(screen.queryByTestId("veto-presets-template-unsaved")).toBeNull();
});
