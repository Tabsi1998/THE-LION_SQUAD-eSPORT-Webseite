import React, { useLayoutEffect } from "react";
import { StyleSheet, View } from "react-native";
import { HeaderBell, HeaderButton } from "./TabHeader";

// Rechts im Kopf einer Detailseite (#1154): „Teilen“ vor der Glocke. Der Platz ist auch für spätere Knöpfe gedacht
// (Folgen, Erinnern) - sie kommen als `children` davor. Die Glocke bleibt an derselben Stelle wie in den Übersichten.

export function HeaderActions({ onShare, shareLabel = "Teilen", children }: { onShare?: (() => void) | null; shareLabel?: string; children?: React.ReactNode }) {
  return (
    <View style={styles.row} testID="header-actions">
      {children}
      {onShare ? <HeaderButton icon="share-social-outline" label={shareLabel} onPress={onShare} testID="header-share" /> : null}
      <HeaderBell />
    </View>
  );
}

type HeaderNavigation = { setOptions?: (options: { headerRight?: () => React.ReactNode }) => void } | null | undefined;

/** Setzt „Teilen“ in den Kopf des Screens, sobald es etwas zu teilen gibt (vorher nur die Glocke). */
export function useShareHeader(navigation: HeaderNavigation, onShare: (() => void) | null) {
  useLayoutEffect(() => {
    if (!navigation || typeof navigation.setOptions !== "function") return;
    navigation.setOptions({ headerRight: () => <HeaderActions onShare={onShare} /> });
  }, [navigation, onShare]);
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
});
