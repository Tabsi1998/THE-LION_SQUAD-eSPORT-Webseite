import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useScreenFocused } from "../screenFocus";
import { useSeason } from "../SeasonProvider";
import { HEADER_BAND, chainLayout } from "./lights";
import { LAYER_HEIGHT, LightChain, useChainSwing, type ChainMode } from "./LightChain";

// Eine Lichterkette an einer Karte (Jahreszeiten IV, Variante B, #1091 - wie CardChains.jsx im Web): dieselbe Kette wie
// an der Begrüßungskarte, das Band beginnt 16 Punkte über der Unterkante. Wird die Karte angetippt, schwingt sie nach,
// ein Licht flackert einmal - nur an dieser Karte, höchstens alle zehn Sekunden. Nie klickbar.

/** Der Wind des Wetters wie an der Begrüßungskarte (christmas/index.tsx). */
function windOf(factor: number | null | undefined): number {
  const value = Number(factor);
  return factor === null || factor === undefined || !Number.isFinite(value) ? 0.6 : Math.max(0, Math.min(2, value));
}

export function CardChain({ perchId, seed, year }: { perchId: string; seed: string; year: number }) {
  const { weather, byKey } = useSeason();
  const focused = useScreenFocused();
  const [width, setWidth] = useState(0);
  const layout = useMemo(() => (width > 0 ? chainLayout({ width, year: String(year), anchor: `card:${seed}` }) : null), [width, year, seed]);
  const swing = useChainSwing(perchId, layout);
  const effective = byKey?.christmas?.effective || "normal";
  const mode: ChainMode = effective === "subtle" ? "subtle" : focused ? "glimmer" : "still";
  return (
    <View pointerEvents="none" style={styles.edge} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))} testID="christmas-card-chain" data-swing={swing ? "1" : undefined}>
      {layout ? <LightChain layout={layout} mode={mode} wind={windOf(weather?.wind_factor)} swing={swing} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  edge: { position: "absolute", left: 0, right: 0, bottom: HEADER_BAND - LAYER_HEIGHT, height: LAYER_HEIGHT },
});
