import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import { createPasskey, listPasskeys, passkeyCreateError, passkeysAvailable, passkeysSupported, reconcilePasskeys, removePasskey, silentPasskeyMiss, type PasskeyRow } from "../lib/passkeys";
import { colors } from "../theme";
import { Button } from "./Button";
import { Card } from "./Card";
import { FormInput } from "./FormInput";
import { Body, Heading, Muted } from "./Text";

// Passkeys (#919): dieselben wie auf der Website unter „Sicherheit“ - hier anlegen (Fingerabdruck, Gesicht oder
// Displaysperre) und entfernen. Beides fragt wie im Web das aktuelle Passwort; direkt nach einer Anmeldung lädt die App
// ohne Passwort ein (PasskeyInvite). Bietet der Server keine Passkeys für die App an, fehlt die Karte ganz.

type Pending = { kind: "create" } | { kind: "remove"; row: PasskeyRow };

export function PasskeysCard({ style }: { style?: object }) {
  const [available, setAvailable] = useState(false);
  const [rows, setRows] = useState<PasskeyRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await listPasskeys());
      // Signal API (#949): was am Handy für dieses Konto liegt, aber hier fehlt, versteckt der Passwortmanager.
      await reconcilePasskeys();
    } catch (error) {
      setFailed(true);
      setMessage(errorMessage(error, "Passkeys konnten nicht geladen werden."));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    passkeysAvailable().then((ok) => {
      if (!alive || !ok) return;
      setAvailable(true);
      void load();
    });
    return () => {
      alive = false;
    };
  }, [load]);

  const start = (next: Pending) => {
    setPending(next);
    setPassword("");
    setMessage("");
    setFailed(false);
  };

  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      if (pending.kind === "create") await createPasskey({ password });
      else await removePasskey(pending.row.id, password);
      setMessage(pending.kind === "create" ? "Passkey angelegt – ab jetzt reicht beim Anmelden der Fingerabdruck." : "Passkey entfernt.");
      setPending(null);
      setPassword("");
      await load();
    } catch (error) {
      // Abgebrochen am Gerät ist kein Fehler - ruhig statt rot.
      setFailed(pending.kind !== "create" || silentPasskeyMiss(error) !== "cancelled");
      setMessage(pending.kind === "create" ? passkeyCreateError(error) : errorMessage(error, "Der Passkey konnte nicht entfernt werden."));
    } finally {
      setBusy(false);
    }
  };

  if (!available) return null;
  return (
    <Card style={style} testID="passkeys">
      <Heading>Passkeys</Heading>
      <Muted>Anmelden ohne Passwort – mit Fingerabdruck, Gesicht oder Displaysperre. Dieselben Passkeys wie auf der Website; ein Passkey zählt auch als zweiter Faktor.</Muted>
      {loaded && !rows.length && !failed ? <Muted testID="passkeys-empty">Noch kein Passkey angelegt.</Muted> : null}
      {rows.map((row) => (
        <View key={row.id} style={styles.row} testID={`passkey-${row.id}`}>
          <View style={styles.flex}>
            <Body style={styles.name}>{row.name}</Body>
            <Muted>{row.last_used_at ? `Zuletzt benutzt am ${formatDate(row.last_used_at)}` : `Angelegt am ${formatDate(row.created_at)}`}</Muted>
          </View>
          <Pressable
            onPress={() => start({ kind: "remove", row })}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`${row.name} entfernen`}
            style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
            testID={`passkey-remove-${row.id}`}
          >
            <Muted style={styles.removeText}>Entfernen</Muted>
          </Pressable>
        </View>
      ))}
      {pending ? (
        <View style={styles.confirm}>
          <Body>{pending.kind === "create" ? "Zum Anlegen bitte dein aktuelles Passwort." : `„${pending.row.name}“ entfernen? Bitte dein aktuelles Passwort.`}</Body>
          <FormInput label="Aktuelles Passwort" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" autoComplete="password" />
          <Button
            label={busy ? "Bitte warten ..." : pending.kind === "create" ? "Weiter zum Fingerabdruck" : "Passkey entfernen"}
            variant={pending.kind === "create" ? "primary" : "danger"}
            onPress={confirm}
            disabled={busy || !password}
            testID="passkey-confirm"
          />
          <Pressable onPress={() => setPending(null)} disabled={busy} accessibilityRole="button" style={styles.cancel} testID="passkey-cancel">
            <Muted>Abbrechen</Muted>
          </Pressable>
        </View>
      ) : passkeysSupported() ? (
        <Button label="Passkey anlegen" variant="secondary" onPress={() => start({ kind: "create" })} testID="passkey-add" />
      ) : (
        <Muted>Dieses Gerät kann keine Passkeys anlegen.</Muted>
      )}
      {message ? <Muted style={failed ? styles.error : pending ? undefined : styles.success} testID="passkeys-message">{message}</Muted> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 10,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontWeight: "900",
  },
  remove: {
    borderColor: "rgba(255, 82, 82, 0.4)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  removeText: {
    color: colors.live,
    fontWeight: "900",
  },
  confirm: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 10,
    paddingTop: 10,
  },
  cancel: {
    alignItems: "center",
    paddingVertical: 4,
  },
  pressed: {
    opacity: 0.72,
  },
  error: {
    color: colors.live,
  },
  success: {
    color: colors.success,
  },
});
