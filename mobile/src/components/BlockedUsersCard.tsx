import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { errorMessage } from "../lib/api";
import { listBlocked, unblockUser, type BlockedEntry } from "../lib/moderation";
import { colors } from "../theme";
import { Card } from "./Card";
import { Body, Heading, Muted } from "./Text";

// Blockierte Benutzer (#414): dieselbe Liste wie auf der Website unter Privatsphäre; „Freigeben“
// hebt die Blockierung auf. Ohne Einträge ein ruhiger Satz statt einer leeren Karte.

export function BlockedUsersCard({ style }: { style?: object }) {
  const [entries, setEntries] = useState<BlockedEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setEntries(await listBlocked());
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Blockierte Benutzer konnten nicht geladen werden."));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const release = async (entry: BlockedEntry) => {
    const id = entry.blocked_id || entry.user?.id;
    if (!id || busy) return;
    setBusy(id);
    try {
      await unblockUser(id);
      setEntries((current) => current.filter((item) => (item.blocked_id || item.user?.id) !== id));
    } catch (err) {
      setError(errorMessage(err, "Blockierung konnte nicht aufgehoben werden."));
    } finally {
      setBusy("");
    }
  };

  return (
    <Card style={style} testID="blocked-users">
      <Heading>Blockierte Benutzer</Heading>
      <Muted>Blockierte Personen können dir keine Direktnachrichten und Freundschaftsanfragen schicken – und du ihnen nicht.</Muted>
      {error ? <Muted style={styles.error}>{error}</Muted> : null}
      {loaded && !entries.length && !error ? <Muted testID="blocked-users-empty">Du hast niemanden blockiert.</Muted> : null}
      {entries.map((entry) => {
        const id = entry.blocked_id || entry.user?.id || "";
        return (
          <View key={id} style={styles.row} testID={`blocked-user-${id}`}>
            <View style={styles.flex}>
              <Body style={styles.name}>{entry.user?.display_name || entry.user?.username || "Benutzer"}</Body>
              {entry.user?.username ? <Muted>@{entry.user.username}</Muted> : null}
            </View>
            <Pressable onPress={() => { void release(entry); }} disabled={Boolean(busy)} accessibilityRole="button" style={({ pressed }) => [styles.release, pressed && styles.pressed]} testID={`blocked-user-release-${id}`}>
              <Muted style={styles.releaseText}>{busy === id ? "..." : "Freigeben"}</Muted>
            </Pressable>
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 10,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontWeight: "900",
  },
  release: {
    borderColor: "rgba(41, 182, 232, 0.4)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  releaseText: {
    color: colors.cyan,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.72,
  },
  error: {
    color: colors.live,
  },
});
