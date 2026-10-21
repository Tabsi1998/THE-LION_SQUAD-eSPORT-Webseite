// Statistik einer Saison der Rennliga (#1950): was der Reiter „Statistik“ der Serienseite aus
// /api/reference-series/public/<spur>/<saison>/statistics macht. Gezählt wird im Server; hier wird je Kennzahl die
// Rangliste gebildet (Gleichstand teilt den Platz) und beschriftet. Es erscheinen nur Kennzahlen, die der Server nennt -
// die, die in der Saison vorkommen. Eine Null steht als Strich.
import { formatNumber } from "@/lib/standingsTable";
import { nameOf } from "@/lib/referenceSeriesTable";

export const METRICS = {
  wins: { column: "Siege", title: "Meiste Siege", order: "high" },
  podiums: { column: "Podien", title: "Meiste Podien", order: "high" },
  poles: { column: "Poles", title: "Meiste Poles", order: "high" },
  fastest_laps: { column: "SR", title: "Meiste schnellste Runden", hint: "Schnellste Runden", order: "high" },
  driver_of_the_day: { column: "FdT", title: "Meiste Fahrer des Tages", hint: "Fahrer des Tages", order: "high" },
  dnfs: { column: "Ausf.", title: "Meiste Ausfälle", hint: "Ausfälle", order: "high" },
  avg_grid: { column: "Ø Start", title: "Bester Ø Startplatz", order: "low" },
  avg_finish: { column: "Ø Ziel", title: "Bester Ø Zielplatz", order: "low" },
  gained: { column: "+/−", title: "Meiste gutgemachte Plätze", hint: "Gutgemachte Plätze", order: "high" },
};

/** Hat die Zeile einen Wert für die Kennzahl? Null und leer zählen nicht. */
export function hasValue(row, metric) {
  const value = row?.[metric];
  return value !== null && value !== undefined && value !== 0;
}

/** Wert als Text: Durchschnitt mit Komma, gutgemacht mit Vorzeichen, sonst die Zahl - ohne Wert ein Strich. */
export function metricText(row, metric) {
  if (!hasValue(row, metric)) return "–";
  const value = Number(row[metric]);
  if (metric === "gained") return value > 0 ? `+${formatNumber(value)}` : `−${formatNumber(Math.abs(value))}`;
  return formatNumber(value);
}

/** Rangliste nach einer Kennzahl: wer einen Wert hat, nach Wert (Gleichstand teilt den Platz, dann nach Name); ohne Wert
 * hinten und ohne Platz. */
export function rankBy(rows, metric) {
  const order = METRICS[metric]?.order === "low" ? 1 : -1;
  const label = (row) => String(row.team || nameOf(row)).toLowerCase();
  const ranked = (rows || []).filter((row) => hasValue(row, metric))
    .sort((a, b) => order * (Number(a[metric]) - Number(b[metric])) || label(a).localeCompare(label(b), "de"));
  let rank = 0;
  const out = ranked.map((row, index) => {
    if (index === 0 || Number(ranked[index - 1][metric]) !== Number(row[metric])) rank = index + 1;
    return { row, rank };
  });
  const rest = (rows || []).filter((row) => !hasValue(row, metric))
    .sort((a, b) => label(a).localeCompare(label(b), "de"))
    .map((row) => ({ row, rank: null }));
  return [...out, ...rest];
}

/** Die Spitze je Kennzahl (für die Karten „Meiste Poles“): bis zu `top` Einträge mit Wert. */
export function leaders(rows, metric, top = 3) {
  return rankBy(rows, metric).filter((entry) => entry.rank !== null).slice(0, top);
}
