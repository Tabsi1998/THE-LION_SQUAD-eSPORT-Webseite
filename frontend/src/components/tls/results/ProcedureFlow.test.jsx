// Liga-Verfahren (#1619, E.2): das geführte Formular „Problem melden“ und die Karte des Verfahrens je Rolle.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProblemReportForm } from "./ProblemReportForm";
import { AppealForm, ProcedureCard } from "./DisputeCard";
import { ProofList } from "./ProofList";

const { api, uploadApi } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }, uploadApi: { post: vi.fn() } }));
vi.mock("@/lib/api", () => ({ api, uploadApi, formatApiError: (detail) => (typeof detail === "string" ? detail : "") }));

const GUIDE = {
  kind: "protest", kind_label: "Protest", until: "2099-01-01T12:00:00Z", open: true, result_reason: "wrong_result", reason_min: 10, reason_max: 1000,
  reasons: [
    { key: "wrong_result", label: "Falsches Ergebnis", ask_notified: false },
    { key: "equipment", label: "Ausrüstung", ask_notified: true },
  ],
  incidents: [{ id: "v-1", position: 2, kind: "disconnect" }],
};
const SIDES = [{ id: "reg-a", name: "Rudel A" }, { id: "reg-b", name: "Horst" }];
const NAMES = { "reg-a": "Rudel A", "reg-b": "Horst" };
const TEXT = "Die zweite Map wurde falsch gemeldet.";

function procedure(extra = {}) {
  return {
    id: "p1", kind: "protest", kind_label: "Protest", state: "open", at: "2026-11-11T10:00:00Z", side: "reg-b", own: false, opponent: false,
    reason_key: "wrong_result", reason_label: "Falsches Ergebnis", reason: TEXT, additions: [], evidence_until: "2099-01-01T12:00:00Z",
    statement: { side: "reg-a", due_at: "2099-01-02T12:00:00Z", extended: false, text: null, at: null, expired: false },
    assignee: null, target_at: null, moss_requests: [], can_amend: false, can_withdraw: false, can_state: false, can_lead: false,
    own_decision: false, can_appeal: false, ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ data: { items: [], open: true, can_add: false, limit: 10 } });
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });
});

describe("Problem melden, geführt", () => {
  it("zeigt die Art von selbst und fragt nur, was der Grund verlangt", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<ProblemReportForm matchId="m1" guide={GUIDE} sides={SIDES} onSubmit={onSubmit} />);
    expect(screen.getByTestId("procedure-kind-label")).toHaveTextContent("Protest");
    expect(screen.queryByTestId("procedure-details")).toBeNull();

    fireEvent.click(screen.getByTestId("match-dispute-reason-equipment"));
    expect(screen.getByTestId("procedure-notified")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("match-dispute-input"), { target: { value: TEXT } });
    fireEvent.click(screen.getByTestId("match-dispute-btn"));
    expect(await screen.findByTestId("match-dispute-error")).toHaveTextContent("sofort");
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("procedure-notified-no"));
    fireEvent.change(screen.getByTestId("procedure-incident"), { target: { value: "v-1" } });
    fireEvent.click(screen.getByTestId("match-dispute-btn"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ reason: TEXT, reason_key: "equipment", notified_immediately: false, incident_id: "v-1" }));
  });

  it("verlangt bei „Falsches Ergebnis“ das abweichende Ergebnis", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<ProblemReportForm matchId="m1" guide={GUIDE} sides={SIDES} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId("match-dispute-reason-wrong_result"));
    expect(screen.queryByTestId("procedure-notified")).toBeNull();
    fireEvent.change(screen.getByTestId("match-dispute-input"), { target: { value: TEXT } });
    fireEvent.click(screen.getByTestId("match-dispute-btn"));
    expect(await screen.findByTestId("match-dispute-error")).toHaveTextContent("Ergebnis angeben");
    fireEvent.change(screen.getByTestId("procedure-claimed-0"), { target: { value: "1" } });
    fireEvent.change(screen.getByTestId("procedure-claimed-1"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("match-dispute-btn"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].claimed.results).toEqual([{ registration_id: "reg-a", score: 1 }, { registration_id: "reg-b", score: 2 }]);
  });

  it("führt nach dem Einreichen zu den Nachweisen", async () => {
    const onDone = vi.fn();
    render(<ProblemReportForm matchId="m1" guide={GUIDE} sides={SIDES} onSubmit={vi.fn()} createdId="p1" onDone={onDone} />);
    expect(screen.getByTestId("procedure-step-proofs")).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/matches/m1/proofs", { params: { kind: "protest", ref_id: "p1" } }));
    fireEvent.click(screen.getByTestId("procedure-done"));
    expect(onDone).toHaveBeenCalled();
  });

  it("bleibt ohne Liga beim Formular der Turniere", () => {
    render(<ProblemReportForm matchId="m1" onSubmit={vi.fn()} />);
    expect(screen.getByTestId("match-dispute-btn")).toHaveTextContent("An die Turnierleitung schicken");
    expect(screen.queryByTestId("procedure-steps")).toBeNull();
  });
});

