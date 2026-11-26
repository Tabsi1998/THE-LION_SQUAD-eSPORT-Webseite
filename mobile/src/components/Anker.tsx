import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { View, type LayoutChangeEvent, type ScrollView, type StyleProp, type ViewStyle } from "react-native";
import { Glow } from "./motion/Glow";
import { useReduceMotion } from "./motion/useReduceMotion";

// Sprungziele in einer Seite (#2059, #1677): ein Link wie /mein-bereich/konto#app-sperre oder ein Suchtreffer öffnet die
// Seite an genau dieser Stelle - sie rollt dorthin und die Stelle leuchtet einmal kurz auf (nur Deckkraft). Mit „Bewegung
// reduzieren“ springt die Seite ohne Rollen, und nichts leuchtet. Ziele dürfen ineinander liegen (eine Karte in einem
// Abschnitt, ein Schalter in einer Karte): jedes meldet seine Lage zu seinem Eltern-Ziel, die Seite rechnet zusammen.
// Darum muss ein inneres Ziel direkt in seinem äußeren liegen (eine Karte ganz oben darin zählt mit, sie liegt bei 0).

type Spot = { y: number; parent?: string };

export type AnkerApi = {
  onLayout: (id: string, parent?: string) => (event: LayoutChangeEvent) => void;
  /** Zählt hoch, sobald diese Stelle angesprungen wurde - für das Aufleuchten. */
  round: (id: string) => number | undefined;
};

/** Wie lange nach dem Sprung nachgerückt wird, wenn darüber noch etwas nachlädt (Geräte, Passkeys …). */
const SETTLE_MS = 900;
const OFFSET = 12;

export function useAnker(scrollRef: React.RefObject<ScrollView | null>, ziel?: string | null): AnkerApi {
  const reduce = useReduceMotion();
  const spots = useRef<Record<string, Spot>>({});
  const jumped = useRef<{ ziel: string; y: number; at: number } | null>(null);
  const [lit, setLit] = useState<{ id: string; round: number } | null>(null);

  const absolute = useCallback((id: string): number | null => {
    let y = 0;
    let current: string | undefined = id;
    for (let depth = 0; current && depth < 6; depth += 1) {
      const spot: Spot | undefined = spots.current[current];
      if (!spot) return null;
      y += spot.y;
      current = spot.parent;
    }
    return current ? null : y;
  }, []);

  const jump = useCallback(() => {
    if (!ziel) return;
    const y = absolute(ziel);
    if (y === null) return;
    const target = Math.max(0, y - OFFSET);
    const done = jumped.current;
    if (done && done.ziel === ziel) {
      // Schon dort - nur nachrücken, wenn darüber gerade etwas nachgeladen hat.
      if (Date.now() - done.at > SETTLE_MS || Math.abs(done.y - target) < 4) return;
      jumped.current = { ...done, y: target };
      scrollRef.current?.scrollTo({ y: target, animated: false });
      return;
    }
    jumped.current = { ziel, y: target, at: Date.now() };
    scrollRef.current?.scrollTo({ y: target, animated: !reduce });
    setLit((previous) => ({ id: ziel, round: (previous?.round || 0) + 1 }));
  }, [absolute, reduce, scrollRef, ziel]);

  // Ein neues Ziel (derselbe Screen, neuer Link) springt neu.
  useEffect(() => {
    jumped.current = null;
    jump();
  }, [jump, ziel]);

  const onLayout = useCallback((id: string, parent?: string) => (event: LayoutChangeEvent) => {
    spots.current[id] = { y: event.nativeEvent.layout.y, parent };
    jump();
  }, [jump]);
  const round = useCallback((id: string) => (lit && lit.id === id ? lit.round : undefined), [lit]);
  return useMemo(() => ({ onLayout, round }), [onLayout, round]);
}

const AnkerContext = createContext<{ api: AnkerApi; parent?: string } | null>(null);

/** Der Bereich einer Seite, in dem Ziele liegen (meist der Inhalt einer ScrollView). */
export function AnkerBereich({ api, children }: { api: AnkerApi; children: React.ReactNode }) {
  const value = useMemo(() => ({ api }), [api]);
  return <AnkerContext.Provider value={value}>{children}</AnkerContext.Provider>;
}

/** Eine Stelle, die man anspringen kann - `mb-<id>` im Test. Außerhalb eines AnkerBereichs nur eine View. */
export function AnkerView({ id, style, children, radius = 6 }: { id: string; style?: StyleProp<ViewStyle>; children: React.ReactNode; radius?: number }) {
  const context = useContext(AnkerContext);
  const inner = useMemo(() => (context ? { api: context.api, parent: id } : null), [context, id]);
  if (!context || !inner) return <View style={style} testID={`mb-${id}`}>{children}</View>;
  return (
    <View style={style} testID={`mb-${id}`} onLayout={context.api.onLayout(id, context.parent)}>
      <AnkerContext.Provider value={inner}>{children}</AnkerContext.Provider>
      <Glow trigger={context.api.round(id)} radius={radius} />
    </View>
  );
}
