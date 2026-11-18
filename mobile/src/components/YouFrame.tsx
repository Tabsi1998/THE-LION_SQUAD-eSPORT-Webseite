import React from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewProps, type ViewStyle } from "react-native";
import { roles } from "../theme";

/**
 * Ecken-Klammern für „das bist du“ (#1316, Web: `.tls-you` in frontend/src/styles/system.css, gemergt mit #2517): vier
 * cyane Winkel, 11 Punkte lang, 2 stark, 5 außerhalb der Kante, dazu eine ganz leichte cyane Fläche (8 %). Kein Schein,
 * keine Bewegung - man lernt das Zeichen einmal und erkennt es überall. Dazu das Etikett „Du“ (bzw. „Dein Team“), damit
 * es auch ohne Farbe verständlich ist; es steht nur dort, wo nicht schon ein „Du“ steht.
 *
 * Die Winkel gehören allein dem „du“: Level-Rahmen (LoewenRangFrame), Bühnen-Bilder der Saison und alles andere tragen sie
 * nie. Die Einsatzorte stehen in `YouFrame.test.tsx` (Wächter); eine neue Stelle wird dort eingetragen.
 *
 * Varianten wie im Web: `inset` - Winkel an der Kante (Zeilen in Tabellen und Karten, deren Rahmen abschneidet oder wo
 * 5 Punkte außen am Handy keinen Platz hätten); `plain` - nur die Winkel, ohne Fläche (um ein rundes Bild).
 */

/** Die Maße aus dem Web (--tls-corner-len, --tls-corner-width, --tls-corner-out). */
export const YOU_CORNER = { len: 11, width: 2, out: 5 } as const;
/** Die Fläche: die Markenfarbe zu 8 % (--tls-you-fill). */
export const YOU_FILL = "rgba(41,182,232,0.08)";
/** Das Etikett: Markenfarbe auf derselben Farbe zu 12 % (.tls-you-tag). */
export const YOU_TAG_BACKGROUND = "rgba(41,182,232,0.12)";

/** Die leichte Fläche - als erstes Kind einer Stelle: über ihrem eigenen Hintergrund, unter ihrem Inhalt. Fläche und Winkel
 * sind reine Flächen ohne Text: Der Vorleser übergeht sie, „du“ sagt das Etikett bzw. der Vorlesetext der Stelle. */
export function YouFill({ radius = 0 }: { radius?: number }) {
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: YOU_FILL, borderRadius: radius }]} testID="you-fill" />;
}

/** Die vier Winkel - als letztes Kind einer Stelle. `out`: wie weit außerhalb der Kante (0 = an der Kante). */
export function YouCorners({ out = YOU_CORNER.out, len = YOU_CORNER.len, testID = "you-corners" }: { out?: number; len?: number; testID?: string }) {
  const size = { height: len, width: len };
  const w = YOU_CORNER.width;
  return (
    <View pointerEvents="none" style={[styles.corners, { bottom: -out, left: -out, right: -out, top: -out }]} testID={testID}>
      <View style={[styles.corner, size, { borderLeftWidth: w, borderTopWidth: w, left: 0, top: 0 }]} />
      <View style={[styles.corner, size, { borderRightWidth: w, borderTopWidth: w, right: 0, top: 0 }]} />
      <View style={[styles.corner, size, { borderBottomWidth: w, borderLeftWidth: w, bottom: 0, left: 0 }]} />
      <View style={[styles.corner, size, { borderBottomWidth: w, borderRightWidth: w, bottom: 0, right: 0 }]} />
    </View>
  );
}

type FrameProps = ViewProps & {
  /** Nur für die eigene Person bzw. das eigene Team - sonst eine gewöhnliche View ohne Zeichen. */
  active: boolean;
  /** Winkel an der Kante statt 5 Punkte außen. */
  inset?: boolean;
  /** Nur die Winkel, keine Fläche. */
  plain?: boolean;
  /** Rundung der Fläche (die der Stelle). */
  radius?: number;
  children?: React.ReactNode;
};

/** Eine Stelle mit „du“: die View selbst trägt Fläche und Winkel - ihr Stil, ihr Inhalt und ihre Vorlesetexte bleiben. */
export function YouFrame({ active, inset = false, plain = false, radius = 0, children, ...rest }: FrameProps) {
  return (
    <View {...rest}>
      {active && !plain ? <YouFill radius={radius} /> : null}
      {children}
      {active ? <YouCorners out={inset ? 0 : YOU_CORNER.out} /> : null}
    </View>
  );
}

/** Das Etikett „Du“ (oder „Dein Team“): eine Pille in gemischter Schreibung, Markenfarbe mit AA-Kontrast. */
export function YouTag({ label = "Du", testID, style }: { label?: string; testID?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.tag, style]} testID={testID}>
      <Text style={styles.tagText as StyleProp<TextStyle>} maxFontSizeMultiplier={1.4} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  corners: { position: "absolute", zIndex: 1 },
  corner: { borderColor: roles.brand, position: "absolute" },
  tag: { alignSelf: "center", backgroundColor: YOU_TAG_BACKGROUND, borderRadius: 999, flexShrink: 0, paddingHorizontal: 7, paddingVertical: 1 },
  tagText: { color: roles.brand, fontSize: 11, fontWeight: "700", letterSpacing: 0.2, lineHeight: 15 },
});
