import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Neuberechnung der Erfolge (#2340): Probelauf mit Ergebnis-Tabelle und Abschluss mit Rückfrage. Die API ist eine
// Attrappe; geprüft wird, was die Tafel zeigt und wann sie was an den Server schickt.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
const confirmMock = vi.fn(async () => true);
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => (typeof detail === "string" ? detail : ""), resolveMediaUrl: (url) => url }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { RecountPanel, POLL_MS, finishLabel } = await import("./RecountPanel");

const ACTIVE = { exists: true, active: true, marker: "2340", started_at: "2026-11-10T08:00:00+00:00", ended_at: null, dry_run: { running: false }, finish: { running: false, done: false, interrupted: false } };
const DRY_DONE = {
  status: "done", running: false, checked: 40, total: 40, affected_users: 12, awards: 19, errors: 0, finished_at: "2026-11-10T09:00:00+00:00",
  tiers: [
    { tier_code: "finalist_1", name: "Finalist I", group_name: "Finalist", material: "wood", count: 11, negative: false },
    { tier_code: "matches_played_2", name: "Spielmacher II", group_name: "Spielmacher", material: "iron", count: 8, negative: false },
  ],
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

describe("Neuberechnung im Erfolge-Admin (#2340)", () => {
  it("zeigt den stillen Modus und das Ergebnis des Probelaufs als Tabelle", async () => {
    apiMock.get.mockResolvedValue({ data: { ...ACTIVE, dry_run: DRY_DONE } });
    render(<RecountPanel />);
    expect(await screen.findByTestId("ach-recount-mode")).toHaveTextContent("An seit");
    expect(screen.getByTestId("ach-recount-finish-state")).toHaveTextContent("Noch offen");
    expect(screen.getByTestId("ach-recount-summary")).toHaveTextContent("12 Personen bekämen 19 Stufen neu dazu.");
    expect(screen.getByTestId("ach-recount-row-finalist_1")).toHaveTextContent("Finalist I");
    expect(screen.getByTestId("ach-recount-row-finalist_1")).toHaveTextContent("11");
    expect(screen.getByTestId("ach-recount-row-matches_played_2")).toHaveTextContent("Spielmacher");
    expect(apiMock.get).toHaveBeenCalledWith("/admin/achievements/recount");
  });

  it("startet den Probelauf und fragt nach, solange er läuft", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      apiMock.get.mockResolvedValueOnce({ data: ACTIVE });
      apiMock.post.mockResolvedValue({ data: { ...ACTIVE, dry_run: { status: "running", running: true, checked: 0, total: 40 } } });
      render(<RecountPanel />);
      fireEvent.click(await screen.findByTestId("ach-recount-dry-run"));
      await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/achievements/recount/dry-run"));
      expect(await screen.findByTestId("ach-recount-dry-state")).toHaveTextContent("Läuft: 0 von 40 Konten gerechnet");
      expect(screen.getByTestId("ach-recount-dry-run")).toBeDisabled();
      apiMock.get.mockResolvedValue({ data: { ...ACTIVE, dry_run: DRY_DONE } });
      await act(async () => { vi.advanceTimersByTime(POLL_MS); });
      expect(await screen.findByTestId("ach-recount-summary")).toHaveTextContent("12 Personen");
      expect(screen.getByTestId("ach-recount-dry-run")).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("schließt erst nach der Rückfrage ab - abgelehnt geht nichts raus", async () => {
    apiMock.get.mockResolvedValue({ data: ACTIVE });
    apiMock.post.mockResolvedValue({ data: { ...ACTIVE, finish: { running: true, phase: "evaluate", evaluated: 0, users_total: 40 } } });
    render(<RecountPanel />);
    confirmMock.mockResolvedValueOnce(false);
    fireEvent.click(await screen.findByTestId("ach-recount-finish"));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(apiMock.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("ach-recount-finish"));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/achievements/recount/finish"));
    expect(confirmMock.mock.calls[1][0]).toEqual(expect.objectContaining({ title: "Neuberechnung abschließen?", confirmLabel: "Abschließen" }));
    expect(confirmMock.mock.calls[1][0].description).toContain("kein Discord");
    expect(await screen.findByTestId("ach-recount-finish-state")).toHaveTextContent("Läuft: 0 von 40 Konten ausgewertet");
    expect(screen.getByTestId("ach-recount-finish")).toBeDisabled();
  });

  it("sperrt den Abschluss, wenn er fertig ist oder keine Neuberechnung angelegt ist", async () => {
    apiMock.get.mockResolvedValueOnce({ data: { ...ACTIVE, active: false, ended_at: "2026-11-12T08:00:00+00:00", finish: { done: true, notified: 7, finished_at: "2026-11-12T08:05:00+00:00" } } });
    const { unmount } = render(<RecountPanel />);
    expect(await screen.findByTestId("ach-recount-finish-state")).toHaveTextContent("7 Sammel-Nachrichten");
    expect(screen.getByTestId("ach-recount-mode")).toHaveTextContent("Aus seit");
    expect(screen.getByTestId("ach-recount-finish")).toBeDisabled();
    unmount();

    apiMock.get.mockResolvedValueOnce({ data: { exists: false, active: false, dry_run: { running: false }, finish: { running: false } } });
    render(<RecountPanel />);
    expect(await screen.findByTestId("ach-recount-mode")).toHaveTextContent("Keine Neuberechnung angelegt");
    expect(screen.getByTestId("ach-recount-finish")).toBeDisabled();
    expect(screen.getByTestId("ach-recount-dry-run")).not.toBeDisabled();
  });

  it("nennt einen Fehler des Servers", async () => {
    apiMock.get.mockResolvedValue({ data: ACTIVE });
    apiMock.post.mockRejectedValue({ response: { data: { detail: "Ein Probelauf läuft schon." } } });
    render(<RecountPanel />);
    fireEvent.click(await screen.findByTestId("ach-recount-dry-run"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Ein Probelauf läuft schon."));
  });

  it("beschreibt einen unterbrochenen Abschluss", () => {
    expect(finishLabel({ interrupted: true, evaluated: 12, users_total: 40 })).toBe("Unterbrochen bei 12 von 40 Konten – „Neuberechnung abschließen“ setzt fort");
    expect(finishLabel({ running: true, phase: "notify", notified: 3 })).toBe("Läuft: Sammel-Nachrichten – 3 verschickt");
  });
});
