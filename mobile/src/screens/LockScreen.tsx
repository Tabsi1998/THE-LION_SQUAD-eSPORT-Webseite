import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { BrandLogo } from "../components/BrandLogo";
import { Button } from "../components/Button";
import { Screen } from "../components/Screen";
import { Body, Muted, Title } from "../components/Text";
import { useAppLock } from "../lock/AppLockProvider";
import { colors } from "../theme";

/** Sperrbildschirm (#217): fragt beim Erscheinen gleich nach Fingerabdruck oder Gesicht; sonst Knopf oder Abmelden. */
export function LockScreen() {
  const { unlock, availability } = useAppLock();
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const attempt = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await unlock();
    if (!ok) setFailed(true);
    setBusy(false);
  };

  useEffect(() => {
    void attempt();
    // Einmal beim Erscheinen - danach nur noch über den Knopf.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen style={styles.wrap}>
      <BrandLogo style={styles.logo} />
      <View style={styles.mark}>
        <Ionicons name="lock-closed-outline" size={28} color={colors.cyan} />
      </View>
      <Title>LionsAPP ist gesperrt</Title>
      <Body style={styles.center}>Entsperre mit {availability.method || "deiner Gerätesperre"}, um Chats und Profil zu sehen.</Body>
      {failed ? <Muted style={styles.center} testID="lock-failed">Nicht erkannt oder abgebrochen – versuch es noch einmal.</Muted> : null}
      <View style={styles.buttons}>
        <Button label={busy ? "Warte ..." : "Entsperren"} onPress={() => void attempt()} disabled={busy} />
        <Button label="Abmelden" variant="secondary" onPress={() => void logout()} disabled={busy} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 24,
  },
  logo: {
    width: "70%",
    height: 80,
  },
  mark: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(41,182,232,0.12)",
    borderWidth: 1,
    borderColor: "rgba(41,182,232,0.35)",
  },
  center: {
    textAlign: "center",
  },
  buttons: {
    alignSelf: "stretch",
    gap: 10,
    marginTop: 8,
  },
});
