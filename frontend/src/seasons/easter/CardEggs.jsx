import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { boxFree, overflows } from "../cardDeco";
import { onHuntActive } from "../easterHunt/api";
import { EggShape } from "../easterHunt/EggShape";
import { useSeason } from "../SeasonContext";
import { useCardDeco, useCardReaction } from "../useCardDeco";
import { GrassTuft } from "./art";
import { ROLL, cardEggPlan, eggBox, rollStep } from "./roll";

// Ostereier an Karten (Jahreszeiten IV, Variante B, #1092): zusätzlich zur Reihe unter der Kopfzeile liegt auf der
// Oberkante einiger Karten, die sich heben, ein bemaltes Ei auf der Seite, daneben ein Grasbüschel - nur dort, wo
// darüber nichts Lesbares und keine andere Karte liegt. Hebt sich die Karte, fährt das Ei mit, wackelt zweimal und rollt
// höchstens sechs Pixel zur näheren Ecke; dort bleibt es liegen (bis zum nächsten Laden), über die Ecke rollt es nie.
// Läuft die Eiersuche, liegen hier keine Eier - sie sähen aus wie die versteckten. Am Karfreitag rührt sich nichts.

/** Schmälere Karten tragen kein Ei. */
export const EGG_MIN_WIDTH = 160;

/** Passt ein Ei auf diese Karte? Platz für Ei, Gras und den ganzen Rollweg über der Kante. Liefert die Form oder null. */
export function placeEgg(anchor, { doc = typeof document === "undefined" ? null : document, win = typeof window === "undefined" ? null : window, neighbours = null, seed = "egg" } = {}) {
  const rect = anchor.rect;
  if (!rect || rect.width < EGG_MIN_WIDTH) return null;
  const plan = cardEggPlan(rect.width, seed);
  const box = eggBox(plan);
  const room = { left: rect.left + box.left, right: rect.left + box.right, top: rect.top + box.top, bottom: rect.top - 1 };
  if (doc && overflows(doc, win, room)) return null;
  if (doc && !boxFree(doc, win, room, anchor.element, { neighbours, step: 5 })) return null;
  return { ...plan, ax: plan.x, ay: 0, box: { left: box.left, top: box.top, right: box.right, bottom: 2 } };
}

/** Der Versatz, auf dem ein Ei liegt - nie weiter als sein Weg (nach einem neuen Messen auch kürzer). */
function clampOffset(offset, plan) {
  return Math.max(-plan.room, Math.min(plan.room, Number(offset) || 0));
}

function CardEgg({ item, reaction }) {
  const plan = item.geo;
  const height = plan.size * (38 / 30);
  const offset = clampOffset(item.offset, plan);
  const rolling = reaction && reaction.kind === "lift" ? reaction : null;
  const from = rolling ? clampOffset(item.rolledFrom, plan) : offset;
  const share = Math.min(1, Math.abs(offset - from) / ROLL.maxPx);
  return (
    <div
      className={`tls-card-egg${item.yield ? " tls-card-egg--yield" : ""}`}
      style={{ left: `${(item.x + plan.x).toFixed(1)}px`, top: `${item.y.toFixed(1)}px` }}
      data-testid="easter-card-egg"
      data-season-card={item.card}
      data-pattern={plan.pattern}
      data-offset={offset}
      data-roll={rolling ? "1" : undefined}
      data-yield={item.yield ? "1" : undefined}
    >
      <span className="tls-card-egg__tuft" style={{ left: `${(plan.tuft.x - plan.x - plan.tuft.width / 2).toFixed(1)}px`, top: `${-plan.tuft.height}px` }}>
        <GrassTuft width={plan.tuft.width} height={plan.tuft.height} blades={plan.tuft.blades} />
      </span>
      {/* Je Rollen eine neue Gruppe: so beginnt die Animation jedes Mal von vorn. */}
      <span key={rolling ? rolling.n : "rest"} className={`tls-card-egg__roll${rolling ? " tls-card-egg__roll--go" : ""}`} style={rolling ? { "--from": `${from}px`, "--to": `${offset}px` } : { transform: `translateX(${offset}px)` }}>
        <span className="tls-card-egg__shadow" style={{ width: `${(plan.size * 1.05).toFixed(1)}px`, left: `${(-plan.size * 0.525).toFixed(1)}px` }} />
        <span className={`tls-card-egg__tilt${rolling ? " tls-card-egg__tilt--go" : ""}`} style={rolling ? { "--wobble": `${ROLL.wobble}deg`, "--turn": `${(ROLL.turn * share * plan.dir).toFixed(2)}deg` } : undefined}>
          <span className="tls-card-egg__body" style={{ left: `${(-plan.size / 2).toFixed(1)}px`, top: `${(-plan.half - height / 2).toFixed(1)}px`, width: `${plan.size}px`, height: `${height.toFixed(1)}px`, transform: `rotate(${plan.lean}deg)` }}>
            <EggShape pattern={plan.pattern} size={plan.size} />
          </span>
        </span>
      </span>
    </div>
  );
}

/** Eier an Karten. `quiet`: Karfreitag - die Eier liegen, aber nichts rührt sich. */
export function CardEggs({ season, quiet = false }) {
  const { byKey } = useSeason();
  const huntWindow = Boolean(byKey?.easter_hunt && byKey.easter_hunt.effective !== "off");
  const [huntActive, setHuntActive] = useState(null);
  useEffect(() => (huntWindow ? onHuntActive(setHuntActive) : undefined), [huntWindow]);
  const show = !huntWindow || huntActive === false;
  const { items, itemsRef, update } = useCardDeco({ season, kind: "egg", place: placeEgg, enabled: show });
  const roll = (mine) => update(mine.map((item) => item.id), (item) => {
    const from = clampOffset(item.offset, item.geo);
    return { ...item, rolledFrom: from, offset: rollStep(from, item.geo) };
  });
  const reactions = useCardReaction(itemsRef, { durationMs: ROLL.ms, enabled: show && items.length > 0 && !quiet, onLift: roll });
  if (typeof document === "undefined" || !show || !items.length) return null;
  return createPortal(
    <div className="tls-card-deco tls-card-eggs" aria-hidden="true" data-testid="easter-card-eggs">
      {items.map((item) => <CardEgg key={item.id} item={item} reaction={reactions[item.id] || null} />)}
    </div>,
    document.body,
  );
}
