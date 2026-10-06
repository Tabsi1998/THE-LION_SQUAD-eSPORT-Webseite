import { useEffect, useRef, useState } from "react";
import { Animated, AppState } from "react-native";
import { DeviceMotion, type DeviceMotionMeasurement } from "expo-sensors";

// Neigungssensor für die Jahreszeiten (#667): Neigen des Handys lässt Netz und Spinne am Faden pendeln, Mond,
// Sterne und Flocken bekommen Parallaxe. Nur wenn die Deko an ist und nicht „Bewegung reduzieren“; im Hintergrund
// hört die App auf. Android fragt nicht nach, iOS nur mit der Deko („NSMotionUsageDescription“ in app.json).
// Alles bleibt ruhig: der Wert wird weich geglättet und begrenzt - ein Ruck am Handy ist kein Sprung im Bild.

export type Tilt = { x: number; y: number };

export const UPDATE_MS = 66;
/** Ab dieser Neigung (rad) ist der Ausschlag voll - etwa 25 Grad; was darüber liegt, bleibt begrenzt. */
export const FULL_AT = Math.PI / 7.2;
/** Glättung je Messung: 0 = starr, 1 = jede Messung sofort. */
export const SMOOTHING = 0.22;
/** Wie weit die Ruhelage nach vorn/hinten mitwandert (die meisten halten das Handy schräg, das ist keine Neigung). */
export const BASELINE_DRIFT = 0.02;

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/**
 * Aus der Lage des Geräts (DeviceMotion `rotation`: gamma = seitlich, beta = nach vorn/hinten, in rad) die Neigung
 * -1…1: x = links/rechts, y = vorn/hinten gegenüber der Ruhelage `restBeta`.
 */
export function tiltFromRotation(rotation: { alpha?: number | null; beta?: number | null; gamma?: number | null } | null | undefined, restBeta = 0): Tilt {
  if (!rotation) return { x: 0, y: 0 };
  const gamma = Number(rotation.gamma);
  const beta = Number(rotation.beta);
  const x = Number.isFinite(gamma) ? clamp(gamma / FULL_AT) : 0;
  const y = Number.isFinite(beta) ? clamp((beta - restBeta) / FULL_AT) : 0;
  return { x, y };
}

/** Weich nachziehen: ein Teil des Wegs je Messung; kleine Reste fallen auf 0. */
export function smoothTilt(current: Tilt, target: Tilt, factor = SMOOTHING): Tilt {
  const next = { x: current.x + (target.x - current.x) * factor, y: current.y + (target.y - current.y) * factor };
  return { x: Math.abs(next.x) < 0.002 ? 0 : Math.round(next.x * 1000) / 1000, y: Math.abs(next.y) < 0.002 ? 0 : Math.round(next.y * 1000) / 1000 };
}

type Listener = (tilt: Tilt) => void;

/** Ein Sensor für alle: wer zuhört, hält ihn an; ohne Zuhörer ist er aus. */
class TiltSource {
  private listeners = new Set<Listener>();
  private subscription: { remove: () => void } | null = null;
  private appState: { remove: () => void } | null = null;
  private current: Tilt = { x: 0, y: 0 };
  private restBeta: number | null = null;
  private available: boolean | null = null;

  get value(): Tilt {
    return this.current;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    void this.start();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.stop();
    };
  }

  private async start() {
    if (this.subscription || !this.listeners.size) return;
    if (this.available === null) {
      try {
        this.available = await DeviceMotion.isAvailableAsync();
      } catch {
        this.available = false;
      }
    }
    if (!this.available || this.subscription || !this.listeners.size) return;
    DeviceMotion.setUpdateInterval(UPDATE_MS);
    this.subscription = DeviceMotion.addListener((measurement) => this.handle(measurement));
    if (!this.appState) {
      this.appState = AppState.addEventListener("change", (status) => {
        if (status === "background" || status === "inactive") this.pause();
        else void this.start();
      });
    }
  }

  private handle(measurement: DeviceMotionMeasurement) {
    const rotation = measurement?.rotation;
    if (!rotation) return;
    const beta = Number(rotation.beta);
    if (Number.isFinite(beta)) this.restBeta = this.restBeta === null ? beta : this.restBeta + (beta - this.restBeta) * BASELINE_DRIFT;
    const next = smoothTilt(this.current, tiltFromRotation(rotation, this.restBeta ?? 0));
    if (next.x === this.current.x && next.y === this.current.y) return;
    this.current = next;
    this.listeners.forEach((listener) => listener(next));
  }

  private pause() {
    this.subscription?.remove();
    this.subscription = null;
    if (this.current.x || this.current.y) {
      this.current = { x: 0, y: 0 };
      this.listeners.forEach((listener) => listener(this.current));
    }
  }

  private stop() {
    this.pause();
    this.appState?.remove();
    this.appState = null;
    this.restBeta = null;
  }
}

export const tiltSource = new TiltSource();

/** Die Neigung als Animated-Werte (-1…1) für Transformationen - nur wenn `enabled`, sonst still bei 0. */
export function useTilt(enabled: boolean): { x: Animated.Value; y: Animated.Value } {
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) {
      x.setValue(0);
      y.setValue(0);
      return undefined;
    }
    return tiltSource.subscribe((tilt) => {
      x.setValue(tilt.x);
      y.setValue(tilt.y);
    });
  }, [enabled, x, y]);
  return { x, y };
}

/** Die Neigung als Zahl (für Rechnungen je Bild, etwa den Wind der Flocken) - nur wenn `enabled`. */
export function useTiltValue(enabled: boolean): Tilt {
  const [tilt, setTilt] = useState<Tilt>({ x: 0, y: 0 });
  useEffect(() => {
    if (!enabled) {
      setTilt({ x: 0, y: 0 });
      return undefined;
    }
    return tiltSource.subscribe(setTilt);
  }, [enabled]);
  return tilt;
}
