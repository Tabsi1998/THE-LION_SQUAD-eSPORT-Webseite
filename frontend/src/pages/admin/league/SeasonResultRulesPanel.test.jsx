import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Ergebnisregeln der Season (docs/LIGA.md, C.3, #1617): festgehaltene Kopie je Modus neben der Regel des Spiels, Abweichung
// sichtbar, „Vom Spiel übernehmen“, Punkte Pflicht. Erfundene Werte.

const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), resolveMediaUrl: (url) => url || "" }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
const { SeasonResultRulesPanel } = await import("./SeasonResultRulesPanel");

const SCORE = { kind: "score", target: 250, time_limit_minutes: 10, draw_allowed: false, overtime: false };
const BODY = {
  scores_required: true, staffeln: 2,
  rules: [
    { mode: "stellung", label: "Stellung", status: "active", season_rule: SCORE, game_rule: { ...SCORE, target: 300 }, differs: true },
    { mode: "suchen", label: "Suchen", status: "active", season_rule: null, game_rule: null, differs: false },
  ],
};

beforeEach(() => {
  for (const fn of [...Object.values(apiMock), ...Object.values(toastMock)]) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: BODY });
});

test("zeigt Season- und Spiel-Regel, übernimmt bewusst und speichert die ganze Kopie", async () => {
  apiMock.put.mockResolvedValue({ data: { ...BODY, changed: true, staffeln_to_sync: 2 } });
  const onSaved = vi.fn();
  render(<SeasonResultRulesPanel seasonId="s1" onSaved={onSaved} />);

  await waitFor(() => expect(screen.getByTestId("result-rules-stellung")).toBeInTheDocument());
  expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s1/result-rules");
  expect(screen.getByTestId("result-rules-stellung-game")).toHaveTextContent("Spiel: Punkte bis zum Ziel: 300");
  expect(screen.getByTestId("result-rules-stellung-differs")).toHaveTextContent("weicht vom Spiel ab");
  expect(screen.getByTestId("result-rules-required")).toBeChecked();

  fireEvent.click(screen.getByTestId("result-rules-stellung-adopt"));
  expect(screen.getByTestId("result-rules-stellung-target")).toHaveValue(300);
  fireEvent.change(screen.getByTestId("result-rules-suchen-kind"), { target: { value: "rounds" } });
  fireEvent.change(screen.getByTestId("result-rules-suchen-target"), { target: { value: "6" } });
  fireEvent.change(screen.getByTestId("result-rules-suchen-limit"), { target: { value: "4" } });
  fireEvent.click(screen.getByTestId("result-rules-save"));
  expect(screen.getByTestId("result-rules-error")).toHaveTextContent("Modus „Suchen“: Das Rundenlimit (4) ist kleiner als das Ziel (6).");
  expect(apiMock.put).not.toHaveBeenCalled();

  fireEvent.change(screen.getByTestId("result-rules-suchen-limit"), { target: { value: "11" } });
  fireEvent.click(screen.getByTestId("result-rules-required"));
  fireEvent.click(screen.getByTestId("result-rules-save"));

  await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
  expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/result-rules", {
    scores_required: false,
    rules: {
      // Altbestand in Minuten (#2271): gespeichert wird in Sekunden.
      stellung: { kind: "score", target: 300, time_limit_seconds: 600, draw_allowed: false, overtime: false },
      suchen: { kind: "rounds", target: 6, round_limit: 11, draw_allowed: false, overtime: false },
    },
  });
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(2));
});

// Einstellungen je Modus (#2271): Kopie der Season, Abweichung je Einstellung, „Vom Spiel übernehmen“, Zeitlimit als 1:30.
const GAME_SETTINGS = { settings: [{ key: "uhr", label: "Uhr", value: 45, unit: "seconds", group: "Lobby" }], rules_text: "Regel" };
const HELD = {
  scores_required: true, staffeln: 0, settings_held: true,
  rules: [{ mode: "zone", label: "Zone", status: "active", icon_url: "/api/static/uploads/zone.png", season_rule: { kind: "highest" },
    game_rule: { kind: "highest" }, differs: false,
    season_settings: { settings: [{ key: "uhr", label: "Uhr", value: 40, unit: "seconds", group: "Lobby" }], rules_text: "Regel" },
    game_settings: GAME_SETTINGS, settings_differ: true }],
};

test("Einstellungen der Season: Abweichung je Wert, vom Spiel übernehmen, Zeiten mit Sekunden", async () => {
  apiMock.get.mockResolvedValue({ data: HELD });
  apiMock.put.mockResolvedValue({ data: { ...HELD, changed: true, staffeln_to_sync: 0 } });
  render(<SeasonResultRulesPanel seasonId="s1" />);

  await waitFor(() => expect(screen.getByTestId("result-rules-zone")).toBeInTheDocument());
  expect(screen.getByTestId("result-rules-zone-icon")).toHaveAttribute("data-icon", "image");
  expect(screen.getByTestId("result-rules-zone-settings-differs")).toHaveTextContent("weicht vom Spiel ab");
  expect(screen.getByTestId("result-rules-zone-settings-diff-0")).toHaveTextContent("weicht vom Spiel ab");
  expect(screen.getByTestId("result-rules-zone-settings-value-0")).toHaveValue("40");

  fireEvent.click(screen.getByTestId("result-rules-zone-settings-adopt"));
  expect(screen.getByTestId("result-rules-zone-settings-value-0")).toHaveValue("45");
  expect(screen.queryByTestId("result-rules-zone-settings-differs")).not.toBeInTheDocument();
  // Übernehmen klappt die Werte nicht weg (Abnahme #2271).
  expect(screen.getByTestId("result-rules-zone-settings-box")).toHaveAttribute("open");
  fireEvent.change(screen.getByTestId("result-rules-zone-time"), { target: { value: "1:30" } });
  fireEvent.click(screen.getByTestId("result-rules-save"));

  await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
  expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/result-rules", {
    scores_required: true,
    rules: { zone: { kind: "highest", time_limit_seconds: 90, draw_allowed: false, overtime: false } },
    settings: { zone: GAME_SETTINGS },
  });
});

test("ältere Season ohne Kopie: ohne Änderung kein Feld „settings“", async () => {
  apiMock.put.mockResolvedValue({ data: { ...BODY, changed: false } });
  render(<SeasonResultRulesPanel seasonId="s1" />);
  await waitFor(() => expect(screen.getByTestId("result-rules-stellung")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("result-rules-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
  expect(apiMock.put.mock.calls[0][1]).not.toHaveProperty("settings");
});

test("nur lesen ohne Recht „Season konfigurieren“", async () => {
  render(<SeasonResultRulesPanel seasonId="s1" canEdit={false} />);
  await waitFor(() => expect(screen.getByTestId("result-rules-stellung")).toBeInTheDocument());
  expect(screen.queryByTestId("result-rules-save")).not.toBeInTheDocument();
  expect(screen.getByTestId("result-rules-stellung-season")).toHaveTextContent("Season: Punkte bis zum Ziel: 250 · 10 Min.");
});
