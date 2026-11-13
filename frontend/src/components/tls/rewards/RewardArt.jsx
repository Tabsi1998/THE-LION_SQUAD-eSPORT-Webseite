import { useId } from "react";
import { resolveMediaUrl } from "@/lib/api";
import { KIND_LABELS, artLines } from "@/lib/leagueRewards";
import "./rewards.css";

// Lionsquad-Vorlagen der Belohnungen (F.4, #2214, Nr. 164): Banner, Emblem, Medaille und Titel als SVG - dieselbe Sprache wie der
// Pokal der Vitrine (TrophyShelf): ein Metall-Verlauf je Gold, Silber, Bronze, sonst Lionsquad-Blau, ein Glanzstreifen. Beschriftet
// mit Season, Liga N und Platz. Hat die Leitung ein eigenes Bild hochgeladen, steht es an Stelle der Vorlage.
//
// Bewegung (Detail-Runde): `play="run"` hebt die Grafik weich an, zeichnet den Glanz einmal nach und lässt die Kante kurz aufleuchten;
// `--tls-i` staffelt mehrere. Mit „Bewegung reduzieren“ steht alles still (rewards.css).

export const REWARD_METALS = {
  gold: { label: "Gold", light: "#FFF2A8", base: "#FFD700", dark: "#8A6A12" },
  silver: { label: "Silber", light: "#FFFFFF", base: "#C9CED6", dark: "#6F7682" },
  bronze: { label: "Bronze", light: "#F2C08E", base: "#D08A4E", dark: "#6E3F16" },
  lion: { label: "Lionsquad", light: "#B8ECFF", base: "#29B6E8", dark: "#0E5C7A" },
};

const SIZES = { sm: 56, md: 112, lg: 184 };

