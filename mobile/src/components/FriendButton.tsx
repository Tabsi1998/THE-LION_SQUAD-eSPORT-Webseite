import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Body } from "./Text";
import { api, errorMessage } from "../lib/api";
import { friendButton, friendRequest, type FriendAction, type Relationship } from "../lib/friends";
import { useLiveRefresh } from "../realtime/LiveChangesProvider";
import { colors } from "../theme";

// Freund hinzufügen (#240) im öffentlichen Profil: Anfrage senden, annehmen, ablehnen,
// zurückziehen oder Freund entfernen - der Zustand kommt vom Server, nie aus dem Text.

export function FriendButton({ userId, initial = null }: { userId: string; initial?: Relationship | null }) {
  const [relationship, setRelationship] = useState<Relationship | null>(initial);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Relationship>(`/friends/status/${userId}`);
      setRelationship(data || null);
    } catch {
      // Ohne Antwort bleibt der letzte Stand stehen.
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["friends", "notifications"], { fallbackMs: 60000 });

  const view = friendButton(relationship);
  if (view.action === "none") return null;

  const run = async (action: FriendAction) => {
    const request = friendRequest(action, userId, relationship?.id);
    if (!request || busy) return;
    if (action === "remove") {
      const ok = await new Promise<boolean>((resolve) => Alert.alert("Freund entfernen?", "Ihr seid dann nicht mehr befreundet.", [
        { text: "Abbrechen", style: "cancel", onPress: () => resolve(false) },
        { text: "Entfernen", style: "destructive", onPress: () => resolve(true) },
      ]));
      if (!ok) return;
    }
    setBusy(true);
    try {
      const response = request.method === "post" ? await api.post<Relationship>(request.path) : await api.delete(request.path);
      if (request.method === "post" && response.data && typeof response.data === "object" && "status" in response.data) {
        setRelationship(response.data as Relationship);
      } else {
        await load();
      }
    } catch (err) {
      Alert.alert("Das hat nicht geklappt", errorMessage(err, "Die Anfrage konnte nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  };

  const primaryStyle = view.action === "remove" || view.action === "cancel" ? styles.quiet : styles.primary;
  const textStyle = view.action === "remove" || view.action === "cancel" ? styles.quietText : styles.primaryText;
  const icon = view.action === "remove" ? "people" : view.action === "cancel" ? "time-outline" : view.action === "accept" ? "checkmark" : "person-add-outline";
  return (
    <View style={styles.row}>
      <Pressable onPress={() => run(view.action)} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.button, primaryStyle, pressed && styles.pressed, busy && styles.busy]} testID="friend-button">
        <Ionicons name={icon} color={view.action === "remove" || view.action === "cancel" ? colors.white : colors.black} size={16} />
        <Body style={textStyle}>{busy ? "…" : view.label}</Body>
      </Pressable>
      {view.secondary ? (
        <Pressable onPress={() => run(view.secondary!.action)} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.button, styles.quiet, pressed && styles.pressed]} testID="friend-button-secondary">
          <Body style={styles.quietText}>{view.secondary.label}</Body>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  button: { alignItems: "center", borderRadius: 7, flexDirection: "row", gap: 7, minHeight: 38, paddingHorizontal: 12, paddingVertical: 8 },
  primary: { backgroundColor: colors.gold },
  primaryText: { color: colors.black, fontWeight: "900" },
  quiet: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  quietText: { color: colors.white, fontWeight: "800" },
  pressed: { opacity: 0.75 },
  busy: { opacity: 0.6 },
});
