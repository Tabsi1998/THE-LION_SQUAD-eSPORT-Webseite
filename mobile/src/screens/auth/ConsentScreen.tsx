import React, { useState } from "react";
import { Linking, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import { WEBSITE_BASE_URL } from "../../config";
import { api, errorMessage } from "../../lib/api";
import { colors, radius } from "../../theme";

export function ConsentScreen() {
  const { user, refreshMe, logout } = useAuth();
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!privacy || !terms || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.post("/auth/consent", { accept_privacy: true, accept_terms: true });
      await refreshMe();
    } catch (err) {
      setError(errorMessage(err, "Einwilligung konnte nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen padded={false} bottomSafe>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Heading>Aktualisierte Bedingungen</Heading>
          <Body>Bevor du fortfährst, bestätige bitte die derzeit gültigen Fassungen.</Body>
          <Muted>
            Datenschutz: {user?.required_privacy_policy_version || "aktuell"} · Bedingungen: {user?.required_terms_version || "aktuell"}
          </Muted>
        </View>
        <Card style={styles.card}>
          <ConsentToggle label="Datenschutzerklärung gelesen und akzeptiert" value={privacy} onChange={setPrivacy} />
          <Button label="Datenschutzerklärung öffnen" variant="secondary" onPress={() => void Linking.openURL(`${WEBSITE_BASE_URL}/privacy`)} />
          <ConsentToggle label="Nutzungsbedingungen akzeptiert" value={terms} onChange={setTerms} />
          <Button label="Nutzungsbedingungen öffnen" variant="secondary" onPress={() => void Linking.openURL(`${WEBSITE_BASE_URL}/terms`)} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label={busy ? "Speichere ..." : "Bestätigen und fortfahren"} onPress={submit} disabled={busy || !privacy || !terms} />
          <Button label="Abmelden" variant="secondary" onPress={() => void logout()} disabled={busy} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

function ConsentToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} thumbColor={value ? colors.gold : colors.muted} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", padding: 18, gap: 18 },
  header: { gap: 8 },
  card: { gap: 14 },
  toggle: {
    minHeight: 52,
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
  toggleLabel: { color: colors.white, fontWeight: "700", flex: 1 },
  error: { color: colors.live, fontWeight: "700" },
});
