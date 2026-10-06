import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { seasonCapabilities } from "../intensity";
import { seasonYear } from "../rng";
import { useSeason, type ActiveSeason } from "../SeasonProvider";
import { capGrowth, capLevel, capPath, capThickness } from "./caps";

// Die Schneehaube auf der Oberkante der Begrüßungskarte im Dashboard (W3, #729 - Entscheidung A: nur dort).
// Stufe vom Server (`snowcap_stage`), Tauen aus dem Wetter, Kontur und Wachstum aus dem Jahres-Seed; sie liegt
// über der Kante, verschiebt nichts und ist nie klickbar. „Dezent“ bekommt eine dünne Haube, stille Screens keine.

/** Einzug an den Enden: die Karte hat gerundete Ecken. */
export const CAP_INSET = 10;

export function SnowCap({ season, screen }: { season: ActiveSeason; screen: string }) {
  const { weather } = useSeason();
  const [width, setWidth] = useState(0);
  const caps = useMemo(() => seasonCapabilities("snow", screen, season.effective), [screen, season.effective]);
  const year = seasonYear({ key: "snow", starts_at: season.starts_at || "" });
  const level = capLevel({ stage: Number(season.data?.snowcap_stage) || 1, tempC: typeof weather?.temp_c === "number" ? weather.temp_c : null });
  const thickness = capThickness(season.effective === "subtle" ? Math.min(level, 1) : level, capGrowth(`${year}:dashboard-hero`));
  const shape = useMemo(() => (width > 2 * CAP_INSET ? capPath({ width: width - 2 * CAP_INSET, thickness, seed: `${year}:dashboard-hero`, level }) : null), [width, thickness, year, level]);
  if (!caps.caps) return null;
  return (
    <View pointerEvents="none" style={styles.edge} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))} testID="snow-cap">
      {shape ? (
        <View style={[styles.cap, { left: CAP_INSET, top: -shape.base + 1, width: width - 2 * CAP_INSET, height: shape.height + 2 }]} testID="snow-cap-shape" data-level={String(level)}>
          <Svg width={width - 2 * CAP_INSET} height={shape.height + 2}>
            <Path d={shape.d} fill="#f4f8ff" fillOpacity={0.96} stroke="rgba(190, 215, 240, 0.8)" strokeWidth={0.6} />
          </Svg>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  edge: { position: "absolute", left: 0, right: 0, top: 0, height: 1 },
  cap: { position: "absolute" },
});
