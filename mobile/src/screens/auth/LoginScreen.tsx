import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { BrandLogo } from "../../components/BrandLogo";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { FormInput } from "../../components/FormInput";
import { Screen } from "../../components/Screen";
import { Body, Muted } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { errorMessage } from "../../lib/api";
import { cancelMfaChallenge, mfaTicketGone, needsEmailVerification } from "../../lib/loginRecovery";
import { passkeyError, passkeysSupported, silentPasskeyMiss, type PasskeyMiss } from "../../lib/passkeys";
import type { RootStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Anmelden (#918, #919): die Seite erreicht man über Profil → Anmelden oder den Hinweis beim ersten Start - die App selbst
// läuft ohne Konto. Einen Passkey bietet die Seite beim Öffnen selbst an (Fingerabdruck oder Gesicht); gibt es keinen
// oder bricht man ab, bleibt still das Formular. Nach der Anmeldung geht es zurück, woher man kam.
// Wege aus der Anmeldung (#996): „Passwort vergessen?“ und „Keine Bestätigungs-Mail bekommen?“ führen zu „Hilfe beim
// Anmelden“; eine MFA-Abfrage lässt sich abbrechen, und eine abgelaufene beginnt mit „Anmelden“ neu.

type LoginNavigation = {
  navigate: {
    (screen: "Register"): void;
    (screen: "LoginHelp", params: RootStackParamList["LoginHelp"]): void;
  };
  goBack?: () => void;
  canGoBack?: () => boolean;
};
type Props = { navigation: LoginNavigation };

export function LoginScreen({ navigation }: Props) {
  const { login, loginWithPasskey, completeMfa, rememberSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(rememberSession);
  const [error, setError] = useState("");
  const [mfaTicket, setMfaTicket] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  // MFA (#995): der Code aus der Authenticator-App (Ziffern) oder ein Wiederherstellungscode (Buchstaben und Ziffern).
  const [recoveryCode, setRecoveryCode] = useState(false);
  // Die Anmeldung scheiterte nur an der noch nicht bestätigten E-Mail-Adresse (#996).
  const [verificationNeeded, setVerificationNeeded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Erst nach einem Abbruch (oder Fehler) gibt es den kleinen Link - ohne Passkey auf dem Gerät gar nichts.
  const [passkeyLink, setPasskeyLink] = useState(false);
  // Was die stille Abfrage auf diesem Gerät fand (#939): „none“ = kein Passkey hier - dann lädt die App nach der
  // Passwort-Anmeldung ein, auch wenn das Konto anderswo (etwa am PC) schon einen hat.
  const [deviceMiss, setDeviceMiss] = useState<PasskeyMiss | null>(null);
  // Ein Passkey am Handy, den der Server nicht (mehr) kennt (#949): ruhiger Hinweis statt rotem Fehler.
  const [unknownHint, setUnknownHint] = useState("");
  const asked = useRef(false);
  // Die MFA-Abfrage, die am Server noch offen ist (#996): beim Abbrechen oder Verlassen der Seite wird sie verworfen.
  const openTicket = useRef("");

  useEffect(() => () => {
    if (openTicket.current) void cancelMfaChallenge(openTicket.current);
  }, []);

  function done() {
    if (navigation.canGoBack?.()) navigation.goBack?.();
  }

  // Zurück zum Formular (#996): ohne Ticket und ohne Code. E-Mail und Passwort bleiben - „Anmelden“ holt eine neue Abfrage.
  // Beim Abbrechen gilt die Abfrage auch am Server nicht mehr; ist sie dort schon ungültig, braucht es das nicht.
  function leaveMfa(cancelOnServer: boolean) {
    if (cancelOnServer && openTicket.current) void cancelMfaChallenge(openTicket.current);
    openTicket.current = "";
    setMfaTicket("");
    setMfaCode("");
    setRecoveryCode(false);
    setError("");
  }

  function openHelp(kind: RootStackParamList["LoginHelp"]["kind"]) {
    navigation.navigate("LoginHelp", { kind, email: email.trim() });
  }

  async function submit() {
    setSubmitting(true);
    setError("");
    setVerificationNeeded(false);
    try {
      if (mfaTicket) {
        await completeMfa(mfaTicket, mfaCode.trim(), remember, noDevicePasskey);
        openTicket.current = "";
        done();
      } else {
        const result = await login(email.trim(), password, remember, noDevicePasskey);
        if (result.mfaRequired && result.ticket) {
          setMfaCode("");
          setRecoveryCode(false);
          openTicket.current = result.ticket;
          setMfaTicket(result.ticket);
        } else done();
      }
    } catch (err) {
      if (mfaTicket && mfaTicketGone(err)) {
        // Die Abfrage gilt nicht mehr - weitere Codes helfen nicht. Neu beginnen statt die App neu zu starten.
        leaveMfa(false);
        setError("Die Bestätigung ist abgelaufen. Tippe auf „Anmelden“, dann bekommst du eine neue Abfrage.");
        return;
      }
      setVerificationNeeded(!mfaTicket && needsEmailVerification(err));
      setError(errorMessage(err, "Anmeldung fehlgeschlagen."));
    } finally {
      setSubmitting(false);
    }
  }

  // Kein brauchbarer Passkey auf diesem Gerät: dann lädt die App nach der Passwort-Anmeldung zu einem neuen ein -
  // auch, wenn hier nur ein Passkey liegt, den der Server nicht mehr kennt (#949).
  const noDevicePasskey = deviceMiss === "none" || deviceMiss === "unknown";

  async function passkeyLogin(silent: boolean) {
    // Die stille Abfrage beim Öffnen sperrt das Formular nicht - man kann gleich tippen.
    if (!silent) {
      setSubmitting(true);
      setError("");
    }
    try {
      await loginWithPasskey(remember, silent);
      done();
    } catch (err) {
      const miss = silentPasskeyMiss(err);
      if (silent) setDeviceMiss(miss);
      if (miss === "unknown") {
        setUnknownHint(passkeyError(err));
        setError("");
      } else if (!silent) {
        setError(passkeyError(err));
      }
      setPasskeyLink(miss !== "none" || !silent);
    } finally {
      if (!silent) setSubmitting(false);
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
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        {/* Mit den Wegen aus der Anmeldung (#996) wird die Seite länger: auf kleinen Handys und mit Tastatur scrollt sie. */}
        <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <BrandLogo style={styles.wordmark} />
            <Body>Mit Konto meldest du dich zu Turnieren und Events an, chattest mit deinem Team und sammelst Erfolge.</Body>
          </View>
          <Card style={styles.card}>
            {mfaTicket ? (
              <>
                {recoveryCode ? (
                  // Wiederherstellungscodes haben Buchstaben (#995): volle Tastatur, Großbuchstaben, keine Korrektur.
                  <FormInput
                    key="recovery"
                    label="Wiederherstellungscode"
                    value={mfaCode}
                    onChangeText={setMfaCode}
                    keyboardType="default"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    spellCheck={false}
                    autoComplete="off"
                  />
                ) : (
                  <FormInput
                    key="totp"
                    label="Code aus der Authenticator-App"
                    value={mfaCode}
                    onChangeText={setMfaCode}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                  />
                )}
                <Muted>
                  {recoveryCode
                    ? "10 Zeichen aus Buchstaben und Ziffern, Bindestriche sind egal. Jeder Code gilt nur einmal."
                    : "6 Ziffern aus deiner Authenticator-App."}
                </Muted>
                <Pressable
                  onPress={() => {
                    setRecoveryCode((value) => !value);
                    setMfaCode("");
                    setError("");
                  }}
                  disabled={submitting}
                  style={styles.linkWrap}
                  testID="login-mfa-mode"
                >
                  <Text style={styles.link}>{recoveryCode ? "Code aus der App verwenden" : "Wiederherstellungscode verwenden"}</Text>
                </Pressable>
              </>
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
            {unknownHint ? <Muted testID="login-passkey-unknown" style={styles.hint}>{unknownHint}</Muted> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {verificationNeeded ? (
              <View style={styles.recovery} testID="login-verification-recovery">
                <Muted>Dein Konto bleibt bestehen. Bestätige zuerst deine E-Mail-Adresse, dann meldest du dich hier an.</Muted>
                <Pressable onPress={() => openHelp("verification")} style={styles.linkWrap}>
                  <Text style={styles.link}>Bestätigungslink anfordern</Text>
                </Pressable>
              </View>
            ) : null}
            <Button label={submitting ? "Anmelden ..." : mfaTicket ? "MFA bestätigen" : "Anmelden"} onPress={submit} disabled={submitting} />
            {mfaTicket ? (
              <Pressable onPress={() => leaveMfa(true)} disabled={submitting} style={styles.linkWrap} testID="login-mfa-restart">
                <Text style={styles.link}>Abbrechen und neu anmelden</Text>
              </Pressable>
            ) : null}
            {!mfaTicket && passkeyLink && passkeysSupported() ? (
              <Pressable onPress={() => passkeyLogin(false)} disabled={submitting} style={styles.linkWrap} testID="login-passkey-link">
                <Text style={styles.link}>Mit Passkey anmelden</Text>
              </Pressable>
            ) : null}
            {/* Wege aus der Anmeldung (#996): auch während einer Passkey-Abfrage erreichbar. */}
            {!mfaTicket ? (
              <>
                <Pressable onPress={() => openHelp("password")} style={styles.linkWrap} testID="login-forgot-password">
                  <Text style={styles.subtleLink}>Passwort vergessen?</Text>
                </Pressable>
                <Pressable onPress={() => openHelp("verification")} style={styles.linkWrap} testID="login-resend-verification">
                  <Text style={styles.subtleLink}>Keine Bestätigungs-Mail bekommen?</Text>
                </Pressable>
              </>
            ) : null}
            <Pressable onPress={() => navigation.navigate("Register")} style={styles.linkWrap}>
              <Text style={styles.link}>Noch keinen Account? Registrieren</Text>
            </Pressable>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  wrap: {
    flexGrow: 1,
    paddingBottom: 18,
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
  hint: {
    marginBottom: 12,
    lineHeight: 18,
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
  subtleLink: {
    color: colors.muted,
    fontWeight: "700",
  },
  recovery: {
    gap: 6,
  },
});
