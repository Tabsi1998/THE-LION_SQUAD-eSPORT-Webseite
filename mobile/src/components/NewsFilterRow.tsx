import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { MOTION, motionEasing } from "../lib/motion";
import type { NewsCategoryCount } from "../lib/newsFilter";
import { colors } from "../theme";
import { useReduceMotion } from "./FadeIn";
import { Muted } from "./Text";

// Filterzeile der News (#1946) - wie NewsFilterRow im Web (#1249, Fabians Wahl vom 07.10. zu #1342): eine Zeile weicher
// Knöpfe zum Wischen - gewählt in Cyan gefüllt, sonst leise -, nur Kategorien mit Beiträgen samt Anzahl. Die Suche ist
// ein Symbol am Ende der Zeile und klappt zum Feld auf; sie nimmt keine eigene Reihe ein. „Suche leeren“ klappt zu.

function Pill({ id, label, count, active, onPress }: { id: string; label: string; count: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label}, ${count} ${count === 1 ? "Beitrag" : "Beiträge"}`}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [styles.pill, active && styles.pillActive, pressed && styles.pressed]}
      testID={`news-filter-${id}`}
    >
      <Muted style={[styles.pillText, active && styles.pillTextActive]}>{label}</Muted>
      <Muted style={[styles.count, active && styles.countActive]}>{String(count)}</Muted>
    </Pressable>
  );
}

export function NewsFilterRow({ categories, total, active, onSelect, query, onQuery }: {
  categories: NewsCategoryCount[];
  /** Wie viele Beiträge „Alle“ zeigt - auch die ohne Kategorie. */
  total: number;
  active: string | null;
  onSelect: (key: string | null) => void;
  query: string;
  onQuery: (value: string) => void;
}) {
  const [open, setOpen] = useState(Boolean(query.trim()));
  const reduce = useReduceMotion();
  const reveal = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    if (query.trim()) setOpen(true);
  }, [query]);

  useEffect(() => {
    if (!open) {
      reveal.setValue(0);
      return undefined;
    }
    if (reduce) {
      reveal.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(reveal, { toValue: 1, duration: MOTION.fast, easing: motionEasing, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [open, reduce, reveal]);

  const close = () => {
    onQuery("");
    setOpen(false);
  };

  return (
    <View style={styles.row} testID="news-filters">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.pills} accessibilityLabel="Kategorien">
        {categories.length ? (
          <>
            <Pill id="all" label="Alle" count={total} active={!active} onPress={() => onSelect(null)} />
            {categories.map((row) => (
              <Pill key={row.key} id={row.key} label={row.label} count={row.count} active={active === row.key} onPress={() => onSelect(row.key)} />
            ))}
          </>
        ) : null}
      </ScrollView>
      {open ? (
        <Animated.View style={[styles.search, { opacity: reveal, transform: [{ translateX: reveal.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
          <Ionicons name="search-outline" color={colors.muted} size={14} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={onQuery}
            placeholder="News suchen"
            accessibilityLabel="News suchen"
            placeholderTextColor="rgba(255,255,255,0.4)"
            returnKeyType="search"
            autoFocus
            testID="news-search"
          />
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Suche leeren" hitSlop={10} style={({ pressed }) => [styles.clear, pressed && styles.pressed]} testID="news-search-clear">
            <Ionicons name="close" color="rgba(255,255,255,0.6)" size={15} />
          </Pressable>
        </Animated.View>
      ) : (
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="News suchen"
          hitSlop={6}
          style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]}
          testID="news-search-open"
        >
          <Ionicons name="search-outline" color="rgba(255,255,255,0.72)" size={17} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", gap: 8, minWidth: 0 },
  scroll: { flex: 1 },
  pills: { alignItems: "center", gap: 8, paddingRight: 4, paddingVertical: 4 },
  pill: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 14,
  },
  pillActive: { backgroundColor: colors.cyan },
  pillText: { color: "rgba(255,255,255,0.68)", fontSize: 12, fontWeight: "800" },
  pillTextActive: { color: "#04141B" },
  count: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontVariant: ["tabular-nums"], fontWeight: "700" },
  countActive: { color: "rgba(4,20,27,0.66)" },
  searchButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 999,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  search: {
    alignItems: "center",
    backgroundColor: colors.black,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 36,
    paddingLeft: 12,
    paddingRight: 4,
    width: 176,
  },
  input: { color: colors.white, flex: 1, fontSize: 14, minWidth: 0, paddingVertical: 6 },
  clear: { alignItems: "center", borderRadius: 999, height: 28, justifyContent: "center", width: 28 },
  pressed: { opacity: 0.72 },
});
