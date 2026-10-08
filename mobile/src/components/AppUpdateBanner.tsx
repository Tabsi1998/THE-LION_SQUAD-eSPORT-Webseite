import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useState } from "react";
import { Alert, Linking, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius } from "../theme";
import { PLAY_STORE_URL, PLAY_STORE_WEB_URL, channelLabel, installPrompt, releaseChannel, releaseTitle, type AppRelease, type ReleaseChannel } from "../lib/appUpdate";
import { Body, Muted } from "./Text";
import { Button } from "./Button";

// Update aus der App (#250): Banner mit „Was ist neu“ und „Später“. Seit der Play-Fassung (#593)
// kommt jedes Update über Google Play: „Update starten“ öffnet Googles Dialog (#421), sonst die
// Store-Seite. Unter min_build ist der Banner nicht wegdrückbar. Den eigenen APK-Download mit
// Installer gibt es nicht mehr - Google erlaubt die Berechtigung dafür nur App-Stores; Geräte
// ohne Google Play holen die APK vom GitHub-Release im Browser.

type Props = {
  release: AppRelease;
  mandatory: boolean;
  onLater: () => void;
  onWhatsNew: () => void;
  /** Googles Dialog starten; liefert, ob er aufging. Ohne Funktion nur der Store-Link. */
  onStartPlayUpdate?: (immediate: boolean) => Promise<boolean>;
  /** Rückfrage je Art vor dem Update (#309): Beta oder Release; Standard ist ein Alert. */
  confirmInstall?: (channel: ReleaseChannel, mandatory: boolean) => Promise<boolean>;
};

/** Standard-Rückfrage: ein Alert mit dem Satz je Art; „Abbrechen“ lässt den Banner stehen. */
export function defaultConfirmInstall(channel: ReleaseChannel, mandatory: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const { title, message } = installPrompt(channel, mandatory);
    Alert.alert(title, message, [
      { text: "Abbrechen", style: "cancel", onPress: () => resolve(false) },
      { text: "Installieren", onPress: () => resolve(true) },
    ], { cancelable: false, onDismiss: () => resolve(false) });
  });
}

/** Store-Seite öffnen: erst die Play-App, sonst der Browser. */
export async function openPlayStore(open: (url: string) => Promise<unknown> = (url) => Linking.openURL(url)) {
  try {
    await open(PLAY_STORE_URL);
  } catch {
    await open(PLAY_STORE_WEB_URL).catch(() => {});
  }
}

export function AppUpdateBanner({ release, mandatory, onLater, onWhatsNew, onStartPlayUpdate, confirmInstall = defaultConfirmInstall }: Props) {
  const insets = useSafeAreaInsets();
  const [opening, setOpening] = useState(false);
  const android = Platform.OS === "android";
  const channel = releaseChannel(release);

  const start = useCallback(async () => {
    // Erst die Rückfrage je Art (#309) - eine Beta sagt, dass sie Fehler haben kann.
    if (!(await confirmInstall(channel, mandatory))) return;
    if (!onStartPlayUpdate) {
      await openPlayStore();
      return;
    }
    setOpening(true);
    const started = await onStartPlayUpdate(mandatory);
    setOpening(false);
    if (!started) await openPlayStore();
  }, [channel, confirmInstall, mandatory, onStartPlayUpdate]);

  return (
    <View style={[styles.banner, { bottom: insets.bottom + 72 }]} testID="app-update-banner">
      <View style={styles.head}>
        <Ionicons name="logo-google-playstore" size={20} color={colors.cyan} />
        <View style={styles.headText}>
          <View style={[styles.badge, channel === "beta" ? styles.badgeBeta : styles.badgeRelease]} testID="app-update-channel">
            <Muted style={[styles.badgeText, channel === "beta" ? styles.badgeTextBeta : styles.badgeTextRelease]}>{channelLabel(channel)}</Muted>
          </View>
          <Body style={styles.title}>{releaseTitle(release)}</Body>
          <Muted>{mandatory ? "Dieses Update ist Pflicht." : "Ein Update ist bereit."} Es kommt über den Play Store.</Muted>
        </View>
      </View>
      {opening ? <Muted>Play Store wird geöffnet …</Muted> : null}
      {!android ? <Muted>Auf iOS kommt das Update später über TestFlight.</Muted> : null}
      <View style={styles.actions}>
        <Button compact variant="quiet" label="Was ist neu" onPress={onWhatsNew} testID="app-update-whats-new" />
        {android ? (
          <Button compact label={opening ? "Öffnet …" : onStartPlayUpdate ? "Update starten" : "Play Store öffnen"} onPress={() => { void start(); }} busy={opening} testID="app-update-play" />
        ) : null}
        {!mandatory ? (
          <Button compact variant="quiet" label="Später" onPress={onLater} disabled={opening} testID="app-update-later" />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", borderRadius: radius.lg, borderWidth: 1, marginBottom: 4, paddingHorizontal: 6, paddingVertical: 1 },
  badgeBeta: { backgroundColor: "rgba(255,217,90,0.12)", borderColor: "rgba(255,217,90,0.6)" },
  badgeRelease: { backgroundColor: "rgba(0,255,136,0.10)", borderColor: "rgba(0,255,136,0.5)" },
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  badgeTextBeta: { color: "#FFD95A" },
  badgeTextRelease: { color: "#00FF88" },
  banner: {
    backgroundColor: colors.surface,
    borderColor: "rgba(41,182,232,0.5)",
    borderRadius: radius.lg,
    borderWidth: 1,
    elevation: 10,
    gap: 10,
    left: 14,
    padding: 14,
    position: "absolute",
    right: 14,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 14,
    zIndex: 60,
  },
  head: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  headText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontWeight: "900",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
});
