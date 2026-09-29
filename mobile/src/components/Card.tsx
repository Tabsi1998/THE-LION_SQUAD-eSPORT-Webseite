import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius } from "../theme";
import { SeasonPerch } from "../seasons/anchors";
import type { PerchKind } from "../seasons/perches";

/**
 * Die Karte. `perch` (eine je Screen eindeutige, stabile Kennung) bietet die Karte der Saison als Platz an - eine
 * Fledermaus sitzt dann auf einer oberen Ecke oder hängt unter der Unterkante (Halloween IV App, #715); ohne
 * Saison ändert sich nichts.
 */
export function Card({ children, style, testID, perch, perchKind }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string; perch?: string; perchKind?: PerchKind }) {
  return (
    <View style={[styles.card, style]} testID={testID}>
      {children}
      {perch ? <SeasonPerch id={perch} kind={perchKind} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
  },
});
