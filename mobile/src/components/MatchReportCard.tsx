import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { REPORT_STATE_TEXT, duelResults, heatResults, rankingMode, type ReportEntry } from "../lib/matchReport";
import { colors } from "../theme";
import { Button } from "./Button";
import { FormInput } from "./FormInput";
import { Body, Muted } from "./Text";

// Ergebnis melden (#1132): wie auf der Website (frontend/src/components/tls/tournament/MatchReportForm.jsx). Wer selbst
// im Spiel steht und melden darf, meldet hier - im Duell, wer gewonnen hat, sonst die Plätze, freiwillig mit Spielstand,
// Beweis-Link und Notiz. Hat die Gegenseite schon gemeldet, genügt „Ja, stimmt“. Weichen die Meldungen ab, entscheidet
// die Turnierleitung.

export type ReportState = {
  status?: "open" | "waiting" | "confirm" | "conflict" | "agreed" | string;
  own_summary?: string | null;
  proposal?: ReportEntry[] | null;
  proposal_summary?: string | null;
} | null;

type Side = { registration_id?: string | null; display_name?: string | null };
export type ReportPayload = { results: ReportEntry[]; screenshot_url: string | null; note: string | null };

function valueLabel(mode: string) {
  if (mode === "time") return "Zeit in ms";
  return mode === "lower_score" ? "Score" : "Punkte";
}

