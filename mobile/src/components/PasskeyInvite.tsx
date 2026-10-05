import * as SecureStore from "expo-secure-store";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { Body, Heading, Muted } from "./Text";
import { useAuth } from "../auth/AuthContext";
import { createPasskey, listPasskeys, passkeyCreateError, passkeysSupported, silentPasskeyMiss } from "../lib/passkeys";
import { colors } from "../theme";

// Passkey-Einladung (#919): direkt nach einer Anmeldung mit Passwort - hat das Konto noch keinen Passkey und kann das Gerät
// welche, lädt die App einmal ein. Hat das Konto schon welche anderswo (etwa am PC mit Windows Hello), aber dieses Handy
// keinen, lädt sie auch ein (#939).
// Angelegt wird mit dem Ticket der Anmeldung, ohne das Passwort noch einmal zu verlangen.
// „Später“ blendet die Einladung für dieses Konto auf diesem Gerät aus; anlegen geht dann im Profil unter „Einstellungen“.

export function inviteKey(userId: string) {
  return `tls.mobile.passkeyInviteDismissed.${userId.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

export function PasskeyInvite() {
  const { passkeyOffer, clearPasskeyOffer } = useAuth();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [done, setDone] = useState(false);
  const [elsewhere, setElsewhere] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!passkeyOffer || !passkeysSupported()) return undefined;
    (async () => {
      try {
        if ((await SecureStore.getItemAsync(inviteKey(passkeyOffer.userId))) === "true") return;
        const rows = await listPasskeys();
        // Mehrere Passkeys (#939): mit Passkeys anderswo nur, wenn die stille Abfrage auf diesem Gerät keinen fand.
        if (rows.length && !passkeyOffer.deviceWithout) return;
        if (alive) {
          setElsewhere(rows.length > 0);
          setVisible(true);
        }
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
      setCancelled(silentPasskeyMiss(error) === "cancelled");
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
              <Heading>{elsewhere ? "Auch auf diesem Handy mit Fingerabdruck?" : "Nächstes Mal nur mit Fingerabdruck?"}</Heading>
              <Body>
                {elsewhere
                  ? "Dein Konto hat schon einen Passkey auf einem anderen Gerät. Leg auch für dieses Handy einen an – dann meldest du dich hier ohne Passwort an, mit Fingerabdruck, Gesicht oder Displaysperre."
                  : "Mit einem Passkey meldest du dich ohne Passwort an – mit Fingerabdruck, Gesicht oder Displaysperre. Er zählt auch als zweiter Faktor."}
              </Body>
              {message ? <Text style={cancelled ? styles.hint : styles.error}>{message}</Text> : null}
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
  hint: { color: colors.muted },
  later: { alignItems: "center", paddingVertical: 6 },
});
