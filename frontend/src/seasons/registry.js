// Jahreszeiten-Bühne (#634): je Saison ein Modul, das erst geladen wird, wenn die Saison läuft.
// Ein Modul exportiert `season` mit optionalen Teilen: Backdrop (hinter dem Inhalt), Sky (Canvas über
// dem Inhalt, nie klickbar), Corners (SVG in den Ecken), Widget (kleines klickbares Element im
// Kopfbereich), Footer (Deko im Footer), Toast (Gruß einmal je Tag) und `accent` (Farbschein).

export const SEASON_MODULES = {
  halloween: () => import("./halloween/index.jsx"),
  weather: () => import("./weather/module.js"),
  new_year: () => import("./newYear/index.jsx"),
  advent: () => import("./advent/index.jsx"),
  snow: () => import("./snow/index.jsx"),
  christmas: () => import("./christmas/index.jsx"),
  advent_calendar: () => import("./adventCalendar/index.jsx"),
};

export function hasModule(key) {
  return Object.prototype.hasOwnProperty.call(SEASON_MODULES, key);
}
