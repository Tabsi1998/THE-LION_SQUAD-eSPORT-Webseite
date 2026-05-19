import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { FormInput } from "../../components/FormInput";
import { Screen } from "../../components/Screen";
import { Body, Muted } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { errorMessage } from "../../lib/api";
import type { AuthStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

type Props = NativeStackScreenProps<AuthStackParamList, "Login">;

export function LoginScreen({ navigation }: Props) {
  const { login, continueAsGuest } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(errorMessage(err, "Login fehlgeschlagen."));
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
          <Image source={require("../../../assets/brand/tls-wordmark.png")} style={styles.wordmark} resizeMode="contain" />
          <Muted>Native App</Muted>
          <Body>Einloggen und Turniere, Teams, Matches und Profil direkt am Handy nutzen.</Body>
        </View>
        <Card style={styles.card}>
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
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label={submitting ? "Anmelden ..." : "Anmelden"} onPress={submit} disabled={submitting} />
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
  linkWrap: {
    alignItems: "center",
    paddingTop: 4,
  },
  link: {
    color: colors.cyan,
    fontWeight: "800",
  },
});
