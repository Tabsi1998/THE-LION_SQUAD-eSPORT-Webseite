import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Ergebnisregeln der Season (docs/LIGA.md, C.3, #1617): festgehaltene Kopie je Modus neben der Regel des Spiels, Abweichung
// sichtbar, „Vom Spiel übernehmen“, Punkte Pflicht. Erfundene Werte.

const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
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
      stellung: { kind: "score", target: 300, time_limit_minutes: 10, draw_allowed: false, overtime: false },
      suchen: { kind: "rounds", target: 6, round_limit: 11, draw_allowed: false, overtime: false },
    },
  });
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(2));
});

test("nur lesen ohne Recht „Season konfigurieren“", async () => {
  render(<SeasonResultRulesPanel seasonId="s1" canEdit={false} />);
  await waitFor(() => expect(screen.getByTestId("result-rules-stellung")).toBeInTheDocument());
  expect(screen.queryByTestId("result-rules-save")).not.toBeInTheDocument();
  expect(screen.getByTestId("result-rules-stellung-season")).toHaveTextContent("Season: Punkte bis zum Ziel: 250 · 10 Min.");
});
