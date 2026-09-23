import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme";
import { PLAY_STORE_URL, PLAY_STORE_WEB_URL, downloadUrl, progressShare, releaseSizeLabel, releaseTitle, verifyDownload, type AppRelease, type UpdatePath } from "../lib/appUpdate";
import { errorMessage } from "../lib/api";
import { Body, Muted } from "./Text";

// Update aus der App (#250): Banner mit „Was ist neu“, „Herunterladen“ und
// „Später“. Der Download läuft mit der Anmeldung der App in den Cache, wird
// auf Größe und Prüfsumme geprüft und dann dem Android-Installer übergeben.
// Unter min_build ist der Banner nicht wegdrückbar. Kommt die App von Google
// Play (#421), gibt es keinen Download: „Update starten“ öffnet Googles Dialog,
// „Play Store“ die Store-Seite.

type Props = {
  release: AppRelease;
  mandatory: boolean;
  token: string | null;
  onLater: () => void;
  onWhatsNew: () => void;
  /** "server" = APK vom Vereinsserver (Standard), "play" = Google Play (#421). */
  path?: UpdatePath;
  /** Googles Dialog starten; liefert, ob er aufging. Ohne Funktion nur der Store-Link. */
  onStartPlayUpdate?: (immediate: boolean) => Promise<boolean>;
};

/** Store-Seite öffnen: erst die Play-App, sonst der Browser. */
export async function openPlayStore(open: (url: string) => Promise<unknown> = (url) => Linking.openURL(url)) {
  try {
    await open(PLAY_STORE_URL);
  } catch {
    await open(PLAY_STORE_WEB_URL).catch(() => {});
  }
}

type Phase = { name: "idle" } | { name: "downloading"; share: number } | { name: "installing" } | { name: "error"; text: string };

export type Downloader = (url: string, headers: Record<string, string>, onProgress: (written: number, expected: number) => void) => Promise<{ uri: string; size?: number; md5?: string | null }>;
export type Installer = (uri: string) => Promise<void>;

/** Lädt mit expo-file-system in den Cache; die Kopfzeile trägt die Anmeldung. */
export const defaultDownloader: Downloader = async (url, headers, onProgress) => {
  const FileSystem = await import("expo-file-system/legacy");
  const target = `${FileSystem.cacheDirectory}lionsapp-update.apk`;
  await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
  const task = FileSystem.createDownloadResumable(url, target, { headers }, (progress) => {
    onProgress(progress.totalBytesWritten, progress.totalBytesExpectedToWrite);
  });
  const result = await task.downloadAsync();
  if (!result || result.status >= 400) throw new Error(`HTTP ${result?.status ?? "?"}`);
  const info = await FileSystem.getInfoAsync(target, { md5: true });
  return { uri: target, size: info.exists ? info.size : undefined, md5: info.exists ? info.md5 ?? null : null };
};

/** Öffnet den Android-Installer; beim ersten Mal fragt Android nach der Erlaubnis für diese Quelle. */
export const defaultInstaller: Installer = async (uri) => {
  const FileSystem = await import("expo-file-system/legacy");
  const IntentLauncher = await import("expo-intent-launcher");
  const contentUri = await FileSystem.getContentUriAsync(uri);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: "application/vnd.android.package-archive",
  });
};

export function AppUpdateBanner({ release, mandatory, token, onLater, onWhatsNew, path = "server", onStartPlayUpdate, downloader = defaultDownloader, installer = defaultInstaller }: Props & { downloader?: Downloader; installer?: Installer }) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const android = Platform.OS === "android";
  const viaPlay = path === "play";

  const startPlay = useCallback(async () => {
    if (!onStartPlayUpdate) {
      await openPlayStore();
      return;
    }
    setPhase({ name: "installing" });
    const started = await onStartPlayUpdate(mandatory);
    setPhase({ name: "idle" });
    if (!started) await openPlayStore();
  }, [mandatory, onStartPlayUpdate]);

  const start = useCallback(async () => {
    setPhase({ name: "downloading", share: 0 });
    try {
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const file = await downloader(downloadUrl(release), headers, (written, expected) => {
        setPhase({ name: "downloading", share: progressShare(written, expected || release.size) });
      });
      const problem = verifyDownload(release, file);
      if (problem) {
        setPhase({ name: "error", text: problem });
        return;
      }
      setPhase({ name: "installing" });
      await installer(file.uri);
      setPhase({ name: "idle" });
    } catch (error) {
      setPhase({ name: "error", text: errorMessage(error, "Download fehlgeschlagen.") });
    }
  }, [downloader, installer, release, token]);

  const busy = phase.name === "downloading" || phase.name === "installing";

  return (
    <View style={[styles.banner, { bottom: insets.bottom + 72 }]} testID="app-update-banner">
      <View style={styles.head}>
        <Ionicons name={viaPlay ? "logo-google-playstore" : "cloud-download-outline"} size={20} color={colors.cyan} />
        <View style={styles.headText}>
          <Body style={styles.title}>{releaseTitle(release)}</Body>
          <Muted>
            {mandatory ? "Dieses Update ist Pflicht." : "Ein Update ist bereit."}
            {viaPlay ? " Es kommt über den Play Store." : release.size ? ` · ${releaseSizeLabel(release.size)}` : ""}
          </Muted>
        </View>
      </View>
      {phase.name === "downloading" ? (
        <View style={styles.progressTrack} accessibilityLabel={`Download ${Math.round(phase.share * 100)} %`}>
          <View style={[styles.progressFill, { width: `${Math.round(phase.share * 100)}%` }]} />
        </View>
      ) : null}
      {phase.name === "installing" ? <Muted>{viaPlay ? "Play Store wird geöffnet …" : "Installer wird geöffnet …"}</Muted> : null}
      {phase.name === "error" ? <Muted style={styles.error} testID="app-update-error">{phase.text}</Muted> : null}
      {!android ? <Muted>Auf iOS kommt das Update später über TestFlight.</Muted> : null}
      <View style={styles.actions}>
        <Pressable onPress={onWhatsNew} accessibilityRole="button" testID="app-update-whats-new" style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
          <Muted style={styles.secondaryText}>Was ist neu</Muted>
        </Pressable>
        {android && viaPlay ? (
          <Pressable onPress={() => { void startPlay(); }} disabled={busy} accessibilityRole="button" testID="app-update-play" style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}>
            <Body style={styles.primaryText}>{busy ? "Öffnet …" : onStartPlayUpdate ? "Update starten" : "Play Store öffnen"}</Body>
          </Pressable>
        ) : null}
        {android && !viaPlay ? (
          <Pressable onPress={start} disabled={busy} accessibilityRole="button" testID="app-update-download" style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}>
            <Body style={styles.primaryText}>{phase.name === "error" ? "Nochmal" : busy ? "Lädt …" : "Herunterladen"}</Body>
          </Pressable>
        ) : null}
        {!mandatory ? (
          <Pressable onPress={onLater} disabled={busy} accessibilityRole="button" testID="app-update-later" style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
            <Muted style={styles.secondaryText}>Später</Muted>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.surface,
    borderColor: "rgba(41,182,232,0.5)",
    borderRadius: 10,
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
  progressTrack: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 4,
    height: 6,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: colors.cyan,
    height: 6,
  },
  error: {
    color: "#FF6B61",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  primary: {
    backgroundColor: colors.cyan,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  primaryText: {
    color: colors.black,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  secondary: {
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  secondaryText: {
    color: colors.white,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  pressed: {
    opacity: 0.7,
  },
});
