import { checkKey, warningSummary, warningsByField } from "./referenceChecks";

// Prüfung beim Speichern einer Referenz (#1755): Warnungen des Servers je Feld.

test("Warnungen werden dem Feld zugeordnet, mehrere am selben Feld bleiben zusammen", () => {
  const grouped = warningsByField([
    { field: "end_date", code: "too_long", message: "Zu lang" },
    { field: "end_date", code: "end_in_future", message: "Zukunft" },
    { field: "entries.1.placement", code: "placement_above_count", message: "Platz zu hoch" },
    { field: "", message: "ohne Feld" },
  ]);
  expect(grouped).toEqual({ end_date: ["Zu lang", "Zukunft"], "entries.1.placement": ["Platz zu hoch"] });
  expect(warningsByField(undefined)).toEqual({});
});

test("neu geprüft wird nur, wenn sich Datum, Status oder Platz und Teilnehmerzahl ändern", () => {
  const base = { title: "A", start_date: "2026-01-01", end_date: "2026-01-02", status: "completed", entries: [{ placement: 2, participant_count: 8, team_name: "X" }] };
  expect(checkKey({ ...base, title: "B", entries: [{ ...base.entries[0], team_name: "Y" }] })).toBe(checkKey(base));
  expect(checkKey({ ...base, end_date: "2027-01-02" })).not.toBe(checkKey(base));
  expect(checkKey({ ...base, entries: [{ placement: 9, participant_count: 8 }] })).not.toBe(checkKey(base));
});

test("die Meldung nach dem Speichern zählt die Hinweise", () => {
  expect(warningSummary([])).toBe("");
  expect(warningSummary([{}])).toBe("Gespeichert – 1 Hinweis zur Prüfung.");
  expect(warningSummary([{}, {}])).toBe("Gespeichert – 2 Hinweise zur Prüfung.");
});
