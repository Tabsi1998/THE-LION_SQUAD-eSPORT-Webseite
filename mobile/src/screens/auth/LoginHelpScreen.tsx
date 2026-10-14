import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { FormInput } from "../../components/FormInput";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import { errorMessage } from "../../lib/api";
import { requestPasswordReset, requestVerificationMail } from "../../lib/loginRecovery";
import { PASSWORD_RULE_HINT } from "../../lib/passwordRules";
import { WEB_BASE_URL } from "../../lib/siteUrls";
import type { LoginHelpKind, RootStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Hilfe beim Anmelden (#996): Passwort vergessen oder Bestätigungs-Mail fehlt. Die App fordert die Mail über denselben
// Server-Weg an wie die Website. Der Link in der Mail öffnet die Website - dort setzt man das Passwort bzw. bestätigt die
// Adresse - und danach meldet man sich wieder in der App an. Wer lieber gleich im Browser weitermacht, kommt auf die
// vorhandene Seite der Website.

type Props = NativeStackScreenProps<RootStackParamList, "LoginHelp">;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TEXT: Record<LoginHelpKind, { title: string; intro: string; action: string; busy: string; next: string; webPath: string }> = {
  password: {
    title: "Passwort vergessen",
    intro: "Wir schicken dir einen Link, mit dem du ein neues Passwort setzt.",
    action: "Link senden",
    busy: "Sende ...",
    next: "Öffne den Link in der Mail. Er gilt eine Stunde und öffnet sich im Browser. Dort setzt du dein neues Passwort, danach meldest du dich hier in der App damit an.",
    webPath: "/forgot-password",
  },
  verification: {
    title: "Bestätigungs-Mail",
    intro: "Dein Konto bleibt bestehen. Bestätige zuerst deine E-Mail-Adresse, dann meldest du dich mit deinem Passwort an.",
    action: "Bestätigungslink anfordern",
    busy: "Fordere an ...",
    next: "Öffne den Link in der Mail, er bestätigt deine Adresse im Browser. Danach kommst du hierher zurück und meldest dich in der App an.",
    webPath: "/verify-email",
  },
};

export function LoginHelpScreen({ navigation, route }: Props) {
  const kind: LoginHelpKind = route.params?.kind === "verification" ? "verification" : "password";
  const text = TEXT[kind];
  const [email, setEmail] = useState(route.params?.email || "");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function changeEmail(value: string) {
    setEmail(value);
    setFieldError("");
    setError("");
  }

  async function submit() {
    const address = email.trim();
    if (!address) return setFieldError("Bitte gib deine E-Mail-Adresse ein.");
    if (!EMAIL_RE.test(address)) return setFieldError("Bitte gib eine gültige E-Mail-Adresse ein.");
    setSubmitting(true);
    setError("");
    try {
      const message = kind === "password" ? await requestPasswordReset(address) : await requestVerificationMail(address);
      setSent(message);
    } catch (err) {
      setError(errorMessage(err, "Die Anfrage hat nicht geklappt. Bitte versuch es gleich nochmal."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Heading>{text.title}</Heading>
            <Body>{text.intro}</Body>
          </View>
          <Card style={styles.card}>
            {sent ? (
              <>
                <Text style={styles.success} testID="login-help-sent">{sent}</Text>
                <Body testID="login-help-next">{text.next}</Body>
                {kind === "password" ? <Muted>Neues Passwort: {PASSWORD_RULE_HINT}</Muted> : null}
                <Button label="Zur Anmeldung" onPress={() => navigation.popTo("Login")} />
              </>
            ) : (
              <>
                <FormInput
                  label="E-Mail"
                  value={email}
                  onChangeText={changeEmail}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                />
                {fieldError ? <Text style={styles.error}>{fieldError}</Text> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Button label={submitting ? text.busy : text.action} onPress={submit} disabled={submitting} />
                <Pressable onPress={() => navigation.popTo("Login")} style={styles.linkWrap}>
                  <Text style={styles.link}>Zurück zur Anmeldung</Text>
                </Pressable>
              </>
            )}
          </Card>
          <Pressable
            onPress={() => void Linking.openURL(`${WEB_BASE_URL}${text.webPath}`).catch(() => {})}
            style={styles.linkWrap}
            testID="login-help-browser"
          >
            <Muted style={styles.center}>Lieber gleich im Browser? Danach meldest du dich wieder hier in der App an.</Muted>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
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
  error: {
    color: colors.live,
    fontWeight: "700",
  },
  success: {
    color: colors.success,
    fontWeight: "700",
  },
  // Tippfläche ab 48 Punkten (#1155) - auch für die kleinen Links.
  linkWrap: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  link: {
    color: colors.cyan,
    fontWeight: "800",
  },
  center: {
    textAlign: "center",
  },
});
