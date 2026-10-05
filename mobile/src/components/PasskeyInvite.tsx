import * as SecureStore from "expo-secure-store";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { Body, Heading, Muted } from "./Text";
import { useAuth } from "../auth/AuthContext";
import { createPasskey, listPasskeys, passkeyCreateError, passkeysSupported } from "../lib/passkeys";
import { colors } from "../theme";

// Passkey-Einladung (#919): direkt nach einer Anmeldung mit Passwort - hat das Konto noch keinen Passkey und kann das Gerät
// welche, lädt die App einmal ein. Angelegt wird mit dem Ticket der Anmeldung, ohne das Passwort noch einmal zu verlangen.
// „Später“ blendet die Einladung für dieses Konto auf diesem Gerät aus; anlegen geht dann im Profil unter „Einstellungen“.

export function inviteKey(userId: string) {
  return `tls.mobile.passkeyInviteDismissed.${userId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

export function PasskeyInvite() {
  const { passkeyOffer, clearPasskeyOffer } = useAuth();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!passkeyOffer || !passkeysSupported()) return undefined;
    (async () => {
      try {
        if ((await SecureStore.getItemAsync(inviteKey(passkeyOffer.userId))) === "true") return;
        if ((await listPasskeys()).length) return;
        if (alive) setVisible(true);
      } catch {
        // Ohne Antwort keine Einladung - sie kommt beim nächsten Anmelden wieder.
      }
    })();
    return () => {
      alive = false;
    };
  }, [passkeyOffer]);

  const later = async () => {
    setVisible(false);
    if (passkeyOffer) await SecureStore.setItemAsync(inviteKey(passkeyOffer.userId), "true").catch(() => {});
    clearPasskeyOffer();
  };

  const create = async () => {
    if (!passkeyOffer) return;
    setBusy(true);
    setMessage("");
    try {
      await createPasskey({ enrollTicket: passkeyOffer.ticket });
      setDone(true);
      clearPasskeyOffer();
    } catch (error) {
      setMessage(passkeyCreateError(error));
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={later}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="passkey-invite">
          {done ? (
            <>
              <Heading>Passkey angelegt</Heading>
              <Body>Ab jetzt meldest du dich mit Fingerabdruck oder Gesicht an – auch auf der Website mit demselben Passkey.</Body>
              <Button label="Fertig" onPress={() => setVisible(false)} testID="passkey-invite-done" />
            </>
          ) : (
            <>
              <Heading>Nächstes Mal nur mit Fingerabdruck?</Heading>
              <Body>Mit einem Passkey meldest du dich ohne Passwort an – mit Fingerabdruck, Gesicht oder Displaysperre. Er zählt auch als zweiter Faktor.</Body>
              {message ? <Text style={styles.error}>{message}</Text> : null}
              <Button label={busy ? "Wird angelegt ..." : "Passkey anlegen"} onPress={create} disabled={busy} testID="passkey-invite-create" />
              <Pressable onPress={later} disabled={busy} style={styles.later} testID="passkey-invite-later">
                <Muted>Später</Muted>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.6)", flex: 1, justifyContent: "center", padding: 20 },
  card: { backgroundColor: colors.card, borderColor: "rgba(41,182,232,0.35)", borderRadius: 10, borderWidth: 1, gap: 12, maxWidth: 420, padding: 20, width: "100%" },
  error: { color: colors.live, fontWeight: "700" },
  later: { alignItems: "center", paddingVertical: 6 },
});
