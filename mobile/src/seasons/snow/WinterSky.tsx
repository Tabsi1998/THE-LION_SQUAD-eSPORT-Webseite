import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { seasonCapabilities } from "../intensity";
import { seasonYear } from "../rng";
import { useSeason, type ActiveSeason } from "../SeasonProvider";
import { skyLight, winterStars } from "../sky/light";

// Der Winterhimmel in der App (W4 #730, #772): hinter dem Inhalt jedes Screens (Slot Backdrop in `Screen`) - nachts
// ein leiser Blauschein, um Auf- und Untergang ein warmes Glühen auf der Seite der Sonne, dazu wenige stille Sterne
// (am Handy reduziert, wie im Web auf dem Handy). Dieselbe Rechnung wie im Web (sky/light.ts). Karten decken ihn,
// Schrift liegt darüber. Der Mond bleibt dem Web vorbehalten: die Screens der App haben keine freie Himmelsfläche, er
// hinge halb hinter Karten. Stille Screens bekommen nichts.

/** Die Uhr des Himmels: jede Minute neu - das Licht ändert sich langsam. */
function useSkyMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function WinterSkyBackdrop({ season, screen }: { season: ActiveSeason; screen: string }) {
  const { weather } = useSeason();
  const { width, height } = useWindowDimensions();
  const now = useSkyMinute();
  const caps = useMemo(() => seasonCapabilities("snow", screen, season.effective), [screen, season.effective]);
  const data = (season.data || {}) as { night?: boolean };
  const light = skyLight({ now, sunrise: weather?.sunrise, sunset: weather?.sunset, code: weather?.code, night: data.night ?? weather?.night ?? null });
  const most = Number(caps.stars) || 0;
  const count = Math.round(most * light.stars * (season.effective === "subtle" ? 0.5 : 1));
  const year = String(seasonYear({ key: "snow", starts_at: season.starts_at || "" }));
  const stars = useMemo(() => winterStars(year, most).slice(0, count), [year, most, count]);
  if (!caps.sky || (light.night <= 0.01 && light.warmth <= 0.01)) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="winter-sky">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="winterNight" cx="50%" cy="12%" rx="80%" ry="60%">
            <Stop offset="0" stopColor="#6e96dc" stopOpacity={0.09 * light.night} />
            <Stop offset="0.7" stopColor="#6e96dc" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="winterGlow" cx={`${Math.round(light.side * 100)}%`} cy="0%" rx="55%" ry="38%">
            <Stop offset="0" stopColor="#ffa870" stopOpacity={0.2 * light.warmth} />
            <Stop offset="0.45" stopColor="#ff8c80" stopOpacity={0.07 * light.warmth} />
            <Stop offset="0.75" stopColor="#ff8c80" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {light.night > 0.01 ? <Rect x="0" y="0" width="100%" height="100%" fill="url(#winterNight)" testID="winter-tint" /> : null}
        {light.warmth > 0.01 ? <Rect x="0" y="0" width="100%" height="100%" fill="url(#winterGlow)" testID="winter-glow" /> : null}
        {stars.map((star) => (
          <Circle key={star.index} cx={star.x * width} cy={star.y * height} r={star.r} fill="#eef4ff" fillOpacity={star.bright * 0.8} testID="winter-star" />
        ))}
      </Svg>
    </View>
  );
}
