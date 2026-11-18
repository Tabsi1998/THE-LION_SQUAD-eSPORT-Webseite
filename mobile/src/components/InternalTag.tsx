import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { radius } from "../theme";

/**
 * „Vereinsintern“ (#2516, Web: components/tls/InternalTag.jsx): ein Turnier, eine Fast-Lap-Zeit oder eine Trophäe, die
 * Gäste nie sehen - nur die Person selbst, ihr Team und Vereinsmitglieder. Der Server setzt dafür `internal: true`.
 * Ruhig gehalten: ein Hinweis, kein Warnsignal.
 */
export function InternalTag({ testID }: { testID?: string }) {
  return (
    <View style={styles.tag} testID={testID} accessible accessibilityLabel="Vereinsintern, sehen nur Vereinsmitglieder">
      <Ionicons name="lock-closed-outline" size={11} color={TEXT} />
      <Text style={styles.text}>Vereinsintern</Text>
    </View>
  );
}

const TEXT = "rgba(255,255,255,0.78)";

const styles = StyleSheet.create({
  tag: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: "rgba(255,255,255,0.22)",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  text: { color: TEXT, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
});
