import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { api, errorMessage } from "../../lib/api";
import {
  UNDO_SECONDS,
  initialState,
  inputKind,
  resultSentence,
  resultsFor,
  tapGame,
  type HeatMode,
  type ResultEntry,
} from "../../lib/resultEntry";
import { colors } from "../../theme";
import { Button } from "../Button";
import { FormInput } from "../FormInput";
import { Body, Heading, Muted } from "../Text";
import { BestOfInput, OrderInput, PointsInput, ScoreInput, WinnerInput } from "./ResultInputs";

// Das Ergebnis-Fenster der App (#1156): dieselbe Eingabe wie auf der Website - ein Blatt von unten, große Knöpfe, der
// Satz vor dem Speichern und danach 10 Sekunden „Rückgängig“. Gespeichert wird mit `hold: true` (der Server hält das
// Ergebnis zurück); ein fertiges Ergebnis zu ändern ist eine Korrektur mit Grund.

const HEAT_MODE_KEY = "tls.result-heat-mode";

async function readHeatMode(): Promise<HeatMode> {
  try {
    return (await SecureStore.getItemAsync(HEAT_MODE_KEY)) === "points" ? "points" : "order";
  } catch {
    return "order";
  }
}

async function rememberHeatMode(mode: HeatMode) {
  try {
    await SecureStore.setItemAsync(HEAT_MODE_KEY, mode);
  } catch {
    // ohne Speicher gilt beim nächsten Mal wieder „Reihenfolge“
  }
}

export type SavedHold = { matchId: string; hold: { id?: string } | null; sentence: string };

