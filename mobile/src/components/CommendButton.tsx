import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { api, errorMessage } from "../lib/api";
import { colors, radius } from "../theme";

// GG (#616, in der App E13 #623): nach einem Match lobt eine Seite die andere - einmal je Match, nur Beteiligte, nur
// nach dem Ende. Zählt für „Fair Play“ (bekommen) und „Guter Verlierer“ (gegeben); wer wem, sieht niemand. Wie im Web.

type CommendState = { participant?: boolean; completed?: boolean; can_commend?: boolean; given?: boolean; received?: number; already?: boolean };

export function CommendButton({ matchId, completed, enabled = true }: { matchId: string; completed: boolean; enabled?: boolean }) {
  const [state, setState] = useState<CommendState | null>(null);
  const [busy, setBusy] = useState(false);
  const [thanked, setThanked] = useState(false);

  const load = useCallback(async () => {
    if (!enabled || !matchId || !completed) return;
    try {
      const { data } = await api.get<CommendState>(`/matches/${matchId}/commend`);
      setState(data || null);
    } catch {
      setState(null);
    }
  }, [enabled, matchId, completed]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!enabled || !completed || !state?.participant) return null;

  const give = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post<CommendState>(`/matches/${matchId}/commend`);
      setState(data || null);
      setThanked(!data?.already);
    } catch (err) {
      Alert.alert("GG hat nicht geklappt", errorMessage(err, "Bitte später noch einmal versuchen."));
    } finally {
      setBusy(false);
    }
  };

  if (state.given) {
    return (
      <View style={[styles.chip, styles.given]} testID="commend-given">
        <Ionicons name="heart-circle" size={16} color={colors.success} />
        <Text style={styles.text}>{thanked ? "GG gegeben – danke fürs faire Spiel" : "GG gegeben"}</Text>
      </View>
    );
  }
  if (!state.can_commend) return null;
  return (
    <Pressable
      onPress={give}
      disabled={busy}
      style={({ pressed }) => [styles.chip, styles.button, (pressed || busy) && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="GG geben – die andere Seite für ein faires Spiel loben"
      testID="commend-button"
    >
      <Ionicons name="heart-circle-outline" size={16} color={colors.success} />
      <Text style={styles.text}>GG geben</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  button: { borderColor: "rgba(0,255,136,0.45)" },
  given: { borderColor: "rgba(0,255,136,0.3)", backgroundColor: "rgba(0,255,136,0.1)" },
  pressed: { opacity: 0.6 },
  text: { color: colors.success, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
});
