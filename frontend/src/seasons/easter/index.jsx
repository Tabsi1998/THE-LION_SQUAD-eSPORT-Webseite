import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { effectClasses, pageClass } from "../intensity";
import { hashString } from "../rng";
import { markToastShown, toastShownToday } from "../SeasonStage";
import { FlowerArt } from "./art";
import { CardEggs } from "./CardEggs";
import { EggRow } from "./EggRow";
import { Meadow } from "./Meadow";
import { Butterflies, HarePeek } from "./Moments";
import { createPetalLayer, petalCount } from "./petals";
import { greetingDay, isQuiet, yearOf } from "./plan";
import "./easter.css";

// Ostern (Jahreszeiten III S14 #645, E1 #753, E4 #756): von Palmsonntag bis Ostermontag. Hasenohren trägt der Löwe
// nicht mehr (Wunsch des Betreibers, #857). Auf einigen Karten liegt ein Ei, das wackelt und ein Stück rollt, wenn sich
// die Karte hebt (Jahreszeiten IV, #1092). Unter der Kopfzeile eine Reihe
// bemalter Eier im Gras (während der Eiersuche Blumen), über der Fußzeile eine kleine Wiese, hinter dem Inhalt ein
// helles Frühlingslicht, das langsam wandert. Selten sinkt ein Blütenblatt, bei „voll“ flattert ab und zu ein
// Zitronenfalter vorbei, und alle paar Minuten streckt ein Feldhase die Ohren hinter einer Karte hervor. Ostersonntag
// und -montag kommt der Gruß. Karfreitag ist still: die Deko bleibt, aber nichts bewegt sich, kein Gruß.
// „dezent“ und „Bewegung reduzieren“: alles steht, keine Blätter, keine Falter, kein Hase.

export const GREETING_KEY = "easter-greeting";

/** Ecken und Kanten: Eier-Reihe, Wiese und die seltenen Momente - je nach Seitenklasse und Tag. */
export function Corners({ season }) {
  const location = useLocation();
  const quiet = isQuiet(season);
  const moving = season.effective !== "subtle" && !quiet;
  const fx = effectClasses(pageClass(location.pathname), season.effective);
  return (
    <>
      {fx.corner > 0 ? <EggRow moving={moving} /> : null}
      <CardEggs season={season} quiet={quiet} />
      {fx.scene !== "none" ? <Meadow year={yearOf(season)} small={fx.scene === "small"} moving={moving} /> : null}
      {moving && fx.motion && season.effective === "full" ? <Butterflies /> : null}
      {moving && fx.rare ? <HarePeek /> : null}
    </>
  );
}

/** Hinter dem Inhalt ein helles Frühlingslicht (#753), das langsam wandert - am Karfreitag halb so hell und still. */
export function Backdrop({ season }) {
  const quiet = isQuiet(season);
  const still = quiet || season.effective === "subtle";
  return <div className={`tls-season-backdrop tls-easter-light${still ? " tls-easter-light--still" : ""}${quiet ? " tls-easter-light--quiet" : ""}`} aria-hidden="true" data-testid="easter-light" />;
}

/** Die Blätter für den gemeinsamen Canvas-Loop: wenige, nicht ohne Bewegung, nicht bei „dezent“, nicht am Karfreitag. */
export function skyLayers({ season, budget = 0, reducedMotion = false }) {
  if (reducedMotion || season.effective === "subtle" || !budget || isQuiet(season)) return [];
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const ambient = effectClasses(pageClass(pathname), season.effective).ambient;
  const share = ambient === "near" ? 1 : ambient === "far" ? 0.5 : 0;
  const count = petalCount(budget, share);
  return count > 0 ? [createPetalLayer({ count, seed: hashString(`easter:${pathname}:${new Date().toDateString()}`) })] : [];
}

/** Der Gruß am Ostersonntag und -montag, einmal je Tag: eine Karte unten mit dem Text aus dem Admin. */
export function Toast({ season }) {
  const [open, setOpen] = useState(false);
  const greeting = season.texts?.greeting || "Frohe Ostern wünscht THE LION SQUAD";
  const due = greetingDay(season) && !isQuiet(season);
  useEffect(() => {
    if (!due || typeof window === "undefined" || toastShownToday(GREETING_KEY)) return undefined;
    const show = window.setTimeout(() => {
      markToastShown(GREETING_KEY);
      setOpen(true);
    }, 1500);
    const hide = window.setTimeout(() => setOpen(false), 1500 + 10000);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [due]);
  if (!open) return null;
  return (
    <div className="tls-season-toast tls-easter-toast" role="status" data-testid="easter-toast">
      <FlowerArt kind="daisy" height={18} />
      <span className="tls-easter-toast__text">{greeting}</span>
      <button type="button" className="tls-easter-toast__close" onClick={() => setOpen(false)} aria-label="Gruß schließen">×</button>
    </div>
  );
}

export const season = { key: "easter", Backdrop, Corners, Toast, skyLayers };
