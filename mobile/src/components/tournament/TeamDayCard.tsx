import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Button } from "../Button";
import { Card } from "../Card";
import { Body, Heading, Muted } from "../Text";
import { api, errorMessage } from "../../lib/api";
import { lineupLabel, presenceLine, starterLabel, type TeamDay } from "../../lib/teamDay";
import { viennaDateTime, viennaTime } from "../../lib/vienna";
import { colors } from "../../theme";

// Team am Spieltag (#1192) - wie im Web in „Dein Stand“: Kapitän oder Co-Kapitän wählt, wer spielt (genau so viele
// wie je Team, die übrigen sind Ersatz, wenn erlaubt), bis zum Ende des Check-ins. Am Turniertag tippt jedes Mitglied
// „Ich bin da“; der Kapitän sieht „4 von 5 da“ und kann Fehlende anstupsen. Bei Einzel-Turnieren steht hier nichts.

export function TeamDayCard({ tournamentId }: { tournamentId: string }) {
  const [data, setData] = useState<TeamDay | null>(null);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: next } = await api.get<TeamDay>(`/team-day/${tournamentId}`);
      setData(next);
      setDraft(null);
    } catch {
      setData(null);
    }
  }, [tournamentId]);

  useEffect(() => { load(); }, [load]);

  const chosen = useMemo(() => draft ?? data?.lineup ?? [], [data, draft]);
  if (!data?.applicable) return null;

  const run = async (task: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (err) {
      setError(errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: string) => {
    const current = draft ?? data.lineup ?? [];
    setDraft(current.includes(id) ? current.filter((uid) => uid !== id) : [...current, id]);
  };
  const save = () => run(async () => {
    const { data: next } = await api.put<TeamDay>(`/team-day/${tournamentId}/lineup`, { lineup: chosen });
    setData(next);
    setDraft(null);
    setMessage("Aufstellung gespeichert.");
  }, "Aufstellung konnte nicht gespeichert werden.");
  const presence = (here: boolean) => run(async () => {
    const { data: next } = here ? await api.post<TeamDay>(`/team-day/${tournamentId}/presence`) : await api.delete<TeamDay>(`/team-day/${tournamentId}/presence`);
    setData(next);
  }, "Das hat nicht geklappt.");
  const nudge = () => run(async () => {
    const { data: next } = await api.post<TeamDay>(`/team-day/${tournamentId}/nudge`);
    setData(next);
    setMessage(next.nudged ? `${next.nudged} angestupst.` : "Alle sind schon da.");
  }, "Anstupsen hat nicht geklappt.");

  const size = data.team_size;
  const valid = chosen.length === size;
  const pres = data.presence;
  const counted = new Set(pres?.counted || []);

  return (
    <Card style={styles.card} testID="team-day">
      <View style={styles.top}>
        <Heading>Wer spielt heute?</Heading>
        <Muted style={[styles.count, valid && styles.countOk]} testID="team-lineup-count">{chosen.length} von {size}</Muted>
      </View>
      {data.members.map((member) => {
        const on = chosen.includes(member.id);
        const label = on ? starterLabel(member) : data.substitutes_allowed ? "Ersatz" : "–";
        return (
          <Pressable
            key={member.id}
            disabled={!data.can_edit || busy}
            onPress={() => toggle(member.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: !data.can_edit }}
            accessibilityLabel={`${member.display_name} spielt`}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            testID={`team-lineup-member-${member.id}`}
          >
            <View style={[styles.box, on && styles.boxOn]}>{on ? <Ionicons name="checkmark" size={14} color={colors.black} /> : null}</View>
            <Body style={styles.name} numberOfLines={1}>{member.display_name}</Body>
            <Muted style={[styles.label, on && styles.labelOn]}>{label.toUpperCase()}</Muted>
          </Pressable>
        );
      })}
      <Muted testID="team-lineup-note">{lineupLabel(data, chosen.length)}</Muted>
      {data.can_edit ? (
        <>
          <Button label="Aufstellung speichern" onPress={save} disabled={draft === null || !valid || busy} testID="team-lineup-save" />
          {data.editable_until ? <Muted>Änderbar bis {viennaDateTime(data.editable_until, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</Muted> : null}
        </>
      ) : null}

      {pres?.enabled ? (
        <View style={styles.presence} testID="team-presence">
          <View style={styles.top}>
            <Heading>Wer ist da?</Heading>
            <Muted style={styles.countOk} testID="team-presence-count">{presenceLine(pres)}</Muted>
          </View>
          <View style={styles.bar}><View style={[styles.fill, { width: `${pres.total ? Math.round((pres.count / pres.total) * 100) : 0}%` }]} /></View>
          {data.members.filter((member) => counted.has(member.id)).map((member) => (
            <View key={member.id} style={styles.presenceRow} testID={`team-presence-${member.id}`}>
              <Body numberOfLines={1} style={styles.name}>{member.display_name}</Body>
              <Muted style={pres.present[member.id] ? styles.here : undefined}>
                {pres.present[member.id] ? `DA · ${viennaTime(pres.present[member.id], { hour: "2-digit", minute: "2-digit" })}` : "FEHLT"}
              </Muted>
            </View>
          ))}
          {pres.me_present ? (
            <Button label="Doch noch nicht da" variant="secondary" onPress={() => presence(false)} disabled={busy} testID="team-presence-undo" />
          ) : (
            <Button label="Ich bin da" onPress={() => presence(true)} disabled={busy} testID="team-presence-here" />
          )}
          {data.can_nudge ? (
            <Button
              label={data.nudge_available_at ? `Wieder ab ${viennaTime(data.nudge_available_at, { hour: "2-digit", minute: "2-digit" })}` : "Fehlende anstupsen"}
              variant="secondary"
              onPress={nudge}
              disabled={busy || Boolean(data.nudge_available_at) || pres.count >= pres.total}
              testID="team-presence-nudge"
            />
          ) : null}
        </View>
      ) : (
        <Muted testID="team-presence-later">Am Turniertag tippt hier jedes Mitglied „Ich bin da“ – so sieht das Team, wer schon da ist.</Muted>
      )}
      {message ? <Muted style={styles.success}>{message}</Muted> : null}
      {error ? <Muted style={styles.error}>{error}</Muted> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  top: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  count: { fontWeight: "900" },
  countOk: { color: colors.cyan, fontWeight: "900" },
  row: { alignItems: "center", borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", gap: 10, minHeight: 44, paddingTop: 8 },
  pressed: { opacity: 0.72 },
  box: { alignItems: "center", borderColor: "rgba(255,255,255,0.3)", borderRadius: 4, borderWidth: 1.5, height: 20, justifyContent: "center", width: 20 },
  boxOn: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  name: { flex: 1, fontWeight: "800" },
  label: { fontSize: 11, fontWeight: "900" },
  labelOn: { color: colors.cyan },
  presence: { borderTopColor: colors.border, borderTopWidth: 1, gap: 8, paddingTop: 12 },
  bar: { backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 3, height: 6, overflow: "hidden" },
  fill: { backgroundColor: colors.cyan, height: 6 },
  presenceRow: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  here: { color: colors.cyan, fontWeight: "900" },
  success: { color: colors.success, fontWeight: "800" },
  error: { color: colors.live, fontWeight: "800" },
});
