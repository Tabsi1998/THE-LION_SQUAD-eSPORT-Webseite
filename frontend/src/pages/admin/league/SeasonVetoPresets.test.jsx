import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Vorgabe der Woche in der Verwaltung der Season (#2326): im Kasten „Veto“, je Spielwoche eine Map, fehlende Wochen sichtbar, „Rotiert
// automatisch durch den Pool“ als Vorschlag, eigenes Speichern mit Historie. Erfundene Modi und Maps.

const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
const confirmMock = vi.fn(() => Promise.resolve(true));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));

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
  toastMock.success.mockClear();
  confirmMock.mockReset();
  confirmMock.mockImplementation(() => Promise.resolve(true));
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

test("Rotation füllt nur leere Wochen, geänderte bleiben bis zum Speichern markiert - Speichern schickt die Liste", async () => {
  serve(RULES, PRESETS);
  const saved = [{ week: 1, mode: "ctl", map_id: "kai" }, { week: 2, mode: "ctl", map_id: "ruine" }, { week: 3, mode: "ctl", map_id: "ruine" }];
  apiMock.put.mockResolvedValue({ data: { ...PRESETS, presets: saved, problems: [], changed: 2, matches_ready: 1,
    history: [{ at: "2026-11-11T13:00:00+00:00", by_name: "Ligaleitung", changes: [{ week: 2, mode: "ctl", from: null, to: "ruine" }, { week: 3, mode: "ctl", from: null, to: "ruine" }] }] } });
  render(<SeasonVetoRulesPanel seasonId="s1" />);
  fireEvent.click(await screen.findByTestId("veto-presets-rotate"));
  // Woche 1 war schon gewählt (Kai) und bleibt - der Vorschlag hätte dort Hafen gesetzt.
  expect(screen.getByTestId("veto-preset-1-ctl")).toHaveValue("kai");
  expect(screen.getByTestId("veto-preset-2-ctl")).toHaveValue("kai");
  expect(screen.getByTestId("veto-preset-3-ctl")).toHaveValue("ruine");
  expect(toastMock.success).toHaveBeenLastCalledWith("2 leere Wochen gefüllt – jede lässt sich noch ändern, gespeichert ist nichts.");
  expect(screen.getByTestId("veto-preset-week-1")).toHaveAttribute("data-changed", "false");
  expect(screen.getByTestId("veto-preset-week-2")).toHaveAttribute("data-changed", "true");
  expect(screen.getByTestId("veto-preset-week-3-changed")).toHaveTextContent("geändert");
  expect(screen.queryByTestId("veto-presets-missing")).toBeNull();
  expect(screen.getByTestId("veto-presets-complete")).toBeInTheDocument();
  expect(screen.getByTestId("veto-presets-dirty")).toBeInTheDocument();
  expect(confirmMock).not.toHaveBeenCalled();
  expect(apiMock.put).not.toHaveBeenCalled();
  // Noch einmal: Es gibt keine leere Woche mehr - nichts ändert sich.
  fireEvent.click(screen.getByTestId("veto-presets-rotate"));
  expect(toastMock.success).toHaveBeenLastCalledWith("Keine leere Woche mehr – „Alle neu verteilen“ ersetzt auch die gewählten.");
  expect(screen.getByTestId("veto-preset-1-ctl")).toHaveValue("kai");
  fireEvent.change(screen.getByTestId("veto-preset-2-ctl"), { target: { value: "ruine" } });
  fireEvent.click(screen.getByTestId("veto-presets-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/veto-presets", { presets: saved }));
  await waitFor(() => expect(screen.queryByTestId("veto-presets-dirty")).toBeNull());
  // Gespeichert: keine Woche ist mehr als geändert markiert.
  expect(screen.getByTestId("veto-preset-week-2")).toHaveAttribute("data-changed", "false");
  // Ein Spiel hat auf die Vorgabe gewartet: Die Meldung sagt, dass die Captains das Veto jetzt selbst starten - nicht, dass es läuft.
  expect(toastMock.success).toHaveBeenLastCalledWith("Vorgaben gespeichert – ein wartendes Spiel kann sein Veto jetzt starten, die Captains sind informiert.");
  expect(screen.getByTestId("veto-presets-history")).toHaveTextContent("Verlauf (1 Änderung)");
  expect(screen.getByTestId("veto-presets-history-entry")).toHaveTextContent("Ligaleitung");
  expect(screen.getByTestId("veto-presets-history-entry")).toHaveTextContent("Spielwoche 2 · Kontrolle: – → Ruine");
  // Eine Woche wieder leeren: Sie steht sofort als fehlend da.
  fireEvent.change(screen.getByTestId("veto-preset-3-ctl"), { target: { value: "" } });
  expect(screen.getByTestId("veto-presets-missing")).toHaveTextContent("Es fehlt noch: Spielwoche 3.");
});

