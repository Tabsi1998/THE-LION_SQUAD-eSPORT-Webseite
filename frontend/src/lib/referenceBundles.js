import { leaguePath } from "@/lib/referencesOverview";

// Referenzen bündeln (#1751): Anzeige-Logik des Assistenten - ohne Oberfläche, damit sie für sich getestet ist. Gruppen,
// Saisons, Plätze und Hinweise rechnet der Server (services/reference_bundles.py); hier wird nur nach der Auswahl
// gefiltert und beschriftet.

export const VISIBILITY_LABELS = { public: "Öffentlich", community: "Community", members: "Mitglieder", internal: "Intern" };

export const HINT_LABELS = {
  missing_date: "Ohne Datum",
  duplicate: "Doppelt",
  placement_conflict: "Platzierung widersprüchlich",
  tightened: "Wird strenger",
  stricter_than_season: "Strenger als die Saison",
  season_has_reference: "Saison hat schon eine Referenz",
};

/** Hinweise, die vor dem Bündeln einen Blick verdienen (Warnfarbe); die übrigen sind nur zur Info. */
export const WARN_HINTS = new Set(["missing_date", "duplicate", "placement_conflict", "season_has_reference"]);

/** Vorauswahl: alle Referenzen der Gruppe. */
export function initialSelection(group) {
  return new Set((group?.references || []).map((ref) => ref.id));
}

/** Die Saisons der Vorschau nur mit den gewählten Referenzen - Saisons ohne gewählte Referenz fallen weg. */
export function selectedSeasons(group, selected) {
  return (group?.seasons || [])
    .map((season) => ({ ...season, reference_ids: (season.reference_ids || []).filter((id) => selected.has(id)) }))
    .filter((season) => season.reference_ids.length > 0);
}

/** Hinweise, die eine gewählte Referenz betreffen. */
export function selectedHints(group, selected) {
  return (group?.hints || []).filter((hint) => (hint.reference_ids || []).some((id) => selected.has(id)));
}

/** Liga-Weg der Vorschau - dieselbe Rechnung wie auf der Übersicht. */
export function previewPath(group, selected) {
  return leaguePath(selectedSeasons(group, selected), group?.lineage?.tier_order);
}

/** „2 Referenzen · 1 neue Saison · 1 vorhandene“ */
export function bundleSummary(group, selected) {
  const seasons = selectedSeasons(group, selected);
  const fresh = seasons.filter((season) => !season.id).length;
  const kept = seasons.length - fresh;
  const count = selected.size;
  const parts = [`${count} ${count === 1 ? "Referenz" : "Referenzen"}`];
  if (fresh) parts.push(`${fresh} ${fresh === 1 ? "neue Saison" : "neue Saisons"}`);
  if (kept) parts.push(`${kept} vorhandene`);
  return parts.join(" · ");
}

/** „Season 1 · Division 3“ */
export function seasonText(season) {
  return [season.season, season.tier].filter(Boolean).join(" · ");
}

/** Ergebnis einer Rücknahme in einem Satz. */
export function undoText(result) {
  if (!result) return "";
  const parts = [`${result.unlinked} ${result.unlinked === 1 ? "Referenz gelöst" : "Referenzen gelöst"}`];
  if (result.series_removed) parts.push(`${result.series_removed} ${result.series_removed === 1 ? "Saison entfernt" : "Saisons entfernt"}`);
  if (result.series_kept?.length) parts.push(`${result.series_kept.length} geänderte ${result.series_kept.length === 1 ? "Saison bleibt" : "Saisons bleiben"}`);
  if (result.lineage_removed) parts.push("Spur entfernt");
  return parts.join(" · ");
}
