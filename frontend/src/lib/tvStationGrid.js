// Stationen auf der Hallen-Tafel (#1126): alle Stationen als Raster - frei, belegt, aufgerufen (= reserviert, #1122),
// defekt -, mit Spiel und Namen im Klartext (#1113). Keine Station fehlt still: Das Raster wird kleiner bis zur
// Untergrenze der Schrift (#1111), danach blättert es ruhig mit „Seite 1/2“. Eine reservierte Station zählt nicht mehr
// als „Belegt“, sondern als „Aufgerufen“.
import { isLiveMatch } from "@/lib/tvLive";

export const STATION_STATES = Object.freeze({
  free: { label: "Frei", tone: "green" },
  busy: { label: "Belegt", tone: "accent" },
  called: { label: "Aufgerufen", tone: "gold" },
  broken: { label: "Defekt", tone: "red" },
});
const STATE_ORDER = ["busy", "called", "free", "broken"];

/** Der Stand einer Station: defekt, belegt (läuft), aufgerufen (reserviert) oder frei. */
export function stationState(station, match = null) {
  const status = String(station?.status || "").toLowerCase();
  if (status === "broken") return "broken";
  if (["busy", "in_use"].includes(status) || (match && isLiveMatch(match))) return "busy";
  if (status === "reserved") return "called";
  return "free";
}

/** „2 frei · 5 belegt · 1 aufgerufen · 1 defekt“ - nur, was es gibt; in fester Reihenfolge. */
export function stationCounts(states = []) {
  const counts = { busy: 0, called: 0, free: 0, broken: 0 };
  for (const state of states) counts[state] = (counts[state] || 0) + 1;
  const words = { busy: "belegt", called: "aufgerufen", free: "frei", broken: "defekt" };
  const text = ["free", "busy", "called", "broken"].filter((key) => counts[key]).map((key) => `${counts[key]} ${words[key]}`).join(" · ");
  return { ...counts, text };
}

/** Stationen in einer ruhigen Reihenfolge: nach Name, Zahlen richtig („PC 2“ vor „PC 10“). */
export function sortStations(stations = []) {
  return [...(stations || [])].sort((a, b) => String(a.name || a.label || a.id).localeCompare(String(b.name || b.label || b.id), "de", { numeric: true }));
}

/**
 * Das Raster: so wenige Spalten wie möglich, so dass alle Stationen mit der größten Stufe Platz haben. Stufen
 * (`levels`) von groß nach klein, je `{ key, minW, h }` in TV-Einheiten. Passt auch die kleinste nicht, blättert das
 * Raster: so viele je Seite, wie in der kleinsten Stufe Platz haben.
 */
export function stationGrid(count, area, levels, gap = 1) {
  const total = Math.max(0, count);
  if (!total || !area?.w || !area?.h || !levels?.length) return { level: levels?.[0]?.key || "", columns: 1, rows: 1, perPage: Math.max(1, total), pages: 1 };
  for (const level of levels) {
    for (let columns = 1; columns <= total; columns += 1) {
      const rows = Math.ceil(total / columns);
      const width = (area.w - (columns - 1) * gap) / columns;
      const height = (area.h - (rows - 1) * gap) / rows;
      if (width < level.minW) break;
      if (height >= level.h) return { level: level.key, columns, rows, perPage: total, pages: 1 };
    }
  }
  const smallest = levels[levels.length - 1];
  const columns = Math.max(1, Math.floor((area.w + gap) / (smallest.minW + gap)));
  const rows = Math.max(1, Math.floor((area.h + gap) / (smallest.h + gap)));
  const perPage = Math.max(1, columns * rows);
  return { level: smallest.key, columns, rows: Math.min(rows, Math.ceil(total / columns)), perPage, pages: Math.ceil(total / perPage) };
}

/** Die Stationen einer Seite. */
export function pageOf(list, layout, page) {
  const pages = Math.max(1, layout.pages);
  const index = ((page % pages) + pages) % pages;
  return list.slice(index * layout.perPage, (index + 1) * layout.perPage);
}

export { STATE_ORDER };
