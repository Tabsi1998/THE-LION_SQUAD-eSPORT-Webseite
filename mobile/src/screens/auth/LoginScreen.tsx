import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { BrandLogo } from "../../components/BrandLogo";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { FormInput } from "../../components/FormInput";
import { Screen } from "../../components/Screen";
import { Body, Muted } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { errorMessage } from "../../lib/api";
import { passkeyError, passkeysSupported, silentPasskeyMiss } from "../../lib/passkeys";
import { colors } from "../../theme";

// Anmelden (#918, #919): die Seite erreicht man aus dem Mehr-Menü oder dem Hinweis beim ersten Start - die App selbst
// läuft ohne Konto. Einen Passkey bietet die Seite beim Öffnen selbst an (Fingerabdruck oder Gesicht); gibt es keinen
// oder bricht man ab, bleibt still das Formular. Nach der Anmeldung geht es zurück, woher man kam.

type LoginNavigation = { navigate: (screen: "Register") => void; goBack?: () => void; canGoBack?: () => boolean };
type Props = { navigation: LoginNavigation };

export function LoginScreen({ navigation }: Props) {
  const { login, loginWithPasskey, completeMfa, rememberSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(rememberSession);
  const [error, setError] = useState("");
  const [mfaTicket, setMfaTicket] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Erst nach einem Abbruch (oder Fehler) gibt es den kleinen Link - ohne Passkey auf dem Gerät gar nichts.
  const [passkeyLink, setPasskeyLink] = useState(false);
  const asked = useRef(false);

  function done() {
    if (navigation.canGoBack?.()) navigation.goBack?.();
  }

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      if (mfaTicket) {
        await completeMfa(mfaTicket, mfaCode.trim(), remember);
        done();
      } else {
        const result = await login(email.trim(), password, remember);
        if (result.mfaRequired && result.ticket) setMfaTicket(result.ticket);
        else done();
      }
    } catch (err) {
      setError(errorMessage(err, "Login fehlgeschlagen."));
    } finally {
      setSubmitting(false);
    }
  }

  async function passkeyLogin(silent: boolean) {
    setSubmitting(true);
    if (!silent) setError("");
    try {
      await loginWithPasskey(remember);
      done();
    } catch (err) {
      const miss = silentPasskeyMiss(err);
      if (!silent) setError(passkeyError(err));
      setPasskeyLink(miss !== "none" || !silent);
    } finally {
      setSubmitting(false);
    }
  }

  // Passkey (#919): einmal beim Öffnen das Gerät fragen - Android zeigt vorhandene Passkeys für lionsquad.at an.
  useEffect(() => {
    if (asked.current || !passkeysSupported()) return;
    asked.current = true;
    passkeyLogin(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
        <View style={styles.brand}>
          <BrandLogo style={styles.wordmark} />
          <Body>Mit Konto meldest du dich zu Turnieren und Events an, chattest mit deinem Team und sammelst Erfolge.</Body>
        </View>
        <Card style={styles.card}>
          {mfaTicket ? (
            <FormInput
              label="MFA- oder Wiederherstellungscode"
              value={mfaCode}
              onChangeText={setMfaCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
            />
          ) : (
            <>
              <FormInput
                label="E-Mail"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
              />
              <FormInput
                label="Passwort"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                autoComplete="password"
              />
            </>
          )}
          <View style={styles.rememberRow}>
            <Switch
              value={remember}
              onValueChange={setRemember}
              trackColor={{ false: "rgba(255,255,255,0.16)", true: "rgba(41,182,232,0.45)" }}
              thumbColor={remember ? colors.cyan : colors.muted}
            />
            <Pressable onPress={() => setRemember((value) => !value)} style={styles.rememberText}>
              <Body style={styles.rememberTitle}>Angemeldet bleiben</Body>
              <Muted>Die App meldet dich beim nächsten Öffnen automatisch wieder an.</Muted>
            </Pressable>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label={submitting ? "Anmelden ..." : mfaTicket ? "MFA bestätigen" : "Anmelden"} onPress={submit} disabled={submitting} />
          {!mfaTicket && passkeyLink && passkeysSupported() ? (
            <Pressable onPress={() => passkeyLogin(false)} disabled={submitting} style={styles.linkWrap} testID="login-passkey-link">
              <Text style={styles.link}>Mit Passkey anmelden</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => navigation.navigate("Register")} style={styles.linkWrap}>
            <Text style={styles.link}>Noch keinen Account? Registrieren</Text>
          </Pressable>
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: "center",
    gap: 22,
  },
  brand: {
    gap: 8,
  },
  wordmark: {
    width: "100%",
    height: 96,
    alignSelf: "flex-start",
    marginBottom: 4,
  },
  card: {
    gap: 14,
  },
  error: {
    color: colors.live,
    fontWeight: "700",
  },
  rememberRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  rememberText: {
    flex: 1,
    gap: 2,
  },
  rememberTitle: {
    fontWeight: "900",
  },
  linkWrap: {
    alignItems: "center",
    paddingTop: 4,
  },
  link: {
    color: colors.cyan,
    fontWeight: "800",
  },
});
