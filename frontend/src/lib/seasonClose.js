// Saison abschließen (#1750): die Logik hinter Vorschlag, „Referenz: Platz 6 von 8“, der Auswahl „Gehört zur Saison“ im
// Referenz-Formular und dem Ziel der Referenz-Karte - ohne Oberfläche, damit sie für sich getestet ist. Gerechnet wird
// nur Anzeige: Platz und Feldgröße kommen vom Server (services/season_close.py).

/** „Probe Liga · 2026 · Division 2“ - wie der Server die Saison einer Referenz nennt. */
export function seasonName(lineage, series) {
  return [lineage?.title, series?.season, series?.tier].filter(Boolean).join(" · ");
}

/** „Platz 6 von 8 Teams · Tabelle“, „Platz 3 von 12 · Fahrerwertung“ oder „Ohne Platz · Saison abgebrochen“. */
export function entryLine(entry) {
  const place = Number(entry?.placement) || null;
  const field = entry?.kind === "solo" ? entry?.participant_count : entry?.team_count;
  const text = place ? `Platz ${place}${field ? ` von ${field}${entry?.kind === "solo" ? "" : " Teams"}` : ""}` : "Ohne Platz";
  return [text, entry?.placement_label].filter(Boolean).join(" · ");
}

/** Wer der Eintrag ist: das Team mit seinem Namen, ein Einzelstarter mit der Person. */
export function entryName(entry) {
  if (entry?.kind === "solo") return entry.members?.[0]?.name || "Einzelstarter";
  return entry?.team_name || "Team";
}

/** „Platz 6 von 8“ für den Kopf der Saison; ohne Platz „Teilnahme“, ohne Referenz leer. */
export function referenceLine(current) {
  if (!current) return "";
  if (!current.placement) return "Teilnahme";
  return `Platz ${current.placement}${current.of ? ` von ${current.of}` : ""}`;
}

/**
 * Welche Referenz die Bestätigung schreibt: Hat die Saison schon ihre Referenz, nur diese (nie eine zweite daneben);
 * sonst die Referenzen, die schon zur Saison gehören, und „Neue Referenz anlegen“.
 */
export function targetOptions(preview) {
  if (preview?.current) return [[preview.current.id, preview.current.title || "Referenz der Saison"]];
  const linked = (preview?.candidates || []).map((item) => [item.id, `Aktualisieren: ${[item.title, item.season].filter(Boolean).join(" · ")}`]);
  return [...linked, ["", "Neue Referenz anlegen"]];
}

const NO_SEASON = ["", "Keine – einzelnes Turnier oder Cup"];

/** Auswahl „Gehört zur Saison“: Saisons aller offenen Spuren; Archiviertes nur, wenn es gerade gewählt ist. */
export function seasonOptions(lineages, selected = "") {
  const options = [NO_SEASON];
  for (const lineage of lineages || []) {
    for (const series of lineage.series || []) {
      const archived = lineage.is_archived || series.status === "archived";
      if (archived && series.id !== selected) continue;
      options.push([series.id, seasonName(lineage, series)]);
    }
  }
  return options;
}

/**
 * Die Saison einer Referenz aus der Verwaltungsübersicht der Serien: über `series_id` der Referenz oder `reference_id`
 * der Saison (Abschluss). `seasonEnd`: die Referenz des Saisonabschlusses - ihr Endplatz wird in der Saison gepflegt.
 */
export function seasonOf(reference, lineages) {
  if (!reference) return null;
  let found = null;
  for (const lineage of lineages || []) {
    for (const series of lineage.series || []) {
      if (series.id === reference.series_id) found = { lineage, series };
      else if (!found && series.reference_id && series.reference_id === reference.id) found = { lineage, series };
    }
  }
  if (!found) return null;
  return { seriesId: found.series.id, label: seasonName(found.lineage, found.series), seasonEnd: found.series.reference_id === reference.id };
}

/** Wohin die Karte einer Referenz führt: zur Saison-Seite, wenn sie aus einer Saison stammt, sonst zur Referenz. */
export function referenceHref(item, link = null) {
  const season = item?.season_link;
  if (season?.lineage_slug && season?.season_slug) return `/references/series/${season.lineage_slug}/${season.season_slug}`;
  if (link?.lineage?.slug && link?.season?.season_slug) return `/references/series/${link.lineage.slug}/${link.season.season_slug}`;
  return `/references/${item?.id}`;
}
