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

const SENTENCE_SIZE = {
  md: "text-lg sm:text-xl",
  lg: "text-xl md:text-2xl xl:text-[1.75rem]",
};
const WINNER_SIZE = {
  md: "text-xl sm:text-2xl",
  lg: "text-2xl md:text-3xl xl:text-4xl",
};

export function NewsTextCard({ news, size = "md", className = "" }) {
  const result = news?.result?.winner ? news.result : null;
  const thumb = size === "thumb";
  const background = result
    ? `radial-gradient(120% 90% at 0% 100%, rgb(255 215 0 / 0.16), transparent 60%), ${SURFACE_COLORS[2]}`
    : undefined;
  const pad = size === "lg" ? "p-6 md:p-8" : "p-5";
  return (
    <div
      data-testid="news-text-card"
      data-variant={thumb ? "thumb" : result ? "result" : "sentence"}
      className={`tls-news-textcard relative w-full h-full overflow-hidden ${className}`}
      style={result ? { background } :{ backgroundColor: newsCategoryColorDark(news?.category) }}
    >
      <LionArt
        art="plain"
        size={120}
        className={`tls-news-textcard__lion absolute pointer-events-none ${thumb ? "-right-[18%] -bottom-[30%] h-[130%] w-auto" : "-right-[10%] -bottom-[22%] h-[105%] w-auto"} ${result ? "text-honor/10" : "text-white/[0.12]"}`}
      />
      {!thumb && (
        <div className={`relative h-full flex flex-col justify-end ${pad} pr-[30%]`}>
          {result ? (
            <>
              <Trophy className={size === "lg" ? "w-9 h-9" : "w-7 h-7"} style={{ color: ROLE_COLORS.honor }} aria-hidden="true" />
              <div
                data-testid="news-text-card-winner"
                className={`mt-3 font-heading font-black leading-tight break-words line-clamp-2 ${WINNER_SIZE[size] || WINNER_SIZE.md}`}
                style={{ color: ROLE_COLORS.honor }}
              >
                1. {result.winner}
              </div>
              {result.tournament && <div className="mt-1 text-xs sm:text-sm font-semibold text-white/65 line-clamp-1">{result.tournament}</div>}
            </>
          ) : (
            <p className={`font-heading font-bold leading-snug text-white break-words line-clamp-4 ${SENTENCE_SIZE[size] || SENTENCE_SIZE.md}`}>
              {textCardSentence(news)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
