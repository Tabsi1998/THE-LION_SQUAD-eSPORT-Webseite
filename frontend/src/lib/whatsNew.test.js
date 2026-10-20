import { readFileSync } from "node:fs";
import path from "node:path";
import { WHATS_NEW_LIMIT, WHATS_NEW_SEEN_KEY, hasNewSince, markWhatsNewSeen, newestMark, shouldShowDot, whatsNewItems } from "./whatsNew";

// „Neu auf der Website“ (#1240): Liste, Punkt-Logik mit Rückfall ohne Browser-Speicher und ein Wächter über die
// gepflegte Datei - Datum, ein Satz, keine Ticketnummern.

function fakeWindow(initial = {}) {
  const data = { ...initial };
  return {
    data,
    localStorage: {
      getItem: (key) => (key in data ? data[key] : null),
      setItem: (key, value) => { data[key] = String(value); },
    },
    dispatchEvent: vi.fn(),
  };
}

const ITEMS = whatsNewItems({ items: [
  { date: "2026-09-01", text: "Alt." },
  { date: "2026-10-20", text: "Neu eins.", link: "/fastlap" },
  { date: "2026-10-20", text: "Neu zwei.", link: "https://example.org" },
  { date: "kaputt", text: "Ohne Datum." },
  { date: "2026-10-01", text: "  " },
] });

test("Liste: die neuesten oben, gleicher Tag in Datei-Reihenfolge, ungültige raus, nur eigene Links", () => {
  expect(ITEMS.map((item) => item.text)).toEqual(["Neu eins.", "Neu zwei.", "Alt."]);
  expect(ITEMS[0].link).toBe("/fastlap");
  expect(ITEMS[1].link).toBeNull();
  const many = Array.from({ length: 40 }, (_, index) => ({ date: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`, text: `Satz ${index}.` }));
  expect(whatsNewItems(many)).toHaveLength(WHATS_NEW_LIMIT);
  expect(whatsNewItems(null)).toEqual([]);
});

test("hasNewSince: neuerer Tag oder mehr Einträge am selben Tag", () => {
  expect(newestMark(ITEMS)).toEqual({ date: "2026-10-20", count: 2 });
  expect(hasNewSince(ITEMS, { date: "2026-10-01", count: 5 })).toBe(true);
  expect(hasNewSince(ITEMS, { date: "2026-10-20", count: 1 })).toBe(true);
  expect(hasNewSince(ITEMS, { date: "2026-10-20", count: 2 })).toBe(false);
  expect(hasNewSince(ITEMS, { date: "2026-11-01", count: 0 })).toBe(false);
  expect(hasNewSince([], { date: "2026-10-20", count: 0 })).toBe(false);
});

test("Punkt: erster Besuch merkt sich den Stand ohne Punkt, danach nur bei Neuem; Öffnen löscht ihn", () => {
  const win = fakeWindow();
  expect(shouldShowDot(ITEMS, win)).toBe(false);
  expect(JSON.parse(win.data[WHATS_NEW_SEEN_KEY])).toEqual({ date: "2026-10-20", count: 2 });
  expect(shouldShowDot(ITEMS, win)).toBe(false);

  const later = whatsNewItems([{ date: "2026-10-25", text: "Ganz neu." }, ...ITEMS]);
  expect(shouldShowDot(later, win)).toBe(true);
  markWhatsNewSeen(later, win);
  expect(shouldShowDot(later, win)).toBe(false);
  expect(win.dispatchEvent).toHaveBeenCalled();
});

test("Rückfall: ohne oder mit kaputtem Browser-Speicher kein Punkt und kein Fehler", () => {
  expect(shouldShowDot(ITEMS, null)).toBe(false);
  const blocked = { get localStorage() { throw new Error("gesperrt"); } };
  expect(shouldShowDot(ITEMS, blocked)).toBe(false);
  expect(() => markWhatsNewSeen(ITEMS, blocked)).not.toThrow();
  const broken = fakeWindow({ [WHATS_NEW_SEEN_KEY]: "{kein json" });
  expect(shouldShowDot(ITEMS, broken)).toBe(false);
});

// Wächter über die gepflegte Datei: wer einen Eintrag ergänzt, hält sich an die Form.
const file = JSON.parse(readFileSync(path.join(process.cwd(), "src/whatsnew.json"), "utf8"));

test("whatsnew.json: jeder Eintrag mit gültigem Datum und genau einem Satz, ohne Ticketnummern und Planungskürzel", () => {
  expect(Array.isArray(file.items)).toBe(true);
  expect(file.items.length).toBeGreaterThan(0);
  for (const item of file.items) {
    expect(Object.keys(item).every((key) => ["date", "text", "link"].includes(key))).toBe(true);
    expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(new Date(`${item.date}T12:00:00Z`).getTime())).toBe(false);
    expect(item.text.trim()).toBe(item.text);
    expect(item.text).toMatch(/[.!]$/);
    expect(item.text, "ein Satz je Neuerung").not.toMatch(/[.!?] [A-ZÄÖÜ]/);
    expect(item.text, "keine Ticketnummern").not.toMatch(/#\d+/);
    expect(item.text, "keine Planungskürzel").not.toMatch(/\b(PR|Issue|Ticket|Meilenstein|Sprint|TODO)\b/i);
    if (item.link !== undefined) expect(item.link).toMatch(/^\/(?!\/)/);
  }
  expect(whatsNewItems(file)).toHaveLength(Math.min(file.items.length, WHATS_NEW_LIMIT));
});
