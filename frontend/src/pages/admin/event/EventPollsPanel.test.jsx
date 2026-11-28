import { emptyPollForm, pollFormError, pollFormFromPlans } from "./EventPollsPanel";

// Abstimmung über die Ort-Pläne (#2612/#2613, Review-Befund 10): lange Plan-Namen werden zur Antwort gekürzt statt mit
// 400 abgelehnt; die Maske prüft die Länge selbst.

test("lange Plan-Namen: die Antwort wird auf 80 Zeichen gekürzt, mit …", () => {
  const long = "Rodelbahn ".repeat(12).trim();
  const form = pollFormFromPlans([{ key: "plan-a", label: "Plan A", name: long }, { key: "plan-b", label: "Plan B", name: "Vereinsheim" }]);
  expect(form.options[0].label.length).toBe(80);
  expect(form.options[0].label.endsWith("…")).toBe(true);
  expect(form.options[0].label.startsWith("Plan A: Rodelbahn")).toBe(true);
  expect(form.options[1]).toEqual({ code: "plan-b", label: "Plan B: Vereinsheim" });
  expect(pollFormError(form)).toBe("");
});

test("die Maske meldet zu lange Antworten selbst", () => {
  const form = { ...emptyPollForm(), question: "Wohin?", options: [{ code: "", label: "x".repeat(81) }, { code: "", label: "Garten" }] };
  expect(pollFormError(form)).toBe("Antwort 1: höchstens 80 Zeichen.");
});
