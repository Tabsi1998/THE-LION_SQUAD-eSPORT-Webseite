import React, { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Body, Muted } from "./Text";
import { colors, kindColors, radius } from "../theme";
import { WEEKDAY_LABELS, itemsByDay, monthLabel, monthMatrix, splitSpans, weekBars, type CalendarItem, type CalendarKind } from "../lib/calendar";
import { viennaDay } from "../lib/vienna";

// Monatsansicht (#216): Punkte je Tag in der Farbe der Art, ein Ring um Tage mit eigener
// Anmeldung. Der Tag antippen zeigt seine Termine darunter - das macht der Aufrufer.
// Seit #1271 wie im Web: „Heute“ springt in den aktuellen Monat, Mehrtägiges ist ein Balken über seine Tage.

// Farben je Art (#1151, #1305) kommen aus dem Thema - dieselben wie auf den Karten und im Web (Event Violett, Turnier Cyan,
// Fast Lap Türkis, Verein Gold - auch Versammlungen und eigene Schichten, #1190).
export const KIND_COLORS: Record<CalendarKind, string> = { event: kindColors.event, tournament: kindColors.tournament, fastlap: kindColors.fastlap, club: kindColors.club };
const BAR_HEIGHT = 16;
export const KIND_LABELS: Record<CalendarKind, string> = { event: "Event", tournament: "Turnier", fastlap: "Fast Lap", club: "Verein" };

export function MonthCalendar({ year, month, items, selected, onSelect, onShift, onToday, today = new Date() }: {
  year: number;
  month: number;
  items: CalendarItem[];
  selected: string | null;
  onSelect: (key: string) => void;
  onShift: (delta: number) => void;
  onToday?: () => void;
  today?: Date;
}) {
  const weeks = useMemo(() => monthMatrix(year, month), [month, year]);
  const byDay = useMemo(() => itemsByDay(items), [items]);
  const { spans, singles } = useMemo(() => splitSpans(items), [items]);
  const dotsByDay = useMemo(() => itemsByDay(singles), [singles]);
  const todayKey = viennaDay(today);
  return (
    <View style={styles.wrap} testID="month-calendar">
      <View style={styles.head}>
        <Pressable onPress={() => onShift(-1)} accessibilityRole="button" accessibilityLabel="Vormonat" style={styles.navButton} testID="calendar-prev">
          <Ionicons name="chevron-back" size={20} color={colors.cyan} />
        </Pressable>
        <Body style={styles.title} testID="calendar-title">{monthLabel(year, month)}</Body>
        {onToday ? (
          <Pressable onPress={onToday} accessibilityRole="button" accessibilityLabel="Heute" style={styles.todayButton} testID="calendar-today">
            <Body style={styles.todayText}>Heute</Body>
          </Pressable>
        ) : null}
        <Pressable onPress={() => onShift(1)} accessibilityRole="button" accessibilityLabel="Folgemonat" style={styles.navButton} testID="calendar-next">
          <Ionicons name="chevron-forward" size={20} color={colors.cyan} />
        </Pressable>
      </View>
      <View style={styles.row}>
        {WEEKDAY_LABELS.map((label) => <Muted key={label} style={styles.weekday}>{label}</Muted>)}
      </View>
      {weeks.map((week) => {
        const bars = weekBars(week, spans);
        const lanes = bars.reduce((count, bar) => Math.max(count, bar.lane + 1), 0);
        return (
          <View key={week[0].key}>
            <View style={styles.row}>
              {week.map((cell) => {
                const dayItems = byDay.get(cell.key) || [];
                const kinds = Array.from(new Set((dotsByDay.get(cell.key) || []).map((item) => item.kind)));
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
            {lanes ? (
              <View style={[styles.bars, { height: lanes * (BAR_HEIGHT + 2) }]}>
                {bars.map((bar) => (
                  <Pressable
                    key={`${bar.item.kind}-${bar.item.id}-${bar.from}`}
                    onPress={() => onSelect(week[bar.from].key)}
                    accessibilityRole="button"
                    accessibilityLabel={bar.item.title}
                    testID={`calendar-bar-${bar.item.kind}-${bar.item.id}`}
                    style={[
                      styles.bar,
                      {
                        backgroundColor: KIND_COLORS[bar.item.kind],
                        left: `${(bar.from / 7) * 100}%`,
                        width: `${((bar.to - bar.from + 1) / 7) * 100}%`,
                        top: bar.lane * (BAR_HEIGHT + 2),
                      },
                      bar.item.mine && styles.barMine,
                      bar.continuesBefore && styles.barOpenStart,
                      bar.continuesAfter && styles.barOpenEnd,
                    ]}
                  >
                    <Body numberOfLines={1} style={styles.barText}>{bar.continuesBefore ? "… " : ""}{bar.item.title}</Body>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      <View style={styles.legend}>
        {(Object.keys(KIND_LABELS) as CalendarKind[]).filter((kind) => kind !== "club" || items.some((item) => item.kind === "club")).map((kind) => (
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
    borderRadius: radius.lg,
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
    flex: 1,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  todayButton: {
    alignItems: "center",
    borderColor: "rgba(255, 255, 255, 0.18)",
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  todayText: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  bars: {
    marginTop: 2,
    position: "relative",
  },
  bar: {
    borderRadius: radius.sm,
    height: BAR_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: 4,
    position: "absolute",
  },
  barMine: {
    borderColor: colors.gold,
    borderWidth: 1.5,
  },
  barOpenStart: {
    borderBottomLeftRadius: 0,
    borderTopLeftRadius: 0,
  },
  barOpenEnd: {
    borderBottomRightRadius: 0,
    borderTopRightRadius: 0,
  },
  barText: {
    color: colors.black,
    fontSize: 10,
    fontWeight: "800",
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
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
    borderWidth: 1.5,
    height: 10,
    width: 10,
  },
});
