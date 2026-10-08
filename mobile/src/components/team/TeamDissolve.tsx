import React, { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { Button } from "../Button";
import { Body, Muted } from "../Text";
import { api, errorMessage } from "../../lib/api";
import { dissolveSentence, sameTeamName, type DissolvePreview } from "../../lib/teamPage";
import { colors } from "../../theme";

// Team auflösen (#1274) - wie im Web ganz unten beim Bearbeiten, nicht neben „Bearbeiten“: ein Satz sagt, was
// passiert, und erst mit dem richtig eingetippten Teamnamen geht der Knopf. Läuft ein Turnier gerade, steht es da.

export function TeamDissolve({ team, onDissolved }: { team: { id: string; name: string }; onDissolved: () => void }) {
  const [preview, setPreview] = useState<DissolvePreview | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.get<DissolvePreview>(`/teams/${team.id}/dissolve-preview`)
      .then(({ data }) => { if (alive) setPreview(data); })
      .catch(() => { if (alive) setPreview(null); });
    return () => { alive = false; };
  }, [team.id]);

  const blocked = preview?.blocked || [];
  const matches = sameTeamName(team, typed);

  const dissolve = async () => {
    if (!matches || blocked.length || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.delete(`/teams/${team.id}`, { params: { confirm: typed.trim() } });
      onDissolved();
    } catch (err) {
      setError(errorMessage(err, "Auflösen hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box} testID="team-dissolve">
      <Body style={styles.title}>Team auflösen</Body>
      <Muted testID="team-dissolve-sentence">{preview ? dissolveSentence(preview) : "Alle Mitglieder verlieren das Team und der Team-Chat wird gelöscht."}</Muted>
      {blocked.length ? (
        <View style={styles.blocked} testID="team-dissolve-blocked">
          <Body style={styles.bold}>Gerade nicht möglich:</Body>
          {blocked.map((row) => <Muted key={row.registration_id || row.title}>{row.title} – {row.reason}</Muted>)}
        </View>
      ) : null}
      <Muted style={styles.label}>Zum Bestätigen den Teamnamen eintippen</Muted>
      <TextInput
        value={typed}
        onChangeText={(value) => { setTyped(value); setError(""); }}
        placeholder={team.name}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        testID="team-dissolve-name"
      />
      {error ? <Muted style={styles.error}>{error}</Muted> : null}
      <Button label={busy ? "Löse auf …" : "Team auflösen"} variant="danger" onPress={dissolve} disabled={!matches || blocked.length > 0 || busy} testID="team-dissolve-submit" />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: "rgba(255,59,48,0.05)", borderColor: "rgba(255,59,48,0.35)", borderRadius: 8, borderWidth: 1, gap: 8, marginTop: 8, padding: 12 },
  title: { color: "#FF6B6B", fontWeight: "900" },
  bold: { fontWeight: "900" },
  blocked: { backgroundColor: "rgba(0,0,0,0.3)", borderColor: colors.border, borderRadius: 8, borderWidth: 1, gap: 4, padding: 10 },
  label: { color: colors.white, fontWeight: "800" },
  input: { backgroundColor: colors.black, borderColor: colors.border, borderRadius: 8, borderWidth: 1, color: colors.white, minHeight: 46, paddingHorizontal: 12 },
  error: { color: colors.live, fontWeight: "800" },
});
