import React from "react";
import Svg, { Circle, Defs, G, Line, Polygon, RadialGradient, Stop } from "react-native-svg";
import type { FlakeShape } from "../snow/flakes";

// Die sechs Formen einer Flocke - dieselben wie `drawShape` im Web (`frontend/src/seasons/snow/layer.js`): weißer
// Punkt mit weichem Rand, Sternkristall, Plättchen, Nadelpaar, Klümpchen, Dendrit. Jede Flocke zeichnet ihre Form
// einmal in ein kleines Svg; bewegt wird nur die Ansicht darum (Versatz und Drehung um ihre Mitte).

const WHITE = "#ffffff";

/** Halbe Kantenlänge der Zeichenfläche um den Mittelpunkt - Platz für die Form samt Strichbreite. */
export function flakeBox(radius: number): number {
  return Math.ceil(radius * 1.6) + 2;
}

function points(count: number, radius: number, offset = 0): string {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + offset;
    return `${(Math.cos(angle) * radius).toFixed(2)},${(Math.sin(angle) * radius).toFixed(2)}`;
  }).join(" ");
}

function Rays({ radius, dendrite, width }: { radius: number; dendrite: boolean; width: number }) {
  const branches = dendrite ? [0.45, 0.72] : [0.62];
  const length = radius * (dendrite ? 0.28 : 0.22);
  return (
    <G stroke={WHITE} strokeWidth={width} strokeLinecap="round">
      {Array.from({ length: 6 }, (_, i) => {
        const angle = (i / 6) * Math.PI * 2;
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        return (
          <G key={i}>
            <Line x1={0} y1={0} x2={ux * radius} y2={uy * radius} />
            {branches.map((at) => [angle + Math.PI / 3, angle - Math.PI / 3].map((side, n) => (
              <Line key={`${at}-${n}`} x1={ux * radius * at} y1={uy * radius * at} x2={ux * radius * at + Math.cos(side) * length} y2={uy * radius * at + Math.sin(side) * length} />
            )))}
            {dendrite ? <Circle cx={ux * radius} cy={uy * radius} r={radius * 0.09} fill={WHITE} stroke="none" /> : null}
          </G>
        );
      })}
    </G>
  );
}

export function FlakeSvg({ shape, radius }: { shape: FlakeShape; radius: number }) {
  const box = flakeBox(radius);
  const width = Math.max(0.6, radius * 0.22);
  return (
    <Svg width={box * 2} height={box * 2} viewBox={`${-box} ${-box} ${box * 2} ${box * 2}`}>
      {shape === "dot" ? (
        <>
          <Defs>
            <RadialGradient id="dot" cx="0" cy="0" r={radius} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={WHITE} stopOpacity={0.95} />
              <Stop offset="0.6" stopColor={WHITE} stopOpacity={0.45} />
              <Stop offset="1" stopColor={WHITE} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={0} cy={0} r={radius} fill="url(#dot)" />
        </>
      ) : shape === "plate" ? (
        <>
          <Polygon points={points(6, radius)} fill={WHITE} fillOpacity={0.85} />
          <Circle cx={0} cy={0} r={radius * 0.35} fill="none" stroke={WHITE} strokeWidth={width} />
        </>
      ) : shape === "needle" ? (
        <G stroke={WHITE} strokeWidth={width} strokeLinecap="round">
          <Line x1={-radius} y1={-radius * 0.2} x2={radius} y2={radius * 0.2} />
          <Line x1={-radius * 0.7} y1={radius * 0.5} x2={radius * 0.7} y2={-radius * 0.5} />
        </G>
      ) : shape === "clump" ? (
        <G fill={WHITE}>
          <Circle cx={0} cy={0} r={radius * 0.7} />
          <Circle cx={-radius * 0.45} cy={radius * 0.3} r={radius * 0.5} />
          <Circle cx={radius * 0.5} cy={-radius * 0.25} r={radius * 0.45} />
        </G>
      ) : (
        <Rays radius={radius} dendrite={shape === "dendrite"} width={width} />
      )}
    </Svg>
  );
}
