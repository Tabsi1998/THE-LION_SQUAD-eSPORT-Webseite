import * as Navigation from "@react-navigation/native";
import React, { useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { NativeSyntheticEvent, TextLayoutEventData } from "react-native";
import { CardKeyContext } from "./cardKey";
import { perchSnapshot } from "./perches";
import { ROOM_SETTLE_MS, checkRoom, markBlocked, registerRoom, roomProbeOn, subscribeRoomProbe, unregisterRoom, type RoomKind, type RoomRect } from "./room";

// Die Haken zur Platzprüfung (#1295, room.ts): `useRoomProbe` lässt Schrift, Knöpfe und Karten sich melden, solange
// eine Saison Deko an Inhalt hängt - sonst tun sie nichts. `useRoomCheck` prüft eine zugeteilte Deko einmal, kurz nach
// dem Zeigen: frei - sie wird sichtbar; belegt - die Saison wählt eine andere Ecke oder Karte.

type RouteContext = React.Context<{ name?: string } | undefined>;
const FallbackRoute: RouteContext = React.createContext<{ name?: string } | undefined>(undefined);
// Tests ersetzen die Navigation oft ohne diesen Kontext - dann gilt „Dashboard“ wie in anchors.tsx.
const RouteNameContext: RouteContext = ((Navigation as unknown as { NavigationRouteContext?: RouteContext }).NavigationRouteContext) || FallbackRoute;

function useScreenName(): string {
  const route = useContext(RouteNameContext);
  return (route && route.name) || "Dashboard";
}

type Measurable = { measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void } | null;
type Line = { x: number; y: number; width: number; height: number };

/** Misst eine Ansicht in Fensterkoordinaten; Schrift je Zeile. Null ohne Antwort (Tests) - spätestens nach 250 ms. */
export function measureRects(node: Measurable, lines: Line[] | null): Promise<RoomRect[] | null> {
  return new Promise((resolve) => {
    if (!node || typeof node.measureInWindow !== "function") {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), 250);
    node.measureInWindow((x, y, width, height) => {
      clearTimeout(timer);
      if (!(width > 0 && height > 0)) {
        resolve(null);
        return;
      }
      const rows = (lines || []).filter((line) => line.width > 0 && line.height > 0);
      resolve(rows.length ? rows.map((line) => ({ x: x + line.x, y: y + line.y, width: line.width, height: line.height })) : [{ x, y, width, height }]);
    });
  });
}

export type RoomProbe = {
  ref: (node: unknown) => void;
  onTextLayout?: (event: NativeSyntheticEvent<TextLayoutEventData>) => void;
};

/**
 * Meldet die Komponente für die Platzprüfung an (nur solange eine Saison sie braucht): Schrift mit ihren Zeilen,
 * Knöpfe und Karten mit ihrem Kasten. Der Rückgabewert kommt auf das Element (`ref`, bei Schrift `onTextLayout`).
 */
export function useRoomProbe(kind: RoomKind, ownCard: string | null = null): RoomProbe | null {
  const on = useSyncExternalStore(subscribeRoomProbe, roomProbeOn, roomProbeOn);
  const screen = useScreenName();
  const insideCard = useContext(CardKeyContext);
  const card = kind === "card" ? ownCard : insideCard;
  const id = useId();
  const node = useRef<Measurable>(null);
  const lines = useRef<Line[] | null>(null);
  const probe = useRef<RoomProbe | null>(null);
  if (!probe.current) {
    probe.current = {
      ref: (value: unknown) => {
        node.current = value as Measurable;
      },
      onTextLayout: kind === "text" ? (event) => {
        lines.current = (event.nativeEvent.lines || []).map((line) => ({ x: line.x, y: line.y, width: line.width, height: line.height }));
      } : undefined,
    };
  }
  useEffect(() => {
    if (!on) return undefined;
    registerRoom({ id, screen, card, kind, measure: () => measureRects(node.current, lines.current) });
    return () => unregisterRoom(id);
  }, [on, id, screen, card, kind]);
  return on ? probe.current : null;
}

/** Zwei Refs auf ein Element (der eigene und der der Platzprüfung). */
export function mergeRefs<T>(...refs: Array<React.Ref<T> | ((node: T) => void) | undefined | null>): (node: T) => void {
  return (node: T) => {
    refs.forEach((ref) => {
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object") (ref as React.MutableRefObject<T>).current = node;
    });
  };
}

/**
 * Prüft eine Deko an der Karte `perchId` einmal kurz nach dem Zeigen: `boxesOf` liefert ihre Kästen aus dem Rechteck
 * der Karte. Frei oder nicht messbar - `true` (sichtbar); belegt - die Karte wird für `use` gesperrt, `onBlocked` läuft
 * und die Saison wählt neu (die Deko bleibt bis dahin unsichtbar). Ohne Karte oder Kästen gibt es nichts zu prüfen.
 */
export function useRoomCheck(perchId: string | null, use: string, boxesOf: ((card: RoomRect) => RoomRect[]) | null, onBlocked?: () => void): boolean {
  // Ohne Platzprüfung (keine Saison mit Deko an Inhalt) meldet sich nichts - dann gibt es auch nichts zu prüfen.
  const probing = useSyncExternalStore(subscribeRoomProbe, roomProbeOn, roomProbeOn);
  const active = Boolean(perchId && boxesOf && probing);
  const [ready, setReady] = useState(!active);
  const boxesRef = useRef(boxesOf);
  boxesRef.current = boxesOf;
  const blockedRef = useRef(onBlocked);
  blockedRef.current = onBlocked;
  useEffect(() => {
    if (!perchId || !active) {
      setReady(true);
      return undefined;
    }
    let cancelled = false;
    setReady(false);
    const timer = setTimeout(() => {
      const perch = perchSnapshot().perches.find((entry) => entry.id === perchId);
      if (!perch) {
        setReady(true);
        return;
      }
      void checkRoom(perch.screen, perchId, () => perch.measure(), (card) => (boxesRef.current ? boxesRef.current(card) : [])).then((free) => {
        if (cancelled) return;
        if (free === false) {
          markBlocked(perchId, use);
          blockedRef.current?.();
        } else setReady(true);
      });
    }, ROOM_SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [perchId, use, active]);
  return ready;
}
