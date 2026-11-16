import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { isGuestUser } from "../live";
import { askPushPermission } from "../notifications/PushService";
import { pushOffHintVisible } from "../notifications/pushPrompt";
import { usePushPermission } from "../notifications/usePushPermission";
import { colors, radius } from "../theme";
import { Body, Muted } from "./Text";

// Der leise Hinweis (#1208): Wer Benachrichtigungen abgelehnt hat - oder wem Android sie verweigert -, sieht auf Turnier-
// und Event-Seiten eine ruhige Zeile statt eines Dialogs bei jedem Öffnen. „einschalten“ fragt Android noch einmal, solange
// es das zulässt, sonst öffnet es die Systemeinstellungen der App. Zurück in der App ist die Zeile weg, sobald es erlaubt ist.

export const PUSH_OFF_TEXT = "Aufrufe sind aus";
export const PUSH_OFF_ACTION = "einschalten";

export function PushOffHint({ show = true, testID = "push-off-hint" }: { show?: boolean; testID?: string }) {
  const { user } = useAuth();
  const signedIn = Boolean(user && !isGuestUser(user));
  const permission = usePushPermission(signedIn && show);
  const [busy, setBusy] = useState(false);

  if (!signedIn || !show || !pushOffHintVisible(permission)) return null;

  const turnOn = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (permission?.canAskAgain) await askPushPermission();
      else await Linking.openSettings();
    } catch {
      // Ohne Systemeinstellungen bleibt die Zeile einfach stehen.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={turnOn}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`${PUSH_OFF_TEXT} – ${PUSH_OFF_ACTION}`}
      accessibilityHint={permission?.canAskAgain ? "Fragt nach der Erlaubnis für Benachrichtigungen" : "Öffnet die Einstellungen der App im System"}
      accessibilityState={{ busy }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons name="notifications-off-outline" size={16} color={colors.muted} />
      <View style={styles.text}>
        <Muted style={styles.line}>{PUSH_OFF_TEXT} – <Body style={styles.action}>{PUSH_OFF_ACTION}</Body></Muted>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pressed: { opacity: 0.7 },
  text: { flex: 1 },
  line: { fontSize: 13 },
  action: { color: colors.cyan, fontSize: 13, fontWeight: "800" },
});
