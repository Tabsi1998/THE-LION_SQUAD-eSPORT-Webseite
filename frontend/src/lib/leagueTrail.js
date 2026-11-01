// Liga-Weg einer Staffel (#2110, L-C2): Staffel- und Spielseite führen über „Liga · Season · Staffel“ zur Ligaseite
// statt über „Turniere“ - dort sind Staffeln ausgefiltert. Die Namen und Adressen kommen aus GET /api/leagues; der
// Server liefert nur Seasons, die die Person sehen darf. Ohne sichtbare Season bleibt es bei „Liga · Staffel A“.

/** Liga, Season und Staffel zu einem Turnier mit ``league_context`` - oder null. */
export function leagueTrail(leagues, tournament) {
  const context = tournament?.league_context;
  if (!context) return null;
  const league = (leagues || []).find((row) => row?.id === context.league_id);
  const season = (league?.seasons || []).find((row) => row?.id === context.season_id);
  if (!league?.slug || !season?.slug) return null;
  const seasonHref = `/liga/${league.slug}/${season.slug}`;
  return {
    leagueName: league.name || "Liga",
    seasonName: season.name || "Season",
    seasonHref,
    staffelHref: `${seasonHref}#staffel-${tournament.slug || tournament.id}`,
    // Gestaltung (#2107): Emblem der Season bzw. Liga - klein auf der Spielseite der Staffel.
    emblemUrl: season.emblem_url || league.emblem_url || null,
  };
}

export function staffelLabel(tournament) {
  const staffel = String(tournament?.league_context?.staffel || "").trim();
  return staffel ? `Staffel ${staffel}` : "Staffel";
}

/**
 * Brotkrumen für eine Staffel (``current`` leer) oder eine Seite darunter (``current`` = letzter Eintrag, etwa das
 * Spiel). ``tournamentUrl``: die Staffel als Turnier. Kein Liga-Turnier: null - die Seite nimmt ihre Brotkrumen.
 */
export function leagueCrumbs(tournament, trail, { tournamentUrl = "", current = null } = {}) {
  if (!tournament?.league_context) return null;
  const staffel = { label: staffelLabel(tournament), ...(current && tournamentUrl ? { to: tournamentUrl } : {}) };
  const head = trail
    ? [{ label: "Liga", to: "/liga" }, { label: `${trail.leagueName} ${trail.seasonName}`, to: trail.seasonHref }]
    : [{ label: "Liga" }];
  return [{ label: "Start", to: "/" }, ...head, staffel, ...(current ? [current] : [])];
}

/**
 * Die eine Brotkrumen-Kette der Turnierseiten (#2124, TP22): „Home · eSports · Turniere · Turnier · Seite“ - bei einer
 * Liga-Staffel der Liga-Weg. Ohne ``current`` endet sie beim Turnier (die Turnierseite selbst).
 */
export function tournamentCrumbs(tournament, trail, { tournamentUrl = "", current = null } = {}) {
  const league = leagueCrumbs(tournament, trail, { tournamentUrl, current });
  if (league) return league;
  const title = { label: tournament?.title || "Turnier", ...(current && tournamentUrl ? { to: tournamentUrl } : {}) };
  return [{ label: "Start", to: "/" }, { label: "eSports", to: "/esports" }, { label: "Turniere", to: "/tournaments" }, title,
    ...(current ? [current] : [])];
}