import { kaderLine } from "./staffelPage";

// Kader-Hinweis je Co-Team (#2262): Wer nicht spielberechtigt ist, steht nach Grund getrennt da - eine Kontosperre oder eine
// Nachmeldung ist keine fehlende Spiel-ID (Stände aus services/league_roster.py: missing, format, taken, late, banned).

const squad = (players, extra = {}) => ({ member_count: players.length, min_squad_size: 4, short: false, players, ...extra });

test("alle spielberechtigt: Größe und „alle IDs gültig“", () => {
  expect(kaderLine(squad([{ ok: true, state: "locked" }, { ok: true, state: "pending" }]))).toEqual({ text: "2 im Kader · alle IDs gültig", warn: false });
});

test("fehlende, falsche oder vergebene ID zählt als „ohne gültige ID“", () => {
  const line = kaderLine(squad([{ ok: false, state: "missing" }, { ok: false, state: "format" }, { ok: false, state: "taken" }, { ok: true, state: "locked" }]));
  expect(line).toEqual({ text: "4 im Kader · 3 ohne gültige ID", warn: true });
});

test("gesperrt und nachgemeldet stehen mit eigenem Grund da, nicht als fehlende ID", () => {
  const line = kaderLine(squad([{ ok: false, state: "banned" }, { ok: false, state: "late" }, { ok: false, state: "late" }, { ok: true, state: "locked" }]));
  expect(line.text).toBe("4 im Kader · 1 gesperrt · 2 warten auf Freigabe");
  expect(line.text).not.toMatch(/ID/);
  expect(line.warn).toBe(true);
});

test("gemischt in fester Reihenfolge, unter Mindestkader als Warnung", () => {
  const line = kaderLine(squad([{ ok: false, state: "late" }, { ok: false, state: "missing" }, { ok: false, state: "banned" }], { short: true }));
  expect(line.text).toBe("3 im Kader · 1 ohne gültige ID · 1 gesperrt · 1 wartet auf Freigabe · unter Mindestkader 4");
});

test("ohne Kaderübersicht kein Hinweis", () => {
  expect(kaderLine(null)).toBeNull();
});
