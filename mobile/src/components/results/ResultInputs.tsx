import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { FLAG_LABELS, winsNeeded, withFlag, type EntryState, type ResultEntry, type SideFlag } from "../../lib/resultEntry";
import { colors } from "../../theme";
import { Body, Muted, Title } from "../Text";

// Bausteine des Ergebnis-Fensters (#1156): große Knöpfe statt Zahlenfelder - wie auf der Website
// (frontend/src/components/tls/results/ResultInputs.jsx). Dieselben Bausteine nutzt die Spieler-Meldung (#1157).

export function Stepper({ value = 0, onChange, label, testID }: { value?: number; onChange: (next: number) => void; label: string; testID?: string }) {
  const number = Number(value || 0);
  return (
    <View style={styles.stepper} testID={testID}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} weniger`} disabled={number <= 0} onPress={() => onChange(Math.max(0, number - 1))} style={[styles.stepButton, number <= 0 && styles.dim]} testID={testID ? `${testID}-minus` : undefined}>
        <Ionicons name="remove" size={24} color={colors.cyan} />
      </Pressable>
      <Title style={styles.stepValue} testID={testID ? `${testID}-value` : undefined}>{String(number)}</Title>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} mehr`} onPress={() => onChange(number + 1)} style={styles.stepButton} testID={testID ? `${testID}-plus` : undefined}>
        <Ionicons name="add" size={24} color={colors.cyan} />
      </Pressable>
    </View>
  );
}

export function FlagChips({ value, onChange, testID }: { value?: SideFlag | null; onChange: (flag: SideFlag | null) => void; testID?: string }) {
  return (
    <View style={styles.chips} testID={testID}>
      {(Object.keys(FLAG_LABELS) as SideFlag[]).map((key) => {
        const active = value === key;
        return (
          <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => onChange(active ? null : key)} style={[styles.chip, active && styles.chipOn]} testID={testID ? `${testID}-${key}` : undefined}>
            <Muted style={[styles.chipText, active && styles.chipTextOn]}>{FLAG_LABELS[key]}</Muted>
          </Pressable>
        );
      })}
    </View>
  );
}

// `showFlags`: „Nicht erschienen“/„Aufgegeben“ nur für die Turnierleitung - Spieler melden ohne (#1157).
type InputProps = { entry: ResultEntry; state: EntryState; onChange: (next: EntryState) => void; showFlags?: boolean };

export function ScoreInput({ entry, state, onChange, showFlags = true }: InputProps) {
  return (
    <View style={styles.stack} testID="result-score">
      {entry.participants.map((side) => (
        <View key={side.registration_id} style={styles.box}>
          <View style={styles.row}>
            <Body style={[styles.name, styles.flex]} numberOfLines={1}>{side.name || "Teilnehmer"}</Body>
            {state.flags[side.registration_id] === "no_show" ? <Muted style={styles.flagText}>nicht erschienen</Muted> : (
              <Stepper label={side.name || "Teilnehmer"} value={state.scores[side.registration_id] || 0} onChange={(next) => onChange({ ...state, scores: { ...state.scores, [side.registration_id]: next } })} testID={`result-score-${side.registration_id}`} />
            )}
          </View>
          {showFlags ? <FlagChips value={state.flags[side.registration_id]} onChange={(flag) => onChange(withFlag(state, side.registration_id, flag, true))} testID={`result-flag-${side.registration_id}`} /> : null}
        </View>
      ))}
    </View>
  );
}

export function BestOfInput({ entry, state, onChange, onTap, showFlags = true }: InputProps & { onTap: (index: number, winner: string) => void }) {
  const total = Number(entry.best_of || 3);
  const needed = winsNeeded(total);
  const wins: Record<string, number> = Object.fromEntries(entry.participants.map((side) => [side.registration_id, 0]));
  const decided: boolean[] = [];
  (state.games || []).forEach((game, index) => {
    if (game && game in wins) wins[game] += 1;
    decided[index] = Object.values(wins).some((count) => count >= needed);
  });
  return (
    <View style={styles.stack} testID="result-bestof">
      <Muted>Wer hat welches Spiel gewonnen? Es braucht {needed} von {total}.</Muted>
      {Array.from({ length: total }, (_, index) => {
        const off = index > 0 && decided[index - 1] && !(state.games || [])[index];
        return (
          <View key={index} style={[styles.gameRow, off && styles.dim]}>
            <Muted style={styles.gameLabel}>Spiel {index + 1}</Muted>
            {entry.participants.map((side) => {
              const active = (state.games || [])[index] === side.registration_id;
              return (
                <Pressable key={side.registration_id} disabled={off} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => onTap(index, side.registration_id)} style={[styles.game, active && styles.gameOn]} testID={`result-game-${index + 1}-${side.registration_id}`}>
                  <Muted style={[styles.gameText, active && styles.chipTextOn]} numberOfLines={1}>{side.name || "Teilnehmer"}</Muted>
                </Pressable>
              );
            })}
          </View>
        );
      })}
      {showFlags && entry.participants.map((side) => (
        <View key={side.registration_id} style={styles.flagLine}>
          <Muted numberOfLines={1}>{side.name}</Muted>
          <FlagChips value={state.flags[side.registration_id]} onChange={(flag) => onChange(withFlag(state, side.registration_id, flag, true))} testID={`result-flag-${side.registration_id}`} />
        </View>
      ))}
    </View>
  );
}

