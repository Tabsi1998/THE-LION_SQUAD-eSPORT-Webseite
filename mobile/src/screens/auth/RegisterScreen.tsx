import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { FormInput } from "../../components/FormInput";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { errorMessage } from "../../lib/api";
import type { RootStackParamList } from "../../navigation/types";
import { colors, radius } from "../../theme";
import { API_BASE_URL } from "../../config";

type Props = NativeStackScreenProps<RootStackParamList, "Register">;

export function RegisterScreen({ navigation }: Props) {
  const { register } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const result = await register({
        username: username.trim(),
        email: email.trim(),
        password,
        accept_privacy: acceptPrivacy,
        accept_terms: acceptTerms,
        newsletter_consent: newsletter,
      });
      if (result.verification_required) {
        setSuccess(`Ein Bestätigungslink wurde an ${result.email} gesendet. Bestätige die Adresse und melde dich danach an.`);
      }
    } catch (err) {
      setError(errorMessage(err, "Registrierung fehlgeschlagen."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Heading>Account erstellen</Heading>
            <Body>Dein App-Account ist derselbe Account wie auf der Website.</Body>
          </View>
          <Card style={styles.card}>
            <FormInput label="Benutzername" value={username} onChangeText={setUsername} autoCapitalize="none" />
            <FormInput label="E-Mail" value={email} onChangeText={setEmail} keyboardType="email-address" />
            <FormInput label="Passwort" value={password} onChangeText={setPassword} secureTextEntry />
            <Toggle label="Datenschutz akzeptieren" value={acceptPrivacy} onValueChange={setAcceptPrivacy} />
            <Pressable onPress={() => void Linking.openURL(`${API_BASE_URL}/privacy`)}><Text style={styles.link}>Datenschutzerklärung öffnen</Text></Pressable>
            <Toggle label="Nutzungsbedingungen akzeptieren" value={acceptTerms} onValueChange={setAcceptTerms} />
            <Pressable onPress={() => void Linking.openURL(`${API_BASE_URL}/terms`)}><Text style={styles.link}>Nutzungsbedingungen öffnen</Text></Pressable>
            <Toggle label="Newsletter erhalten" value={newsletter} onValueChange={setNewsletter} />
            <Muted>Passwort: mindestens 10 Zeichen.</Muted>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {success ? <Text style={styles.success}>{success}</Text> : null}
            <Button
              label={submitting ? "Erstelle Account ..." : "Registrieren"}
              onPress={submit}
              disabled={submitting || !acceptPrivacy || !acceptTerms}
            />
            {/* Aus „Anmelden“ geht es dorthin zurück; aus dem Hinweis beim ersten Start (#918) ersetzt Anmelden diese Seite. */}
            <Pressable onPress={() => navigation.popTo("Login")} style={styles.linkWrap} testID="register-login">
              <Text style={styles.link}>Schon ein Konto? Anmelden</Text>
            </Pressable>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Toggle({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} thumbColor={value ? "#f0b429" : "#9ca3af"} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    padding: 18,
    gap: 18,
  },
  header: {
    gap: 8,
    paddingTop: 10,
  },
  card: {
    gap: 14,
  },
  toggle: {
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.black,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  toggleLabel: {
    color: colors.white,
    fontWeight: "700",
    flex: 1,
  },
  error: {
    color: colors.live,
    fontWeight: "700",
  },
  success: {
    color: colors.success,
    fontWeight: "700",
  },
  linkWrap: {
    alignItems: "center",
  },
  link: {
    color: colors.cyan,
    fontWeight: "800",
  },
});
