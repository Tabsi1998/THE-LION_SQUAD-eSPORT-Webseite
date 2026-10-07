import React, { useEffect } from "react";
import { useWindowDimensions } from "react-native";
import { CardGarland } from "./birthday/garlandView";
import { CardStreamer } from "./carnival/streamerOnCard";
import { CardChain } from "./christmas/cardChain";
import { CardEgg } from "./easter/cardEgg";
import { effectClasses, screenClass } from "./intensity";
import { assignCardDeco, cardDecoFor, perchSnapshot, subscribePerches, type CardDecoAssignment, type CardDecoKind } from "./perches";
import { seasonRng, seasonYear } from "./rng";
import type { ActiveSeason } from "./SeasonProvider";

// Deko an Karten in der App (Jahreszeiten IV, Variante B, #1091-#1094 - wie frontend/src/seasons/cardDeco.js):
// Lichterkette, Osterei, Luftschlange und Wimpelkette hängen nicht nur an der Begrüßungskarte bzw. am Rand, sondern
// zusätzlich an einigen Karten eines Screens - nie an jeder. Dieselben Regeln wie im Web: so viele, wie die Ecken des
// Screens erlauben (lebendig 2, mittel 1, ruhig und still keine; „dezent“ eine; kleine Bildschirme keine), höchstens
// vier von zehn Karten, mindestens eine. Nur Karten, die nichts abschneiden (die Deko ragt über ihre Kanten), nicht die
// Begrüßungskarte (die trägt ihre Deko schon) und keine Banner. Wird eine Karte angetippt, reagiert nur ihre Deko.

/** Höchstens so ein Anteil der Karten eines Screens trägt Deko. */
export const CARD_SHARE = 0.4;

/** Wie viele Karten eines Screens Deko tragen - nach Screen, Stärke, Bildschirm und Zahl der Karten. */
export function cardDecoCount(screen: string, effective: string, width: number, height: number, cards: number): number {
  const corner = width < 360 || height < 640 ? 0 : effectClasses(screenClass(screen), effective).corner;
  if (!corner || cards <= 0) return 0;
  return Math.min(corner, Math.max(1, Math.round(cards * CARD_SHARE)));
}

/**
 * Die Karten eines Screens, die eine Saison mit Deko schmücken darf (`kind`): solange `active`, beim Anmelden und
 * Abmelden von Karten neu - wer schon Deko trägt, behält sie; freie Plätze werden aus dem Seed (Saison, Jahr, Screen,
 * Kartenliste) gefüllt. Karten mit Deko einer anderen Saison bleiben frei.
 */
export function useCardDecoAssignments(season: ActiveSeason, screen: string, kind: CardDecoKind, active: boolean) {
  const { width, height } = useWindowDimensions();
  const key = season.key;
  const effective = season.effective;
  const year = seasonYear(season);
  useEffect(() => {
    if (!active) {
      assignCardDeco(key, []);
      return undefined;
    }
    const recompute = () => {
      const snapshot = perchSnapshot();
      const others = new Set(Object.values(snapshot.deco).filter((entry) => entry.season !== key).map((entry) => entry.perchId));
      const eligible = snapshot.perches.filter((perch) => perch.screen === screen && !perch.clip && (perch.kind === "card" || perch.kind === "tile") && !others.has(perch.id));
      const count = cardDecoCount(screen, effective, width, height, eligible.length);
      const kept = cardDecoFor(key).filter((entry) => entry.kind === kind && eligible.some((perch) => perch.id === entry.perchId)).slice(0, count);
      const rng = seasonRng({ season: key, year, screen }, `cards:${kind}:${eligible.map((perch) => perch.id).join(",")}`);
      const free = eligible.filter((perch) => !kept.some((entry) => entry.perchId === perch.id));
      const fresh: CardDecoAssignment[] = [];
      while (kept.length + fresh.length < count && free.length) {
        const [pick] = free.splice(Math.min(free.length - 1, Math.floor(rng() * free.length)), 1);
        fresh.push({ perchId: pick.id, season: key, kind, seed: `${key}:${year}:${screen}:${pick.id}`, year });
      }
      assignCardDeco(key, [...kept, ...fresh]);
    };
    recompute();
    const stop = subscribePerches(recompute);
    return () => {
      stop();
      assignCardDeco(key, []);
    };
  }, [key, screen, kind, active, effective, width, height, year]);
}

/** Die Deko einer Karte - je nach Saison Lichterkette, Osterei, Luftschlange oder Wimpelkette. */
export function CardDeco({ perchId, deco }: { perchId: string; deco: CardDecoAssignment }) {
  if (deco.kind === "chain") return <CardChain perchId={perchId} seed={deco.seed} year={deco.year} />;
  if (deco.kind === "egg") return <CardEgg perchId={perchId} seed={deco.seed} />;
  if (deco.kind === "streamer") return <CardStreamer perchId={perchId} seed={deco.seed} />;
  return <CardGarland perchId={perchId} year={deco.year} />;
}
