import { Trophy } from "lucide-react";
import { LionArt } from "@/components/tls/LionArt";
import { ROLE_COLORS, SURFACE_COLORS, newsCategoryColorDark } from "@/lib/categoryColors";
import { textCardSentence } from "@/lib/newsCards";

// Text-Karte für News ohne Bild (#1343, Design-Idee 29): statt Verlauf und Zeitungs-Symbol eine Fläche in der dunklen
// Kategorie-Farbe mit einem Satz aus der News und dem angeschnittenen Vereinslöwen. Ergebnis-News (verknüpftes Turnier
// mit veröffentlichten Ergebnissen, `news.result` vom Server) zeigen stattdessen Pokal und „1. Sieger“ in Gold.
// Die Karte füllt den Platz des Bildes (16 : 9 gibt der Rahmen vor), damit das Raster ruhig bleibt.
//
// size: "thumb" (kleines Vorschaubild, nur Fläche und Löwe), "md" (Karte im Raster), "lg" (Aufmacher).

/** Löwe der großen Karten: 78 % hoch, unten um 24 % angeschnitten - oben bleibt gut ein Drittel der Fläche frei. */
export const LION_PLACE = "-right-[8%] -bottom-[24%] h-[78%] w-auto";

// Der Satz auf der Fläche bleibt unter dem Titel daneben (Aufmacher: Abschnitt), der Sieger ist das Größte darauf.
const SENTENCE_SIZE = {
  md: "tls-type-card",
  lg: "tls-type-card",
};
const WINNER_SIZE = {
  md: "tls-type-section",
  lg: "tls-type-section",
};
// Lange Siegernamen (#1314) stehen ganz da statt mit „…“ - eine Stufe kleiner, damit Pokal, Name und Turnier auch am
// schmalsten Handy (320 px) in die feste Fläche passen.
const WINNER_SIZE_LONG = {
  md: "tls-type-card",
  lg: "tls-type-card",
};
export const LONG_WINNER = 18;

function winnerSize(winner, size) {
  const sizes = String(winner || "").trim().length >= LONG_WINNER ? WINNER_SIZE_LONG : WINNER_SIZE;
  return sizes[size] || sizes.md;
}

export function NewsTextCard({ news, size = "md", className = "" }) {
  const result = news?.result?.winner ? news.result : null;
  const thumb = size === "thumb";
  const background = result
    ? `radial-gradient(120% 90% at 0% 100%, rgb(var(--tls-honor-rgb) / 0.16), transparent 60%), ${SURFACE_COLORS[2]}`
    : undefined;
  const pad = size === "lg" ? "p-6 md:p-8" : "p-5";
  return (
    <div
      data-testid="news-text-card"
      data-variant={thumb ? "thumb" : result ? "result" : "sentence"}
      className={`tls-news-textcard relative w-full h-full overflow-hidden ${className}`}
      style={result ? { background } :{ backgroundColor: newsCategoryColorDark(news?.category) }}
    >
      {/* Der Löwe sitzt unten rechts angeschnitten; die oberen Ecken bleiben frei - dort darf Saison-Deko (Ostereier
          an Karten) liegen, ohne über der Grafik zu stehen. */}
      <LionArt
        art="plain"
        size={120}
        className={`tls-news-textcard__lion absolute pointer-events-none ${thumb ? "-right-[18%] -bottom-[30%] h-[130%] w-auto" : LION_PLACE} ${result ? "text-honor/10" : "text-white/[0.12]"}`}
      />
      {!thumb && (
        <div className={`relative h-full flex flex-col justify-end ${pad} ${result ? "pr-[12%]" : "pr-[30%]"}`}>
          {result ? (
            <>
              <Trophy className={size === "lg" ? "w-9 h-9" : "w-7 h-7"} style={{ color: ROLE_COLORS.honor }} aria-hidden="true" />
              <div
                data-testid="news-text-card-winner"
                className={`tls-wrap tls-wrap--name mt-3 font-black leading-tight ${winnerSize(result.winner, size)}`}
                style={{ color: ROLE_COLORS.honor }}
              >
                1. {result.winner}
              </div>
              {result.tournament && <div className="tls-wrap mt-1 tls-type-small font-semibold text-white/65">{result.tournament}</div>}
            </>
          ) : (
            <p className={`font-bold leading-snug text-white break-words line-clamp-4 ${SENTENCE_SIZE[size] || SENTENCE_SIZE.md}`}>
              {textCardSentence(news)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
