import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Wächter (#1353): Knöpfe der Verwaltung hängen an dem Recht, das auch der Server prüft - `canUseArea(...)`,
// `isTournamentLead` oder die Felder je Turnier (`can_manage_results`, `can_check_in` …). „isAdmin“ heißt im Web
// „irgendein Verwaltungsbereich“: eine Redaktion mit Helfer-Einsatz sah damit „Neues Turnier“ und „Löschen“, die der
// Server ablehnt. Der Test sucht `isAdmin` und `isAnyAdmin` in pages/admin und meldet jeden Treffer. Eine Ausnahme kommt
// nur begründet in die Liste unten.

const ADMIN_PAGES = path.resolve(__dirname, "../pages/admin");

// Datei (relativ zu pages/admin) → Begründung. Leer ist das Ziel.
const ALLOWED = {};

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

test("keine Knöpfe nach „irgendein Adminbereich“ in der Verwaltung", () => {
  const hits = [];
  for (const file of files(ADMIN_PAGES)) {
    const rel = path.relative(ADMIN_PAGES, file).split(path.sep).join("/");
    if (ALLOWED[rel]) continue;
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
      if (/\bisAdmin\b|\bisAnyAdmin\b/.test(line)) hits.push(`${rel}:${index + 1}: ${line.trim()}`);
    });
  }
  expect(hits).toEqual([]);
});

test("jede Ausnahme hat eine Begründung und gibt es noch", () => {
  for (const [rel, reason] of Object.entries(ALLOWED)) {
    expect(String(reason).trim().length).toBeGreaterThan(10);
    expect(() => statSync(path.join(ADMIN_PAGES, rel))).not.toThrow();
  }
});