export function WinnerInput({ entry, state, onChange, showFlags = true }: InputProps) {
  return (
    <View style={styles.stack} testID="result-winner">
      <Muted>Wer hat gewonnen?</Muted>
      <View style={styles.row}>
        {entry.participants.map((side) => {
          const active = state.winner === side.registration_id;
          return (
            <Pressable key={side.registration_id} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => onChange({ ...state, winner: side.registration_id })} style={[styles.game, active && styles.gameOn]} testID={`result-winner-${side.registration_id}`}>
              <Muted style={[styles.gameText, active && styles.chipTextOn]}>{side.name}</Muted>
            </Pressable>
          );
        })}
      </View>
      {showFlags && entry.participants.map((side) => (
        <FlagChips key={side.registration_id} value={state.flags[side.registration_id]} onChange={(flag) => onChange(withFlag(state, side.registration_id, flag, true))} testID={`result-flag-${side.registration_id}`} />
      ))}
    </View>
  );
}

export function OrderInput({ entry, state, onChange, showFlags = true }: InputProps) {
  const order = state.order || [];
  const tap = (id: string) => {
    if (state.flags[id]) return;
    onChange({ ...state, order: order.includes(id) ? order.filter((item) => item !== id) : [...order, id] });
  };
  return (
    <View style={styles.stack} testID="result-order">
      <Muted>In Zielreihenfolge antippen – wer zuerst im Ziel war, zuerst. Noch ein Tipp nimmt es zurück.</Muted>
      {entry.participants.map((side) => {
        const place = order.indexOf(side.registration_id) + 1;
        const flag = state.flags[side.registration_id];
        return (
          <View key={side.registration_id} style={[styles.box, place > 0 && styles.boxOn]}>
            <Pressable accessibilityRole="button" disabled={Boolean(flag)} onPress={() => tap(side.registration_id)} style={styles.orderTap} testID={`result-order-${side.registration_id}`}>
              <View style={[styles.place, place === 1 && styles.placeGold, place > 1 && styles.placeOn]}>
                <Body style={styles.placeText}>{flag ? "–" : place ? String(place) : ""}</Body>
              </View>
              <Body style={[styles.name, styles.flex]} numberOfLines={1}>{side.name}</Body>
              {flag ? <Muted style={styles.flagText}>{FLAG_LABELS[flag]}</Muted> : null}
            </Pressable>
            {showFlags ? <FlagChips value={flag} onChange={(next) => onChange(withFlag(state, side.registration_id, next))} testID={`result-flag-${side.registration_id}`} /> : null}
          </View>
        );
      })}
    </View>
  );
}

export function PointsInput({ entry, state, onChange }: InputProps) {
  return (
    <View style={styles.stack} testID="result-points">
      {entry.participants.map((side) => {
        const flag = state.flags[side.registration_id];
        return (
          <View key={side.registration_id} style={styles.box}>
            <View style={styles.row}>
              <Body style={[styles.name, styles.flex]} numberOfLines={1}>{side.name}</Body>
              {flag ? <Muted style={styles.flagText}>{FLAG_LABELS[flag]}</Muted> : (
                <Stepper label={side.name || "Teilnehmer"} value={state.scores[side.registration_id] || 0} onChange={(next) => onChange({ ...state, scores: { ...state.scores, [side.registration_id]: next } })} testID={`result-points-${side.registration_id}`} />
              )}
            </View>
            <FlagChips value={flag} onChange={(next) => onChange(withFlag(state, side.registration_id, next))} testID={`result-flag-${side.registration_id}`} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.black, borderColor: colors.border, borderRadius: 8, borderWidth: 1, gap: 8, padding: 10 },
  boxOn: { backgroundColor: "rgba(41,182,232,0.06)", borderColor: "rgba(41,182,232,0.4)" },
  chip: { borderColor: "rgba(255,255,255,0.15)", borderRadius: 16, borderWidth: 1, minHeight: 34, justifyContent: "center", paddingHorizontal: 12 },
  chipOn: { backgroundColor: "rgba(255,59,48,0.15)", borderColor: "rgba(255,59,48,0.6)" },
  chipText: { fontSize: 12, fontWeight: "800" },
  chipTextOn: { color: colors.white },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dim: { opacity: 0.4 },
  flagLine: { gap: 6 },
  flagText: { color: colors.live, fontWeight: "900" },
  flex: { flex: 1, minWidth: 0 },
  game: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.05)", borderColor: colors.border, borderRadius: 8, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: 8 },
  gameLabel: { fontWeight: "800", width: 62 },
  gameOn: { backgroundColor: "rgba(41,182,232,0.16)", borderColor: "rgba(41,182,232,0.6)" },
  gameRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  gameText: { fontWeight: "900" },
  name: { fontWeight: "900" },
  orderTap: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 46 },
  place: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 16, height: 32, justifyContent: "center", width: 32 },
  placeGold: { backgroundColor: colors.gold },
  placeOn: { backgroundColor: colors.cyan },
  placeText: { color: colors.black, fontWeight: "900" },
  row: { alignItems: "center", flexDirection: "row", gap: 10 },
  stack: { gap: 10 },
  stepButton: { alignItems: "center", borderColor: "rgba(41,182,232,0.5)", borderRadius: 8, borderWidth: 1, height: 46, justifyContent: "center", width: 46 },
  stepValue: { fontVariant: ["tabular-nums"], minWidth: 40, textAlign: "center" },
  stepper: { alignItems: "center", flexDirection: "row", gap: 8 },
});
