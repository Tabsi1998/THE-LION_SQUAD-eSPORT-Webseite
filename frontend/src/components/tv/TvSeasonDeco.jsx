import { useMemo } from "react";
import { useSeason } from "@/seasons/SeasonContext";
import { decoParticles, tvDecoFor } from "@/lib/tvSeasonDeco";
import { useTv } from "./TvScreen";

// Jahreszeiten in der TV-Kopfleiste (#1114): eine leise Fassung hinter Logo und Titel - nie über Namen, Zahlen oder
// dem Baum (die Ebene liegt unter dem Inhalt der Kopfleiste und endet an ihrem Rand). Reine CSS-Bewegung, nichts
// zum Anklicken, kein Ton. Mit „Bewegung reduzieren“ steht sie still, mit dem Schalter aus oder ohne Jahreszeit fehlt sie.

const TRACK = { snow: "fall", confetti: "fall", petals: "fall", sparks: "rise", bats: "fly", stars: "stay", candles: "stay" };
const COLORS = {
  confetti: ["#29b6e8", "#ffd700", "#ff5fa2", "#00ff88", "#ffffff"],
  petals: ["#ffc6dd", "#fff3a6", "#c8f5c0", "#d8c8ff"],
};

function Bat() {
  return (
    <svg viewBox="0 0 30 14" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M15 4c1-2 2-3 2-3l.6 2.4L20 2l-.6 3c3-2 7-2 10.6.6-2.6-.2-4.2.8-5 2.4-1.4-1-3.2-1-4.6.4-1-.8-2.6-.8-3.6.4-.8-1-2.2-1.2-3.6-.4-1.4-1.4-3.2-1.4-4.6-.4-.8-1.6-2.4-2.6-5-2.4C3.2 3 7.2 3 10.2 5L9.6 2l2.4 1.4L12.6 1S13.6 2 15 4z" />
    </svg>
  );
}

function Star() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M10 0l2.4 7.6H20l-6.2 4.6 2.4 7.8L10 15.2 3.8 20l2.4-7.8L0 7.6h7.6z" />
    </svg>
  );
}

export function TvSeasonDeco() {
  const { settings } = useTv();
  const { seasons } = useSeason();
  const deco = useMemo(() => (settings.season_header ? tvDecoFor(seasons) : null), [settings.season_header, seasons]);
  const particles = useMemo(() => (deco ? decoParticles(deco.kind, { subtle: deco.subtle }) : []), [deco]);
  if (!deco || !particles.length) return null;
  const track = TRACK[deco.kind] || "fall";
  const colors = COLORS[deco.kind] || [];
  return (
    <div className={`tv-deco tv-deco--${deco.kind}`} aria-hidden="true" data-testid="tv-season-deco" data-deco={deco.kind} data-season={deco.season}>
      {particles.map((particle, index) => (
        <span
          key={particle.id}
          className={`tv-deco__track tv-deco__track--${track}`}
          style={{
            "--x": `${particle.left}%`,
            "--y": String(particle.top),
            "--s": String(particle.size),
            "--dur": `${particle.duration}s`,
            "--delay": `${particle.delay}s`,
            "--drift": String(particle.drift),
            "--turn": String(particle.turn),
            "--c": colors.length ? colors[index % colors.length] : undefined,
          }}
        >
          <span className="tv-deco__p">{deco.kind === "bats" ? <Bat /> : deco.kind === "stars" ? <Star /> : null}</span>
        </span>
      ))}
    </div>
  );
}
