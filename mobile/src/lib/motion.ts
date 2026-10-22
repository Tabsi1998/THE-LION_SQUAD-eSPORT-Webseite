import { Easing } from "react-native";
import { micro, motion } from "../theme";

// Bewegungs-Regeln in der App (#1085): dieselben Dauern und dieselbe Kurve wie im Web (theme.motion, lib/motion.js).
// `pressScale` ist das Nachgeben einer Karte beim Antippen, `staggerMs` der Versatz in Listen.
export const MOTION = motion;
/** Mikro-Bewegung (#1969): Hochzählen, Staffeln, Aufleuchten - wie MICRO im Web (theme.micro). */
export const MICRO = micro;
export const PRESS_SCALE = 0.98;
export const STAGGER_MS = 70;
export const STAGGER_MAX_STEPS = 8;
export const motionEasing = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);

/** Versatz für Listen: die ersten Zeilen bauen sich nacheinander auf, danach nicht mehr. */
export function staggerMs(index: number): number {
  return Math.min(Math.max(0, Math.floor(index)), STAGGER_MAX_STEPS) * STAGGER_MS;
}
