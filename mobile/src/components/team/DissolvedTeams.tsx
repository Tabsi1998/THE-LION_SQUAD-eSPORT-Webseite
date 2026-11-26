import React, { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import { api, errorMessage } from "../../lib/api";
import { TEAM_TAG_MAX, TEAM_TAG_MIN } from "../../lib/teamPage";
import { colors, radius, roles, surfaces } from "../../theme";
import { Button } from "../Button";
import { Card } from "../Card";
import { MediaImage } from "../MediaImage";
import { Body, Heading, Muted } from "../Text";

// Aufgelöstes Team wiederherstellen (#2542, #2128 TM8, Web: pages/public/team/DissolvedTeams.jsx unter „Deine Teams“): Die frühere
// Teamleitung holt ein aufgelöstes Team innerhalb der Frist zurück (`GET /teams/dissolved/mine`, `POST /teams/{id}/restore`). Hat ein
// anderes Team das Kürzel inzwischen, fragt die Zeile nach einem neuen. Ohne aufgelöste Teams (oder auf älteren Servern) steht nichts da.

export type DissolvedTeam = { id: string; name: string; tag?: string | null; logo_url?: string | null; member_count?: number | null; days_left?: number | null };

/** Noch wie lange wiederherstellbar: „noch 1 Tag“, „noch 12 Tage“ (wie restoreDaysLeft im Web). */
export function restoreDaysLeft(days?: number | null): string {
  const left = Number(days || 0);
  return left === 1 ? "noch 1 Tag" : `noch ${left} Tage`;
}

function DissolvedRow({ team, onRestored }: { team: DissolvedTeam; onRestored: (team: DissolvedTeam) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [askTag, setAskTag] = useState(false);
  const [tag, setTag] = useState("");

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/teams/${encodeURIComponent(team.id)}/restore`, askTag ? { tag: tag.trim().toUpperCase() } : {});
      onRestored(team);
    } catch (failure) {
      const message = errorMessage(failure, "Wiederherstellen hat nicht geklappt.");
      setError(message);
      if ((failure as { response?: { status?: number } })?.response?.status === 409 && message.includes("Kürzel")) setAskTag(true);
    } finally {
      setBusy(false);
    }
  };

  const restore = () => {
    if (busy) return;
    if (askTag) {
      void send();
      return;
    }
    Alert.alert("Team wiederherstellen?",
      `${team.name} kommt mit allen zurück, die noch ein Konto haben. Es gibt einen neuen Beitrittscode und einen neuen Einladungs-Link; zurückgezogene Turnier-Anmeldungen bleiben zurückgezogen.`,
      [{ text: "Abbrechen", style: "cancel" }, { text: "Wiederherstellen", onPress: () => { void send(); } }]);
  };

  const members = Number(team.member_count || 0);
  return (
    <View style={styles.row} testID={`dissolved-team-${team.id}`}>
      <View style={styles.head}>
        <View style={styles.logo} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {team.logo_url ? <MediaImage uri={team.logo_url} style={StyleSheet.absoluteFill} fallback={null} /> : <Text style={styles.tag}>{team.tag}</Text>}
        </View>
        <View style={styles.text}>
          <Body style={styles.name}>{team.name}</Body>
          <Muted style={styles.small}>[{team.tag}] · {members} {members === 1 ? "Mitglied" : "Mitglieder"} · {restoreDaysLeft(team.days_left)}</Muted>
        </View>
      </View>
      {askTag ? (
        <View style={styles.field}>
          <Muted style={styles.label}>Neues Kürzel</Muted>
          <TextInput value={tag} onChangeText={(value) => { setTag(value.toUpperCase().slice(0, TEAM_TAG_MAX)); setError(""); }} autoCapitalize="characters" autoCorrect={false}
            accessibilityLabel={`Neues Kürzel für ${team.name}`} style={styles.input} placeholderTextColor={colors.muted} testID={`dissolved-team-tag-${team.id}`} />
        </View>
      ) : null}
      {error ? <Muted style={{ color: roles.live }} accessibilityLiveRegion="polite" testID={`dissolved-team-error-${team.id}`}>{error}</Muted> : null}
      <Button compact variant="secondary" icon="refresh-outline" arrow={false} label={busy ? "Stelle her ..." : "Wiederherstellen"} busy={busy}
        disabled={busy || (askTag && tag.trim().length < TEAM_TAG_MIN)} accessibilityLabel={`${team.name} wiederherstellen`} onPress={restore} testID={`dissolved-team-restore-${team.id}`} />
    </View>
  );
}

export function DissolvedTeams({ onRestored }: { onRestored?: () => void }) {
  const [teams, setTeams] = useState<DissolvedTeam[]>([]);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    try {
      const { data } = await api.get<DissolvedTeam[]>("/teams/dissolved/mine");
      setTeams(Array.isArray(data) ? data.filter((team) => team?.id) : []);
    } catch {
      // Ein Teil der Teamliste - kommt er nicht, steht er nicht da.
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!teams.length && !message) return null;
  return (
    <Card style={styles.card} testID="dissolved-teams">
      <Heading accessibilityRole="header">Aufgelöste Teams</Heading>
      {message ? <Muted style={{ color: roles.ok }} accessibilityLiveRegion="polite" testID="dissolved-teams-message">{message}</Muted> : null}
      {teams.length ? <Muted style={styles.small}>Als frühere Teamleitung holst du sie innerhalb der Frist zurück.</Muted> : null}
      {teams.map((team) => (
        <DissolvedRow key={team.id} team={team} onRestored={(restored) => {
          setMessage(`${restored.name} ist wieder da.`);
          void load();
          onRestored?.();
        }} />
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  row: { borderTopColor: colors.border, borderTopWidth: 1, gap: 8, paddingTop: 10 },
  head: { alignItems: "center", flexDirection: "row", gap: 12 },
  logo: { alignItems: "center", backgroundColor: surfaces.s1, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, height: 40, justifyContent: "center", overflow: "hidden", width: 40 },
  tag: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "900" },
  text: { flex: 1, minWidth: 0 },
  name: { fontWeight: "800" },
  small: { fontSize: 12 },
  field: { gap: 4 },
  label: { fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase" },
  input: { backgroundColor: surfaces.s1, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, color: colors.white, minHeight: 44, paddingHorizontal: 12 },
});
