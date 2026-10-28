// Gestaltung der Liga (#2107): Emblem, Kopf mit Banner und „Um was gespielt wird“. Emblem und Banner kommen aus der
// Season, sonst aus der Liga (der Server löst das auf, ``look``); ohne Emblem steht das Liga-Zeichen, ohne Banner ein
// ruhiger Kopf. Die Akzentfarbe der Liga färbt Kopf, Abzeichen und Zeichen - ohne sie gilt die Vereinsfarbe.
import { useState } from "react";
import { ListOrdered, Trophy } from "lucide-react";
import { LazyImg } from "@/components/tls/LazyImg";
import { SizedImage } from "@/components/tls/SizedImage";
import { StaggerIn } from "@/components/tls/motion";
import { accentStyle, bannerFocus, placeLabel, placeTone } from "@/lib/leagueLook";
import "./league.css";

/** Das Emblem einer Liga bzw. Season - quadratisch, unverzerrt; ohne Bild das Liga-Zeichen in der Akzentfarbe. */
export function LeagueEmblem({ src, size = 40, className = "", testId }) {
  const inner = Math.round(size * 0.8);
  return (
    <span className={`tls-league-emblem ${className}`} style={{ width: size, height: size }} data-testid={testId}
      data-empty={src ? undefined : "true"}>
      <SizedImage src={src} size={inner} alt="" style={{ objectFit: "contain" }}
        fallback={<ListOrdered className="tls-league-accent" style={{ width: size * 0.45, height: size * 0.45 }} aria-hidden="true" />} />
    </span>
  );
}

/** Kopf der Ligaseite: Banner (Fokuspunkt je Zuschnitt), darauf Emblem und Titel. ``children`` steht unter dem Titel. */
export function LeagueHead({ look, title, eyebrow, children, testId = "league-head" }) {
  const [state, setState] = useState("loading");
  const banner = look?.banner?.url && state !== "failed" ? look.banner : null;
  return (
    <header className="tls-league-head" data-banner={banner ? "true" : "false"} style={accentStyle(look?.accent_color)} data-testid={testId}>
      {banner ? (
        <div className="tls-league-head__banner" style={bannerFocus(banner)} data-testid={`${testId}-banner`}>
          <LazyImg src={banner.url} alt="" priority sizes="(min-width: 1152px) 1152px, 100vw" className="tls-league-head__img"
            data-loaded={state === "loaded" ? "true" : "false"} onLoad={() => setState("loaded")} onError={() => setState("failed")} />
        </div>
      ) : null}
      <div className="tls-league-head__body">
        <LeagueEmblem src={look?.emblem_url} size={88} className="tls-league-head__emblem" testId={`${testId}-emblem`} />
        <div className="min-w-0 flex-1">
          {eyebrow ? <p className="tls-league-head__eyebrow">{eyebrow}</p> : null}
          <h1 className="font-heading text-4xl md:text-6xl font-black uppercase leading-[0.95] break-words">{title}</h1>
        </div>
      </div>
      {children}
    </header>
  );
}

/** Ein Gewinn: Platz (Gold, Silber, Bronze, dann ruhig), Preis, optional Bild. */
function Prize({ prize }) {
  return (
    <li className="tls-league-prize" data-tone={placeTone(prize.place)} data-testid={`league-prize-${prize.place}`}>
      <span className="tls-league-prize__place">{placeLabel(prize.place)}</span>
      <span className="tls-league-prize__text">{prize.text}</span>
      {prize.image_url ? (
        <SizedImage src={prize.image_url} size={48} alt="" className="tls-league-prize__image" style={{ objectFit: "contain" }} />
      ) : null}
    </li>
  );
}

/** „Um was gespielt wird“ - die Gewinne der Season bzw. einer Liga N. Reine Anzeige, ohne Bezug zu XP oder Pokalen. */
export function LeaguePrizes({ prizes, title = "Um was gespielt wird", hint, compact = false, testId = "league-prizes" }) {
  if (!prizes?.length) return null;
  return (
    <section className={compact ? "mt-4" : "mt-12"} aria-label={title} data-testid={testId}>
      <h2 className={compact ? "tls-league-subhead" : "flex items-center gap-2 font-heading text-2xl font-black uppercase"}>
        <Trophy className={compact ? "h-3.5 w-3.5" : "h-5 w-5 tls-league-accent"} aria-hidden="true" /> {title}
      </h2>
      {hint ? <p className="mb-3 text-sm text-white/55">{hint}</p> : null}
      <StaggerIn as="ol" className={`tls-league-prizes ${compact ? "" : "mt-4"}`}>
        {prizes.map((prize) => <Prize key={prize.place} prize={prize} />)}
      </StaggerIn>
    </section>
  );
}
