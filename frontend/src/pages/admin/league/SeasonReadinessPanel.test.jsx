import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Prüfung vor der Veröffentlichung (#2207, docs/LIGA.md „C.2 Maps und Pools“). Erfundene Modi.
const apiMock = { get: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { SeasonPoolMinimum, SeasonReadinessPanel, useSeasonReadiness } = await import("./SeasonReadinessPanel");

// Seit #2267 lädt die Seite die Prüfung einmal; hier stellvertretend ein kleiner Rahmen um beide Teile.
function Check(props) {
  const readiness = useSeasonReadiness("s1", 1);
  return <SeasonReadinessPanel readiness={readiness} {...props} />;
}
function Minimum(props) {
  const readiness = useSeasonReadiness("s1", 1);
  return <SeasonPoolMinimum seasonId="s1" readiness={readiness} {...props} />;
}

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

test("Probleme und Warnungen stehen im Klartext da - jeder Punkt führt an seine Stelle (#2267)", async () => {
  const onJump = vi.fn();
  render(<Check onJump={onJump} />);

  expect(await screen.findByTestId("season-readiness-state")).toHaveTextContent("2 Probleme vor der Veröffentlichung");
  expect(screen.getByTestId("season-readiness-state")).toHaveTextContent("1 Warnung");
  expect(screen.getByTestId("season-readiness-problems")).toHaveTextContent("Stellung braucht mindestens 2 Maps");
  expect(screen.getByTestId("season-readiness-warnings")).toHaveTextContent("Kein Anmeldefenster.");
  expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s1/readiness");
  expect(screen.queryByTestId("season-readiness-override")).toBeNull();
  expect(screen.getByTestId("season-readiness-problems-go-pool_too_small")).toHaveTextContent("Zu Spielbetrieb");
  fireEvent.click(screen.getByTestId("season-readiness-problems-go-rules_missing"));
  expect(onJump).toHaveBeenCalledWith("regelwerk");
  fireEvent.click(screen.getByTestId("season-readiness-warnings-go-application_none"));
  expect(onJump).toHaveBeenLastCalledWith("selbstanmeldung");
});

test("die Mindestgröße steht je Modus da, wird überschrieben und gespeichert", async () => {
  const saved = vi.fn();
  render(<Minimum onSaved={saved} />);
  expect(await screen.findByTestId("season-readiness-row-stellung")).toHaveTextContent("1 von mindestens 2 Maps");

  fireEvent.change(screen.getByTestId("season-readiness-min-suchen"), { target: { value: "3" } });
  fireEvent.click(screen.getByTestId("season-readiness-min-save"));

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/admin/leagues/seasons/s1", { pool_min_maps: [{ mode: "suchen", min_maps: 3 }] }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  fireEvent.change(screen.getByTestId("season-readiness-min-suchen"), { target: { value: "0" } });
  fireEvent.click(screen.getByTestId("season-readiness-min-save"));
  expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("zwischen 1 und 50"));
});

test("nur der Superadmin bekommt das Feld für die Notausnahme - und nur solange die Season nicht veröffentlicht ist", async () => {
  apiMock.get.mockResolvedValue({ data: { ...UNREADY, superadmin: true } });
  const reason = vi.fn();
  const { rerender } = render(<Check onOverrideReason={reason} />);

  fireEvent.change(await screen.findByTestId("season-readiness-override"), { target: { value: "Saisonstart trotz Lücke" } });
  expect(reason).toHaveBeenCalledWith("Saisonstart trotz Lücke");
  // „Nur Liga-Leitung“ ist Vorschau (Entscheidung zu #2207): Von dort aus wird noch veröffentlicht, das Feld bleibt.
  rerender(<Check visibility="admins" onOverrideReason={reason} />);
  expect(screen.getByTestId("season-readiness-override")).toBeInTheDocument();
  rerender(<Check visibility="public" onOverrideReason={reason} />);
  expect(screen.queryByTestId("season-readiness-override")).toBeNull();
});

test("eine fertige Season heißt bereit, ohne Rechte gibt es kein Speichern der Mindestgröße", async () => {
  apiMock.get.mockResolvedValue({ data: { ...UNREADY, ok: true, problems: [], warnings: [] } });
  render(<><Check /><Minimum canEdit={false} /></>);

  expect(await screen.findByTestId("season-readiness-state")).toHaveTextContent("Bereit zur Veröffentlichung");
  expect(screen.getByTestId("season-readiness-clean")).toBeInTheDocument();
  expect(screen.queryByTestId("season-readiness-min-save")).toBeNull();
});
