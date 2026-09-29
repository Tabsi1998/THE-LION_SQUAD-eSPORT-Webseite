import { CalendarDays, Clapperboard, Gift, HelpCircle, Image as ImageIcon, Newspaper, Play, ScrollText, Smile, Star } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";
import { doorLabel } from "./doors";

// Ein Türchen (#641, #732): vorne ein Stück des Winterbildes mit Schildchen, dahinter die Nische mit dem Licht.
// Zu: der Flügel liegt im Bild. Offen für heute: durch den Spalt fällt Licht. Geöffnet: der Flügel steht offen,
// in der Nische wartet der Inhalt. Verschlossen: ein Klick rüttelt nur an der Tür.

export const KIND_ICONS = {
  text: ScrollText,
  image: ImageIcon,
  video: Play,
  clip: Clapperboard,
  news: Newspaper,
  event: CalendarDays,
  member_spotlight: Star,
  sticker: Smile,
  quiz: HelpCircle,
  prize: Gift,
};

const ORNAMENT_PATHS = {
  star: <path d="M12 2.6l2.6 6 6.5.6-4.9 4.3 1.5 6.4L12 16.5l-5.7 3.4 1.5-6.4-4.9-4.3 6.5-.6z" />,
  twig: <path d="M4 20L20 4M8 16l-4.4-1.2M8 16l1.2 4.4M11.5 12.5L6.6 11.2M11.5 12.5l1.3 4.9M15 9l-4.6-1.2M15 9l1.2 4.6M18 6l-3.6-.9M18 6l.9 3.6" />,
  flake: <path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M12 6l-2.4-2M12 6l2.4-2M12 18l-2.4 2M12 18l2.4 2M6.8 9l-3-.4M6.8 9L6.4 6M17.2 15l3 .4M17.2 15l.4 3M6.8 15l-3 .4M6.8 15l-.4 3M17.2 9l3-.4M17.2 9l.4-3" />,
  bell: <path d="M12 3.2c-3.6 0-5.4 2.8-5.4 6.4 0 4.2-1.4 5.6-2.6 6.8h16c-1.2-1.2-2.6-2.6-2.6-6.8 0-3.6-1.8-6.4-5.4-6.4zM10 19.2a2 2 0 0 0 4 0M12 1.4v1.8" />,
  paw: (
    <>
      <path d="M12 11.8c2.7 0 4.9 2.1 4.8 4.6-.1 2-2.3 2.5-4.8 2.5s-4.7-.5-4.8-2.5c-.1-2.5 2.1-4.6 4.8-4.6z" />
      <ellipse cx="6.3" cy="9.7" rx="1.7" ry="2.1" />
      <ellipse cx="9.9" cy="6.2" rx="1.7" ry="2.2" />
      <ellipse cx="14.1" cy="6.2" rx="1.7" ry="2.2" />
      <ellipse cx="17.7" cy="9.7" rx="1.7" ry="2.1" />
    </>
  ),
};

function Ornament({ kind }) {
  const path = ORNAMENT_PATHS[kind];
  if (!path) return null;
  const filled = kind === "star" || kind === "paw";
  return (
    <svg className="tls-adv__ornament" viewBox="0 0 24 24" aria-hidden="true" fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

function Plaque({ day }) {
  return (
    <span className="tls-adv__plaque" aria-hidden="true">
      <span className="tls-adv__number">{day}</span>
    </span>
  );
}

function Leaf({ part, day, variant, withPlaque, withOrnament }) {
  return (
    <span className={`tls-adv__leaf tls-adv__leaf--${part}`} data-testid={`advent-leaf-${day}-${part}`}>
      <span className="tls-adv__face tls-adv__face--front">
        {withOrnament && <Ornament kind={variant.ornament} />}
        {withPlaque && <Plaque day={day} />}
        <span className="tls-adv__knob" />
      </span>
      <span className="tls-adv__face tls-adv__face--back">
        <span className="tls-adv__back-number">{day}</span>
      </span>
    </span>
  );
}

/** Was in der Nische eines geöffneten Türchens zu sehen ist: das Bild, der Sticker oder ein Zeichen für die Art. */
export function NichePreview({ content }) {
  if (!content) return null;
  const Icon = KIND_ICONS[content.kind] || ScrollText;
  const picture = content.kind === "image" ? content.media_url : content.kind === "sticker" ? content.sticker?.url : content.card?.image_url || null;
  return (
    <span className="tls-adv__preview" data-kind={content.kind} data-long={String(content.title || "").length > 34 ? "1" : "0"}>
      {picture
        ? <img className={`tls-adv__preview-image${content.kind === "sticker" ? " tls-adv__preview-image--sticker" : ""}`} src={resolveMediaUrl(picture)} alt="" loading="lazy" />
        : <Icon className="tls-adv__preview-icon" aria-hidden="true" />}
      <span className="tls-adv__preview-title">{content.title}</span>
    </span>
  );
}

export function Door({ door, variant, cell, today = false, busy = false, rattling = false, onActivate }) {
  const double = variant.hinge === "double";
  // Bei zwei Flügeln sitzt das Schildchen auf dem linken oder rechten Flügel - nie über dem Spalt.
  const plaque = double && variant.plaque === "center" ? "tl" : variant.plaque;
  const plaqueLeft = plaque === "tl" || plaque === "bl" || plaque === "center";
  const style = {
    "--col": cell.col,
    "--row": cell.row,
    "--inset": variant.inset,
    "--light": variant.light.color,
    "--light-soft": variant.light.soft,
    "--angle": variant.angle,
    "--swing": `${variant.swing}ms`,
    "--tilt": `${variant.tilt}deg`,
    "--pulse": `${variant.pulse}s`,
    "--delay": `${variant.delay}s`,
  };
  const locked = door.state === "locked";
  return (
    <div
      className="tls-adv__cell"
      style={style}
      data-testid={`advent-door-${door.day}`}
      data-day={door.day}
      data-state={door.state}
      data-shape={variant.shape}
      data-hinge={variant.hinge}
      data-plaque={plaque}
      data-today={today ? "1" : "0"}
      data-busy={busy ? "1" : "0"}
      data-rattle={rattling ? "1" : "0"}
    >
      {today && door.state !== "opened" && <span className="tls-adv__today" aria-hidden="true">Heute</span>}
      <button
        type="button"
        className="tls-adv__door"
        onClick={() => onActivate(door)}
        aria-label={doorLabel(door, { today })}
        title={locked ? doorLabel(door) : undefined}
        data-testid={`advent-door-button-${door.day}`}
      >
        <span className="tls-adv__niche">
          <span className="tls-adv__glow" />
          {door.state === "opened" && <NichePreview content={door.content} />}
        </span>
        {double ? (
          <>
            <Leaf part="a" day={door.day} variant={variant} withPlaque={plaqueLeft} withOrnament={!plaqueLeft} />
            <Leaf part="b" day={door.day} variant={variant} withPlaque={!plaqueLeft} withOrnament={plaqueLeft} />
          </>
        ) : (
          <Leaf part="single" day={door.day} variant={variant} withPlaque withOrnament />
        )}
      </button>
    </div>
  );
}
