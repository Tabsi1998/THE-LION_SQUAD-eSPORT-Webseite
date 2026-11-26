import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, View, type LayoutChangeEvent, type ScrollView, type StyleProp, type ViewStyle } from "react-native";
import { Glow } from "./motion/Glow";
import { useReduceMotion } from "./motion/useReduceMotion";

// Sprungziele in einer Seite (#2059, #1677): ein Link wie /mein-bereich/konto#app-sperre oder ein Suchtreffer öffnet die
// Seite an genau dieser Stelle - sie rollt dorthin, die Stelle leuchtet einmal kurz auf (nur Deckkraft) und bekommt den
// Fokus des Vorlesers. Mit „Bewegung reduzieren“ springt die Seite ohne Rollen, und nichts leuchtet. Ziele dürfen
// ineinander liegen (eine Karte in einem Abschnitt, ein Schalter in einer Karte), beliebig tief: jedes meldet seine Lage zu
// seinem Eltern-Ziel, die Seite rechnet zusammen. Darum muss ein inneres Ziel direkt in seinem äußeren liegen (eine Karte
// ganz oben darin zählt mit, sie liegt bei 0).

type Spot = { y: number; parent?: string };

export type AnkerApi = {
  onLayout: (id: string, parent?: string) => (event: LayoutChangeEvent) => void;
  /** Zählt hoch, sobald diese Stelle angesprungen wurde - für das Aufleuchten. Ein späteres Ziel ändert ihn nicht. */
  round: (id: string) => number | undefined;
  /** Die Ansicht der Stelle - für den Fokus des Vorlesers. */
  register: (id: string, node: View | null) => void;
};

/** So lange nach dem Sprung rückt die Seite nach, wenn darüber noch etwas nachlädt (Geräte, Passkeys, Karten …). */
export const SETTLE_MS = 3000;
/** Höchstens so oft - danach rollt der Mensch selbst. */
const MAX_CORRECTIONS = 6;
const OFFSET = 12;
/** Erst nach dem Rollen den Vorleser hinschicken - sonst liest er die alte Stelle. */
const FOCUS_DELAY_MS = 450;

type Jump = { ziel: string; y: number; at: number; corrections: number };

export function useAnker(scrollRef: React.RefObject<ScrollView | null>, ziel?: string | null): AnkerApi {
  const reduce = useReduceMotion();
  const spots = useRef<Record<string, Spot>>({});
  const nodes = useRef<Record<string, View | null>>({});
  const jumped = useRef<Jump | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Je Stelle, wie oft sie angesprungen wurde - eine Stelle behält ihren Wert, wenn ein anderes Ziel kommt (kein Nachleuchten).
  const [rounds, setRounds] = useState<Record<string, number>>({});

  /** Die Lage einer Stelle in der Seite - über alle Eltern, ohne Tiefenlimit; ein Kreis oder eine fehlende Lage: null. */
  const absolute = useCallback((id: string): number | null => {
    let y = 0;
    const seen = new Set<string>();
    let current: string | undefined = id;
    while (current) {
      if (seen.has(current)) return null;
      seen.add(current);
      const spot: Spot | undefined = spots.current[current];
      if (!spot) return null;
      y += spot.y;
      current = spot.parent;
    }
    return y;
  }, []);

  const focus = useCallback((id: string) => {
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      focusTimer.current = null;
      const node = nodes.current[id];
      if (!node) return;
      try {
        AccessibilityInfo.sendAccessibilityEvent(node as never, "focus");
      } catch {
        // ohne Vorleser-Fokus weiter
      }
    }, FOCUS_DELAY_MS);
  }, []);

  const jump = useCallback(() => {
    if (!ziel) return;
    const y = absolute(ziel);
    if (y === null) return;
    const target = Math.max(0, y - OFFSET);
    const done = jumped.current;
    if (done && done.ziel === ziel) {
      // Schon dort - nur nachrücken, wenn darüber gerade etwas nachgeladen hat, und nur eine Weile.
      if (Math.abs(done.y - target) < 4 || Date.now() - done.at > SETTLE_MS || done.corrections >= MAX_CORRECTIONS) return;
      jumped.current = { ...done, y: target, corrections: done.corrections + 1 };
      scrollRef.current?.scrollTo({ y: target, animated: false });
      return;
    }
    jumped.current = { ziel, y: target, at: Date.now(), corrections: 0 };
    scrollRef.current?.scrollTo({ y: target, animated: !reduce });
    setRounds((previous) => ({ ...previous, [ziel]: (previous[ziel] || 0) + 1 }));
    focus(ziel);
  }, [absolute, focus, reduce, scrollRef, ziel]);

  // Ein neues Ziel (derselbe Screen, neuer Link) springt neu.
  useEffect(() => {
    jumped.current = null;
    jump();
  }, [jump, ziel]);
  useEffect(() => () => {
    if (focusTimer.current) clearTimeout(focusTimer.current);
  }, []);

  const onLayout = useCallback((id: string, parent?: string) => (event: LayoutChangeEvent) => {
    spots.current[id] = { y: event.nativeEvent.layout.y, parent };
    jump();
  }, [jump]);
  const round = useCallback((id: string) => rounds[id], [rounds]);
  const register = useCallback((id: string, node: View | null) => {
    nodes.current[id] = node;
  }, []);
  return useMemo(() => ({ onLayout, round, register }), [onLayout, round, register]);
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
  const api = context?.api;
  const ref = useCallback((node: View | null) => { api?.register(id, node); }, [api, id]);
  if (!context || !inner) return <View style={style} testID={`mb-${id}`}>{children}</View>;
  return (
    <View ref={ref} style={style} testID={`mb-${id}`} onLayout={context.api.onLayout(id, context.parent)}>
      <AnkerContext.Provider value={inner}>{children}</AnkerContext.Provider>
      <Glow trigger={context.api.round(id)} radius={radius} />
    </View>
  );
}
