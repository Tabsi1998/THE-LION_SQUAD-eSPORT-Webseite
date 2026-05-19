import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { colors } from "../theme";
import { Body, Muted } from "./Text";

export function LoadingState({ label = "Lade Daten ..." }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.cyan} />
      <Muted>{label}</Muted>
    </View>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.center}>
      <Body style={styles.emptyTitle}>{title}</Body>
      {detail ? <Muted style={styles.detail}>{detail}</Muted> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 28,
  },
  emptyTitle: {
    fontWeight: "800",
  },
  detail: {
    textAlign: "center",
  },
});
