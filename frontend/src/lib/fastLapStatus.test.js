import { archiveBlocked, F1_STATUS_LABELS, statusFilterOptions, statusOptionsFor } from "./fastLapStatus";

const values = (rows) => rows.map(([value]) => value);

test("Einreichungs-Status: im Feld nur, wenn die Challenge ihn schon trägt", () => {
  expect(values(statusOptionsFor("live"))).not.toContain("registration_open");
  expect(values(statusOptionsFor("registration_open"))).toContain("registration_open");
  expect(values(statusOptionsFor("registration_open"))).not.toContain("registration_closed");
});

test("Filter: alle Status mit denselben Namen wie im Feld, Einreichung nur mit Treffern", () => {
  const plain = statusFilterOptions({});
  expect(values(plain)).toEqual(expect.arrayContaining(["paused", "completed", "results_published"]));
  expect(values(plain)).not.toContain("registration_closed");
  expect(values(statusFilterOptions({ registration_closed: 1 }))).toContain("registration_closed");
  expect(F1_STATUS_LABELS.completed).toBe("Beendet");
  expect(F1_STATUS_LABELS.results_published).toBe("Ergebnisse veröffentlicht");
});

test("Archiv: mit Zeiten erst nach dem Veröffentlichen oder einer Absage", () => {
  expect(archiveBlocked({ status: "completed", participant_count: 2 })).toBe(true);
  expect(archiveBlocked({ status: "live", participant_count: 1 })).toBe(true);
  expect(archiveBlocked({ status: "completed", participant_count: 0 })).toBe(false);
  expect(archiveBlocked({ status: "results_published", participant_count: 2 })).toBe(false);
  expect(archiveBlocked({ status: "cancelled", participant_count: 2 })).toBe(false);
  expect(archiveBlocked(null)).toBe(false);
});
