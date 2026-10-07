import fs from "fs";
import path from "path";
import { APP_TOPICS, TOPIC_SCAN_DIRS } from "./topics";

// Wächter „Jedes Thema an genau einem Ort“ (#1150): kommt irgendwo ein zweiter Weg zu einem der elf Themen dazu, schlägt
// dieser Test an - und nennt die Datei. Links von außen und Benachrichtigungen (navigation/) führen zum selben Ort.

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const full = path.join(SRC, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [relative] : [];
  });
}

const FILES = TOPIC_SCAN_DIRS.flatMap(sourceFiles);
const read = (file: string) => fs.readFileSync(path.join(SRC, file), "utf8");

test("die elf Themen: jedes genau ein Ort - kein zweiter Weg im Quelltext", () => {
  expect(APP_TOPICS).toHaveLength(11);
  expect(FILES.length).toBeGreaterThan(50);
  for (const topic of APP_TOPICS) {
    const found = FILES.filter((file) => topic.pattern.test(read(file)) && file !== topic.self).sort();
    expect([topic.topic, found]).toEqual([topic.topic, [...topic.files].sort()]);
  }
});

test("Thema → Ort steht für jedes Thema da, und jedes Ziel ist ein echter Screen", () => {
  for (const topic of APP_TOPICS) {
    expect(topic.place.length).toBeGreaterThan(3);
    for (const file of [...topic.files, ...(topic.self ? [topic.self] : [])]) expect(fs.existsSync(path.join(SRC, file))).toBe(true);
  }
  // Die Screens der App, aus der einen Liste, die auch der Navigator nimmt (screenRegistry.ts).
  const screens = new Set([...read("navigation/screenRegistry.ts").matchAll(/^\s{2}(\w+): \w+Screen,\r?$/gm)].map((match) => match[1]));
  expect(screens.size).toBeGreaterThan(30);
  for (const gone of ["MoreHub", "MemberArea", "DirectMessages", "FastLapList", "TeamList"]) expect(screens.has(gone)).toBe(false);
  for (const kept of ["MyInvoices", "MyMembership", "Gallery", "Settings", "Notifications", "AchievementShowcase"]) expect(screens.has(kept)).toBe(true);
});