export function MatchReportCard({ participants, match, state, allowsDraw = false, busy = false, onReport }: {
  participants: Side[];
  match: { settings?: Record<string, unknown> | null } | null | undefined;
  state: ReportState;
  allowsDraw?: boolean;
  busy?: boolean;
  onReport: (payload: ReportPayload) => Promise<boolean>;
}) {
  const status = state?.status || "open";
  const mode = rankingMode(match);
  const sides = useMemo(() => participants.filter((side) => side.registration_id) as Array<Side & { registration_id: string }>, [participants]);
  const isDuel = sides.length === 2;
  const [editing, setEditing] = useState(status === "open");
  const [winner, setWinner] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [rows, setRows] = useState(() => sides.map((side, index) => ({ registration_id: side.registration_id, rank: String(index + 1), value: "" })));
  const [proofUrl, setProofUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  // Ein neuer Stand vom Server schließt das Formular - außer, es ist noch nichts gemeldet.
  useEffect(() => { setEditing(status === "open"); }, [status]);

  const submit = async () => {
    const outcome = isDuel ? duelResults({ sides: sides.map((side) => side.registration_id), winner, values, mode }) : heatResults(rows, mode);
    if (outcome.error !== undefined) {
      setError(outcome.error);
      return;
    }
    setError("");
    const done = await onReport({ results: outcome.results, screenshot_url: proofUrl.trim() || null, note: note.trim() || null });
    if (done) {
      setProofUrl("");
      setNote("");
    }
  };

  return (
    <View style={styles.stack} testID="match-report">
      {status !== "open" && status !== "agreed" ? (
        <View style={[styles.state, status === "conflict" ? styles.stateConflict : status === "confirm" ? styles.stateConfirm : styles.stateWaiting]} testID="match-report-state">
          <Body style={styles.strong}>{REPORT_STATE_TEXT[status] || REPORT_STATE_TEXT.waiting}</Body>
          {status === "confirm" && state?.proposal_summary ? <Muted>Die Gegenseite meldet: {state.proposal_summary}</Muted> : null}
          {status !== "confirm" && state?.own_summary ? <Muted>Deine Meldung: {state.own_summary}</Muted> : null}
          {status === "confirm" && state?.proposal ? (
            <View style={styles.row}>
              <Button label="Ja, stimmt" onPress={() => { void onReport({ results: state.proposal || [], screenshot_url: null, note: null }); }} disabled={busy} testID="match-report-confirm" />
              {!editing ? <Button label="Nein, anderes Ergebnis" variant="secondary" onPress={() => setEditing(true)} testID="match-report-differs" /> : null}
            </View>
          ) : null}
          {(status === "waiting" || status === "conflict") && !editing ? (
            <Pressable onPress={() => setEditing(true)} hitSlop={8} testID="match-report-change">
              <Muted style={styles.link}>Meldung ändern</Muted>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {editing ? (
        <View style={styles.stack} testID="match-report-form">
          {isDuel ? (
            <>
              <Muted style={styles.label}>Wer hat gewonnen?</Muted>
              <View style={styles.row}>
                {sides.map((side) => (
                  <Choice key={side.registration_id} label={side.display_name || "Teilnehmer"} active={winner === side.registration_id} onPress={() => setWinner(side.registration_id)} testID={`match-report-winner-${side.registration_id}`} />
                ))}
                {allowsDraw ? <Choice label="Unentschieden" active={winner === "draw"} onPress={() => setWinner("draw")} testID="match-report-draw" /> : null}
              </View>
              <Muted style={styles.label}>Spielstand (freiwillig)</Muted>
              {sides.map((side) => (
                <FormInput
                  key={side.registration_id}
                  label={`${valueLabel(mode)} ${side.display_name || "Teilnehmer"}`}
                  value={values[side.registration_id] || ""}
                  keyboardType="numeric"
                  onChangeText={(value) => setValues((current) => ({ ...current, [side.registration_id]: value }))}
                  testID={`match-report-value-${side.registration_id}`}
                />
              ))}
            </>
          ) : (
            rows.map((row, index) => (
              <View key={row.registration_id} style={styles.heatRow}>
                <Body style={[styles.strong, styles.flex]} numberOfLines={1}>{sides.find((side) => side.registration_id === row.registration_id)?.display_name || "Teilnehmer"}</Body>
                <FormInput label="Platz" value={row.rank} keyboardType="number-pad" style={styles.small} onChangeText={(value) => setRows((current) => current.map((item, i) => (i === index ? { ...item, rank: value } : item)))} testID={`match-report-rank-${row.registration_id}`} />
                <FormInput label={valueLabel(mode)} value={row.value} keyboardType="numeric" style={styles.small} onChangeText={(value) => setRows((current) => current.map((item, i) => (i === index ? { ...item, value } : item)))} />
              </View>
            ))
          )}
          <FormInput label="Beweis-Link (freiwillig)" value={proofUrl} onChangeText={setProofUrl} placeholder="https://..." />
          <FormInput label="Notiz für die Turnierleitung (freiwillig)" value={note} onChangeText={setNote} />
          {error ? <Muted style={styles.error} testID="match-report-error">{error}</Muted> : null}
          <Button label={busy ? "Meldet ..." : "Ergebnis melden"} onPress={() => { void submit(); }} disabled={busy} testID="match-report-submit" />
          <Muted>Meldet die Gegenseite dasselbe, steht das Ergebnis fest. Weicht es ab, entscheidet die Turnierleitung.</Muted>
        </View>
      ) : null}
    </View>
  );
}

function Choice({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} testID={testID} style={[styles.choice, active && styles.choiceActive]}>
      {active ? <Ionicons name="checkmark" size={16} color={colors.cyan} /> : null}
      <Muted style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Muted>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  choice: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  choiceActive: {
    backgroundColor: "rgba(41,182,232,0.16)",
    borderColor: "rgba(41,182,232,0.55)",
  },
  choiceText: {
    fontWeight: "900",
  },
  choiceTextActive: {
    color: colors.cyan,
  },
  error: {
    color: colors.live,
    fontWeight: "800",
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  heatRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 8,
  },
  label: {
    fontWeight: "900",
  },
  link: {
    color: colors.cyan,
    fontWeight: "900",
    textDecorationLine: "underline",
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  small: {
    minWidth: 72,
  },
  stack: {
    gap: 10,
  },
  state: {
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  stateConfirm: {
    backgroundColor: "rgba(240,180,41,0.12)",
    borderColor: "rgba(240,180,41,0.45)",
  },
  stateConflict: {
    backgroundColor: "rgba(255,59,48,0.12)",
    borderColor: "rgba(255,59,48,0.45)",
  },
  stateWaiting: {
    backgroundColor: "rgba(41,182,232,0.1)",
    borderColor: "rgba(41,182,232,0.35)",
  },
  strong: {
    fontWeight: "900",
  },
});
