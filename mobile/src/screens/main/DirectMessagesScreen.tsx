import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { formatDate } from "../../lib/format";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { DirectConversation } from "../../types";

type Props = NativeStackScreenProps<MoreStackParamList, "DirectMessages">;

export function DirectMessagesScreen({ navigation }: Props) {
  const [items, setItems] = useState<DirectConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<DirectConversation[]>("/messages/conversations");
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(errorMessage(err, "Nachrichten konnten nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", load);
    load();
    return unsubscribe;
  }, [load, navigation]);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Muted>Community</Muted>
          <Title>Nachrichten</Title>
          <Muted>Direkte Unterhaltungen mit Spielern, Freunden und Teammitgliedern.</Muted>
        </View>
        {loading ? <LoadingState /> : null}
        {error ? <Muted style={styles.error}>{error}</Muted> : null}
        {!loading && !items.length ? <EmptyState title="Keine Nachrichten" detail="Neue Chats entstehen, sobald du einem Profil eine Nachricht schreibst." /> : null}
        {items.map((item) => {
          const name = item.user.display_name || item.user.username || "Spieler";
          return (
            <Pressable
              key={item.user.id}
              onPress={() => navigation.navigate("DirectThread", { userId: item.user.id, title: name })}
            >
              <Card style={[styles.row, item.unread_count ? styles.unread : null]}>
                <View style={styles.avatar}>
                  <MediaImage
                    uri={item.user.avatar_url}
                    style={styles.avatarImage}
                    fallback={<Body style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Body>}
                  />
                </View>
                <View style={styles.main}>
                  <View style={styles.rowHead}>
                    <Heading style={styles.name}>{name}</Heading>
                    {item.unread_count ? <Body style={styles.badge}>{item.unread_count}</Body> : null}
                  </View>
                  <Muted numberOfLines={2}>{item.latest_message?.message || item.message_hint || "Unterhaltung öffnen"}</Muted>
                  {item.latest_message?.created_at ? <Muted>{formatDate(item.latest_message.created_at)}</Muted> : null}
                </View>
              </Card>
            </Pressable>
          );
        })}
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
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  unread: {
    borderColor: "rgba(41,182,232,0.5)",
  },
  avatar: {
    height: 46,
    width: 46,
  },
  avatarImage: {
    borderRadius: 8,
    height: "100%",
    width: "100%",
  },
  avatarText: {
    fontWeight: "900",
  },
  main: {
    flex: 1,
    gap: 4,
  },
  rowHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  name: {
    flex: 1,
    fontSize: 17,
  },
  badge: {
    backgroundColor: colors.cyan,
    borderRadius: 10,
    color: colors.black,
    fontSize: 12,
    fontWeight: "900",
    minWidth: 22,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 2,
    textAlign: "center",
  },
  error: {
    color: colors.live,
  },
});
