import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Prüfung vor der Veröffentlichung (#2207, docs/LIGA.md „C.2 Maps und Pools“). Erfundene Modi.
const apiMock = { get: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeasonReadinessPanel } = await import("./SeasonReadinessPanel");

const UNREADY = {
  ok: false, superadmin: false, max_maps: 3, total: null,
  problems: [{ code: "pool_too_small", text: "Stellung braucht mindestens 2 Maps im Pool, hat 1." }, { code: "rules_missing", text: "Es gibt kein veröffentlichtes Regelwerk." }],
  warnings: [{ code: "application_none", text: "Kein Anmeldefenster." }],
  requirements: [{ mode: "stellung", label: "Stellung", derived: 2, override: null, needed: 2, have: 1 },
    { mode: "suchen", label: "Suchen", derived: 1, override: null, needed: 1, have: 1 }],
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.patch.mockReset();
  Object.values(toastMock).forEach((fn) => fn.mockReset());
  apiMock.get.mockResolvedValue({ data: UNREADY });
  apiMock.patch.mockResolvedValue({ data: {} });
});

test("Probleme und Warnungen stehen im Klartext da, mit der Mindestgröße je Modus", async () => {
  render(<SeasonReadinessPanel seasonId="s1" />);

  expect(await screen.findByTestId("season-readiness-state")).toHaveTextContent("2 Probleme vor der Veröffentlichung");
  expect(screen.getByTestId("season-readiness-state")).toHaveTextContent("1 Warnung");
  expect(screen.getByTestId("season-readiness-problems")).toHaveTextContent("Stellung braucht mindestens 2 Maps");
  expect(screen.getByTestId("season-readiness-warnings")).toHaveTextContent("Kein Anmeldefenster.");
  expect(screen.getByTestId("season-readiness-row-stellung")).toHaveTextContent("1 von mindestens 2 Maps");
  expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s1/readiness");
  expect(screen.queryByTestId("season-readiness-override")).toBeNull();
});

test("die Mindestgröße wird je Modus überschrieben und gespeichert", async () => {
  const saved = vi.fn();
  render(<SeasonReadinessPanel seasonId="s1" onSaved={saved} />);
  await screen.findByTestId("season-readiness-row-suchen");

  fireEvent.change(screen.getByTestId("season-readiness-min-suchen"), { target: { value: "3" } });
  fireEvent.click(screen.getByTestId("season-readiness-min-save"));

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/admin/leagues/seasons/s1", { pool_min_maps: [{ mode: "suchen", min_maps: 3 }] }));
  expect(saved).toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("season-readiness-min-suchen"), { target: { value: "0" } });
  fireEvent.click(screen.getByTestId("season-readiness-min-save"));
  expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("zwischen 1 und 50"));
});

test("nur der Superadmin bekommt das Feld für die Notausnahme - und nur solange die Season aus ist", async () => {
  apiMock.get.mockResolvedValue({ data: { ...UNREADY, superadmin: true } });
  const reason = vi.fn();
  const { rerender } = render(<SeasonReadinessPanel seasonId="s1" onOverrideReason={reason} />);

  fireEvent.change(await screen.findByTestId("season-readiness-override"), { target: { value: "Vorschau für die Leitung" } });
  expect(reason).toHaveBeenCalledWith("Vorschau für die Leitung");
  rerender(<SeasonReadinessPanel seasonId="s1" visibility="public" onOverrideReason={reason} />);
  expect(screen.queryByTestId("season-readiness-override")).toBeNull();
});

test("eine fertige Season heißt bereit", async () => {
  apiMock.get.mockResolvedValue({ data: { ...UNREADY, ok: true, problems: [], warnings: [] } });
  render(<SeasonReadinessPanel seasonId="s1" canEdit={false} />);

  expect(await screen.findByTestId("season-readiness-state")).toHaveTextContent("Bereit zur Veröffentlichung");
  expect(screen.queryByTestId("season-readiness-min-save")).toBeNull();
});
