import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { buttonColors, radius } from "../theme";
import { PRESS_SCALE } from "../lib/motion";
import { useRoomProbe } from "../seasons/useRoom";

// Knöpfe wie im Web (#1082, #1151): vier Arten, sonst keine. Wichtig ist blau gefüllt und zeigt mit einem Pfeil, wohin es
// geht; zweitrangig ein blauer Rahmen; leise ein grauer Rahmen für Nebensachen; gefährlich (Löschen, Verlassen,
// Abmelden) ein roter Rahmen statt einer roten Fläche. `compact` für Knöpfe in einer Zeile - die Tippfläche bleibt
// mindestens 48 Punkte groß. Eigene Knopf-Stile außerhalb dieser Datei fängt der Wächter `buttons.test.ts`.

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  busy = false,
  arrow,
  compact = false,
  icon,
  accessibilityLabel,
  style,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Wartet auf eine Antwort: nicht noch einmal drückbar, der Vorleser sagt „beschäftigt“. */
  busy?: boolean;
  /** Pfeil nach dem Text - bei „wichtig“ von selbst, sonst nie. */
  arrow?: boolean;
  compact?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel?: string;
  /** Nur für die Lage (Abstand, `alignSelf`, `flex`) - Farbe und Form kommen immer von hier. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  // Knöpfe melden sich für die Platzprüfung der Saison-Deko (#1295): nichts hängt oder sitzt über ihnen.
  const probe = useRoomProbe("control");
  const tone = buttonColors[variant] || buttonColors.primary;
  const showArrow = arrow ?? variant === "primary";
  const off = disabled || busy;
  return (
    <Pressable
      ref={probe?.ref}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      testID={testID}
      hitSlop={compact ? 6 : undefined}
      data-variant={variant}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        { backgroundColor: pressed && !off ? tone.pressed : tone.background, borderColor: tone.border },
        off && styles.disabled,
        pressed && !off && styles.pressed,
        style,
      ]}
    >
      <View style={styles.row}>
        {icon ? <Ionicons name={icon} size={compact ? 15 : 17} color={tone.text} /> : null}
        <Text style={[styles.label, compact && styles.compactLabel, { color: tone.text }]}>{label}</Text>
        {showArrow ? <Ionicons name="arrow-forward" size={compact ? 15 : 17} color={tone.text} testID={testID ? `${testID}-arrow` : "button-arrow"} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  compact: {
    minHeight: 36,
    paddingHorizontal: 12,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    transform: [{ scale: PRESS_SCALE }],
  },
  label: {
    fontWeight: "800",
    fontSize: 15,
    letterSpacing: 0,
    textAlign: "center",
  },
  compactLabel: {
    fontSize: 13,
  },
});
