import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius } from "../theme";
import { SeasonPerch } from "../seasons/anchors";
import { cardLiftTouch } from "../seasons/cardLift";
import type { PerchKind } from "../seasons/perches";
import { CardKeyContext } from "../seasons/useCardLift";
import { useRoomProbe } from "../seasons/useRoom";

type ControlProps = { onPress?: unknown; onLongPress?: unknown; onChangeText?: unknown; onValueChange?: unknown; children?: React.ReactNode };

/** Ist dieses Element (oder etwas darin) ein Knopf, ein Eingabefeld oder ein Schalter? */
function hasControl(node: React.ReactElement, depth: number): boolean {
  const props = (node.props || {}) as ControlProps;
  if (props.onPress || props.onLongPress || props.onChangeText || props.onValueChange) return true;
  if (depth >= 5) return false;
  return React.Children.toArray(props.children).some((child) => React.isValidElement(child) && hasControl(child, depth + 1));
}

/**
 * Liegt in der letzten Zeile der Karte ein Knopf (#1295)? Dann hängt dort keine Kette und kein Wimpel - sie säßen direkt
 * unter „Antrag stellen“ oder in der Zeile „Partner“. Geprüft wird das letzte Element der Karte samt Inhalt.
 */
export function endsWithControl(children: React.ReactNode): boolean {
  const list = React.Children.toArray(children).filter(React.isValidElement);
  const last = list[list.length - 1];
  return Boolean(last) && hasControl(last as React.ReactElement, 0);
}

/**
 * Die Karte. `perch` (eine je Screen eindeutige, stabile Kennung) bietet die Karte der Saison als Platz an - eine
 * Fledermaus sitzt dann auf einer oberen Ecke oder hängt unter der Unterkante (Halloween IV App, #715), Ostereier
 * liegen an ihren Ecken (#647); ohne Saison ändert sich nichts. `perchClip`: die Karte schneidet ab (overflow).
 * Mit Platz liest die Karte ihre Berührungen mit (Jahreszeiten IV, #1087): ein Tippen lässt die Deko an genau dieser
 * Karte reagieren - was die Karte selbst beim Antippen tut, bleibt, wie es ist. Jede Karte meldet sich für die
 * Platzprüfung (#1295): Deko an einer anderen Karte ragt nie in sie hinein.
 */
export function Card({ children, style, testID, perch, perchKind, perchClip = false }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string; perch?: string; perchKind?: PerchKind; perchClip?: boolean }) {
  const probe = useRoomProbe("card", perch || null);
  const card = (
    <View ref={probe?.ref} style={[styles.card, style]} testID={testID} {...cardLiftTouch(perch)}>
      {children}
      {perch ? <SeasonPerch id={perch} kind={perchKind} clip={perchClip} bottomControl={endsWithControl(children)} /> : null}
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