export function ResultEntrySheet({ entry, onClose, onSaved }: { entry: ResultEntry | null; onClose: () => void; onSaved: (saved: SavedHold) => void }) {
  const correcting = Boolean(entry?.has_result);
  const [heatMode, setHeatMode] = useState<HeatMode>("order");
  const [state, setState] = useState(() => initialState(entry));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void readHeatMode().then(setHeatMode);
  }, []);
  // Ein anderes Spiel geöffnet: frisch anfangen. Ein Neuladen derselben Liste lässt die Eingabe stehen.
  useEffect(() => {
    setState(initialState(entry));
    setReason("");
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id]);

  const kind = inputKind(entry, heatMode);
  const outcome = useMemo(() => (entry ? resultsFor(entry, kind, state) : { error: "" }), [entry, kind, state]);
  const sentence = outcome.results ? resultSentence(entry, outcome.results) : "";

  const save = async () => {
    if (!entry) return;
    if (outcome.error !== undefined) {
      setError(outcome.error);
      return;
    }
    if (correcting && reason.trim().length < 5) {
      setError("Bitte kurz den Grund der Korrektur angeben (mindestens 5 Zeichen).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post<{ hold?: { id?: string } }>(`/matches/${entry.id}/result${correcting ? "?force=true" : ""}`, {
        results: outcome.results,
        hold: true,
        reason: correcting ? reason.trim() : null,
      });
      onSaved({ matchId: entry.id, hold: data?.hold || null, sentence });
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Ergebnis konnte nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  };

  const meta = entry ? [entry.label, entry.station_text, entry.kind === "duel" && Number(entry.best_of) > 1 ? `Best of ${entry.best_of}` : null].filter(Boolean).join(" · ") : "";

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={Boolean(entry)}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="result-sheet">
          {entry ? (
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <View style={styles.top}>
                <View style={styles.flex}>
                  <Muted style={styles.eyebrow} numberOfLines={1}>{meta}</Muted>
                  <Heading>{correcting ? "Ergebnis korrigieren" : "Ergebnis eintragen"}</Heading>
                </View>
                <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Schließen" hitSlop={10} testID="result-sheet-close">
                  <Ionicons name="close" size={24} color={colors.muted} />
                </Pressable>
              </View>
              {entry.kind !== "duel" && entry.ranking_mode !== "time" ? (
                <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Eingabe bei Durchgängen">
                  {(["order", "points"] as HeatMode[]).map((mode) => (
                    <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ selected: heatMode === mode }} onPress={() => { setHeatMode(mode); void rememberHeatMode(mode); }} style={[styles.segmentItem, heatMode === mode && styles.segmentOn]} testID={`result-heat-mode-${mode}`}>
                      <Muted style={[styles.segmentText, heatMode === mode && styles.segmentTextOn]}>{mode === "order" ? "Reihenfolge antippen" : "Punkte eintragen"}</Muted>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {kind === "score" ? <ScoreInput entry={entry} state={state} onChange={setState} /> : null}
              {kind === "bestof" ? (
                <BestOfInput entry={entry} state={state} onChange={setState} onTap={(index, winner) => setState((current) => ({ ...current, games: tapGame(current.games, index, winner, { sides: current.sides, bestOf: entry.best_of }) }))} />
              ) : null}
              {kind === "winner" ? <WinnerInput entry={entry} state={state} onChange={setState} /> : null}
              {kind === "order" ? <OrderInput entry={entry} state={state} onChange={setState} /> : null}
              {kind === "points" ? <PointsInput entry={entry} state={state} onChange={setState} /> : null}
              {correcting ? <FormInput label="Grund der Korrektur (steht im Protokoll)" value={reason} onChangeText={setReason} placeholder="z. B. Stand falsch abgelesen" testID="result-reason" /> : null}
              <View style={[styles.sentence, !sentence && styles.sentenceEmpty]}>
                <Body style={styles.sentenceText} testID="result-sentence">{sentence ? `${correcting ? "Neu: " : ""}${sentence}` : outcome.error || "Noch kein Ergebnis gewählt."}</Body>
              </View>
              {error ? <Muted style={styles.error} testID="result-error">{error}</Muted> : null}
              <Button label={busy ? "Speichert …" : correcting ? "Korrektur speichern" : "Ergebnis speichern"} onPress={() => { void save(); }} disabled={busy} testID="result-save" />
              <Muted>Danach {UNDO_SECONDS} Sekunden „Rückgängig“ – erst dann rückt der Baum weiter und die Spieler bekommen Bescheid.</Muted>
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/** „Rückgängig“ nach dem Speichern: 10 Sekunden lang unten eine Leiste mit dem Satz und dem Knopf. */
export function useResultUndo(onDone?: () => void) {
  const [pending, setPending] = useState<{ matchId: string; holdId: string | null; sentence: string; until: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [pending]);

  useEffect(() => {
    if (!pending || now < pending.until) return undefined;
    setPending(null);
    const reload = setTimeout(() => doneRef.current?.(), 2500);
    return () => clearTimeout(reload);
  }, [now, pending]);

  const start = useCallback((saved: SavedHold) => {
    setNow(Date.now());
    setPending({ matchId: saved.matchId, holdId: saved.hold?.id || null, sentence: saved.sentence, until: Date.now() + UNDO_SECONDS * 1000 });
    doneRef.current?.();
  }, []);

  const undo = useCallback(async () => {
    if (!pending) return "";
    const current = pending;
    setPending(null);
    try {
      await api.post(`/matches/${current.matchId}/result/undo`, { hold_id: current.holdId });
      doneRef.current?.();
      return "Rückgängig gemacht – es ist nichts passiert.";
    } catch (err) {
      doneRef.current?.();
      return errorMessage(err, "Rückgängig ging nicht.");
    }
  }, [pending]);

  return { pending, secondsLeft: pending ? Math.max(0, Math.ceil((pending.until - now) / 1000)) : 0, start, undo };
}

export function ResultUndoBar({ undo, onMessage }: { undo: ReturnType<typeof useResultUndo>; onMessage?: (text: string) => void }) {
  if (!undo.pending) return null;
  return (
    <View style={styles.undoBar} accessibilityRole="alert" testID="result-undo-bar">
      <View style={styles.flex}>
        <Muted style={styles.eyebrow}>Gespeichert</Muted>
        <Body numberOfLines={2} testID="result-undo-sentence">{undo.pending.sentence}</Body>
      </View>
      <Pressable accessibilityRole="button" onPress={() => { void undo.undo().then((text) => text && onMessage?.(text)); }} style={styles.undoButton} testID="result-undo">
        <Ionicons name="arrow-undo" size={18} color={colors.cyan} />
        <Muted style={styles.undoText}>Rückgängig ({undo.secondsLeft})</Muted>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.7)", flex: 1, justifyContent: "flex-end" },
  content: { gap: 14, padding: 18, paddingBottom: 32 },
  error: { color: colors.live, fontWeight: "800" },
  eyebrow: { color: colors.cyan, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  flex: { flex: 1, minWidth: 0 },
  segment: { backgroundColor: "rgba(255,255,255,0.05)", borderColor: colors.border, borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 4, padding: 4 },
  segmentItem: { alignItems: "center", borderRadius: 6, flex: 1, justifyContent: "center", minHeight: 40 },
  segmentOn: { backgroundColor: colors.cyan },
  segmentText: { fontWeight: "900" },
  segmentTextOn: { color: colors.black },
  sentence: { backgroundColor: "rgba(41,182,232,0.1)", borderColor: "rgba(41,182,232,0.35)", borderRadius: 8, borderWidth: 1, padding: 12 },
  sentenceEmpty: { backgroundColor: "rgba(255,255,255,0.04)", borderColor: colors.border },
  sentenceText: { fontWeight: "900" },
  sheet: { backgroundColor: colors.surface, borderColor: colors.border, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderWidth: 1, maxHeight: "92%" },
  top: { flexDirection: "row", gap: 12 },
  undoBar: { alignItems: "center", backgroundColor: "#0F1D23", borderColor: "rgba(41,182,232,0.45)", borderRadius: 10, borderWidth: 1, bottom: 16, flexDirection: "row", gap: 12, left: 12, padding: 12, position: "absolute", right: 12 },
  undoButton: { alignItems: "center", borderColor: "rgba(41,182,232,0.5)", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 6, minHeight: 44, paddingHorizontal: 10 },
  undoText: { color: colors.cyan, fontWeight: "900" },
});
