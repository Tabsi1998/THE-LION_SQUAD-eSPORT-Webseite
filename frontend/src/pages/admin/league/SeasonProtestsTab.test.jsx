// Reiter „Proteste“ der Season-Seite (#1619, E.2): Eingang der Verfahren und die Einstellungen je Season.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SeasonProtestsTab, protestSettingsPayload, reasonKeyFor } from "./SeasonProtestsTab";

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock("@/lib/api", () => ({ api, formatApiError: (detail) => (typeof detail === "string" ? detail : "") }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SETTINGS = {
  protest_hours: 48, statement_hours: 48, protest_target_hours: 72, appeal_hours: 48, moss_upload_hours: 24, evidence_keep_days: 30,
  contested_result_mode: "counts",
  protest_reasons: [
    { key: "wrong_result", label: "Falsches Ergebnis", ask_notified: false },
    { key: "equipment", label: "Ausrüstung", ask_notified: true },
  ],
};
const VIEW = { settings: SETTINGS, active: false, defaults: SETTINGS, limits: { protest_hours: { min: 1, max: 336 } }, reasons_max: 20, fixed_reasons: ["wrong_result"] };
const ITEMS = [
  { id: "p1", match_id: "m1", staffel: "Liga 1 · Staffel A", sides: ["Rudel A", "Horst"], side_name: "Horst", kind_label: "Protest", reason_label: "Falsches Ergebnis",
    state: "open", conflict: false, assignee: null, statement: { due_at: "2099-01-01T12:00:00Z" } },
  { id: "p2", match_id: "m2", staffel: "Liga 1 · Staffel A", sides: ["Rudel B", "Horst"], kind_label: "Beanstandung", state: "open", conflict: true },
];

function renderTab(props = {}) {
  return render(<MemoryRouter><SeasonProtestsTab seasonId="s1" canSeason canDisputes {...props} /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/procedures") ? { items: ITEMS, open: 2 } : VIEW }));
  api.put.mockResolvedValue({ data: { ...VIEW, active: true, staffeln_updated: 2 } });
});

describe("Reiter Proteste", () => {
  it("zeigt den Eingang: was wartet, wer übernommen hat - und Befangenen keine Einzelheiten", async () => {
    renderTab();
    expect(await screen.findByTestId("season-procedures-count")).toHaveTextContent("2 Verfahren warten");
    expect(screen.getByTestId("season-procedure-p1")).toHaveTextContent("Protest · Falsches Ergebnis");
    expect(screen.getByTestId("season-procedure-p1")).toHaveTextContent("Noch nicht übernommen");
    expect(screen.getByTestId("season-procedure-open-p1")).toHaveAttribute("href", "/matches/m1#verfahren-p1");
    expect(screen.getByTestId("season-procedure-conflict-p2")).toHaveTextContent("selbst beteiligt");
    expect(screen.queryByTestId("season-procedure-open-p2")).toBeNull();
  });

  it("lädt den Eingang nur für die Zuständigkeit „Proteste“", async () => {
    renderTab({ canDisputes: false });
    expect(await screen.findByTestId("season-protest-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("season-procedures")).toBeNull();
    expect(api.get).not.toHaveBeenCalledWith("/admin/leagues/seasons/s1/procedures");
  });

  it("speichert Fristen, Tabelle und Gründe und sagt, in wie vielen Staffeln es gilt", async () => {
    renderTab();
    expect(await screen.findByTestId("protest-settings-defaults")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("protest-settings-protest_hours"), { target: { value: "72" } });
    fireEvent.change(screen.getByTestId("protest-settings-mode"), { target: { value: "excluded" } });
    expect(screen.queryByTestId("protest-reason-remove-0")).toBeNull();
    fireEvent.click(screen.getByTestId("protest-reason-add"));
    fireEvent.change(screen.getByTestId("protest-reason-label-2"), { target: { value: "Stream-Verzögerung" } });
    fireEvent.click(screen.getByTestId("protest-reason-ask-2"));
    fireEvent.click(screen.getByTestId("protest-settings-save"));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const [url, body] = api.put.mock.calls[0];
    expect(url).toBe("/admin/leagues/seasons/s1/protest-settings");
    expect(body.protest_hours).toBe(72);
    expect(body.contested_result_mode).toBe("excluded");
    expect(body.protest_reasons[2]).toEqual({ key: "stream_verzoegerung", label: "Stream-Verzögerung", ask_notified: true });
    await waitFor(() => expect(screen.queryByTestId("protest-settings-defaults")).toBeNull());
  });

  it("zeigt ohne „Season konfigurieren“ die Werte nur an", async () => {
    renderTab({ canSeason: false });
    expect(await screen.findByTestId("protest-settings-protest_hours")).toBeDisabled();
    expect(screen.queryByTestId("protest-settings-save")).toBeNull();
  });
});

describe("Anfrage und Schlüssel", () => {
  it("schickt ganze Zahlen und lässt leere neue Gründe weg", () => {
    const payload = protestSettingsPayload({ ...SETTINGS, protest_hours: "24", statement_hours: "",
      protest_reasons: [{ key: "other", label: "Sonstiges", fixed: true }, { key: "grund_2", label: "  ", fresh: true }] });
    expect(payload.protest_hours).toBe(24);
    expect(payload).not.toHaveProperty("statement_hours");
    expect(payload.protest_reasons).toEqual([{ key: "other", label: "Sonstiges", ask_notified: false }]);
  });

  it("baut einen eindeutigen Schlüssel aus der Bezeichnung", () => {
    expect(reasonKeyFor("Stream-Verzögerung")).toBe("stream_verzoegerung");
    expect(reasonKeyFor("Technik", ["technik"])).toBe("technik_2");
    expect(reasonKeyFor("???")).toBe("grund");
  });
});
