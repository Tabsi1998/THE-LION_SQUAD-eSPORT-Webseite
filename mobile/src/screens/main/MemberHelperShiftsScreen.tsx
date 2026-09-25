import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { formatDate } from "../../lib/format";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Helferdienste (#331): dieselben Daten wie auf lionsquad.at/members/helfen - Schichten aus der Vereinsakte
// (Vereine 1.4), Anfrage nach Rückfrage, Rücknahme nur unbestätigt. Der Vorstand bestätigt in Dolibarr.

export type HelperShift = {
  id: number; label: string; day: string; start: string; end: string; capacity: number; taken: number; free: number; full: boolean;
  mine: string; mine_label: string; can_request: boolean; can_withdraw: boolean;
};
export type HelperEvent = {
  id: number; label: string; day: string; end_day: string; timezone: string; place: string; status: string; status_label: string;
  visibility: string; visibility_label: string; registration: { kind: string; external_ref: string; text: string }; shifts: HelperShift[];
  upcoming: boolean; mine: HelperShift[]; open_places: number;
};
export type HelperShiftsView = { available: boolean; reason?: string | null; text?: string; events: HelperEvent[]; my_count?: number; open_places?: number };

export type ConfirmShift = (title: string, message: string) => Promise<boolean>;

export const defaultConfirmShift: ConfirmShift = (title, message) => new Promise((resolve) => {
  Alert.alert(title, message, [
    { text: "Abbrechen", style: "cancel", onPress: () => resolve(false) },
    { text: "Ich helfe", onPress: () => resolve(true) },
  ], { cancelable: false, onDismiss: () => resolve(false) });
});

export function shiftWhen(shift: HelperShift): string {
  const time = shift.start && shift.end ? `${shift.start}–${shift.end} Uhr` : shift.start ? `ab ${shift.start} Uhr` : "";
  return [formatDate(shift.day), time].filter(Boolean).join(" · ");
}

type Props = NativeStackScreenProps<MoreStackParamList, "MemberHelperShifts"> & { confirmShift?: ConfirmShift };

export function MemberHelperShiftsScreen({ confirmShift = defaultConfirmShift }: Props) {
  const [view, setView] = useState<HelperShiftsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<HelperShiftsView>("/membership/me/helper-shifts");
      setView(data && typeof data === "object" ? data : null);
    } catch (err) {
      setError(errorMessage(err, "Helferdienste konnten nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const request = async (event: HelperEvent, shift: HelperShift) => {
    const ok = await confirmShift(`Beim Dienst „${shift.label}“ helfen?`, `${event.label} · ${shiftWhen(shift)}. Der Vorstand bestätigt die Anfrage; bis dahin kannst du sie zurückziehen.`);
    if (!ok) return;
    setBusy(`shift-${shift.id}`);
    try {
      await api.put(`/membership/me/events/${event.id}/shifts/${shift.id}`);
    } catch (err) {
      Alert.alert("Das hat nicht geklappt", errorMessage(err, "Die Anfrage wurde nicht angenommen."));
    } finally {
      setBusy("");
      await load();
    }
  };

  const withdraw = async (event: HelperEvent, shift: HelperShift) => {
    setBusy(`shift-${shift.id}`);
    try {
      await api.delete(`/membership/me/events/${event.id}/shifts/${shift.id}`);
    } catch (err) {
      Alert.alert("Das hat nicht geklappt", errorMessage(err, "Die Anfrage konnte nicht zurückgezogen werden."));
    } finally {
      setBusy("");
      await load();
    }
  };

  const events = view?.events ?? [];
  const sorted = [...events.filter((e) => e.upcoming), ...events.filter((e) => !e.upcoming)];

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}>
        {loading ? <SkeletonList count={2} hasImage={false} /> : null}
        {error ? <EmptyState icon="alert-circle-outline" tone="gold" title="Nicht geladen" detail={error} /> : null}

        {view && !view.available ? (
          <Card style={styles.card} testID="helper-shifts-unavailable">
            <Heading>Helferdienste</Heading>
            <Muted>{view.text || "Hier gibt es noch nichts."}</Muted>
          </Card>
        ) : null}

        {view?.available ? (
          <>
            <Muted>Angefragt heißt: der Vorstand bestätigt. Gezählt wird, was der Verein als geleistet bestätigt.</Muted>
            {view.my_count ? <Muted testID="helper-shifts-mine">Du bist bei {view.my_count === 1 ? "einem Dienst" : `${view.my_count} Diensten`} eingetragen.</Muted> : null}
            {!events.length ? <Muted testID="helper-shifts-empty">Derzeit keine Veranstaltung mit Helferdiensten.</Muted> : null}
            {sorted.map((event) => (
              <Card key={event.id} style={[styles.card, event.upcoming && styles.upcoming]} testID={`helper-event-${event.id}`}>
                <Muted style={styles.eyebrow}>{event.visibility_label} · {event.status_label}</Muted>
                <Heading>{event.label}</Heading>
                <Muted>{formatDate(event.day)}{event.end_day && event.end_day !== event.day ? ` – ${formatDate(event.end_day)}` : ""}{event.place ? ` · ${event.place}` : ""}</Muted>
                <Muted testID={`helper-event-${event.id}-registration`}>{event.registration?.text}</Muted>
                {event.shifts.map((shift) => (
                  <View key={shift.id} style={styles.shift} testID={`shift-${shift.id}`}>
                    <View style={styles.flex}>
                      <Body style={styles.strong}>{shift.label}</Body>
                      <Muted>{shiftWhen(shift)} · {shift.taken}/{shift.capacity}{shift.full ? " · voll" : ""}</Muted>
                      {shift.mine ? <Body style={[styles.mine, shift.mine === "confirmed" || shift.mine === "done" ? styles.mineOk : shift.mine === "requested" ? styles.mineWait : null]} testID={`shift-${shift.id}-mine`}>{shift.mine_label}</Body> : null}
                      {shift.mine === "confirmed" ? <Muted>Absagen bitte beim Vorstand.</Muted> : null}
                    </View>
                    {shift.can_request ? (
                      <Pressable onPress={() => request(event, shift)} disabled={busy === `shift-${shift.id}`} accessibilityRole="button" testID={`shift-${shift.id}-request`} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
                        <Body style={styles.primaryText}>Ich helfe</Body>
                      </Pressable>
                    ) : null}
                    {shift.can_withdraw ? (
                      <Pressable onPress={() => withdraw(event, shift)} disabled={busy === `shift-${shift.id}`} accessibilityRole="button" testID={`shift-${shift.id}-withdraw`} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
                        <Muted style={styles.secondaryText}>Zurückziehen</Muted>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                {!event.shifts.length ? <Muted>Keine Helferdienste ausgeschrieben.</Muted> : null}
              </Card>
            ))}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  card: { gap: 8 },
  upcoming: { borderColor: "rgba(255,215,0,0.45)" },
  eyebrow: { fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: colors.gold },
  shift: { flexDirection: "row", alignItems: "center", gap: 10, borderColor: "rgba(255,255,255,0.12)", borderRadius: 6, borderWidth: 1, padding: 10 },
  flex: { flex: 1, gap: 2 },
  strong: { fontWeight: "700" },
  mine: { fontSize: 12, fontWeight: "700" },
  mineOk: { color: colors.success },
  mineWait: { color: colors.gold },
  primary: { backgroundColor: colors.gold, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  primaryText: { color: colors.black, fontWeight: "700", fontSize: 13 },
  secondary: { borderColor: "rgba(255,255,255,0.2)", borderRadius: 6, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  secondaryText: { fontSize: 12 },
  pressed: { opacity: 0.7 },
});