describe("Einspruch", () => {
  it("fragt erst nach dem Knopf nach der Begründung und schickt dann genau einen Einspruch", async () => {
    const onChanged = vi.fn();
    render(<AppealForm matchId="m1" against={{ type: "forfeit", ref_id: "m1" }} until="2099-01-01T12:00:00Z" onChanged={onChanged} testId="match-appeal" />);
    expect(screen.getByTestId("match-appeal-until")).toHaveTextContent("noch");
    expect(screen.queryByTestId("match-appeal-input")).toBeNull();
    fireEvent.click(screen.getByTestId("match-appeal-open"));
    expect(screen.getByTestId("match-appeal-send")).toBeDisabled();
    fireEvent.change(screen.getByTestId("match-appeal-input"), { target: { value: "Wir waren da, der Check-in hing." } });
    fireEvent.click(screen.getByTestId("match-appeal-send"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/matches/m1/appeals",
      { against_type: "forfeit", ref_id: "m1", reason: "Wir waren da, der Check-in hing." }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("steht an der Karte eines entschiedenen Verfahrens nur, solange Einspruch möglich ist", () => {
    const decided = { state: "decided", decision: "keep", decision_note: "Die Aufzeichnung bestätigt die Meldung.", appeal_until: "2099-01-01T12:00:00Z" };
    const { rerender } = render(<ProcedureCard matchId="m1" sideNames={NAMES} onChanged={vi.fn()} procedure={procedure({ ...decided, can_appeal: true })} />);
    expect(screen.getByTestId("procedure-appeal-p1-open")).toBeInTheDocument();
    rerender(<ProcedureCard matchId="m1" sideNames={NAMES} onChanged={vi.fn()} procedure={procedure({ ...decided, can_appeal: false })} />);
    expect(screen.queryByTestId("procedure-appeal-p1-open")).toBeNull();
  });
});

describe("Hinweis zu Nachweisen", () => {
  it("steht in der Karte einmal, nicht unter jeder Liste", async () => {
    api.get.mockResolvedValue({ data: { items: [], open: true, can_add: true, limit: 10 } });
    render(<ProcedureCard matchId="m1" sideNames={NAMES} onChanged={vi.fn()} procedure={procedure({ can_lead: true, can_state: true })} />);
    expect(await screen.findByTestId("procedure-moss-proofs-p1-add")).toBeInTheDocument();
    expect(screen.getAllByText(/Ingame-Uhr/)).toHaveLength(1);
    expect(screen.getByTestId("procedure-proof-hint-p1")).toHaveTextContent("Höchstens 10 Nachweise je Seite");
  });

  it("bleibt an einer einzelnen Liste, wie sie war", async () => {
    api.get.mockResolvedValue({ data: { items: [], open: true, can_add: true, limit: 10 } });
    render(<ProofList matchId="m1" kind="report" />);
    expect(await screen.findByTestId("proof-list-hint")).toHaveTextContent("Ingame-Uhr");
  });
});

describe("MOSS-Datei", () => {
  it("schickt die ZIP über den Upload-Host und Bilder wie bisher", async () => {
    api.get.mockResolvedValue({ data: { items: [], open: true, can_add: true, limit: 10 } });
    uploadApi.post.mockResolvedValue({ data: {} });
    render(<ProofList matchId="m1" kind="moss" refId="p1" />);
    const zip = new File(["PK"], "moss.zip", { type: "application/zip" });
    fireEvent.change(await screen.findByTestId("proof-list-zip-input"), { target: { files: [zip] } });
    await waitFor(() => expect(uploadApi.post).toHaveBeenCalledTimes(1));
    expect(uploadApi.post.mock.calls[0][0]).toBe("/matches/m1/proofs");
    expect(uploadApi.post.mock.calls[0][1].get("file")).toBe(zip);
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("proof-list-input"), { target: { files: [new File(["x"], "bild.png", { type: "image/png" })] } });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(uploadApi.post).toHaveBeenCalledTimes(1);
  });

  it("bietet die ZIP nur am Bezug MOSS an", async () => {
    api.get.mockResolvedValue({ data: { items: [], open: true, can_add: true, limit: 10 } });
    render(<ProofList matchId="m1" kind="protest" refId="p1" />);
    expect(await screen.findByTestId("proof-list-gallery")).toBeInTheDocument();
    expect(screen.queryByTestId("proof-list-zip")).toBeNull();
  });
});

describe("Karte des Verfahrens", () => {
  it("zeigt der Gegenseite Grund, abweichendes Ergebnis, Frist und das Feld für die Stellungnahme", async () => {
    const onChanged = vi.fn();
    const claimed = { results: [{ registration_id: "reg-a", score: 1 }, { registration_id: "reg-b", score: 2 }] };
    render(<ProcedureCard matchId="m1" procedure={procedure({ opponent: true, can_state: true, claimed })} sideNames={NAMES} onChanged={onChanged} />);
    expect(screen.getByTestId("procedure-reason-p1")).toHaveTextContent(TEXT);
    expect(screen.getByTestId("procedure-statement-until-p1")).toHaveTextContent("noch");
    expect(screen.getByTestId("procedure-claimed-p1")).toHaveTextContent("Rudel A 1 : 2 Horst");
    expect(screen.queryByTestId("procedure-lead-p1")).toBeNull();
    expect(screen.getByTestId("procedure-assignee-p1")).toHaveTextContent("Noch von niemandem übernommen");

    fireEvent.change(screen.getByTestId("procedure-statement-input-p1"), { target: { value: "Aus unserer Sicht stimmt die Meldung." } });
    fireEvent.click(screen.getByTestId("procedure-statement-send-p1"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/matches/m1/procedures/p1/statement", { text: "Aus unserer Sicht stimmt die Meldung." }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("lässt die eigene Seite ergänzen und erst nach Rückfrage zurückziehen", async () => {
    const claimed = { results: [{ registration_id: "reg-a", score: 1 }, { registration_id: "reg-b", score: 2 }] };
    render(<ProcedureCard matchId="m1" procedure={procedure({ own: true, can_amend: true, can_withdraw: true, claimed })} sideNames={NAMES} onChanged={vi.fn()} />);
    expect(screen.getByTestId("procedure-claimed-p1")).toHaveTextContent("Rudel A 1 : 2 Horst");
    fireEvent.click(screen.getByTestId("procedure-withdraw-p1"));
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByTestId("procedure-withdraw-p1")).toHaveTextContent("Wirklich zurückziehen?");
    fireEvent.click(screen.getByTestId("procedure-withdraw-p1"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/matches/m1/procedures/p1/withdraw"));
  });

  it("gibt der Leitung Übernehmen, MOSS und die Entscheidung nur mit Begründung", async () => {
    const onChangeResult = vi.fn();
    render(<ProcedureCard matchId="m1" procedure={procedure({ can_lead: true })} sideNames={NAMES} players={[{ id: "u1", name: "Mila", side: "reg-a" }]}
      onChanged={vi.fn()} onChangeResult={onChangeResult} />);
    fireEvent.click(screen.getByTestId("procedure-assign-p1"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/matches/m1/procedures/p1/assign", {}));
    expect(screen.getByTestId("procedure-keep-p1")).toBeDisabled();
    expect(screen.getByTestId("procedure-change-p1")).toBeDisabled();
    fireEvent.change(screen.getByTestId("procedure-note-p1"), { target: { value: "Die Aufzeichnung bestätigt die Meldung." } });
    fireEvent.click(screen.getByTestId("procedure-change-p1"));
    expect(onChangeResult).toHaveBeenCalledWith("Die Aufzeichnung bestätigt die Meldung.");
    fireEvent.click(screen.getByTestId("procedure-keep-p1"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/matches/m1/procedures/p1/decision",
      { decision: "keep", decision_note: "Die Aufzeichnung bestätigt die Meldung." }));
    fireEvent.change(screen.getByTestId("procedure-moss-player-p1"), { target: { value: "u1" } });
    fireEvent.click(screen.getByTestId("procedure-moss-request-p1"));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/matches/m1/procedures/p1/moss-requests", { user_id: "u1" }));
  });

  it("zeigt die Entscheidung mit Begründung und sagt, wer nicht entscheiden darf", () => {
    const { rerender } = render(<ProcedureCard matchId="m1" sideNames={NAMES} onChanged={vi.fn()}
      procedure={procedure({ state: "decided", decision: "keep", decision_note: "Die Aufzeichnung bestätigt die Meldung.", resolved_at: "2026-11-12T10:00:00Z" })} />);
    expect(screen.getByTestId("procedure-decision-p1")).toHaveTextContent("Das Ergebnis bleibt.");
    expect(screen.getByTestId("procedure-decision-p1")).toHaveTextContent("Die Aufzeichnung bestätigt die Meldung.");
    expect(screen.queryByTestId("procedure-deadlines-p1")).toBeNull();
    rerender(<ProcedureCard matchId="m1" sideNames={NAMES} onChanged={vi.fn()} procedure={procedure({ kind: "appeal", kind_label: "Einspruch", own_decision: true, against: { type: "protest_decision", ref_id: "p0" } })} />);
    expect(screen.getByTestId("procedure-own-decision-p1")).toHaveTextContent("andere Person");
    expect(screen.queryByTestId("procedure-lead-p1")).toBeNull();
  });
});
