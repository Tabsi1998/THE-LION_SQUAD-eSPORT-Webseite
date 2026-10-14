import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../e2e/fixtures/matchplanGenerated.json";

// Matchplan-Seite (#1557): „Automatisch planen“ holt die Vorschau des Planers, „Übernehmen“ schickt Fingerabdruck und
// Anker der gesehenen Vorschau. Ist der Plan inzwischen anders (409), sagt die Seite das in Worten und plant neu -
// geschrieben wird nie etwas anderes als gezeigt. Antworten: echte Routen (scripts/make_matchplan_fixture.py).

const post = vi.fn();
const patch = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { post: (...args) => post(...args), patch: (...args) => patch(...args) },
  formatRequestError: (error, fallback) => error?.response?.data?.detail || fallback,
}));
vi.mock("sonner", () => ({ toast: { message: vi.fn(), success: vi.fn(), error: vi.fn() } }));

const { applySchedulePlan, moveMatch, releaseSchedule, requestSchedulePlan } = await import("./schedulePlan");

function conflict(detail) {
  const error = new Error("409");
  error.response = { status: 409, data: { detail } };
  return error;
}

beforeEach(() => {
  post.mockReset();
  patch.mockReset();
});

describe("Vorschau holen", () => {
  it("fragt den Planer und gibt seine Antwort unverändert weiter", async () => {
    post.mockResolvedValueOnce({ data: fixture.local.preview.plan });
    const plan = await requestSchedulePlan("t 1");
    expect(post).toHaveBeenCalledWith("/tournaments/t%201/schedule/plan");
    expect(plan).toBe(fixture.local.preview.plan);
  });
});

describe("Übernehmen", () => {
  const plan = fixture.local.preview.plan;

  it("schickt Fingerabdruck und Anker der gezeigten Vorschau", async () => {
    post.mockResolvedValueOnce({ data: fixture.local.apply_response });
    const result = await applySchedulePlan("t1", plan);
    expect(post).toHaveBeenCalledWith("/tournaments/t1/schedule/apply", { fingerprint: plan.fingerprint, planned_at: plan.planned_at });
    expect(result).toEqual({ ok: true, written: fixture.local.apply_response.written });
  });

  it("409: der Plan hat sich geändert - Hinweis in Worten, neu planen statt überschreiben", async () => {
    post.mockRejectedValueOnce(conflict(fixture.local.errors.stale_apply.detail));
    const result = await applySchedulePlan("t1", plan);
    expect(result).toEqual({ ok: false, stale: true, message: fixture.local.errors.stale_apply.detail });
  });

  it("andere Fehler sagen, was schiefging", async () => {
    post.mockRejectedValueOnce(Object.assign(new Error("weg"), { response: { status: 500, data: {} } }));
    const result = await applySchedulePlan("t1", plan);
    expect(result).toEqual({ ok: false, stale: false, message: "Spielplan konnte nicht übernommen werden." });
  });
});

describe("Spiel verschieben (Ziehen oder Tastatur)", () => {
  it("setzt Zeit und Station über den bestehenden Weg - das macht den Termin fest", async () => {
    patch.mockResolvedValueOnce({ data: { id: "m1", schedule_source: "manual" } });
    const result = await moveMatch("m1", { start: Date.parse("2026-10-31T15:05:00Z"), stationId: "s2" });
    expect(patch).toHaveBeenCalledWith("/matches/m1", { scheduled_at: "2026-10-31T15:05:00.000Z", station_id: "s2" });
    expect(result).toEqual({ ok: true });
  });

  it("ohne Station bleibt die Station leer", async () => {
    patch.mockResolvedValueOnce({ data: {} });
    await moveMatch("m1", { start: Date.parse("2026-10-31T15:05:00Z"), stationId: "none" });
    expect(patch).toHaveBeenCalledWith("/matches/m1", { scheduled_at: "2026-10-31T15:05:00.000Z", station_id: null });
  });

  it("Station belegt (409 vom Server): die Antwort steht als Grund da", async () => {
    patch.mockRejectedValueOnce(conflict(fixture.local.errors.station_taken.detail));
    const result = await moveMatch("m1", { start: Date.now(), stationId: "s1" });
    expect(result).toEqual({ ok: false, message: "Station ist in diesem Zeitraum bereits belegt (A)." });
  });

  it("Termin lösen: leer gesetzt plant der Planer das Spiel wieder", async () => {
    patch.mockResolvedValueOnce({ data: {} });
    await moveMatch("m1", { release: true });
    expect(patch).toHaveBeenCalledWith("/matches/m1", { scheduled_at: null });
  });
});


describe("Alle Termine von Hand lösen (Praxis 14.10.)", () => {
  it("schickt den Umfang und gibt die Zahl der gelösten Spiele zurück", async () => {
    post.mockResolvedValueOnce({ data: { released: 14, match_ids: [], scope: "all" } });
    expect(await releaseSchedule("t1", "all")).toEqual({ ok: true, released: 14 });
    expect(post).toHaveBeenCalledWith("/tournaments/t1/schedule/release", { scope: "all" });
  });

  it("nur gelöschte Stationen", async () => {
    post.mockResolvedValueOnce({ data: { released: 13 } });
    await releaseSchedule("t1", "missing_stations");
    expect(post).toHaveBeenCalledWith("/tournaments/t1/schedule/release", { scope: "missing_stations" });
  });

  it("ein Fehler steht in Worten da", async () => {
    post.mockRejectedValueOnce(Object.assign(new Error("x"), { response: { status: 403, data: { detail: "Keine Turnierberechtigung" } } }));
    expect(await releaseSchedule("t1", "all")).toEqual({ ok: false, message: "Keine Turnierberechtigung" });
  });
});
