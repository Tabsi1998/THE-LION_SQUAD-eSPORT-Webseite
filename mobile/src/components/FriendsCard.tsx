import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "./Card";
import { MediaImage } from "./MediaImage";
import { Body, Heading, Muted } from "./Text";
import { api, errorMessage } from "../lib/api";
import { emptyFriends, friendLabel, friendRequest, normalizeFriends, type FriendRow, type FriendsPayload } from "../lib/friends";
import { useLiveRefresh } from "../realtime/LiveChangesProvider";
import { colors } from "../theme";

// Freunde (#240) in der Profil-Übersicht: offene Anfragen oben mit Annehmen/Ablehnen, darunter
// die Liste; gesendete Anfragen lassen sich zurückziehen. Kommt live über den Änderungsstrom.

export function FriendsCard({ onOpenProfile }: { onOpenProfile: (username: string) => void }) {
  const [data, setData] = useState<FriendsPayload>(emptyFriends());
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: payload } = await api.get<Partial<FriendsPayload>>("/friends");
      setData(normalizeFriends(payload));
    } catch {
      setData(emptyFriends());
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["friends", "notifications"], { fallbackMs: 60000 });

  const act = async (row: FriendRow, action: "accept" | "decline" | "cancel" | "remove") => {
    if (!row.user || busyId) return;
    if (action === "remove") {
      const ok = await new Promise<boolean>((resolve) => Alert.alert("Freund entfernen?", `${friendLabel(row.user)} wird aus deiner Freundesliste entfernt.`, [
        { text: "Abbrechen", style: "cancel", onPress: () => resolve(false) },
        { text: "Entfernen", style: "destructive", onPress: () => resolve(true) },
      ]));
      if (!ok) return;
    }
    const request = friendRequest(action, row.user.id, row.id);
    if (!request) return;
    setBusyId(row.id);
    try {
      if (request.method === "post") await api.post(request.path);
      else await api.delete(request.path);
      await load();
    } catch (err) {
      Alert.alert("Das hat nicht geklappt", errorMessage(err, "Die Änderung konnte nicht gespeichert werden."));
    } finally {
      setBusyId("");
    }
  };

  const friends = expanded ? data.friends : data.friends.slice(0, 6);
  return (
    <Card style={styles.card} testID="friends-card">
      <View style={styles.head}>
        <Heading>Freunde{loaded ? ` (${data.friends.length})` : ""}</Heading>
        {data.incoming.length ? <View style={styles.badge}><Body style={styles.badgeText}>{data.incoming.length} offen</Body></View> : null}
      </View>
      {data.incoming.map((row) => (
        <View key={row.id} style={styles.row} testID={`friend-incoming-${row.id}`}>
          <Person row={row} onPress={() => row.user?.username && onOpenProfile(row.user.username)} hint="möchte dich als Freund" />
          <View style={styles.actions}>
            <Pressable onPress={() => act(row, "accept")} disabled={busyId === row.id} accessibilityRole="button" style={[styles.action, styles.accept]} testID={`friend-accept-${row.id}`}>
              <Ionicons name="checkmark" color={colors.black} size={18} />
            </Pressable>
            <Pressable onPress={() => act(row, "decline")} disabled={busyId === row.id} accessibilityRole="button" style={[styles.action, styles.decline]} testID={`friend-decline-${row.id}`}>
              <Ionicons name="close" color={colors.white} size={18} />
            </Pressable>
          </View>
        </View>
      ))}
      {data.outgoing.map((row) => (
        <View key={row.id} style={styles.row} testID={`friend-outgoing-${row.id}`}>
          <Person row={row} onPress={() => row.user?.username && onOpenProfile(row.user.username)} hint="Anfrage gesendet" />
          <Pressable onPress={() => act(row, "cancel")} disabled={busyId === row.id} accessibilityRole="button" style={[styles.action, styles.decline]} testID={`friend-cancel-${row.id}`}>
            <Ionicons name="close" color={colors.white} size={18} />
          </Pressable>
        </View>
      ))}
      {loaded && !data.friends.length && !data.incoming.length && !data.outgoing.length ? (
        <Muted>Noch keine Freunde. Auf einem Spielerprofil „Freund hinzufügen“ antippen.</Muted>
      ) : null}
      {friends.map((row) => (
        <View key={row.id} style={styles.row} testID={`friend-${row.id}`}>
          <Person row={row} onPress={() => row.user?.username && onOpenProfile(row.user.username)} />
          <Pressable onPress={() => act(row, "remove")} disabled={busyId === row.id} accessibilityRole="button" accessibilityLabel="Freund entfernen" style={[styles.action, styles.quiet]} testID={`friend-remove-${row.id}`}>
            <Ionicons name="person-remove-outline" color={colors.muted} size={16} />
          </Pressable>
        </View>
      ))}
      {data.friends.length > 6 ? (
        <Pressable onPress={() => setExpanded((value) => !value)} accessibilityRole="button" style={styles.more}>
          <Body style={styles.moreText}>{expanded ? "Weniger anzeigen" : `Alle ${data.friends.length} anzeigen`}</Body>
        </Pressable>
      ) : null}
    </Card>
  );
}

function Person({ row, onPress, hint }: { row: FriendRow; onPress: () => void; hint?: string }) {
  const label = friendLabel(row.user);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.person, pressed && styles.pressed]}>
      <MediaImage uri={row.user?.avatar_url} style={styles.avatar} fallback={<Body style={styles.avatarText}>{label.slice(0, 1).toUpperCase()}</Body>} />
      <View style={styles.personText}>
        <Body style={styles.name}>{label}</Body>
        <Muted>{hint || (row.user?.username ? `@${row.user.username}` : "")}</Muted>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  head: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  badge: { backgroundColor: colors.gold, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { color: colors.black, fontSize: 12, fontWeight: "900" },
  row: { alignItems: "center", flexDirection: "row", gap: 10 },
  person: { alignItems: "center", flex: 1, flexDirection: "row", gap: 10 },
  personText: { flex: 1 },
  name: { fontWeight: "800" },
  avatar: { backgroundColor: colors.surface, borderRadius: 18, height: 36, overflow: "hidden", width: 36 },
  avatarText: { color: colors.cyan, fontWeight: "900", textAlign: "center" },
  actions: { flexDirection: "row", gap: 6 },
  action: { alignItems: "center", borderRadius: 8, height: 36, justifyContent: "center", width: 36 },
  accept: { backgroundColor: colors.gold },
  decline: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  quiet: { backgroundColor: "transparent" },
  more: { alignItems: "center", paddingVertical: 6 },
  moreText: { color: colors.cyan, fontWeight: "900" },
  pressed: { opacity: 0.75 },
});
