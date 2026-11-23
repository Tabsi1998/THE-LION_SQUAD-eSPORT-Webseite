// Saisonverlauf als Linie (#1630): je abgeschlossener Season ein Punkt auf der Leiter aus Liga N und Platz (lib/leagueBadge.ladderValue)
// - ein Aufstieg hebt die Linie, auch wenn der Platz in der höheren Liga N schlechter ist. Liga N steht als Band, der Platz am Punkt,
// der Meister in Gold. Profil: eine Linie für die Person; Teamseite: je Co-Team eine. Quelle ist die Season-Historie (Endstände), unter
// zwei Seasons zeigt der Baustein nichts. Ein Rückzug steht als grauer Punkt „ausgetreten“ ohne Platz auf der Achse, die Linie ist dort
// unterbrochen (Fabian 23.11.). Eigenes SVG ohne Diagramm-Bibliothek - die bleibt aus öffentlichen Seiten draußen (#936).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TrendingUp } from "lucide-react";
import { exitLabel, lineRuns, seasonLabelLines, seasonLine } from "@/lib/leagueBadge";
import { useFirstSight } from "@/components/tls/league/LeagueBadge";
import "./leagueBadge.css";

const COLORS = ["#29B6E8", "#E5E7EB", "#B8ECFF", "#9CA3AF"];
const DASHES = [undefined, "6 4", "2 4", "10 4 2 4"];
const EXIT_COLOR = "#6B7280";
const GUTTER = 58;
const BAND = 52;
const TOP = 16;
// Unter den Bändern: eine bzw. zwei Zeilen Season-Name (Schrift 10 px).
const BOTTOM = 24;
const LINE = 12;
// Mindestabstand zweier Seasons; sonst der breiteste Season-Name plus Luft - reicht die Breite nicht, wischt man die Linie seitlich
// (Review #1638: lange Namen liefen ineinander). „ausgetreten“ steht im Band und braucht nur Abstand zu einem zweiten „ausgetreten“
// daneben (EXIT_AIR); zu einer Platz-Zahl reicht der Mindestabstand.
const STEP = 64;
const LABEL_AIR = 14;
const EXIT_AIR = 6;
// Schätzung je Zeichen (Schrift 10 px, fett), bis der Browser gemessen hat - in Tests ohne Messung bleibt sie stehen.
const CHAR = 6.2;
// Mindestabstand zweier Platz-Zahlen übereinander (Schrift 10 px).
const LABEL_GAP = 11;
// Eine Beschriftung (Grundlinie `spot`, Schrift 10 px: etwa 9 px darüber, 2 px darunter) trifft einen Kreis (Radius bis 6 px plus Rand
// und 1 px Luft), wenn ihre Grundlinie zwischen 9 px über und 16 px unter seiner Mitte liegt (Review #1638: „6.“ lag auf Kreisen).
const hitsCircle = (spot, cy) => spot > cy - 9 && spot < cy + 16;
// Seitlicher Abstand mehrerer Rückzüge in derselben Season und Liga N - sonst lägen die Punkte genau übereinander.
const EXIT_SHIFT = 11;
// Ohne Messung (erster Zeichenschritt, Tests) die kleinste nötige Breite - nie breiter als die Fläche (Review #1638: bei 320 px wuchs
// die Spalte sonst auf die Startbreite mit, und die Messung bestätigte sie).
const FALLBACK_WIDTH = 0;

/** Die Breite der Fläche in Pixeln: Das SVG zeichnet 1:1, Schrift und Punkte bleiben an jeder Breite gleich groß. */
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const update = () => setWidth(Math.round(node.clientWidth) || FALLBACK_WIDTH);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Die breitesten Beschriftungen im SVG je Art (`data-measure="season"` bzw. `"exit"`), gemessen nach dem Zeichnen und noch einmal, wenn
 * die Schrift geladen ist. `estimate`: `{season, exit}` bis dahin.
 */
function useLabelWidth(estimate, key) {
  const ref = useRef(null);
  const [measured, setMeasured] = useState(null);
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return undefined;
    let alive = true;
    const measure = () => {
      const widest = { season: 0, exit: 0 };
      svg.querySelectorAll("[data-measure]").forEach((node) => {
        try {
          const kind = node.getAttribute("data-measure");
          widest[kind] = Math.max(widest[kind] || 0, Math.ceil(node.getBBox().width));
        } catch {
          // Ohne Layout (jsdom) gibt es keine Messung - dann bleibt die Schätzung.
        }
      });
      if (!alive || widest.season <= 0) return;
      setMeasured((before) => (before && before.season === widest.season && before.exit === widest.exit ? before : widest));
    };
    measure();
    document.fonts?.ready?.then(measure);
    return () => {
      alive = false;
    };
  }, [key]);
  return [ref, measured ?? estimate];
}

function summary(line, byTeam) {
  return line.series.map((series) => {
    const points = series.points.map((point) => (point.exit
      ? `${point.season}: Liga ${point.level}, ${exitLabel(point.exit)}`
      : `${point.season}: Liga ${point.level}, Platz ${point.rank}${point.of ? ` von ${point.of}` : ""}${point.champion ? ", Meister" : ""}`));
    return `${byTeam ? `${series.name} – ` : ""}${points.join("; ")}`;
  }).join(". ");
}

