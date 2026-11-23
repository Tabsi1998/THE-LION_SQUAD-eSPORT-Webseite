// Spiele zur Auswahl (Nachzug #2128 TM3, #2173): dieselben Regeln wie frontend/src/lib/gameLabels.js - Name mit Hauptspiel,
// archivierte Spiele nur, wenn sie schon gewählt sind.

export type GameChoice = {
  id: string;
  name?: string | null;
  display_name?: string | null;
  short_name?: string | null;
  kind?: string | null;
  status?: string | null;
  parent_game_id?: string | null;
  parent_game?: { name?: string | null; display_name?: string | null } | null;
};

export function gameLabel(game?: GameChoice | null): string {
  if (!game) return "";
  if (game.display_name) return game.display_name;
  const parentName = game.parent_game?.display_name || game.parent_game?.name;
  const name = game.name || "";
  if ((game.kind === "edition" || game.parent_game_id) && parentName && name) {
    const lowerName = name.toLowerCase();
    const lowerParent = parentName.toLowerCase();
    if (lowerName !== lowerParent && !lowerName.startsWith(`${lowerParent}:`)) return `${parentName}: ${name}`;
  }
  return name;
}

/** Archiviert (#2129): beim Anlegen nicht mehr zur Wahl. Fehlt `status`: aktiv. */
export function isArchivedGame(game?: GameChoice | { status?: string | null } | null): boolean {
  return game?.status === "archived";
}

export function gameOptionLabel(game: GameChoice): string {
  const label = gameLabel(game);
  const archived = isArchivedGame(game) ? " – archiviert" : "";
  if (game.kind === "edition" && game.short_name && !label.includes(game.short_name)) return `${label} (${game.short_name})${archived}`;
  return `${label}${archived}`;
}

export function selectableGames<T extends GameChoice>(games: T[] | null | undefined, currentId?: string | null): T[] {
  return (Array.isArray(games) ? games : []).filter((game) => !isArchivedGame(game) || (Boolean(currentId) && game.id === currentId));
}
