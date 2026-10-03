import React, { createContext, useContext } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { type Edge, SafeAreaView } from "react-native-safe-area-context";
import { SeasonBackdropSlot } from "../seasons/SeasonStage";
import { colors } from "../theme";

/**
 * Liegt der Screen unter einer Kopfzeile des Stapels? Die Kopfzeile hält schon Abstand zur Statusleiste - unter Android
 * (randlos) rechnete die SafeAreaView darunter den Abstand noch einmal dazu, und jede Unterseite begann mit einer leeren
 * Fläche. Die Navigatoren setzen das je Screen (AppNavigator, `screenLayout`).
 */
export const UnderHeaderContext = createContext(false);

/** Die Ränder, an denen der Screen Abstand zu Statusleiste, Kerbe und Gestenleiste hält. */
export function screenEdges(underHeader: boolean, bottomSafe: boolean): Edge[] {
  return [...(underHeader ? [] : ["top" as const]), "left", "right", ...(bottomSafe ? ["bottom" as const] : [])];
}

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
  const underHeader = useContext(UnderHeaderContext);
  return (
    <SafeAreaView style={styles.safe} edges={screenEdges(underHeader, bottomSafe)}>
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
