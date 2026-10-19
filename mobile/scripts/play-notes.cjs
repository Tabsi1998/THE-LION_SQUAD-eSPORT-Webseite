// Versionshinweis für Google Play (19.10.2026): der Text, den der Betreiber beim Hochladen des Bundles in den offenen
// Test der Play Console kopiert. Er steht je Version in PLAY_NOTES.md, kurz und für Mitglieder geschrieben - nicht die
// langen „Was ist neu“-Punkte aus dem Changelog, die Play bei 500 Zeichen abschneiden müsste.
//
// Geprüft wird vor jedem Release (Preflight und release:local): Abschnitt da, Kopfzeile „Neu in <Version>:“, jeder
// Punkt in einer eigenen Zeile mit „• “, höchstens 500 Zeichen inklusive Zeilenumbrüchen.
const fs = require("fs");
const path = require("path");
const { RELEASE_NOTES_LIMIT } = require("./play-publish.cjs");

const PLAY_NOTES_FILE = "PLAY_NOTES.md";
const BULLET = "• ";

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Der Text unter „## <Version>“ bis zum nächsten Abschnitt; null, wenn es ihn nicht gibt. Zeilenenden immer \n. */
function playNotesSection(markdown, version) {
  const header = new RegExp(`^## ${escapeRegExp(version)}\\s*$`);
  const lines = String(markdown || "").split(/\r?\n/);
  const start = lines.findIndex((line) => header.test(line));
  if (start < 0) return null;
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    body.push(line.trimEnd());
  }
  return body.join("\n").trim();
}

/** So zählt Google Play: jedes Zeichen, Zeilenumbrüche mit. */
function playNotesLength(text) {
  return String(text || "").trim().length;
}

/** Was am Hinweis für diese Version nicht stimmt - leer, wenn er so in die Play Console darf. */
function playNotesProblems(text, version) {
  if (text === null || text === undefined || !String(text).trim()) {
    return [`${PLAY_NOTES_FILE}: Abschnitt „## ${version}“ mit dem Versionshinweis für Google Play fehlt.`];
  }
  const problems = [];
  const [head, ...rest] = String(text).trim().split("\n");
  const title = `Neu in ${version}:`;
  if (head.trim() !== title) {
    problems.push(`${PLAY_NOTES_FILE}, ## ${version}: die erste Zeile muss „${title}“ lauten, nicht „${head.trim()}“.`);
  }
  const lines = rest.map((line) => line.trim()).filter(Boolean);
  const bullets = lines.filter((line) => line.startsWith(BULLET));
  if (!bullets.length) {
    problems.push(`${PLAY_NOTES_FILE}, ## ${version}: mindestens einen Punkt mit „${BULLET}“ am Zeilenanfang eintragen.`);
  } else {
    for (const line of lines.filter((entry) => !entry.startsWith(BULLET))) {
      problems.push(`${PLAY_NOTES_FILE}, ## ${version}: jeder Punkt steht in einer eigenen Zeile mit „${BULLET}“ – „${line}“ nicht.`);
    }
  }
  const length = playNotesLength(text);
  if (length > RELEASE_NOTES_LIMIT) {
    problems.push(`${PLAY_NOTES_FILE}, ## ${version}: ${length} Zeichen, Google Play nimmt höchstens ${RELEASE_NOTES_LIMIT} (inklusive Zeilenumbrüchen). Kürzen.`);
  }
  return problems;
}

/** Liest PLAY_NOTES.md aus dem App-Ordner: Text, Länge und Probleme für diese Version. */
function loadPlayNotes(mobileDir, version) {
  let markdown = "";
  try {
    markdown = fs.readFileSync(path.join(mobileDir, PLAY_NOTES_FILE), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const text = playNotesSection(markdown, version);
  return { text, length: playNotesLength(text), problems: playNotesProblems(text, version) };
}

module.exports = { BULLET, PLAY_NOTES_FILE, loadPlayNotes, playNotesLength, playNotesProblems, playNotesSection };
