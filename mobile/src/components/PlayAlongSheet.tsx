import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { api, errorMessage } from "../lib/api";
import {
  initialSelection,
  playAlongRows,
  resultSentence,
  selectionTotal,
  type PlayAlongEntry,
  type PlayAlongResponse,
  type PlayAlongRow,
} from "../lib/playAlong";
import { formatCents } from "../lib/startFee";
import { useSeasonOverlay } from "../seasons/anchors";
import { colors, radius } from "../theme";
import { Button } from "./Button";
import { Body, Heading, Muted } from "./Text";

// „Spielst du auch mit?“ (#1184) in der App - wie im Web: nach der Event-Anmeldung ein Blatt von unten mit den Turnieren
// des Events. Haken nur bei Einzel-Turnieren (Tippfläche mindestens 48 Punkte); Team-Turniere sagen, dass der Kapitän
// anmeldet (Kapitäne bekommen den Weg zur Turnierseite), Fast Laps brauchen keine Anmeldung. „Anmelden“ legt je Haken eine
// normale Turnier-Anmeldung an; danach steht je Eintrag, was passiert ist. „Nein danke“ beendet ohne Rückfrage.

type Props = {
  eventId: string | null;
  multiDay?: boolean;
  from?: string | null;
  onClose: () => void;
  onOpenTournament: (key: string) => void;
};

function stateColor(state: string): string {
  if (state === "error") return "#FF6B6B";
  if (state === "waitlist") return colors.gold;
  return colors.cyan;
}

function stateIcon(state: string): keyof typeof Ionicons.glyphMap {
  if (state === "error") return "alert-circle";
  if (state === "waitlist") return "time";
  return "checkmark-circle";
}

function When({ row }: { row: PlayAlongRow }) {
  return (
    <View style={styles.when}>
      {row.dayLabel ? <Muted style={styles.day}>{row.dayLabel}</Muted> : null}
      <Body style={styles.time}>{row.timeLabel || "–"}</Body>
    </View>
  );
}

