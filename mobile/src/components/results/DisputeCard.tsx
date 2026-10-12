import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import type { ResultEntry } from "../../lib/resultEntry";
import { viennaTime } from "../../lib/vienna";
import { colors } from "../../theme";
import { AuthorizedImage } from "../AuthorizedImage";
import { Button } from "../Button";
import { Card } from "../Card";
import { Body, Muted } from "../Text";

// Streitfall für die Turnierleitung (#1158) wie auf der Website: Meldung mit Grund, Foto und eingetragenes Ergebnis -
// entschieden wird mit einem Tipp. „Ergebnis bleibt“ (ohne Ergebnis: „Weiter wie bisher“) schließt den Dispute,
// „Ergebnis ändern“ öffnet das Ergebnis-Fenster (Korrektur mit Grund). Beide Seiten bekommen die Entscheidung.

function clock(value?: string | null) {
  return value ? viennaTime(value, { hour: "2-digit", minute: "2-digit" }) : "";
}

export function DisputeCard({ item, busy = false, highlighted = false, onKeep, onChange }: {
  item: ResultEntry;
  busy?: boolean;
  highlighted?: boolean;
  onKeep: (note: string | null) => void;
  onChange: () => void;
}) {
  const { accessToken } = useAuth();
  const [note, setNote] = useState("");
  const dispute = item.dispute;
  if (!dispute) return null;
  const hasResult = Boolean(item.has_result);
  return (
    <Card style={[styles.card, highlighted && styles.highlighted]} testID={`lead-dispute-${item.id}`}>
      <Muted style={styles.eyebrow}>Gemeldet von {dispute.by}{dispute.at ? ` · ${clock(dispute.at)}` : ""}</Muted>
      <View style={styles.row}>
        <Ionicons name="alert-circle-outline" size={18} color={colors.live} />
        <Body style={styles.title}>{dispute.category_label}</Body>
      </View>
      <Muted numberOfLines={1}>{item.stage_name ? `${item.stage_name} · ` : ""}{item.label}</Muted>
      {dispute.text ? <Body>„{dispute.text}“</Body> : null}
      {dispute.photo?.url ? (
        <AuthorizedImage url={dispute.photo.url} token={accessToken} width={400} style={styles.photo} testID={`lead-dispute-photo-${item.id}`} />
      ) : null}
      {hasResult ? (
        <Muted testID={`lead-dispute-result-${item.id}`}>
          Eingetragen: {item.result_summary}{dispute.result_by ? ` · von ${dispute.result_by}` : ""}{dispute.result_at ? ` um ${clock(dispute.result_at)}` : ""}
        </Muted>
      ) : <Muted>Noch kein Ergebnis eingetragen.</Muted>}
      {(dispute.reports || []).map((report) => (
        <Muted key={`${report.by}-${report.at}`}>Meldung von {report.by}: {report.summary}</Muted>
      ))}
      <TextInput
        value={note}
        onChangeText={(value) => setNote(value.slice(0, 500))}
        placeholder="Begründung (freiwillig, geht an beide Seiten)"
        placeholderTextColor={colors.muted}
        style={styles.input}
        testID={`lead-dispute-note-${item.id}`}
      />
      <View style={styles.buttons}>
        <View style={styles.flex}>
          <Button label={hasResult ? "Ergebnis bleibt" : "Weiter wie bisher"} variant="secondary" onPress={() => onKeep(note.trim() || null)} disabled={busy} testID={`lead-dispute-keep-${item.id}`} />
        </View>
        <View style={styles.flex}>
          <Button label={hasResult ? "Ergebnis ändern" : "Ergebnis eintragen"} onPress={onChange} disabled={busy || !item.can_enter} testID={`lead-dispute-change-${item.id}`} />
        </View>
      </View>
      <Muted style={styles.center}>Beide Seiten bekommen die Entscheidung als Benachrichtigung.</Muted>
    </Card>
  );
}

const styles = StyleSheet.create({
  buttons: { flexDirection: "row", gap: 8 },
  card: { borderColor: "rgba(255,59,48,0.45)", gap: 8 },
  center: { textAlign: "center" },
  eyebrow: { color: colors.gold, fontWeight: "900" },
  flex: { flex: 1 },
  highlighted: { borderColor: colors.gold, borderWidth: 2 },
  input: { backgroundColor: colors.black, borderColor: colors.border, borderRadius: 8, borderWidth: 1, color: colors.white, minHeight: 44, paddingHorizontal: 10 },
  photo: { borderRadius: 6, height: 140, width: "100%" },
  row: { alignItems: "center", flexDirection: "row", gap: 6 },
  title: { fontWeight: "900" },
});