/** `playing`: Kennungen bzw. Namen der Co-Teams, die gerade spielen - sie stehen zuerst (Teamseite). */
export function LeagueSeasonLine({ rows, byTeam = false, playing = [], testId = "league-season-line" }) {
  const line = seasonLine(rows, { byTeam, limit: COLORS.length, playing });
  const [ref, state] = useFirstSight(Boolean(line));
  const [boxRef, box] = useWidth();
  const names = (line?.seasons || []).map((season) => seasonLabelLines(season.name));
  const exits = (line?.series || []).flatMap((row) => row.points.filter((point) => point.exit).map((point) => exitLabel(point.exit)));
  const estimate = { season: Math.max(0, ...names.flat().map((text) => text.length * CHAR)), exit: Math.max(0, ...exits.map((text) => text.length * CHAR)) };
  const [svgRef, labels] = useLabelWidth(estimate, `${names.flat().join("|")}#${[...new Set(exits)].join("|")}`);
  if (!line) return null;
  const first = line.levels[0];
  const last = line.levels[line.levels.length - 1];
  const bands = Array.from({ length: last - first + 1 }, (_, at) => first + at);
  const rowsOfNames = Math.max(...names.map((parts) => parts.length));
  const step = Math.max(STEP, Math.ceil(labels.season) + LABEL_AIR, Math.ceil(labels.exit) + EXIT_AIR);
  // Rand links und rechts: Die äußeren Beschriftungen stehen ganz im SVG.
  const pad = Math.max(28, Math.ceil(Math.max(labels.season, labels.exit) / 2) + 4);
  const width = Math.max(box, GUTTER + 2 * pad + (line.seasons.length - 1) * step);
  const height = TOP + bands.length * BAND + BOTTOM + (rowsOfNames - 1) * LINE;
  const span = width - GUTTER - 2 * pad;
  const x = (index) => GUTTER + pad + (line.seasons.length > 1 ? (index * span) / (line.seasons.length - 1) : span / 2);
  const y = (value) => TOP + (value - (first - 1)) * BAND + 6;
  // Ein Rückzug steht mitten im Band seiner Liga N; mehrere in derselben Season und Liga N nebeneinander (Review #1638).
  const yOf = (point) => (point.exit ? y(point.level - 0.5) : y(point.value));
  const exitGroups = new Map();
  line.series.forEach((row, at) => row.points.forEach((point) => {
    if (!point.exit) return;
    const key = `${point.index}-${point.level}`;
    exitGroups.set(key, [...(exitGroups.get(key) || []), at]);
  }));
  const shiftOf = (at, point) => {
    const group = exitGroups.get(`${point.index}-${point.level}`) || [at];
    return (group.indexOf(at) - (group.length - 1) / 2) * EXIT_SHIFT;
  };
  // Höchstens vier Linien - die besten Co-Teams (seasonLine sortiert); die übrigen nennt ein Satz darunter (Fabian 23.11.).
  const series = line.series;
  // Wo eine Beschriftung am Punkt steht (Review #1638): zuerst über dem Punkt, stößt sie dort an eine schon gesetzte derselben Season
  // oder an einen Kreis irgendeiner Linie, darunter - und passt auch das nicht (oder rutschte sie in die Season-Zeile), bleibt sie weg.
  // „ausgetreten“ kommt vor den Plätzen dran; Plätze stehen nur am Anfang, am Ende und bei einem Wechsel, die besten Co-Teams zuerst.
  // Alles steht in der Bildbeschreibung.
  const bottom = TOP + bands.length * BAND;
  const circles = new Map();
  series.forEach((row) => row.points.forEach((point) => circles.set(point.index, [...(circles.get(point.index) || []), yOf(point)])));
  const placed = new Map();
  const spots = new Map();
  const place = (at, point) => {
    const taken = placed.get(point.index) || [];
    const dots = circles.get(point.index) || [];
    const free = (spot) => spot >= TOP - 6 && spot < bottom && taken.every((other) => Math.abs(other - spot) >= LABEL_GAP)
      && dots.every((cy) => !hitsCircle(spot, cy));
    const spot = [yOf(point) - 10, yOf(point) + 17].find(free);
    if (spot === undefined) return;
    placed.set(point.index, [...taken, spot]);
    spots.set(`${at}-${point.index}`, spot);
  };
  // Mehrere Rückzüge mit demselben Grund in derselben Season und Liga N stehen nebeneinander - eine Beschriftung gilt für alle.
  const exitLabeled = new Set();
  series.forEach((row, at) => row.points.forEach((point) => {
    const key = `${point.index}-${point.level}-${point.exit}`;
    if (!point.exit || exitLabeled.has(key)) return;
    exitLabeled.add(key);
    place(at, point);
  }));
  series.forEach((row, at) => row.points.forEach((point, index) => {
    if (point.exit) return;
    const before = row.points[index - 1];
    if (before && !before.exit && index !== row.points.length - 1 && before.rank === point.rank && before.level === point.level) return;
    place(at, point);
  }));
  const more = line.hidden;
  const moreText = more > 0 ? `und ${more} ${more === 1 ? "weiteres Co-Team" : "weitere Co-Teams"}` : "";
  return (
    <section data-testid={testId} aria-labelledby={`${testId}-title`}>
      <h2 id={`${testId}-title`} className="mb-4 flex items-center gap-2 font-heading text-2xl font-bold uppercase">
        <TrendingUp className="h-5 w-5 text-[#29B6E8]" aria-hidden="true" /> Saisonverlauf
      </h2>
      <div ref={ref} className="tls-season-line" data-play={state}>
        {/* Per Tastatur erreichbar: Ist die Linie breiter als die Fläche, scrollen die Pfeiltasten seitlich. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- eine scrollbare Fläche muss per Tastatur erreichbar sein (axe: scrollable-region-focusable) */}
        <div ref={boxRef} role="region" aria-label="Saisonverlauf, seitlich scrollbar" tabIndex={0}
          className="tls-swipe rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8]">
          <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="tls-season-line__svg" role="img"
            aria-label={`Saisonverlauf: ${summary({ ...line, series }, byTeam)}${moreText ? `. ${moreText}` : ""}`} data-testid={`${testId}-svg`}
            data-step={step}>
            {bands.map((level, at) => (
              <g key={level}>
                <rect className="tls-season-line__band" data-even={at % 2 === 0 ? "true" : "false"} x="0" y={TOP + at * BAND} width={width} height={BAND} />
                <text className="tls-season-line__level" x="8" y={TOP + at * BAND + BAND / 2} dominantBaseline="central">Liga {level}</text>
              </g>
            ))}
            {line.seasons.map((season, index) => (
              <text key={season.key} className="tls-season-line__season" x={x(index)} y={bottom + 16} textAnchor="middle" data-measure="season"
                data-testid={`${testId}-season-${index}`}>
                <title>{season.name}</title>
                {names[index].map((part, at) => <tspan key={`${at}-${part}`} x={x(index)} dy={at ? LINE : 0}>{part}</tspan>)}
              </text>
            ))}
            {series.map((row, at) => lineRuns(row.points).map((run) => (
              <polyline key={`line-${row.name}-${run[0].index}`} className="tls-season-line__path" stroke={COLORS[at]} strokeDasharray={DASHES[at]}
                points={run.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")} />
            )))}
            {series.map((row, at) => row.points.map((point, index) => {
              // Die Beschriftung steht, wo `spots` Platz gefunden hat (siehe oben) - sonst nur in der Bildbeschreibung.
              const spot = spots.get(`${at}-${point.index}`);
              if (point.exit) {
                return (
                  <g key={`${row.name}-${point.index}`} className="tls-season-line__point" data-exit={point.exit} style={{ "--tls-i": Math.min(index, 8) }}
                    data-testid={`${testId}-exit-${at}-${point.index}`}>
                    <title>{`${point.season}: ${exitLabel(point.exit)}`}</title>
                    {/* Grauer Punkt, der Rand in der Farbe der Linie - so erkennt man das Co-Team auch bei zwei Rückzügen nebeneinander. */}
                    <circle cx={x(point.index) + shiftOf(at, point)} cy={yOf(point)} r="4.5" fill={EXIT_COLOR} stroke={COLORS[at]} strokeWidth="2"
                      strokeDasharray="2 2" data-testid={`${testId}-exit-dot-${at}-${point.index}`} />
                    {spot !== undefined ? (
                      <text className="tls-season-line__exit" x={x(point.index)} y={spot} textAnchor="middle" data-measure="exit">{exitLabel(point.exit)}</text>
                    ) : null}
                  </g>
                );
              }
              return (
                <g key={`${row.name}-${point.index}`} className="tls-season-line__point" style={{ "--tls-i": Math.min(index, 8) }}
                  data-testid={`${testId}-point-${at}-${point.index}`} data-champion={point.champion ? "true" : undefined}>
                  <circle cx={x(point.index)} cy={y(point.value)} r={point.champion ? 6 : 5} fill="#0A0A0A"
                    stroke={COLORS[at]} strokeWidth="2.5" />
                  {spot !== undefined ? (
                    <text className="tls-season-line__rank" x={x(point.index)} y={spot} textAnchor="middle"
                      data-testid={`${testId}-rank-${at}-${point.index}`}>{point.rank}.</text>
                  ) : null}
                </g>
              );
            }))}
          </svg>
        </div>
        {byTeam && series.length > 1 ? (
          <ul className="tls-season-line__legend" data-testid={`${testId}-legend`}>
            {series.map((row, at) => (
              <li key={row.name}><span className="tls-season-line__swatch" style={{ background: COLORS[at] }} aria-hidden="true" />{row.name}</li>
            ))}
          </ul>
        ) : null}
        {moreText ? <p className="tls-season-line__more" data-testid={`${testId}-more`}>{moreText}</p> : null}
      </div>
    </section>
  );
}
