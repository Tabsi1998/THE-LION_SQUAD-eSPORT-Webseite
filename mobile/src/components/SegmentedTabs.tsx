import React from "react";
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius } from "../theme";
import { Muted } from "./Text";

type TabItem<T extends string> = {
  key: T;
  label: string;
};

// Umschalter (#1155): der Vorleser hört „Reiter, ausgewählt“ beim gewählten Eintrag und die Lage („2 von 4“); jede
// Fläche ist mindestens 48 Punkte hoch, die Namen bleiben ganz (kein „…“ bei großer Schrift - sie dürfen umbrechen).
export function SegmentedTabs<T extends string>({
  items,
  onChange,
  style,
  value,
  label,
}: {
  items: Array<TabItem<T>>;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  value: T;
  /** Wofür die Reiter stehen (für den Vorleser), etwa „Ansicht“. */
  label?: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.tabs, style]}>
      <View accessibilityRole="tablist" accessibilityLabel={label} style={styles.list}>
        {items.map((item, index) => {
          const active = value === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => onChange(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              accessibilityHint={`${index + 1} von ${items.length}`}
              style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.pressed]}
            >
              <Muted style={[styles.tabText, active && styles.tabTextActive]}>
                {item.label}
              </Muted>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tabs: {
    paddingRight: 18,
  },
  list: {
    flexDirection: "row",
    gap: 8,
  },
  tab: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: "rgba(41,182,232,0.16)",
    borderColor: "rgba(41,182,232,0.42)",
  },
  tabText: {
    fontWeight: "900",
  },
  tabTextActive: {
    color: colors.cyan,
  },
  pressed: {
    opacity: 0.72,
  },
});
