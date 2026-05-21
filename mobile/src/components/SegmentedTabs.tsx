import React from "react";
import { Pressable, ScrollView, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "../theme";
import { Muted } from "./Text";

type TabItem<T extends string> = {
  key: T;
  label: string;
};

export function SegmentedTabs<T extends string>({
  items,
  onChange,
  style,
  value,
}: {
  items: Array<TabItem<T>>;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  value: T;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.tabs, style]}>
      {items.map((item) => {
        const active = value === item.key;
        return (
          <Pressable key={item.key} onPress={() => onChange(item.key)} style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.pressed]}>
            <Muted numberOfLines={1} style={[styles.tabText, active && styles.tabTextActive]}>
              {item.label}
            </Muted>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tabs: {
    gap: 8,
    paddingRight: 18,
  },
  tab: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    minHeight: 36,
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
