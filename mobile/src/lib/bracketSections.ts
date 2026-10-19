// Abschnittsnamen im Turnierbaum (#1633, wie #1591 im Web) - eine Wahrheit mit dem Server. Die Listen spiegeln
// backend/services/round_labels.py (MAIN_SECTIONS, LOSER_SECTIONS, FINAL_SECTIONS, BRONZE_SECTIONS) 1:1; der Test
// gleicht sie mit frontend/src/lib/bracketSections.json ab (die Quelle von Web und TV). So steht „[FINAL]“ in der App wie
// am Server und im Web als Grand Final, „BR“ als Spiel um Platz 3. Baum, Podium, Namen und Spielplan lesen nur von hier.

export const MAIN_SECTIONS = new Set(["", "main", "wb", "winner", "winners"]);
export const LOSER_SECTIONS = new Set(["lb", "loser", "losers", "lower", "lower_bracket", "loser bracket", "looser"]);
export const FINAL_SECTIONS = new Set(["gf", "grand_final", "grand final", "final"]);
export const BRONZE_SECTIONS = new Set(["bronze", "br", "spiel um platz 3", "platz 3"]);

export type SectionKind = "main" | "loser" | "grand_final" | "bronze" | "group";

/** Der Abschnittsname, wie der Server ihn vergleicht: klein, ohne Leerraum am Rand. */
export function sectionKey(section?: string | null) {
  return String(section || "").trim().toLowerCase();
}

/** Wie `section_kind` am Server: „main“, „loser“, „grand_final“, „bronze“ oder „group“. */
export function sectionKind(section?: string | null): SectionKind {
  const key = sectionKey(section);
  if (BRONZE_SECTIONS.has(key)) return "bronze";
  if (FINAL_SECTIONS.has(key)) return "grand_final";
  if (LOSER_SECTIONS.has(key)) return "loser";
  if (key.startsWith("group_") || key === "round_robin") return "group";
  return "main";
}
