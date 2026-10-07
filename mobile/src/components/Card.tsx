import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius } from "../theme";
import { SeasonPerch } from "../seasons/anchors";
import { cardLiftTouch } from "../seasons/cardLift";
import type { PerchKind } from "../seasons/perches";
import { CardKeyContext } from "../seasons/useCardLift";

/**
 * Die Karte. `perch` (eine je Screen eindeutige, stabile Kennung) bietet die Karte der Saison als Platz an - eine
 * Fledermaus sitzt dann auf einer oberen Ecke oder hängt unter der Unterkante (Halloween IV App, #715), Ostereier
 * liegen an ihren Ecken (#647); ohne Saison ändert sich nichts. `perchClip`: die Karte schneidet ab (overflow).
 * Mit Platz liest die Karte ihre Berührungen mit (Jahreszeiten IV, #1087): ein Tippen lässt die Deko an genau dieser
 * Karte reagieren - was die Karte selbst beim Antippen tut, bleibt, wie es ist.
 */
export function Card({ children, style, testID, perch, perchKind, perchClip = false }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string; perch?: string; perchKind?: PerchKind; perchClip?: boolean }) {
  const card = (
    <View style={[styles.card, style]} testID={testID} {...cardLiftTouch(perch)}>
      {children}
      {perch ? <SeasonPerch id={perch} kind={perchKind} clip={perchClip} /> : null}
    </View>
  );
  return perch ? <CardKeyContext.Provider value={perch}>{card}</CardKeyContext.Provider> : card;
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
