import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useNotifications } from "../../notifications/NotificationContext";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { UserNotification } from "../../types";

type Props = NativeStackScreenProps<MoreStackParamList, "Notifications">;

export function NotificationsScreen({ navigation }: Props) {
  const [items, setItems] = useState<UserNotification[]>([]);
  const { load: loadLiveNotifications, markAllRead: markAllLiveRead, markRead: markLiveRead } = useNotifications();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<UserNotification[]>("/admin/notifications");
      setItems(Array.isArray(data) ? data : []);
      await loadLiveNotifications();
    } catch (err) {
      setError(errorMessage(err, "Benachrichtigungen konnten nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, [loadLiveNotifications]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", load);
    load();
    const timer = setInterval(load, 15000);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [load, navigation]);

  const markAllRead = useCallback(async () => {
    await api.post("/admin/notifications/read-all");
    await markAllLiveRead();
    await load();
  }, [load, markAllLiveRead]);

  const markRead = useCallback(async (item: UserNotification) => {
    if (!item.read) {
      await api.post(`/admin/notifications/${item.id}/read`);
      await markLiveRead(item);
      setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, read: true } : row));
    }
  }, [markLiveRead]);

  const unread = useMemo(() => items.filter((item) => !item.read).length, [items]);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Muted>LionsAPP</Muted>
          <Title>Benachrichtigungen</Title>
          <Muted>{unread ? `${unread} ungelesen` : "Alles gelesen"}</Muted>
        </View>
        {items.length ? <Button label="Alle als gelesen markieren" onPress={markAllRead} variant="secondary" /> : null}
        {loading ? <LoadingState /> : null}
        {error ? <Muted style={styles.error}>{error}</Muted> : null}
        {!loading && !items.length ? <EmptyState title="Keine Benachrichtigungen" detail="Erinnerungen, Mentions, Nachrichten und Match-Updates erscheinen hier." /> : null}
        {items.map((item) => (
          <Pressable key={item.id} onPress={() => markRead(item)}>
            <Card style={[styles.note, !item.read && styles.unread]}>
              <View style={styles.noteHead}>
                <Heading style={styles.noteTitle}>{item.title}</Heading>
                {!item.read ? <View style={styles.dot} /> : null}
              </View>
              {item.body ? <Body>{item.body}</Body> : null}
              <View style={styles.meta}>
                {item.kind ? <Muted style={styles.kind}>{item.kind}</Muted> : null}
                {item.created_at ? <Muted>{formatDateTime(item.created_at)}</Muted> : null}
              </View>
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
    padding: 18,
    paddingBottom: 30,
  },
  header: {
    gap: 4,
  },
  note: {
    gap: 8,
  },
  unread: {
    borderColor: "rgba(41,182,232,0.5)",
  },
  noteHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  noteTitle: {
    flex: 1,
    fontSize: 17,
  },
  dot: {
    backgroundColor: colors.cyan,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  meta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  kind: {
    color: colors.cyan,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  error: {
    color: colors.live,
  },
});
