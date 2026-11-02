// Kader unter Mindestgröße (docs/LIGA.md, #2202): Abgänge aus einem Co-Team bleiben möglich. Der Server sagt je Co-Team, was
// seine laufende Staffel verlangt (`league_requirement`) - hier nur der Vergleich und der Satz für die Rückfrage.

/** Was aus dem Kader wird, wenn er so aussieht: `null`, wenn er nicht kleiner wird oder weiter reicht. */
export function shortageAfter(squad, memberIdsAfter) {
  const needed = squad?.league_requirement?.min_size;
  const size = new Set(memberIdsAfter || []).size;
  if (!needed || size >= needed || size >= new Set(squad.member_ids || []).size) return null;
  return { name: squad.name, size, min: needed, title: squad.league_requirement.title };
}

/** Der Satz für die Rückfrage; leer, wenn kein Kader zu klein wird. */
export function shortageWarning(shortages) {
  if (!shortages?.length) return "";
  const parts = shortages.map(({ name, size, min, title }) => `„${name}“ unter den Mindestkader${title ? ` (${title})` : ""}: noch ${size} von mindestens ${min} Spielern`);
  return `Damit fällt ${parts.join(", und ")}. Das bleibt möglich, Team und Turnierleitung bekommen eine Warnung.`;
}

/** Verlässt jemand das Team, verlässt er jeden Kader seiner Co-Teams. */
export function departureWarning(squads, userId) {
  const rows = Array.isArray(squads) ? squads : [];
  return shortageWarning(rows
    .filter((squad) => (squad.member_ids || []).includes(userId))
    .map((squad) => shortageAfter(squad, squad.member_ids.filter((id) => id !== userId)))
    .filter(Boolean));
}
