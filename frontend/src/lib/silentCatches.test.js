import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Wächter für stille Fehlerfänger (#2412, Rest aus #937): ein `.catch(() => {})` schluckt jeden Fehler. Das ist nur
// richtig, wenn ein Fehlschlag dort niemandem fehlt (Zählpixel, Lesemarke, Hintergrund-Update) - dann steht der Grund
// direkt daneben, in einem Kommentar mit „Bewusst still:“ (in der Zeile oder bis zu drei Zeilen darüber). Alles andere
// meldet den Fehler: als Zustand der Seite (PublicErrorState, LoadNotice) oder mit toastLoadFailed (lib/loadProblem.js).

const SRC = path.join(process.cwd(), "src");
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;
const SOURCE_FILE = /\.[jt]sx?$/;
const SILENT = ".catch(() => {})";
const MARKER = "Bewusst still:";

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return SOURCE_FILE.test(name) && !TEST_FILE.test(name) ? [full] : [];
  });
}

function unexplained() {
  const found = [];
  for (const file of sourceFiles(SRC)) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.includes(SILENT)) return;
      const around = lines.slice(Math.max(0, index - 3), index + 1).join("\n");
      if (!around.includes(MARKER)) found.push(`${path.relative(SRC, file).split(path.sep).join("/")}:${index + 1}`);
    });
  }
  return found;
}

test("jeder stille Fehlerfänger nennt seinen Grund („Bewusst still:“) - sonst wird der Fehler gemeldet", () => {
  expect(unexplained()).toEqual([]);
});