export function PlayAlongSheet({ eventId, multiDay = false, from = null, onClose, onOpenTournament }: Props) {
  const [entries, setEntries] = useState<PlayAlongEntry[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [acceptRules, setAcceptRules] = useState(false);
  const [acceptCosts, setAcceptCosts] = useState(false);
  const [result, setResult] = useState<PlayAlongResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Mehrfachklick-Schutz: der Ref sperrt sofort, der Zustand nur für die Anzeige.
  const lock = useRef(false);
  const visible = Boolean(eventId && entries?.length);
  useSeasonOverlay("play-along-sheet", visible);

  useEffect(() => {
    if (!eventId) return undefined;
    let alive = true;
    setEntries(null);
    setResult(null);
    setError("");
    setAcceptRules(false);
    setAcceptCosts(false);
    api.get<{ show?: boolean; entries?: PlayAlongEntry[] }>(`/events/${eventId}/play-along`).then(({ data }) => {
      if (!alive) return;
      if (!data?.show || !data.entries?.length) {
        onClose();
        return;
      }
      setEntries(data.entries);
      setSelected(initialSelection(data.entries, from));
    }).catch(() => { if (alive) onClose(); });
    return () => { alive = false; };
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps -- nur beim Öffnen laden

  const rows = useMemo(() => playAlongRows(entries, { multiDay }), [entries, multiDay]);
  const sum = selectionTotal(entries, selected);
  const needsCosts = sum.total_cents > 0 || sum.waitlistFees > 0;
  const canSubmit = selected.length > 0 && acceptRules && (!needsCosts || acceptCosts) && !busy;
  const selectable = rows.some((row) => row.selectable);

  const toggle = (id: string) => {
    setError("");
    setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  };

  const submit = async () => {
    if (!eventId || !canSubmit || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post<PlayAlongResponse>(`/events/${eventId}/play-along`, {
        tournament_ids: selected, accept_rules: true, accept_privacy: true, accept_costs: acceptCosts,
      });
      setResult(data);
    } catch (err) {
      setError(errorMessage(err, "Die Anmeldung hat nicht geklappt."));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="play-along-sheet" accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.top}>
              <View style={styles.flex}>
                <Muted style={styles.eyebrow}>{result ? "ERLEDIGT" : "DU BIST BEIM EVENT DABEI"}</Muted>
                <Heading style={styles.question} accessibilityRole="header">{result ? "Deine Turniere" : "Spielst du auch mit?"}</Heading>
                <Muted>{result ? `${resultSentence(result.results)}.` : "Melde dich gleich für die Turniere an – jedes einzeln, mit denselben Regeln wie auf der Turnierseite."}</Muted>
              </View>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Schließen" hitSlop={12} style={styles.close} testID="play-along-close">
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>

            {result ? (
              <View style={styles.list} testID="play-along-result">
                {result.results.map((row) => (
                  <View key={row.id} style={styles.row} testID={`play-along-result-${row.id}`}>
                    <Ionicons name={stateIcon(row.state)} size={20} color={stateColor(row.state)} />
                    <View style={styles.flex}>
                      <Body style={styles.title}>{row.title || "Turnier"}</Body>
                      <Muted style={[styles.state, { color: stateColor(row.state) }]}>{row.label}{row.price ? ` · ${formatCents(row.price.total_cents, row.price.currency || "EUR")}` : ""}</Muted>
                      {row.detail ? <Muted>{row.detail}</Muted> : null}
                    </View>
                  </View>
                ))}
                {result.total_cents > 0 ? (
                  <View style={styles.sum} testID="play-along-total">
                    <View style={styles.sumRow}>
                      <Muted>Startgeld gesamt</Muted>
                      <Body style={styles.sumValue}>{formatCents(result.total_cents, result.currency || "EUR")}</Body>
                    </View>
                    <Muted style={styles.small}>Die Rechnungen kommen wie gewohnt in dein Konto unter „Meine Rechnungen“.</Muted>
                  </View>
                ) : null}
                <Button label={from ? "Zurück zum Turnier" : "Fertig"} onPress={onClose} testID="play-along-done" />
              </View>
            ) : (
              <>
                <View style={styles.list}>
                  {rows.map((row) => row.selectable ? (
                    <Pressable
                      key={row.id}
                      onPress={() => toggle(row.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected.includes(row.id) }}
                      accessibilityLabel={`${row.title}, ${[row.timeLabel, row.line].filter(Boolean).join(", ")}`}
                      style={[styles.row, styles.rowChoice, selected.includes(row.id) && styles.rowChosen]}
                      testID={`play-along-check-${row.id}`}
                    >
                      <View style={[styles.checkbox, selected.includes(row.id) && styles.checkboxOn]}>
                        {selected.includes(row.id) ? <Ionicons name="checkmark" size={16} color={colors.black} /> : null}
                      </View>
                      <When row={row} />
                      <View style={styles.flex}>
                        <Body style={styles.title}>{row.title}</Body>
                        <Muted style={styles.small}>{row.line}</Muted>
                      </View>
                    </Pressable>
                  ) : (
                    <View key={row.id} style={styles.row} testID={`play-along-row-${row.id}`}>
                      <Ionicons name={row.kind === "fastlap" ? "flag" : "people"} size={20} color={row.kind === "fastlap" ? colors.cyan : colors.gold} />
                      <When row={row} />
                      <View style={styles.flex}>
                        <Body style={styles.title}>{row.title}</Body>
                        <Muted style={styles.small}>{row.line}</Muted>
                        <Muted style={[styles.small, row.my_status ? styles.mine : null]} testID={`play-along-note-${row.id}`}>{row.reason}</Muted>
                        {row.captain ? (
                          <Button label="Team anmelden" variant="secondary" compact arrow={false} onPress={() => onOpenTournament(row.key)} style={styles.teamButton} testID={`play-along-team-${row.id}`} />
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
                {selectable ? (
                  <>
                    {needsCosts ? (
                      <View style={styles.sum} testID="play-along-sum">
                        <View style={styles.sumRow}>
                          <Muted>Summe Startgeld</Muted>
                          <Body style={styles.sumValue}>{formatCents(sum.total_cents, sum.currency)}</Body>
                        </View>
                        <Muted style={styles.small}>Die Rechnungen kommen wie gewohnt unter „Meine Rechnungen“.{sum.waitlistFees ? " Volle Turniere (Warteliste) zahlst du erst, wenn du nachrückst." : ""}</Muted>
                      </View>
                    ) : null}
                    <Pressable onPress={() => setAcceptRules((current) => !current)} accessibilityRole="checkbox" accessibilityState={{ checked: acceptRules }} style={styles.consent} testID="play-along-rules">
                      <View style={[styles.checkbox, acceptRules && styles.checkboxOn]}>
                        {acceptRules ? <Ionicons name="checkmark" size={16} color={colors.black} /> : null}
                      </View>
                      <Body style={styles.flex}>Ich akzeptiere die Regeln der gewählten Turniere und den Datenschutz.</Body>
                    </Pressable>
                    {needsCosts ? (
                      <Pressable onPress={() => setAcceptCosts((current) => !current)} accessibilityRole="checkbox" accessibilityState={{ checked: acceptCosts }} style={styles.consent} testID="play-along-costs">
                        <View style={[styles.checkbox, acceptCosts && styles.checkboxOn]}>
                          {acceptCosts ? <Ionicons name="checkmark" size={16} color={colors.black} /> : null}
                        </View>
                        <Body style={styles.flex}>Ich übernehme die Startgelder (Rechnung an mich).</Body>
                      </Pressable>
                    ) : null}
                  </>
                ) : null}
                {error ? <Muted style={styles.error} accessibilityLiveRegion="polite">{error}</Muted> : null}
                {selectable ? (
                  <Button
                    label={busy ? "Melde an …" : selected.length ? `Anmelden (${selected.length})` : "Anmelden"}
                    onPress={submit}
                    disabled={!canSubmit}
                    busy={busy}
                    testID="play-along-submit"
                  />
                ) : null}
                <Button label="Nein danke" variant="quiet" onPress={onClose} testID="play-along-skip" />
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.75)", flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.black, borderColor: "rgba(255,215,0,0.3)", borderTopLeftRadius: 14, borderTopRightRadius: 14, borderWidth: 1, maxHeight: "92%" },
  content: { gap: 12, padding: 18, paddingBottom: 30 },
  top: { flexDirection: "row", gap: 12 },
  flex: { flex: 1, gap: 2 },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  question: { fontSize: 24 },
  close: { alignItems: "center", height: 48, justifyContent: "center", width: 48 },
  list: { gap: 8 },
  row: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 },
  rowChoice: { minHeight: 56 },
  rowChosen: { backgroundColor: "rgba(41,182,232,0.1)", borderColor: colors.cyan },
  when: { alignItems: "center", width: 52 },
  day: { color: colors.gold, fontSize: 10, fontWeight: "900" },
  time: { fontWeight: "800" },
  title: { fontWeight: "900" },
  small: { fontSize: 12 },
  state: { fontSize: 12, fontWeight: "900" },
  mine: { color: colors.cyan, fontWeight: "900" },
  checkbox: { alignItems: "center", borderColor: colors.cyan, borderRadius: radius.sm, borderWidth: 2, height: 24, justifyContent: "center", width: 24 },
  checkboxOn: { backgroundColor: colors.cyan },
  consent: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 48 },
  sum: { backgroundColor: "rgba(255,215,0,0.05)", borderColor: "rgba(255,215,0,0.4)", borderRadius: radius.lg, borderWidth: 1, gap: 4, padding: 12 },
  sumRow: { alignItems: "baseline", flexDirection: "row", justifyContent: "space-between" },
  sumValue: { fontSize: 20, fontWeight: "900" },
  teamButton: { alignSelf: "flex-start", marginTop: 6 },
  error: { color: "#FF6B6B", fontWeight: "800" },
});
