import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { dayOptions, shiftTime, withDay } from "../lib/dateChoice";
import { colors } from "../theme";
import { Body, Muted } from "./Text";

// Datum und Uhrzeit zum Antippen (#1139): Tage als Knöpfe, die Uhrzeit mit Minus und Plus in Viertelstunden - wie das
// Datumsfeld der Website, in Wiener Zeit (#960). `value` ist die Wiener Uhr („2026-05-19T20:00“).

export function DateTimeChooser({ label, value, onChange, testID }: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  testID?: string;
}) {
  const days = useMemo(() => dayOptions(new Date(), 21), []);
  const day = value.slice(0, 10);
  const time = value.slice(11, 16);
  const known = days.some((option) => option.day === day);
  return (
    <View style={styles.wrap} testID={testID}>
      <Muted style={styles.label}>{label}</Muted>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
        {!known && day ? <Chip label={day.split("-").reverse().join(".")} active onPress={() => undefined} /> : null}
        {days.map((option) => (
          <Chip key={option.day} label={option.label} active={option.day === day} onPress={() => onChange(withDay(value, option.day))} testID={testID ? `${testID}-day-${option.day}` : undefined} />
        ))}
      </ScrollView>
      <View style={styles.timeRow}>
        <Step icon="remove" label="Früher" onPress={() => onChange(shiftTime(value, -15))} testID={testID ? `${testID}-earlier` : undefined} />
        <Body style={styles.time} accessibilityLabel={`Uhrzeit ${time}`} testID={testID ? `${testID}-time` : undefined}>{time}</Body>
        <Step icon="add" label="Später" onPress={() => onChange(shiftTime(value, 15))} testID={testID ? `${testID}-later` : undefined} />
        <Muted>Uhr (Wiener Zeit)</Muted>
      </View>
    </View>
  );
}

function Chip({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} testID={testID} style={[styles.chip, active && styles.chipActive]}>
      <Muted style={[styles.chipText, active && styles.chipTextActive]}>{label}</Muted>
    </Pressable>
  );
}

function Step({ icon, label, onPress, testID }: { icon: "add" | "remove"; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} testID={testID} style={styles.step}>
      <Ionicons name={icon} size={20} color={colors.cyan} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  chipActive: {
    backgroundColor: "rgba(41,182,232,0.16)",
    borderColor: "rgba(41,182,232,0.55)",
  },
  chipText: {
    fontWeight: "900",
  },
  chipTextActive: {
    color: colors.cyan,
  },
  days: {
    gap: 8,
    paddingVertical: 2,
  },
  label: {
    fontWeight: "900",
  },
  step: {
    alignItems: "center",
    borderColor: "rgba(41,182,232,0.45)",
    borderRadius: 999,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  time: {
    fontSize: 24,
    fontVariant: ["tabular-nums"],
    fontWeight: "900",
    minWidth: 70,
    textAlign: "center",
  },
  timeRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  wrap: {
    gap: 8,
  },
});
