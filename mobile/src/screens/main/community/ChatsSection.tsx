import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from "react-native";
import { useChats } from "../../../chats/ChatsContext";
import { MediaImage } from "../../../components/MediaImage";
import { EmptyState, SkeletonList } from "../../../components/ListState";
import { SignInRequired } from "../../../components/SignInRequired";
import { useTabScrollToTop } from "../../../components/TabHeader";
import { Body, Muted } from "../../../components/Text";
import { api } from "../../../lib/api";
import { badgeText, chatTarget, chatTime, type ChatItem } from "../../../lib/chats";
import { colors } from "../../../theme";

// Community → Chats (#1148): Direktnachrichten, Team-, Turnier- und Match-Chats in einer Liste, das Neueste oben, mit der
// Zahl der Ungelesenen. Ein Tipp öffnet den Chat selbst über dem Tab. „Neue Nachricht“ sucht eine Person.

type Navigation = { navigate: (screen: never, params?: never) => void };

const KIND_ICON: Record<ChatItem["kind"], keyof typeof Ionicons.glyphMap> = {
  direct: "person-outline",
  team: "people-outline",
  tournament: "trophy-outline",
  match: "game-controller-outline",
};

export function ChatsSection({ navigation, guest }: { navigation: Navigation; guest: boolean }) {
  const { list, loading, error, reload } = useChats();
  const [refreshing, setRefreshing] = useState(false);
  const [composing, setComposing] = useState(false);
  const listRef = useRef<FlatList<ChatItem>>(null);
  useTabScrollToTop(listRef);

  useEffect(() => {
    if (!guest) void reload();
  }, [guest, reload]);

  if (guest) {
    return (
      <View style={styles.padded}>
        <SignInRequired text="Chats gibt es mit einem Konto – mit Spielern, Freunden, deinem Team und im Turnier." testID="chats-sign-in" />
      </View>
    );
  }

  const open = (item: ChatItem) => {
    const target = chatTarget(item);
    navigation.navigate(target.screen as never, target.params as never);
  };

  return (
    <FlatList
      ref={listRef}
      data={list.items}
      keyExtractor={(item) => item.key}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} tintColor={colors.cyan} />}
      ListHeaderComponent={error ? <Muted style={styles.error}>{error}</Muted> : null}
      ListEmptyComponent={loading ? <SkeletonList count={4} hasImage={false} /> : (
        <EmptyState icon="chatbubbles-outline" title="Noch keine Chats" detail="Schreib jemandem über „Neue Nachricht“ oder aus seinem Profil. Team- und Turnier-Chats erscheinen hier von selbst." />
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => <ChatRow item={item} onPress={() => open(item)} />}
      ListFooterComponent={
        <View style={styles.footer}>
          {composing ? (
            <NewMessage onPick={(userId, title) => { setComposing(false); navigation.navigate("DirectThread" as never, { userId, title } as never); }} onClose={() => setComposing(false)} />
          ) : (
            <Pressable onPress={() => setComposing(true)} accessibilityRole="button" style={({ pressed }) => [styles.newButton, pressed && styles.pressed]} testID="chats-new">
              <Ionicons name="add" color={colors.cyan} size={18} />
              <Body style={styles.newText}>Neue Nachricht</Body>
            </Pressable>
          )}
        </View>
      }
    />
  );
}

