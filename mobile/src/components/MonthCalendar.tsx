import React, { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Body, Muted } from "./Text";
import { colors } from "../theme";
import { WEEKDAY_LABELS, dayKey, itemsByDay, monthLabel, monthMatrix, type CalendarItem, type CalendarKind } from "../lib/calendar";

// Monatsansicht (#216): Punkte je Tag in der Farbe der Art, ein Ring um Tage mit eigener
// Anmeldung. Der Tag antippen zeigt seine Termine darunter - das macht der Aufrufer.

export const KIND_COLORS: Record<CalendarKind, string> = { event: colors.cyan, tournament: colors.gold, fastlap: colors.live };
export const KIND_LABELS: Record<CalendarKind, string> = { event: "Event", tournament: "Turnier", fastlap: "Fast Lap" };

export function MonthCalendar({ year, month, items, selected, onSelect, onShift, today = new Date() }: {
  year: number;
  month: number;
  items: CalendarItem[];
  selected: string | null;
  onSelect: (key: string) => void;
  onShift: (delta: number) => void;
  today?: Date;
}) {
  const weeks = useMemo(() => monthMatrix(year, month), [month, year]);
  const byDay = useMemo(() => itemsByDay(items), [items]);
  const todayKey = dayKey(today);
  return (
    <View style={styles.wrap} testID="month-calendar">
      <View style={styles.head}>
        <Pressable onPress={() => onShift(-1)} accessibilityRole="button" accessibilityLabel="Vormonat" style={styles.navButton} testID="calendar-prev">
          <Ionicons name="chevron-back" size={20} color={colors.cyan} />
        </Pressable>
        <Body style={styles.title} testID="calendar-title">{monthLabel(year, month)}</Body>
        <Pressable onPress={() => onShift(1)} accessibilityRole="button" accessibilityLabel="Folgemonat" style={styles.navButton} testID="calendar-next">
          <Ionicons name="chevron-forward" size={20} color={colors.cyan} />
        </Pressable>
      </View>
      <View style={styles.row}>
        {WEEKDAY_LABELS.map((label) => <Muted key={label} style={styles.weekday}>{label}</Muted>)}
      </View>
      {weeks.map((week) => (
        <View key={week[0].key} style={styles.row}>
          {week.map((cell) => {
            const dayItems = byDay.get(cell.key) || [];
            const kinds = Array.from(new Set(dayItems.map((item) => item.kind)));
            const mine = dayItems.some((item) => item.mine);
            const isSelected = cell.key === selected;
            return (
              <Pressable
                key={cell.key}
                onPress={() => onSelect(cell.key)}
                accessibilityRole="button"
                accessibilityLabel={`${cell.day}. ${monthLabel(cell.date.getFullYear(), cell.date.getMonth())}${dayItems.length ? `, ${dayItems.length} Termine` : ""}`}
                accessibilityState={{ selected: isSelected }}
                style={[styles.cell, isSelected && styles.cellSelected, mine && styles.cellMine]}
                testID={`calendar-day-${cell.key}`}
              >
                <Body style={[styles.dayText, !cell.inMonth && styles.dayMuted, cell.key === todayKey && styles.dayToday]}>{cell.day}</Body>
                <View style={styles.dots}>
                  {kinds.slice(0, 3).map((kind) => <View key={kind} style={[styles.dot, { backgroundColor: KIND_COLORS[kind] }]} testID={`calendar-dot-${cell.key}-${kind}`} />)}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={styles.legend}>
        {(Object.keys(KIND_LABELS) as CalendarKind[]).map((kind) => (
          <View key={kind} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: KIND_COLORS[kind] }]} />
            <Muted>{KIND_LABELS[kind]}</Muted>
          </View>
        ))}
        <View style={styles.legendItem}>
          <View style={[styles.legendRing]} />
          <Muted>angemeldet</Muted>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    padding: 10,
  },
  head: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  navButton: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  title: {
    fontSize: 16,
    fontWeight: "900",
  },
  row: {
    flexDirection: "row",
    gap: 2,
  },
  weekday: {
    flex: 1,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  cell: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 8,
    borderWidth: 1.5,
    flex: 1,
    minHeight: 44,
    paddingTop: 4,
  },
  cellSelected: {
    backgroundColor: "rgba(41,182,232,0.15)",
    borderColor: colors.cyan,
  },
  cellMine: {
    borderColor: colors.gold,
  },
  dayText: {
    fontSize: 13,
    fontWeight: "700",
  },
  dayMuted: {
    color: colors.muted,
    opacity: 0.55,
  },
  dayToday: {
    color: colors.cyan,
    textDecorationLine: "underline",
  },
  dots: {
    flexDirection: "row",
    gap: 3,
    marginTop: 3,
    minHeight: 6,
  },
  dot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 6,
  },
  legendItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
  },
  legendRing: {
    borderColor: colors.gold,
    borderRadius: 4,
    borderWidth: 1.5,
    height: 10,
    width: 10,
  },
});
