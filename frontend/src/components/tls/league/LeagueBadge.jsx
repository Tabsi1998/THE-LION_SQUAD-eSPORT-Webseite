// Liga-Abzeichen (#1638): Wappen mit der Zahl der Liga N - ein Baustein für Profil, Teamseite, Tabellenkopf und Historie.
// Die Stufe zeigt sich über die Form (lib/leagueBadge.badgeTier): Liga 1 mit Krone, doppeltem Rand und zartem Glanz, Liga 2 mit
// doppeltem Rand, ab Liga 3 schlicht (nur Kontur). Cyan ist die Markenfarbe, Gold nur für den Season-Meister - dieselbe
// Metallsprache wie die Belohnungen (RewardArt, F.4). Der Beiname steht als Text daneben („Liga 1 · Elite“).
//
// Bewegung (Detail-Runde, leagueBadge.css): beim ersten Sichtbarwerden hebt sich das Wappen leise an, die Krone setzt sich einmal
// sanft auf, der Glanz läuft einmal darüber und die Kante leuchtet kurz auf - nur transform und opacity, mehrere gestaffelt über
// `index`. Mit „Bewegung reduzieren“, im Druck und ohne Beobachter steht alles still da.
import { useEffect, useId, useRef, useState } from "react";
import { motionAllowed } from "@/lib/motion";
import { badgeAria, badgeMetal, badgeTier } from "@/lib/leagueBadge";
import "./leagueBadge.css";

// Die Metalle (Cyan, Gold für den Meister) stehen als --tls-lbadge-light/-base/-dark in leagueBadge.css - Gold über die Rolle
// --tls-honor, wie REWARD_METALS (RewardArt) bzw. METALS.gold (TrophyShelf).
const paint = (part) => `var(--tls-lbadge-${part})`;
// Festes Leerzeichen vor dem Punkt, normales danach: Bricht der Text um, dann hinter dem Punkt - er steht nie am Zeilenanfang.
const SEP = " · ";
const SHIELD = "M10 20h44v24c0 17-10 27-22 33C20 71 10 61 10 44z";
const FIELD = "M15.5 25.5h33v18.5c0 12.6-7.4 20.4-16.5 25.4-9.1-5-16.5-12.8-16.5-25.4z";
const RIM = "M13 23h38v21c0 15-9 24-19 29.6C22 68 13 59 13 44z";
const CROWN = "M21 18.5L18.6 8l6.6 4.6L32 5l6.8 7.6L45.4 8 43 18.5z";
// Wie StaggerIn: einmal beim ersten Sichtbarwerden, danach Ruhe.
const STAGGER_MAX = 8;

function startState(play) {
  if (!play || !motionAllowed()) return "done";
  return typeof IntersectionObserver === "undefined" ? "run" : "wait";
}

export function useFirstSight(play) {
  const ref = useRef(null);
  const [state, setState] = useState(() => startState(play));
  useEffect(() => {
    if (state !== "wait") return undefined;
    const node = ref.current;
    if (!node) {
      setState("run");
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setState("run");
        observer.disconnect();
      }
    }, { threshold: 0.2 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [state]);
  return [ref, state];
}

function Shield({ tier, id }) {
  const fill = `url(#${id}-metal)`;
  if (tier === "base") {
    // Ab Liga 3 schlicht: nur die Kontur im Metall, keine Fläche, kein zweiter Rand.
    return <path d={SHIELD} fill="#0D0D0D" style={{ stroke: paint("base") }} strokeWidth="2.4" strokeLinejoin="round" />;
  }
  return (
    <g>
      <path d={SHIELD} fill={fill} />
      <path d={FIELD} fill="#0A0A0A" opacity="0.82" />
      <path d={RIM} fill="none" style={{ stroke: paint("light") }} strokeWidth="0.9" opacity={tier === "top" ? 0.75 : 0.5} />
    </g>
  );
}

/**
 * Das Abzeichen. `badge`: `{level, nickname, champion}` vom Server. `size`: "list" (Zeilen), "card" (Karten, Tabellenkopf), "hero".
 * `label`: den Text „Liga N · Beiname“ daneben zeigen (sonst trägt das Wappen ihn als Bildbeschreibung). `play`: beim ersten
 * Sichtbarwerden einmal bewegen; `index` staffelt mehrere.
 */
export function LeagueBadge({ badge, size = "card", label = true, play = true, index = 0, className = "", testId }) {
  const rawId = useId();
  const id = `lb${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [ref, state] = useFirstSight(play);
  const tier = badgeTier(badge?.level);
  if (!tier) return null;
  const metalKey = badgeMetal(badge);
  const number = String(badge.level);
  const shine = tier === "top" || badge.champion;
  const nickname = String(badge.nickname || "").trim();
  return (
    <span ref={ref} className={`tls-lbadge tls-lbadge--${size} ${className}`.trim()} data-tier={tier} data-metal={metalKey}
      data-play={state} style={{ "--tls-i": Math.min(index, STAGGER_MAX) }} data-testid={testId} title={label ? undefined : badgeAria(badge)}>
      <span className="tls-lbadge__art" role={label ? undefined : "img"} aria-label={label ? undefined : badgeAria(badge)}
        aria-hidden={label ? "true" : undefined} data-testid={testId ? `${testId}-art` : undefined}>
        <svg viewBox="0 0 64 80" className="tls-lbadge__svg" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={`${id}-metal`} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" style={{ stopColor: paint("dark") }} />
              <stop offset="0.42" style={{ stopColor: paint("light") }} />
              <stop offset="0.62" style={{ stopColor: paint("base") }} />
              <stop offset="1" style={{ stopColor: paint("dark") }} />
            </linearGradient>
            <clipPath id={`${id}-clip`}><path d={SHIELD} /></clipPath>
          </defs>
          <Shield tier={tier} id={id} />
          {shine ? (
            <g clipPath={`url(#${id}-clip)`}>
              <rect className="tls-lbadge__shine" x="-14" y="10" width="10" height="76" fill="#FFFFFF" transform="skewX(-18)" />
            </g>
          ) : null}
          <text x="32" y="47" textAnchor="middle" dominantBaseline="central" className="tls-lbadge__number"
            style={{ fill: paint(tier === "base" ? "base" : "light") }} fontSize={number.length > 1 ? 17 : 23}>{number}</text>
          {tier === "top" ? (
            <g className="tls-lbadge__crown" data-testid={testId ? `${testId}-crown` : undefined}>
              <path d={CROWN} fill={`url(#${id}-metal)`} style={{ stroke: paint("dark") }} strokeWidth="0.6" strokeLinejoin="round" />
              <rect x="20.6" y="17" width="22.8" height="3" rx="1" style={{ fill: paint("base") }} />
              <circle cx="18.6" cy="8" r="1.5" style={{ fill: paint("light") }} />
              <circle cx="32" cy="5" r="1.7" style={{ fill: paint("light") }} />
              <circle cx="45.4" cy="8" r="1.5" style={{ fill: paint("light") }} />
            </g>
          ) : null}
        </svg>
      </span>
      {label ? (
        <span className="tls-lbadge__text" data-testid={testId ? `${testId}-label` : undefined}>
          <span className="tls-lbadge__level">Liga {number}</span>
          {nickname ? <span className="tls-lbadge__nick"><span className="tls-lbadge__dot">{SEP}</span>{nickname}</span> : null}
          {badge.champion ? <span className="tls-lbadge__champion">{size === "list" ? <span className="sr-only">, Season-Meister</span> : size === "hero" ? "Meister" : `${SEP}Meister`}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
