import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { BrandLogo } from "../../components/BrandLogo";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { FormInput } from "../../components/FormInput";
import { Screen } from "../../components/Screen";
import { Body, Muted } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { errorMessage } from "../../lib/api";
import { passkeyError, passkeysSupported } from "../../lib/passkeys";
import type { AuthStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const { login, loginWithPasskey, completeMfa, continueAsGuest, rememberSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(rememberSession);
  const [error, setError] = useState("");
  const [mfaTicket, setMfaTicket] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      if (mfaTicket) {
        await completeMfa(mfaTicket, mfaCode.trim(), remember);
      } else {
        const result = await login(email.trim(), password, remember);
        if (result.mfaRequired && result.ticket) setMfaTicket(result.ticket);
      }
    } catch (err) {
      setError(errorMessage(err, "Login fehlgeschlagen."));
    } finally {
      setSubmitting(false);
    }
  }

  // Passkey (#217 Stufe 2): derselbe Passkey wie auf der Website - Fingerabdruck oder Gesicht statt Passwort.
  async function passkeyLogin() {
    setSubmitting(true);
    setError("");
    try {
      await loginWithPasskey(remember);
    } catch (err) {
      setError(passkeyError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function liveMode() {
    setSubmitting(true);
    setError("");
    try {
      await continueAsGuest();
    } catch (err) {
      setError(errorMessage(err, "Live-Modus konnte nicht gestartet werden."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
        <View style={styles.brand}>
          <BrandLogo style={styles.wordmark} />
          <Muted>Native App</Muted>
          <Body>Einloggen und Turniere, Teams, Matches und Profil direkt am Handy nutzen.</Body>
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
          {!mfaTicket && passkeysSupported() ? (
            <Button label="Mit Passkey anmelden" variant="secondary" onPress={passkeyLogin} disabled={submitting} />
          ) : null}
          <Button
            label="Live-Daten ansehen"
            variant="secondary"
            onPress={liveMode}
            disabled={submitting}
          />
          <Muted>Der Live-Modus nutzt echte öffentliche Daten von lionsquad.at. Nach dem Deployment funktioniert der Login direkt mit deinem Webseiten-Account.</Muted>
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
