import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Einlass bei der Generalversammlung (#845): Scan → großes Ergebnis und neue Zahlen; Nummer ohne Karte; Rücknahme nur
// mit Grund; eine Ablehnung steht rot mit dem Satz des Servers; ohne Versammlung heute nur der Hinweis.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/QrScanner", () => ({
  QrScanner: ({ onCode, paused }) => (
    <button type="button" disabled={paused} onClick={() => onCode("https://lionsquad.at/karte/pruefen/AbCdEfGh1234")} data-testid="fake-scan">scan</button>
  ),
}));

const { default: AdminAdmissionPage, quorumText } = await import("./AdminAdmissionPage");

const COUNTS = { present: 1, eligible: 3, quorum_from: 2, quorum_reached: false };
const MEETING = { id: 5, title: "Generalversammlung 2026", time: "18:00", place: "Vereinsheim", counts: null, recent: [] };
const PAULA = { member_id: 12, name: "Paula B.", state: "present", voting: true, reason_text: "stimmberechtigt", arrived: "18:58", by_name: "Otto", undo_reason: "" };

beforeEach(() => {
  vi.clearAllMocks();
});

function show() {
  return render(<MemoryRouter><AdminAdmissionPage /></MemoryRouter>);
}

test("Beschlussfähigkeit in Worten", () => {
  expect(quorumText(null)).toBe("Noch niemand eingelassen.");
  expect(quorumText(COUNTS)).toBe("1 anwesend · 3 stimmberechtigt eingeladen · beschlussfähig ab 2 Stimmen – noch nicht beschlussfähig");
  expect(quorumText({ ...COUNTS, present: 2, quorum_reached: true })).toContain("– beschlussfähig");
});

test("Scan: groß das Ergebnis, neue Zahlen, Zeile mit Rücknahme nur mit Grund", async () => {
  apiMock.get.mockResolvedValue({ data: { ready: true, meetings: [MEETING] } });
  apiMock.post.mockImplementation(async (url, body) => {
    if (url.endsWith("/scan")) return { data: { ok: true, already: false, headline: "Anwesend: Paula B.", detail: "stimmberechtigt", admission: PAULA, counts: COUNTS } };
    return { data: { ok: true, admission: { ...PAULA, state: "absent", voting: false, reason_text: "nicht anwesend", undo_reason: body.reason }, counts: { ...COUNTS, present: 0 } } };
  });
  show();
  expect(await screen.findByTestId("admission-counts")).toHaveTextContent("Noch niemand eingelassen.");
  fireEvent.click(screen.getByTestId("fake-scan"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/admission/5/scan", { code: "https://lionsquad.at/karte/pruefen/AbCdEfGh1234" }));
  expect(await screen.findByTestId("admission-result")).toHaveTextContent("Anwesend: Paula B.stimmberechtigt");
  expect(screen.getByTestId("admission-counts")).toHaveTextContent("1 anwesend · 3 stimmberechtigt eingeladen");
  expect(screen.getByTestId("admission-row-12")).toHaveTextContent("ab 18:58 · stimmberechtigt");

  fireEvent.click(screen.getByTestId("admission-undo-12"));
  expect(screen.getByTestId("admission-undo-confirm")).toBeDisabled();
  fireEvent.change(screen.getByTestId("admission-undo-reason"), { target: { value: "falscher Ausweis" } });
  fireEvent.click(screen.getByTestId("admission-undo-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/admission/5/undo", { member_id: 12, reason: "falscher Ausweis" }));
  await waitFor(() => expect(screen.getByTestId("admission-row-12")).toHaveTextContent("zurückgenommen: falscher Ausweis"));
  expect(screen.getByTestId("admission-counts")).toHaveTextContent("0 anwesend");
});

test("Nummer ohne Karte; eine Ablehnung steht rot mit dem Satz des Servers", async () => {
  apiMock.get.mockResolvedValue({ data: { ready: true, meetings: [{ ...MEETING, counts: COUNTS, recent: [PAULA] }] } });
  apiMock.post.mockRejectedValue({ response: { data: { detail: "Du hast heute keine Funktion im Vorstand – einlassen darf nur der Vorstand." } } });
  show();
  fireEvent.change(await screen.findByTestId("admission-number"), { target: { value: "13" } });
  fireEvent.click(screen.getByTestId("admission-number-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/admission/5/scan", { number: "13" }));
  const result = await screen.findByTestId("admission-result");
  expect(result).toHaveTextContent("Nicht eingelassen");
  expect(result).toHaveTextContent("keine Funktion im Vorstand");
});

test("ohne Versammlung heute nur der Hinweis", async () => {
  apiMock.get.mockResolvedValue({ data: { ready: false, reason: "no_meeting", text: "Heute ist keine Generalversammlung, zu der du eingeladen bist.", meetings: [] } });
  show();
  expect(await screen.findByTestId("admission-not-ready")).toHaveTextContent("Heute ist keine Generalversammlung");
  expect(screen.queryByTestId("fake-scan")).toBeNull();
});
