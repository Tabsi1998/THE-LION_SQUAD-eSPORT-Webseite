import { ScanGate, canAdmit, quorumText, rememberAdmission, resultFromError, resultFromScan, rowText } from "./admission";

// Einlass (#845): wer ihn sieht, die Zahlen, was groß steht, die Liste, und die Sperre gegen Dauerscans.

jest.mock("./api", () => ({ api: { get: jest.fn(), post: jest.fn() }, errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback) }));

test("nur der Bereich „Verein“ sieht den Einlass", () => {
  expect(canAdmit({ id: "u", email: "", username: "", areas: ["club"] })).toBe(true);
  expect(canAdmit({ id: "u", email: "", username: "", areas: ["content"] })).toBe(false);
  expect(canAdmit({ id: "u", email: "", username: "" })).toBe(false);
  expect(canAdmit(null)).toBe(false);
});

test("Zahlen zur Beschlussfähigkeit - derselbe Satz wie im Web", () => {
  expect(quorumText(null)).toBe("Noch niemand eingelassen.");
  expect(quorumText({ present: 12, eligible: 20, quorum_from: 11, quorum_reached: true })).toBe("12 anwesend · 20 stimmberechtigt eingeladen · beschlussfähig ab 11 Stimmen – beschlussfähig");
  expect(quorumText({ present: 3, eligible: 20, quorum_from: 11, quorum_reached: false })).toContain("noch nicht beschlussfähig");
});

test("Ergebnis: grün mit Stimmrecht, gelb ohne, rot bei Fehler - Text vom Server, sonst ein eigener", () => {
  const voting = { member_id: 7, name: "Paula Muster", state: "present", voting: true };
  expect(resultFromScan({ ok: true, admission: voting, headline: "Anwesend: Paula Muster, stimmberechtigt", detail: "ab 18:02" })).toEqual({ tone: "ok", headline: "Anwesend: Paula Muster, stimmberechtigt", detail: "ab 18:02" });
  expect(resultFromScan({ ok: true, already: true, admission: { ...voting, voting: false } })).toEqual({ tone: "info", headline: "Schon da: Paula Muster", detail: "" });
  expect(resultFromError(new Error("Karte abgelaufen."))).toEqual({ tone: "error", headline: "Nicht eingelassen", detail: "Karte abgelaufen." });
  expect(resultFromError({}, "Nicht zurückgenommen")).toEqual({ tone: "error", headline: "Nicht zurückgenommen", detail: "Dolibarr hat nicht geantwortet." });
});

test("Liste: neue Zeile nach oben, dieselbe Person einmal, höchstens 20, Zahlen neu", () => {
  const meeting = { id: 1, title: "GV", counts: { present: 1, eligible: 9, quorum_from: 5, quorum_reached: false }, recent: Array.from({ length: 20 }, (_, i) => ({ member_id: i + 100, name: `M${i}`, state: "present" })) };
  const next = rememberAdmission(meeting, { admission: { member_id: 105, name: "M5", state: "present", voting: true }, counts: { present: 2, eligible: 9, quorum_from: 5, quorum_reached: false } });
  expect(next.recent?.[0].member_id).toBe(105);
  expect(next.recent).toHaveLength(20);
  expect(next.recent?.filter((row) => row.member_id === 105)).toHaveLength(1);
  expect(next.counts?.present).toBe(2);
  expect(rememberAdmission(meeting, { admission: { member_id: 1, name: "Neu" } }).counts).toBe(meeting.counts);
  expect(rowText({ member_id: 1, name: "A", state: "present", arrived: "18:02", reason_text: "stimmberechtigt" })).toBe("ab 18:02 · stimmberechtigt");
  expect(rowText({ member_id: 1, name: "A", state: "present" })).toBe("");
  expect(rowText({ member_id: 1, name: "A", state: "undone", undo_reason: "falscher Ausweis" })).toBe("zurückgenommen: falscher Ausweis");
});

test("Sperre: derselbe Code erst nach sechs Sekunden wieder, nach jedem Scan 2,5 Sekunden Ruhe", () => {
  const gate = new ScanGate();
  expect(gate.accept("card-1", 1000)).toBe(true);
  expect(gate.accept("card-1", 1500)).toBe(false);
  expect(gate.accept("card-2", 2000)).toBe(false);
  expect(gate.accept("card-2", 3600)).toBe(true);
  expect(gate.accept("card-2", 6200)).toBe(false);
  expect(gate.accept("card-2", 9700)).toBe(true);
  expect(gate.accept("   ", 20000)).toBe(false);
  gate.reset();
  expect(gate.accept("card-2", 9800)).toBe(true);
});
