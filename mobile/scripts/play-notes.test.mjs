import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Versionshinweis für Google Play (19.10.2026): der Text, den der Betreiber beim Hochladen des Bundles in die Play
// Console kopiert. Er steht je Version in PLAY_NOTES.md und wird vor jedem Release geprüft - Kopfzeile, Punkte
// untereinander mit „•“, höchstens 500 Zeichen (Grenze von Google Play).

const require = createRequire(import.meta.url);
const { PLAY_NOTES_FILE, loadPlayNotes, playNotesLength, playNotesProblems, playNotesSection } = require("./play-notes.cjs");
const { RELEASE_NOTES_LIMIT } = require("./play-publish.cjs");

const FILE = [
  "# Versionshinweise für Google Play",
  "",
  "Kopf mit Regeln - gehört zu keiner Version.",
  "",
  "## 1.7.1",
  "",
  "Neu in 1.7.1:",
  "• Weiterkommen in vier Modi",
  "• Fast Lap: Versuche und Gäste wie auf der Website",
  "",
  "## 1.7.1-beta",
  "",
  "Neu in 1.7.1-beta:",
  "• Nur die Beta",
  "",
  "## 1.7.0",
  "",
  "Neu in 1.7.0:",
  "• Turnierbaum",
  "",
].join("\n");

test("der Abschnitt gehört genau zu seiner Version, ohne Kopf und Leerzeilen außen", () => {
  assert.equal(playNotesSection(FILE, "1.7.1"), "Neu in 1.7.1:\n• Weiterkommen in vier Modi\n• Fast Lap: Versuche und Gäste wie auf der Website");
  assert.equal(playNotesSection(FILE, "1.7.1-beta"), "Neu in 1.7.1-beta:\n• Nur die Beta");
  assert.equal(playNotesSection(FILE, "1.7.0"), "Neu in 1.7.0:\n• Turnierbaum");
  assert.equal(playNotesSection(FILE, "9.9.9"), null);
  assert.equal(playNotesSection("", "1.7.1"), null);
});

test("Windows-Zeilenenden zählen nicht doppelt", () => {
  const crlf = FILE.replace(/\n/g, "\r\n");
  const text = playNotesSection(crlf, "1.7.1");
  assert.equal(text, playNotesSection(FILE, "1.7.1"));
  assert.doesNotMatch(text, /\r/);
});

test("ein gültiger Hinweis hat keine Probleme, die Länge zählt Umbrüche mit", () => {
  const text = playNotesSection(FILE, "1.7.1");
  assert.deepEqual(playNotesProblems(text, "1.7.1"), []);
  assert.equal(playNotesLength(text), text.length);
  assert.equal(playNotesLength("Neu in 1.0.0:\n• A"), 17);
});

test("genau 500 Zeichen gehen, 501 nicht", () => {
  const head = "Neu in 1.7.1:\n• ";
  const exact = head + "x".repeat(RELEASE_NOTES_LIMIT - head.length);
  assert.equal(playNotesLength(exact), 500);
  assert.deepEqual(playNotesProblems(exact, "1.7.1"), []);
  const problems = playNotesProblems(`${exact}x`, "1.7.1");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /501 Zeichen/);
  assert.match(problems[0], /höchstens 500/);
});

test("fehlt der Abschnitt, sagt die Prüfung, wo er hingehört", () => {
  const problems = playNotesProblems(null, "1.8.0");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /PLAY_NOTES\.md/);
  assert.match(problems[0], /## 1\.8\.0/);
});

test("die Kopfzeile muss die Version des Releases nennen", () => {
  const problems = playNotesProblems("Neu in 1.7.0:\n• Turnierbaum", "1.7.1");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Neu in 1\.7\.1:/);
});

test("ohne Punkt mit „•“ gilt der Hinweis nicht", () => {
  assert.match(playNotesProblems("Neu in 1.7.1:", "1.7.1").join(" "), /mindestens einen Punkt/);
  assert.match(playNotesProblems("Neu in 1.7.1:\n- Turnierbaum", "1.7.1").join(" "), /„• “/);
});

test("jeder Punkt steht in einer eigenen Zeile mit „•“", () => {
  const problems = playNotesProblems("Neu in 1.7.1:\n• Turnierbaum\nund noch mehr", "1.7.1");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /und noch mehr/);
});

test("loadPlayNotes liest PLAY_NOTES.md aus dem App-Ordner und prüft die Version", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lionsapp-play-notes-"));
  try {
    const missing = loadPlayNotes(dir, "1.7.1");
    assert.equal(missing.text, null);
    assert.match(missing.problems[0], /PLAY_NOTES\.md/);

    await writeFile(path.join(dir, PLAY_NOTES_FILE), FILE.replace(/\n/g, "\r\n"));
    const found = loadPlayNotes(dir, "1.7.1");
    assert.deepEqual(found.problems, []);
    assert.equal(found.text, playNotesSection(FILE, "1.7.1"));
    assert.equal(found.length, found.text.length);

    assert.match(loadPlayNotes(dir, "1.8.0").problems[0], /## 1\.8\.0/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("die App im Repo hat einen gültigen Versionshinweis für ihre Version", async () => {
  const mobileDir = fileURLToPath(new URL("..", import.meta.url));
  const pkg = require("../package.json");
  const notes = loadPlayNotes(mobileDir, pkg.version);
  assert.deepEqual(notes.problems, []);
  assert.ok(notes.length <= RELEASE_NOTES_LIMIT);
});