test("„Alle neu verteilen“ fragt nach, wie viele gewählte Wochen es überschreibt - vergangene und begonnene bleiben immer", async () => {
  // Woche 1 ist vorbei (Kai gewählt), in Woche 2 hat ein Veto begonnen (Ruine gewählt), Woche 3 ist gewählt (Hafen), Woche 4 ist leer.
  const weeks = [{ ...WEEKS[0], past: true, started: false }, { ...WEEKS[1], past: false, started: true }, { ...WEEKS[2], past: false, started: false },
    { week: 4, start_day: "2026-12-01", end_day: "2026-12-07", past: false, started: false }];
  const stored = [{ week: 1, mode: "ctl", map_id: "kai" }, { week: 2, mode: "ctl", map_id: "ruine" }, { week: 3, mode: "ctl", map_id: "hafen" }];
  serve(RULES, { ...PRESETS, weeks, presets: stored, problems: missing([4]), rotation: [...PRESETS.rotation, { week: 4, mode: "ctl", map_id: "hafen" }] });
  render(<SeasonVetoRulesPanel seasonId="s1" />);
  expect(await screen.findByTestId("veto-preset-week-1-kept")).toHaveTextContent("vorbei");
  expect(screen.getByTestId("veto-preset-week-2-kept")).toHaveTextContent("Veto begonnen");
  expect(screen.queryByTestId("veto-preset-week-3-kept")).toBeNull();
  expect(screen.getByTestId("veto-presets-rotation-note")).toHaveTextContent("Spielwoche 1 und 2 bleiben dabei immer, wie sie sind (vorbei oder Veto begonnen).");
  // Abgelehnt: nichts ändert sich.
  confirmMock.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByTestId("veto-presets-redistribute"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
  expect(confirmMock.mock.calls[0][0].description).toContain("Das überschreibt eine gewählte Woche.");
  expect(confirmMock.mock.calls[0][0].description).toContain("Vergangene Wochen und Wochen mit begonnenem Veto bleiben");
  expect(screen.getByTestId("veto-preset-3-ctl")).toHaveValue("hafen");
  expect(screen.getByTestId("veto-preset-4-ctl")).toHaveValue("");
  // Bestätigt: Woche 3 und 4 bekommen den Vorschlag, Woche 1 und 2 bleiben.
  fireEvent.click(screen.getByTestId("veto-presets-redistribute"));
  await waitFor(() => expect(screen.getByTestId("veto-preset-3-ctl")).toHaveValue("ruine"));
  expect(screen.getByTestId("veto-preset-4-ctl")).toHaveValue("hafen");
  expect(screen.getByTestId("veto-preset-1-ctl")).toHaveValue("kai");
  expect(screen.getByTestId("veto-preset-2-ctl")).toHaveValue("ruine");
  expect(screen.getByTestId("veto-preset-week-3")).toHaveAttribute("data-changed", "true");
  expect(screen.getByTestId("veto-preset-week-1")).toHaveAttribute("data-changed", "false");
  // Von Hand bleibt auch eine vergangene Woche änderbar (gilt dann nur für Spiele, deren Veto noch nicht begonnen hat).
  fireEvent.change(screen.getByTestId("veto-preset-1-ctl"), { target: { value: "hafen" } });
  expect(screen.getByTestId("veto-preset-week-1")).toHaveAttribute("data-changed", "true");
});

test("„Rotiert …“ lässt eine leere Woche mit begonnenem Veto aus - und ohne Gewähltes fragt „Alle neu verteilen“ nicht nach", async () => {
  const weeks = [{ ...WEEKS[0], past: false, started: true }, { ...WEEKS[1], past: false, started: false }, { ...WEEKS[2], past: false, started: false }];
  serve(RULES, { ...PRESETS, weeks, presets: [], problems: missing([1, 2, 3]) });
  render(<SeasonVetoRulesPanel seasonId="s1" />);
  fireEvent.click(await screen.findByTestId("veto-presets-rotate"));
  expect(screen.getByTestId("veto-preset-1-ctl")).toHaveValue("");
  expect(screen.getByTestId("veto-preset-2-ctl")).toHaveValue("kai");
  expect(screen.getByTestId("veto-presets-missing")).toHaveTextContent("Es fehlt noch: Spielwoche 1.");
  fireEvent.click(screen.getByTestId("veto-presets-redistribute"));
  await waitFor(() => expect(toastMock.success).toHaveBeenLastCalledWith("Neu verteilt – jede Woche lässt sich noch ändern, gespeichert ist nichts."));
  expect(confirmMock).not.toHaveBeenCalled();
  expect(screen.getByTestId("veto-preset-1-ctl")).toHaveValue("");
});

test("eine Map außerhalb des Pools bleibt sichtbar stehen - anderes Speichern nimmt sie mit, erst neu wählen ersetzt sie", async () => {
  const stored = [{ week: 1, mode: "ctl", map_id: "weg" }, { week: 2, mode: "ctl", map_id: "kai" }, { week: 3, mode: "ctl", map_id: "hafen" }];
  serve(RULES, { ...PRESETS, presets: stored, problems: [{ week: 1, problems: ["Kontrolle: Die vorgegebene Map steht nicht im Pool des Modus."] }] });
  apiMock.put.mockImplementation((_url, body) => Promise.resolve({ data: { ...PRESETS, presets: body.presets, problems: [], changed: 1, matches_ready: 0 } }));
  render(<SeasonVetoRulesPanel seasonId="s1" />);
  // Die Map der Woche 1 steht nicht mehr im Pool: Die Zeile sagt es und zeigt die Auswahl als „bitte neu wählen“ - nicht als leer.
  expect(await screen.findByTestId("veto-preset-week-1")).toHaveAttribute("data-stale", "true");
  expect(screen.getByTestId("veto-preset-week-1")).toHaveAttribute("data-missing", "false");
  expect(screen.getByTestId("veto-preset-week-1-stale")).toHaveTextContent("nicht mehr im Pool");
  expect(screen.getByTestId("veto-preset-1-ctl")).toHaveValue("weg");
  expect(screen.getByTestId("veto-preset-1-ctl")).toHaveDisplayValue("Map nicht mehr im Pool – bitte neu wählen");
  expect(screen.getByTestId("veto-presets-stale")).toHaveTextContent("Map nicht mehr im Pool – bitte neu wählen: Spielwoche 1.");
  expect(screen.queryByTestId("veto-presets-missing")).toBeNull();
  expect(screen.queryByTestId("veto-presets-complete")).toBeNull();
  expect(screen.getByTestId("veto-preset-week-2")).toHaveAttribute("data-stale", "false");
  expect(screen.getByTestId("veto-presets-save")).toBeDisabled();
  // „Rotiert …“ füllt nur leere Wochen - die Woche mit der alten Map fasst es nicht an.
  fireEvent.click(screen.getByTestId("veto-presets-rotate"));
  expect(screen.getByTestId("veto-preset-1-ctl")).toHaveValue("weg");
  // Eine andere Woche ändern und speichern: Die alte Auswahl geht unverändert mit, sie wird nicht still gelöscht.
  fireEvent.change(screen.getByTestId("veto-preset-2-ctl"), { target: { value: "ruine" } });
  fireEvent.click(screen.getByTestId("veto-presets-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/veto-presets",
    { presets: [{ week: 1, mode: "ctl", map_id: "weg" }, { week: 2, mode: "ctl", map_id: "ruine" }, { week: 3, mode: "ctl", map_id: "hafen" }] }));
  await waitFor(() => expect(screen.queryByTestId("veto-presets-dirty")).toBeNull());
  expect(screen.getByTestId("veto-preset-week-1")).toHaveAttribute("data-stale", "true");
  // Neu wählen: Der Vermerk verschwindet, die Woche ist geändert.
  fireEvent.change(screen.getByTestId("veto-preset-1-ctl"), { target: { value: "kai" } });
  expect(screen.getByTestId("veto-preset-week-1")).toHaveAttribute("data-stale", "false");
  expect(screen.getByTestId("veto-preset-week-1")).toHaveAttribute("data-changed", "true");
  expect(screen.queryByTestId("veto-presets-stale")).toBeNull();
  expect(screen.getByTestId("veto-presets-complete")).toBeInTheDocument();
});

test("ein Fehler des Servers steht beim Block, ein Problem des gespeicherten Stands bei seiner Woche", async () => {
  serve(RULES, { ...PRESETS, presets: [{ week: 1, mode: "ctl", map_id: "kai" }, { week: 2, mode: "ctl", map_id: "kai" }, { week: 3, mode: "ctl", map_id: "hafen" }],
    problems: [{ week: 1, problems: ["Mit diesen Vorgaben lässt sich die Vorlage nicht zu Ende spielen – bitte eine andere Map vorgeben."] }] });
  apiMock.put.mockRejectedValue({ response: { data: { detail: "Spielwoche 2: Die Map steht nicht im Pool für Kontrolle." } } });
  render(<SeasonVetoRulesPanel seasonId="s1" />);
  expect(await screen.findByTestId("veto-preset-week-1-problem")).toHaveTextContent("lässt sich die Vorlage nicht zu Ende spielen");
  expect(screen.queryByTestId("veto-preset-week-2-problem")).toBeNull();
  fireEvent.change(screen.getByTestId("veto-preset-2-ctl"), { target: { value: "ruine" } });
  // Der Satz des Servers bleibt bei der unveränderten Woche 1 stehen.
  expect(screen.getByTestId("veto-preset-week-1-problem")).toBeInTheDocument();
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
