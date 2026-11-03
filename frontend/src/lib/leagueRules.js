// Regelwerk der Liga (docs/LIGA.md, #1646): Adressen, Inhaltsverzeichnis, Suche in der Seite und Helfer der Pflege. Abschnitte, Anker und
// Vergleich rechnet der Server - Web und PDF zeigen dieselben.
import { renderMarkdownLite } from "@/lib/markdownLite";
import { dayNoon, viennaDate } from "@/lib/vienna";

const LONG_DAY = { day: "2-digit", month: "2-digit", year: "numeric" };
const SEARCH_MIN = 2;
const HIT = "tls-rules-hit";
const ACTIVE_HIT = "tls-rules-hit-active";

// Bilder im Editor und in der Gestaltung der Liga (#2230): Die Admin-Medien gehen über die Rolle (upload_routes), Zuständigkeiten öffnen sie nicht. Wer sie nicht hat, nimmt wie jedes
// Konto die eigenen Bilder - sonst wäre das Hochladen auf dieser Seite für Zuständige immer ein 403.
const ADMIN_MEDIA_ROLES = ["admin", "tournament_admin", "club_admin", "superadmin"];

export function rulesMediaProps(user) {
  return ADMIN_MEDIA_ROLES.includes(user?.role) ? {} : { mediaScope: "user", libraryEndpoint: "/media?type=images" };
}

export function rulesApiPath(league, season) {
  return season ? `/league-rules/seasons/${league}/${season}` : `/league-rules/leagues/${league}`;
}

export function rulesPagePath(league, season) {
  return season ? `/liga/${league}/${season}/regeln` : `/liga/${league}/regeln`;
}

export function dayLabel(day) {
  return day ? viennaDate(dayNoon(day), LONG_DAY) : "";
}

/** Das Inhaltsverzeichnis: Überschriften bis Ebene 2, Anlagen als eigener Block. */
export function tocOf(sections = []) {
  const rows = sections.filter((row) => row.title && row.level <= 2);
  return { main: rows.filter((row) => row.kind !== "annex"), annexes: rows.filter((row) => row.kind === "annex") };
}

/** „Neu in Version X“ als Liste: Geändertes und Neues führt zum Abschnitt, Entferntes gibt es nur noch als Titel. */
export function changeRows(changes) {
  return [
    ...(changes?.changed || []).map((row) => ({ kind: "changed", word: "Geändert", anchor: row.anchor, title: row.title || "Einleitung" })),
    ...(changes?.new || []).map((row) => ({ kind: "new", word: "Neu", anchor: row.anchor, title: row.title || "Einleitung" })),
    ...(changes?.removed || []).map((row) => ({ kind: "removed", word: "Entfernt", anchor: null, title: row.title || "Einleitung" })),
  ];
}

// Wie auf dem Server (`game_maps.IMAGE_URL`): Bilder nur aus dem eigenen Upload - eine fremde Adresse ließe jede Person beim Lesen bei
// Dritten anfragen.
const OWN_UPLOAD = /^\/api\/static\/uploads\/[A-Za-z0-9][A-Za-z0-9_.-]{0,150}\.(png|webp|jpg|jpeg)(\?v=\d+)?$/;

export function isOwnUpload(address) {
  return OWN_UPLOAD.test(String(address || ""));
}

/** Optionen für Markdown im Regelwerk - auch für die Vorschau im Editor. */
// `escapes` (#2218): Namen in Bausteinen tragen einen Backslash vor Steuerzeichen und bleiben Text - wie im PDF.
export const RULES_MARKDOWN = { linkMentions: false, anchorLinksInPage: true, imageAllowed: isOwnUpload, escapes: true };

/** Markdown wie überall im Projekt (maskiert, nur sichere Elemente); Sprünge bleiben in der Seite, „@“ wird kein Profil-Link. */
export function renderRulesMarkdown(markdown) {
  return renderMarkdownLite(markdown, RULES_MARKDOWN);
}

// ---------------------------------------------------------------- Suche in der Seite

/** Jeder Treffer als Range - ohne Eingriff in den Text, damit React seine Knoten behält. */
export function findRanges(root, query) {
  const needle = String(query || "").trim();
  if (!root || needle.length < SEARCH_MIN) return [];
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT);
  const ranges = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const match of node.nodeValue.matchAll(pattern)) {
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      ranges.push(range);
    }
  }
  return ranges;
}

function highlights() {
  return window.CSS?.highlights && window.Highlight ? window.CSS.highlights : null;
}

/** Färbt die Treffer (CSS Custom Highlight); ohne die Schnittstelle bleiben Zähler und Sprung. */
export function paintHits(ranges, activeIndex) {
  const registry = highlights();
  if (!registry) return;
  registry.set(HIT, new window.Highlight(...ranges));
  if (ranges[activeIndex]) registry.set(ACTIVE_HIT, new window.Highlight(ranges[activeIndex]));
  else registry.delete(ACTIVE_HIT);
}

export function clearHits() {
  const registry = highlights();
  registry?.delete(HIT);
  registry?.delete(ACTIVE_HIT);
}

// ---------------------------------------------------------------- Pflege

export function annexLabel(index) {
  return `Anlage ${String.fromCharCode(65 + index)}`;
}

export function addAnnex(annexes = []) {
  return [...annexes, { title: "", body_md: "" }];
}

export function removeAnnex(annexes, index) {
  return annexes.filter((_row, position) => position !== index);
}

export function moveAnnex(annexes, index, step) {
  const target = index + step;
  if (target < 0 || target >= annexes.length) return annexes;
  const next = [...annexes];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Ein Baustein steht als eigener Absatz am Ende des Texts. */
export function insertBlock(body, token) {
  const text = String(body || "").trimEnd();
  return `${text}${text ? "\n\n" : ""}${token}\n`;
}
