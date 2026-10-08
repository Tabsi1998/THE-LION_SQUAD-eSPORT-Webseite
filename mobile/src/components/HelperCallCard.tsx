import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { api, errorMessage } from "../lib/api";
import { viennaDateTime } from "../lib/vienna";
import { colors } from "../theme";
import { Card } from "./Card";
import { Body, Muted } from "./Text";

// Helfer-Aufruf (#1197) für den Vorstand - wie im Web unter /members/helfen: fehlen für ein Event noch Helfer, geht
// mit einem Knopf eine Meldung an alle Mitglieder. Höchstens ein Aufruf je Event und Tag; bestätigt wird im Vereinsmodul.

type CallEvent = {
  id: number;
  label: string;
  open_shifts: Array<{ id: number }>;
  open_places: number;
  text: string;
  called_today: boolean;
  can_call: boolean;
  last_call_at?: string | null;
  last_call_recipients?: number | null;
};

export type ConfirmCall = (title: string, message: string) => Promise<boolean>;

export const defaultConfirmCall: ConfirmCall = (title, message) => new Promise((resolve) => {
  Alert.alert(title, message, [
    { text: "Abbrechen", style: "cancel", onPress: () => resolve(false) },
    { text: "Aufruf senden", onPress: () => resolve(true) },
  ], { cancelable: false, onDismiss: () => resolve(false) });
});

export function HelperCallCard({ confirmCall = defaultConfirmCall }: { confirmCall?: ConfirmCall }) {
  const [events, setEvents] = useState<CallEvent[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ available: boolean; events?: CallEvent[] }>("/membership/helper-calls");
      setEvents(data?.available ? (data.events || []).filter((event) => event.open_shifts?.length || event.called_today) : []);
    } catch {
      setEvents([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!events.length) return null;

  const send = async (event: CallEvent) => {
    const ok = await confirmCall(`Helfer-Aufruf für ${event.label} senden?`, `Alle Mitglieder bekommen: „${event.text}“ Höchstens ein Aufruf am Tag.`);
    if (!ok) return;
    setBusy(event.id);
    setMessage("");
    try {
      const { data } = await api.post<{ recipients: number }>(`/membership/helper-calls/${event.id}`);
      setMessage(`Aufruf gesendet – an ${data.recipients} Mitglieder.`);
    } catch (err) {
      setMessage(errorMessage(err, "Das hat nicht geklappt."));
    } finally {
      setBusy(null);
      await load();
    }
  };

  return (
    <Card style={styles.card} testID="helper-call-card">
      <View style={styles.head}>
        <Ionicons name="megaphone-outline" size={16} color={colors.gold} />
        <Muted style={styles.eyebrow}>HELFER-AUFRUF · VORSTAND</Muted>
      </View>
      <Muted>Fehlen noch Helfer, fragst du hier mit einem Tipp alle Mitglieder.</Muted>
      {events.map((event) => (
        <View key={event.id} style={styles.row} testID={`helper-call-${event.id}`}>
          <View style={styles.flex}>
            <Body style={styles.strong}>{event.label}</Body>
            <Muted testID={`helper-call-text-${event.id}`}>{event.text || (event.open_shifts?.length ? `Noch ${event.open_places} freie Plätze.` : "Alle Schichten sind besetzt.")}</Muted>
            {event.last_call_at ? <Muted style={styles.small}>Zuletzt gerufen: {viennaDateTime(event.last_call_at, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</Muted> : null}
          </View>
          <Pressable
            onPress={() => send(event)}
            disabled={!event.can_call || busy === event.id}
            accessibilityRole="button"
            accessibilityState={{ disabled: !event.can_call }}
            style={({ pressed }) => [styles.button, !event.can_call && styles.disabled, pressed && styles.pressed]}
            testID={`helper-call-send-${event.id}`}
          >
            <Body style={styles.buttonText}>{event.called_today ? "Heute gesendet" : "Aufruf senden"}</Body>
          </Pressable>
        </View>
      ))}
      {message ? <Muted style={styles.message}>{message}</Muted> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderColor: "rgba(255,215,0,0.4)", gap: 8 },
  head: { alignItems: "center", flexDirection: "row", gap: 6 },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  row: { alignItems: "center", borderColor: "rgba(255,255,255,0.12)", borderRadius: 6, borderWidth: 1, flexDirection: "row", gap: 10, padding: 10 },
  flex: { flex: 1, gap: 2 },
  strong: { fontWeight: "800" },
  small: { fontSize: 11 },
  button: { backgroundColor: colors.gold, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  buttonText: { color: colors.black, fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  message: { color: colors.success, fontWeight: "800" },
});
