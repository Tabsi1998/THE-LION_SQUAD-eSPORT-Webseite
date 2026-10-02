import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SeasonBackdropSlot } from "../seasons/SeasonStage";
import { colors } from "../theme";

export function Screen({
  children,
  padded = true,
  style,
  bottomSafe = false,
}: {
  children: React.ReactNode;
  padded?: boolean;
  style?: ViewStyle;
  bottomSafe?: boolean;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={bottomSafe ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]}>
      <View style={[styles.container, padded && styles.padded, style]}>
        {/* Jahreszeiten (#642): was hinter dem Inhalt liegt (Weihnachten: warme Lichtinseln) - unter allem, nie klickbar. */}
        <SeasonBackdropSlot />
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.black,
  },
  container: {
    flex: 1,
    backgroundColor: colors.black,
  },
  padded: {
    paddingHorizontal: 18,
    paddingTop: 14,
  },
});
