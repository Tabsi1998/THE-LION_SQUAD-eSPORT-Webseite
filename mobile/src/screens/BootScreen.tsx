import React from "react";
import { ActivityIndicator, Image, StyleSheet } from "react-native";
import { Screen } from "../components/Screen";
import { Muted } from "../components/Text";
import { colors } from "../theme";

export function BootScreen() {
  return (
    <Screen style={styles.wrap}>
      <Image source={require("../../assets/brand/tls-wordmark.png")} style={styles.wordmark} resizeMode="contain" />
      <ActivityIndicator color={colors.cyan} size="large" />
      <Muted>App wird vorbereitet ...</Muted>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
  },
  wordmark: {
    width: "82%",
    height: 110,
  },
});
