import * as SecureStore from "expo-secure-store";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Button } from "./Button";
import { Body, Heading, Muted } from "./Text";
import { openSignIn, signInOpen } from "../navigation/rootNavigation";
import { colors } from "../theme";
import { useAppUpdate } from "../update/AppUpdateProvider";

// Gast zuerst (#918): Die App startet ohne Konto. Nur beim allerersten Start kommt nach ein paar Sekunden einmal dieser
// Hinweis - wegdrücken reicht, danach nie wieder (gemerkt im Gerätespeicher). Angemeldet wird danach im Tab „Profil“
// (seit #1143 gibt es keinen Tab „Mehr“ mehr - der Hinweis darf nicht auf ihn zeigen).
// Ist gerade „Was ist neu“ offen, wartet er, bis die Karte zu ist; ist man schon beim Anmelden, entfällt er.

export const NUDGE_KEY = "tls.mobile.signInNudgeSeen";
export const NUDGE_DELAY_MS = 12000;

export async function markSignInNudgeSeen() {
  try {
    await SecureStore.setItemAsync(NUDGE_KEY, "true");
  } catch {
    // Nicht merkbar (Speicher gesperrt): dann kommt der Hinweis eben noch einmal - kein Schaden.
  }
}

export function SignInNudge({ delayMs = NUDGE_DELAY_MS }: { delayMs?: number }) {
  const { whatsNewOpen } = useAppUpdate();
  const [due, setDue] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    SecureStore.getItemAsync(NUDGE_KEY)
      .then((seen) => {
        if (!alive || seen === "true") return;
        timer = setTimeout(() => alive && setDue(true), delayMs);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [delayMs]);

  useEffect(() => {
    if (!due || whatsNewOpen) return;
    setDue(false);
    if (signInOpen()) {
      void markSignInNudgeSeen();
      return;
    }
    setVisible(true);
  }, [due, whatsNewOpen]);

  const close = async (screen?: "Login" | "Register") => {
    setVisible(false);
    await markSignInNudgeSeen();
    if (screen) openSignIn(screen);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => close()}>
      <Pressable style={styles.backdrop} onPress={() => close()} testID="sign-in-nudge-backdrop">
        <Pressable style={styles.card} onPress={() => {}} testID="sign-in-nudge">
          <Heading>Schön, dass du da bist!</Heading>
          <Body>Schau dich in Ruhe um. Mit einem Konto meldest du dich zu Turnieren und Events an, chattest mit deinem Team und sammelst Erfolge.</Body>
          <View style={styles.actions}>
            <Button label="Konto erstellen" onPress={() => close("Register")} testID="sign-in-nudge-register" />
            <Button label="Anmelden" variant="secondary" onPress={() => close("Login")} testID="sign-in-nudge-login" />
          </View>
          <Pressable onPress={() => close()} style={styles.later} testID="sign-in-nudge-later">
            <Muted>Später – geht jederzeit unter „Profil“</Muted>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.6)", flex: 1, justifyContent: "center", padding: 20 },
  card: { backgroundColor: colors.card, borderColor: "rgba(41,182,232,0.35)", borderRadius: 10, borderWidth: 1, gap: 12, maxWidth: 420, padding: 20, width: "100%" },
  actions: { gap: 10 },
  later: { alignItems: "center", paddingVertical: 6 },
});
