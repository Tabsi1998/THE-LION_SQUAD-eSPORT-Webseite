import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colors, radius } from "../theme";
import { Body, Muted } from "./Text";

type ActionTone = "cyan" | "danger";

export function ActionTile({
  disabled = false,
  icon,
  label,
  onPress,
  tone = "cyan",
}: {
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  tone?: ActionTone;
}) {
  const isDisabled = disabled || !onPress;
  const color = tone === "danger" ? colors.live : colors.cyan;
  return (
    <Pressable
      disabled={isDisabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled }}
      style={({ pressed }) => [styles.tile, tone === "danger" && styles.dangerSurface, isDisabled && styles.disabled, pressed && styles.pressed]}
    >
      <Ionicons name={icon} color={color} size={18} />
      {/* Eine Zeile, notfalls kleiner: "Einstellungen" brach vorher mitten im Wort (#247). */}
      <Muted style={[styles.tileText, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{label}</Muted>
    </Pressable>
  );
}

export function ActionRow({
  detail,
  disabled = false,
  icon,
  label,
  onPress,
  tone = "cyan",
}: {
  detail?: string | null;
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  tone?: ActionTone;
}) {
  const isDisabled = disabled || !onPress;
  const color = tone === "danger" ? colors.live : colors.cyan;
  // Vorlesen (#1155): eine Zeile ist ein Knopf mit einem Satz - „Mitgliedsausweis, zeigt den QR-Code“.
  return (
    <Pressable
      disabled={isDisabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ disabled: isDisabled }}
      style={({ pressed }) => [styles.row, tone === "danger" && styles.dangerSurface, isDisabled && styles.disabled, pressed && styles.pressed]}
    >
      <View style={[styles.rowIcon, tone === "danger" && styles.dangerIcon]}>
        <Ionicons name={icon} color={color} size={18} />
      </View>
      <View style={styles.rowText}>
        <Body style={styles.rowTitle}>{label}</Body>
        {detail ? <Muted>{detail}</Muted> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" color={color} size={16} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: "center",
    backgroundColor: "rgba(41, 182, 232, 0.1)",
    borderColor: "rgba(41, 182, 232, 0.28)",
    borderRadius: radius.lg,
    borderWidth: 1,
    flexBasis: "23%",
    flexGrow: 1,
    gap: 6,
    justifyContent: "center",
    minHeight: 56,
    paddingHorizontal: 8,
    paddingVertical: 9,
  },
  tileText: {
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
  },
  row: {
    alignItems: "center",
    backgroundColor: "rgba(41, 182, 232, 0.08)",
    borderColor: "rgba(41, 182, 232, 0.24)",
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 48,
    padding: 12,
  },
  rowIcon: {
    alignItems: "center",
    backgroundColor: "rgba(41, 182, 232, 0.12)",
    borderRadius: radius.lg,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  rowText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  rowTitle: {
    fontWeight: "900",
  },
  dangerSurface: {
    backgroundColor: "rgba(255, 59, 48, 0.08)",
    borderColor: "rgba(255, 59, 48, 0.24)",
  },
  dangerIcon: {
    backgroundColor: "rgba(255, 59, 48, 0.12)",
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.72,
  },
});
