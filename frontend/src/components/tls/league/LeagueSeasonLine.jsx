// Saisonverlauf als Linie (#1630): je abgeschlossener Season ein Punkt auf der Leiter aus Liga N und Platz (lib/leagueBadge.ladderValue)
// - ein Aufstieg hebt die Linie, auch wenn der Platz in der höheren Liga N schlechter ist. Liga N steht als Band, der Platz am Punkt,
// der Meister in Gold. Profil: eine Linie für die Person; Teamseite: je Co-Team eine. Quelle ist die Season-Historie (Endstände), unter
// zwei Seasons zeigt der Baustein nichts. Eigenes SVG ohne Diagramm-Bibliothek - die bleibt aus öffentlichen Seiten draußen (#936).
import { useEffect, useRef, useState } from "react";
import { TrendingUp } from "lucide-react";
import { seasonLine } from "@/lib/leagueBadge";
import { useFirstSight } from "@/components/tls/league/LeagueBadge";
import "./leagueBadge.css";

const COLORS = ["#29B6E8", "#E5E7EB", "#B8ECFF", "#9CA3AF"];
const DASHES = [undefined, "6 4", "2 4", "10 4 2 4"];
const GUTTER = 58;
const BAND = 52;
const TOP = 16;
const BOTTOM = 24;
// Mindestabstand zweier Seasons - reicht die Breite nicht, wischt man die Linie seitlich.
const STEP = 64;
const FALLBACK_WIDTH = 640;

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

function clip(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function summary(line, byTeam) {
  return line.series.map((series) => {
    const points = series.points.map((point) => `${point.season}: Liga ${point.level}, Platz ${point.rank}${point.of ? ` von ${point.of}` : ""}${point.champion ? ", Meister" : ""}`);
    return `${byTeam ? `${series.name} – ` : ""}${points.join("; ")}`;
  }).join(". ");
}

export function LeagueSeasonLine({ rows, byTeam = false, testId = "league-season-line" }) {
  const line = seasonLine(rows, { byTeam });
  const [ref, state] = useFirstSight(Boolean(line));
  const [boxRef, box] = useWidth();
  if (!line) return null;
  const first = line.levels[0];
  const last = line.levels[line.levels.length - 1];
  const bands = Array.from({ length: last - first + 1 }, (_, at) => first + at);
  const width = Math.max(box, GUTTER + 56 + (line.seasons.length - 1) * STEP);
  const height = TOP + bands.length * BAND + BOTTOM;
  const span = width - GUTTER - 56;
  const x = (index) => GUTTER + 28 + (line.seasons.length > 1 ? (index * span) / (line.seasons.length - 1) : span / 2);
  const y = (value) => TOP + (value - (first - 1)) * BAND + 6;
  // Höchstens vier Linien - die besten Co-Teams (seasonLine sortiert); die übrigen nennt ein Satz darunter (Fabian 23.11.).
  const series = line.series.slice(0, COLORS.length);
  const more = line.series.length - series.length;
  const moreText = more > 0 ? `und ${more} ${more === 1 ? "weiteres Co-Team" : "weitere Co-Teams"}` : "";
  return (
    <section data-testid={testId} aria-labelledby={`${testId}-title`}>
      <h2 id={`${testId}-title`} className="mb-4 flex items-center gap-2 font-heading text-2xl font-bold uppercase">
        <TrendingUp className="h-5 w-5 text-[#29B6E8]" aria-hidden="true" /> Saisonverlauf
      </h2>
      <div ref={ref} className="tls-season-line" data-play={state}>
        <div ref={boxRef} className="tls-swipe">
          <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="tls-season-line__svg" role="img"
            aria-label={`Saisonverlauf: ${summary({ ...line, series }, byTeam)}${moreText ? `. ${moreText}` : ""}`} data-testid={`${testId}-svg`}>
            {bands.map((level, at) => (
              <g key={level}>
                <rect className="tls-season-line__band" data-even={at % 2 === 0 ? "true" : "false"} x="0" y={TOP + at * BAND} width={width} height={BAND} />
                <text className="tls-season-line__level" x="8" y={TOP + at * BAND + BAND / 2} dominantBaseline="central">Liga {level}</text>
              </g>
            ))}
            {line.seasons.map((season, index) => (
              <text key={season.key} className="tls-season-line__season" x={x(index)} y={height - 8} textAnchor="middle">{clip(season.name, 14)}</text>
            ))}
            {series.map((row, at) => (
              <polyline key={`line-${row.name}`} className="tls-season-line__path" stroke={COLORS[at]} strokeDasharray={DASHES[at]}
                points={row.points.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")} />
            ))}
            {series.map((row, at) => row.points.map((point, index) => (
              <g key={`${row.name}-${point.index}`} className="tls-season-line__point" style={{ "--tls-i": Math.min(index, 8) }}
                data-testid={`${testId}-point-${at}-${point.index}`} data-champion={point.champion ? "true" : undefined}>
                <circle cx={x(point.index)} cy={y(point.value)} r={point.champion ? 6 : 5} fill="#0A0A0A"
                  stroke={COLORS[at]} strokeWidth="2.5" />
                <text className="tls-season-line__rank" x={x(point.index)} y={y(point.value) - 10} textAnchor="middle">{point.rank}.</text>
              </g>
            )))}
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
