// Abschnittsnamen im Turnierbaum (#1591) - eine Wahrheit mit dem Server. Die Listen stehen in bracketSections.json und
// spiegeln services/round_labels.py (MAIN_SECTIONS, LOSER_SECTIONS, FINAL_SECTIONS, BRONZE_SECTIONS) 1:1; beide Seiten
// prüfen das (bracketSections.test.js, backend/tests/test_bracket_sections_unit.py). Web-Baum, TV, Podium und Namen
// lesen nur von hier.
import SECTIONS from "./bracketSections.json";

export const MAIN_SECTIONS = new Set(SECTIONS.main);
export const LOSER_SECTIONS = new Set(SECTIONS.loser);
export const FINAL_SECTIONS = new Set(SECTIONS.final);
export const BRONZE_SECTIONS = new Set(SECTIONS.bronze);

/** Der Abschnittsname, wie der Server ihn vergleicht: klein, ohne Leerraum am Rand. */
export function sectionKey(section) {
  return String(section || "").trim().toLowerCase();
}

/** Wie `section_kind` am Server: „main“, „loser“, „grand_final“, „bronze“ oder „group“. */
export function sectionKind(section) {
  const key = sectionKey(section);
  if (BRONZE_SECTIONS.has(key)) return "bronze";
  if (FINAL_SECTIONS.has(key)) return "grand_final";
  if (LOSER_SECTIONS.has(key)) return "loser";
  if (key.startsWith("group_") || key === "round_robin") return "group";
  return "main";
}