function clip(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Die Ziffer im Zeichen: „1“ aus „1. Platz“, „4–6“ aus einem Bereich, sonst ein Stern. */
export function placeMark(place) {
  const text = String(place || "");
  const single = text.match(/^(\d{1,2})\. Platz$/);
  if (single) return single[1];
  const range = text.match(/^Platz (\d{1,2})–(\d{1,2})$/);
  if (range) return `${range[1]}–${range[2]}`;
  return "★";
}

function Shapes({ kind, id, metal }) {
  const fill = `url(#${id}-metal)`;
  if (kind === "banner") {
    return (
      <g>
        <rect x="18" y="8" width="84" height="8" rx="3" fill={metal.dark} />
        <path d="M24 14h72v94l-36-18-36 18z" fill={fill} />
        <path d="M30 20h60v78l-30-15-30 15z" fill="#0A0A0A" opacity="0.72" />
        <g clipPath={`url(#${id}-clip)`}><rect className="tls-reward__shine" x="-30" y="0" width="14" height="120" fill="#FFFFFF" opacity="0.5" transform="skewX(-18)" /></g>
      </g>
    );
  }
  if (kind === "emblem") {
    return (
      <g>
        <path d="M60 8l44 16v32c0 28-20 46-44 56C36 102 16 84 16 56V24z" fill={fill} />
        <path d="M60 18l34 12v26c0 22-15 36-34 45-19-9-34-23-34-45V30z" fill="#0A0A0A" opacity="0.72" />
        <path d="M40 30l20 9 20-9" fill="none" stroke={metal.base} strokeWidth="3" strokeLinecap="round" opacity="0.8" />
        <g clipPath={`url(#${id}-clip)`}><rect className="tls-reward__shine" x="-30" y="0" width="14" height="120" fill="#FFFFFF" opacity="0.5" transform="skewX(-18)" /></g>
      </g>
    );
  }
  if (kind === "title") {
    return (
      <g>
        <rect x="6" y="36" width="108" height="48" rx="8" fill={fill} />
        <rect x="11" y="41" width="98" height="38" rx="5" fill="#0A0A0A" opacity="0.74" />
        <path d="M6 60l-4-6v12zM114 60l4-6v12z" fill={metal.base} />
        <g clipPath={`url(#${id}-clip)`}><rect className="tls-reward__shine" x="-30" y="0" width="14" height="120" fill="#FFFFFF" opacity="0.5" transform="skewX(-18)" /></g>
      </g>
    );
  }
  // Medaille: zwei Bänder, Scheibe mit Rand und innerem Ring.
  return (
    <g>
      <path d="M38 6h16l14 40H52z" fill={metal.dark} />
      <path d="M82 6H66L52 46h16z" fill={metal.base} opacity="0.85" />
      <circle cx="60" cy="74" r="38" fill={fill} />
      <circle cx="60" cy="74" r="30" fill="#0A0A0A" opacity="0.7" />
      <circle cx="60" cy="74" r="33" fill="none" stroke={metal.light} strokeWidth="1.2" opacity="0.6" />
      <g clipPath={`url(#${id}-clip)`}><rect className="tls-reward__shine" x="-30" y="0" width="14" height="120" fill="#FFFFFF" opacity="0.5" transform="skewX(-18)" /></g>
    </g>
  );
}

const CLIPS = {
  banner: "M24 14h72v94l-36-18-36 18z",
  emblem: "M60 8l44 16v32c0 28-20 46-44 56C36 102 16 84 16 56V24z",
  title: "M6 36h108v48H6z",
  medal: "M98 74a38 38 0 1 1-76 0 38 38 0 0 1 76 0z",
};

/**
 * Eine Belohnung als Grafik. `reward`: `{kind, name, image_url, art: {season, division, place, metal}}` (aus der Auszeichnung oder der
 * Zusammenstellung). `size`: sm (Liste), md (Karte), lg (Zeremonie). `play`: "run" spielt die Bewegung einmal.
 */
export function RewardArt({ reward, size = "md", play, index = 0, testId, labelled = true }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const kind = KIND_LABELS[reward?.kind] ? reward.kind : "medal";
  const art = reward?.art || {};
  const metalKey = REWARD_METALS[art.metal] ? art.metal : "lion";
  const metal = REWARD_METALS[metalKey];
  const px = SIZES[size] || SIZES.md;
  const lines = artLines(art);
  const label = [KIND_LABELS[kind], reward?.name, ...lines].filter(Boolean).join(" · ");
  const image = reward?.image_url ? resolveMediaUrl(reward.image_url) : "";
  const mark = placeMark(art.place);
  const small = size === "sm";
  return (
    <span className={`tls-reward tls-reward--${kind} tls-reward--${size}`} data-metal={metalKey} data-play={play || undefined}
      style={{ "--tls-i": index, width: px, height: px }} data-testid={testId} role={labelled ? "img" : undefined} aria-label={labelled ? label : undefined}
      aria-hidden={labelled ? undefined : "true"}>
      {image ? (
        <img src={image} alt="" className="tls-reward__image" loading="lazy" />
      ) : (
        <svg viewBox="0 0 120 120" className="tls-reward__svg" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={`${id}-metal`} x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor={metal.dark} />
              <stop offset="0.42" stopColor={metal.light} />
              <stop offset="0.62" stopColor={metal.base} />
              <stop offset="1" stopColor={metal.dark} />
            </linearGradient>
            <clipPath id={`${id}-clip`}><path d={CLIPS[kind]} /></clipPath>
          </defs>
          <Shapes kind={kind} id={id} metal={metal} />
          {kind === "title" ? (
            <text x="60" y={small ? 66 : 58} textAnchor="middle" className="tls-reward__title" fill={metal.light} fontSize={small ? 13 : 11}>
              {clip(reward?.name, small ? 10 : 16)}
            </text>
          ) : (
            <text x="60" y={kind === "medal" ? 82 : kind === "banner" ? 58 : 62} textAnchor="middle" className="tls-reward__mark" fill={metal.base}
              fontSize={mark.length > 2 ? 18 : 26}>{mark}</text>
          )}
          {!small && kind === "title" && art.season ? (
            <text x="60" y="72" textAnchor="middle" className="tls-reward__line" fill="#FFFFFF" fontSize="7.5">{clip([art.season, art.division].filter(Boolean).join(" · "), 26)}</text>
          ) : null}
          {!small && kind !== "title" ? (
            <g className="tls-reward__lines">
              {art.season ? <text x="60" y={kind === "medal" ? 98 : 78} textAnchor="middle" className="tls-reward__line" fill="#FFFFFF" fontSize="7.5">{clip(art.season, 18)}</text> : null}
              {art.division ? <text x="60" y={kind === "medal" ? 62 : 88} textAnchor="middle" className="tls-reward__line" fill={metal.light} fontSize="7">{clip(art.division, 16)}</text> : null}
            </g>
          ) : null}
        </svg>
      )}
    </span>
  );
}