function ChatRow({ item, onPress }: { item: ChatItem; onPress: () => void }) {
  const unread = Number(item.unread_count || 0);
  const preview = item.last_message?.text
    ? `${item.subtitle}${item.last_message.author && item.kind !== "direct" ? ` · ${item.last_message.author}` : ""}: ${item.last_message.text}`
    : `${item.subtitle} · Noch keine Nachricht`;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${item.title}, ${item.subtitle}${unread ? `, ${unread} ungelesen` : ""}`} style={({ pressed }) => [styles.row, pressed && styles.pressed]} testID={`chat-${item.key}`}>
      <View style={[styles.avatar, item.kind === "tournament" && styles.avatarGold]}>
        {item.image ? (
          <MediaImage uri={item.image} style={styles.avatarImage} fallback={<Ionicons name={KIND_ICON[item.kind]} color={colors.cyan} size={18} />} />
        ) : item.kind === "direct" || item.kind === "team" ? (
          <Body style={styles.initials}>{initials(item.tag || item.title)}</Body>
        ) : (
          <Ionicons name={KIND_ICON[item.kind]} color={item.kind === "tournament" ? colors.gold : colors.cyan} size={18} />
        )}
      </View>
      <View style={styles.main}>
        <Body style={[styles.title, unread ? styles.titleUnread : null]} numberOfLines={1}>{item.title}</Body>
        <Muted numberOfLines={1}>{preview}</Muted>
      </View>
      <View style={styles.side}>
        <Muted style={[styles.time, unread ? styles.timeUnread : null]}>{chatTime(item.updated_at)}</Muted>
        {unread ? (
          <View style={styles.badge} testID={`chat-${item.key}-unread`}>
            <Body style={styles.badgeText}>{badgeText(unread)}</Body>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function initials(value: string) {
  const words = value.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

type Person = { id: string; username?: string; display_name?: string; avatar_url?: string | null; can_message?: boolean; message_hint?: string };

/** „Neue Nachricht“: ab zwei Buchstaben Personen suchen, denen man schreiben darf (dieselbe Suche wie im Web). */
function NewMessage({ onPick, onClose }: { onPick: (userId: string, title: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setPeople([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.get<Person[]>("/messages/users", { params: { q: trimmed } })
        .then(({ data }) => { if (!cancelled) setPeople(Array.isArray(data) ? data.slice(0, 8) : []); })
        .catch(() => { if (!cancelled) setPeople([]); });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);
  return (
    <View style={styles.compose} testID="chats-compose">
      <View style={styles.composeBar}>
        <Ionicons name="search-outline" color={colors.cyan} size={16} />
        <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Name suchen" placeholderTextColor={colors.muted} style={styles.composeInput} testID="chats-compose-input" />
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Schließen" hitSlop={8}>
          <Ionicons name="close" color={colors.muted} size={18} />
        </Pressable>
      </View>
      {people.map((person) => {
        const name = person.display_name || person.username || "Spieler";
        return (
          <Pressable key={person.id} disabled={person.can_message === false} onPress={() => onPick(person.id, name)} accessibilityRole="button" style={({ pressed }) => [styles.person, pressed && styles.pressed]} testID={`chats-compose-${person.id}`}>
            <Body style={styles.title}>{name}</Body>
            <Muted numberOfLines={1}>{person.can_message === false ? person.message_hint || "Nimmt gerade keine Nachrichten an." : `@${person.username || ""}`}</Muted>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  padded: {
    paddingHorizontal: 18,
  },
  content: {
    paddingBottom: 28,
    paddingHorizontal: 18,
  },
  error: {
    color: colors.live,
    paddingBottom: 8,
  },
  separator: {
    backgroundColor: colors.border,
    height: 1,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    paddingVertical: 10,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: "rgba(41,182,232,0.14)",
    borderRadius: 10,
    height: 42,
    justifyContent: "center",
    overflow: "hidden",
    width: 42,
  },
  avatarGold: {
    backgroundColor: "rgba(255,215,0,0.12)",
  },
  avatarImage: {
    height: 42,
    width: 42,
  },
  initials: {
    color: colors.cyan,
    fontSize: 13,
    fontWeight: "900",
  },
  main: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontWeight: "800",
  },
  titleUnread: {
    color: colors.white,
    fontWeight: "900",
  },
  side: {
    alignItems: "flex-end",
    gap: 6,
    minWidth: 44,
  },
  time: {
    fontSize: 12,
  },
  timeUnread: {
    color: colors.cyan,
  },
  badge: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 10,
    minWidth: 20,
    paddingHorizontal: 5,
  },
  badgeText: {
    color: colors.black,
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 18,
  },
  footer: {
    paddingTop: 16,
  },
  newButton: {
    alignItems: "center",
    borderColor: "rgba(41,182,232,0.45)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 46,
  },
  newText: {
    color: colors.cyan,
    fontWeight: "800",
  },
  compose: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 10,
  },
  composeBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 40,
  },
  composeInput: {
    color: colors.white,
    flex: 1,
    fontSize: 15,
  },
  person: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 2,
    paddingVertical: 8,
  },
  pressed: {
    opacity: 0.72,
  },
});
