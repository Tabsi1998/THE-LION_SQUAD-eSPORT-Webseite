import React from "react";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";

// Fledermaus-Figuren der App (A1, wie art.jsx im Web): hängend (kopfüber unter einer Kante) und sitzend (aufrecht
// auf einer Kante), beide mit einem feinen Mondlicht-Saum, weil sie sonst auf dunklen Karten verschwinden.

export const INK = "#0b0a0f";
export const RIM = "rgba(170,225,240,0.28)";
export const RIM_EDGE = "rgba(170,225,240,0.55)";
export const EYES = "#bff3ff";
/** Höhe der Figur je Haltung, in Vielfachen der Breite. */
export const SHAPE_HEIGHT = { hang: 1.55, sit: 1.15 };

/** Eine Fledermaus, die kopfüber hängt: Füße oben, Flügel angelegt, Kopf unten mit Ohren und Augen. */
export function HangingBatShape({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size * SHAPE_HEIGHT.hang} viewBox="0 0 40 62">
      <Path d="M18 0 l2 6 l2 -6" stroke={INK} strokeWidth={1.6} fill="none" strokeLinecap="round" />
      <Path d="M13 12 q-9 12 -3 28 q3 -7 7 -3 z" fill={RIM} transform="translate(-0.6 0)" />
      <Path d="M27 12 q9 12 3 28 q-3 -7 -7 -3 z" fill={RIM} transform="translate(0.6 0)" />
      <Path d="M13 12 q-9 12 -3 28 q3 -7 7 -3 z" fill={INK} stroke={RIM_EDGE} strokeWidth={0.8} strokeLinejoin="round" />
      <Path d="M27 12 q9 12 3 28 q-3 -7 -7 -3 z" fill={INK} stroke={RIM_EDGE} strokeWidth={0.8} strokeLinejoin="round" />
      <Ellipse cx={20} cy={24} rx={6.5} ry={12} fill={INK} stroke={RIM_EDGE} strokeWidth={0.8} />
      <Path d="M15 43 l-2.5 8 l6.5 -3.5 z M25 43 l2.5 8 l-6.5 -3.5 z" fill={INK} stroke={RIM_EDGE} strokeWidth={0.7} strokeLinejoin="round" />
      <Circle cx={20} cy={40} r={5.6} fill={INK} stroke={RIM_EDGE} strokeWidth={0.8} />
      <Circle cx={17.8} cy={40.5} r={1} fill={EYES} />
      <Circle cx={22.2} cy={40.5} r={1} fill={EYES} />
    </Svg>
  );
}

/** Dieselbe Fledermaus aufrecht auf einer Kante: Füße unten, Flügel angelegt, Kopf oben mit Ohren und Augen. */
export function SittingBatShape({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size * SHAPE_HEIGHT.sit} viewBox="0 0 40 46">
      <Path d="M12 20 q-9 10 -4 24 q3 -6 7 -3 z" fill={RIM} transform="translate(-0.6 0)" />
      <Path d="M28 20 q9 10 4 24 q-3 -6 -7 -3 z" fill={RIM} transform="translate(0.6 0)" />
      <Path d="M12 20 q-9 10 -4 24 q3 -6 7 -3 z" fill={INK} stroke={RIM_EDGE} strokeWidth={0.8} strokeLinejoin="round" />
      <Path d="M28 20 q9 10 4 24 q-3 -6 -7 -3 z" fill={INK} stroke={RIM_EDGE} strokeWidth={0.8} strokeLinejoin="round" />
      <Ellipse cx={20} cy={29} rx={6.5} ry={11} fill={INK} stroke={RIM_EDGE} strokeWidth={0.8} />
      <Path d="M14 12 l-3 -9 l7 5 z M26 12 l3 -9 l-7 5 z" fill={INK} stroke={RIM_EDGE} strokeWidth={0.7} strokeLinejoin="round" />
      <Circle cx={20} cy={14} r={5.8} fill={INK} stroke={RIM_EDGE} strokeWidth={0.8} />
      <Circle cx={17.8} cy={13.5} r={1} fill={EYES} />
      <Circle cx={22.2} cy={13.5} r={1} fill={EYES} />
      <Path d="M16 41 l-2 4.5 M24 41 l2 4.5" stroke={INK} strokeWidth={1.6} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

/** Dieselbe Fledermaus im Flug: Flügel gespreizt. */
export function FlyingBatShape({ size = 44 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 0.55} viewBox="0 0 80 44">
      <Path d="M40 24 q-9 -20 -36 -16 q10 3 12 14 q6 -5 12 1 q4 -3 12 1 q8 -4 12 -1 q6 -6 12 -1 q2 -11 12 -14 q-27 -4 -36 16 z" fill={INK} stroke={RIM_EDGE} strokeWidth={0.8} strokeLinejoin="round" />
      <Ellipse cx={40} cy={25} rx={4.5} ry={8.5} fill={INK} stroke={RIM_EDGE} strokeWidth={0.8} />
      <Path d="M36 17 l-3 -6 l5 3 z M44 17 l3 -6 l-5 3 z" fill={INK} />
      <Circle cx={38} cy={21} r={1.1} fill={EYES} />
      <Circle cx={42} cy={21} r={1.1} fill={EYES} />
    </Svg>
  );
}
