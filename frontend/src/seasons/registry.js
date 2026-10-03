// Jahreszeiten-Bühne (#634): je Saison ein Modul, das erst geladen wird, wenn die Saison läuft.
// Ein Modul exportiert `season` mit optionalen Teilen: Backdrop (hinter dem Inhalt), Sky (Canvas über
// dem Inhalt, nie klickbar), Corners (SVG in den Ecken), Widget (kleines klickbares Element im
// Kopfbereich), Footer (Deko im Footer), Toast (Gruß einmal je Tag) und `accent` (Farbschein).

export const SEASON_MODULES = {
  halloween: () => import("./halloween/index.jsx"),
  weather: () => import("./weather/module.js"),
  new_year: () => import("./newYear/index.jsx"),
  carnival: () => import("./carnival/index.jsx"),
  club_birthday: () => import("./birthday/index.jsx"),
  advent: () => import("./advent/index.jsx"),
  snow: () => import("./snow/index.jsx"),
  christmas: () => import("./christmas/index.jsx"),
  nikolaus: () => import("./nikolaus/index.jsx"),
  advent_calendar: () => import("./adventCalendar/index.jsx"),
  // Ostern (#645): Hasenohren auf dem Löwen, Eier-Reihe, Wiese, Frühlingslicht, Falter, Feldhase, Gruß.
  easter: () => import("./easter/index.jsx"),
  // Ostereiersuche (#646): Eier auf den Seiten, das Löwenei mit dem Korb-Stand neben dem Logo.
  easter_hunt: () => import("./easterHunt/index.jsx"),
};

export function hasModule(key) {
  return Object.prototype.hasOwnProperty.call(SEASON_MODULES, key);
}
