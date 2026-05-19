import React, { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import { colors } from "../theme";
import type { ChatMessage } from "../types";
import { EmptyState, LoadingState } from "./ListState";
import { RichText } from "./RichText";
import { Body, Muted } from "./Text";

type Props = {
  listUrl: string;
  postUrl: string;
  currentUserId?: string;
  emptyTitle: string;
  lockedDetail?: string;
  extractMessages?: (data: unknown) => ChatMessage[];
  canSend?: (data: unknown) => boolean;
};

export function ChatThreadView({
  listUrl,
  postUrl,
  currentUserId,
  emptyTitle,
  lockedDetail,
  extractMessages = (data) => (Array.isArray(data) ? data as ChatMessage[] : []),
  canSend = () => true,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get(listUrl);
      setMessages(extractMessages(data));
      setAllowed(canSend(data));
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 0);
    } catch (err) {
      setAllowed(false);
      setError(errorMessage(err, lockedDetail || "Chat konnte nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, [canSend, extractMessages, listUrl, lockedDetail]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 7000);
    return () => clearInterval(timer);
  }, [load]);

  const send = useCallback(async () => {
    const message = text.trim();
    if (!message || sending || !allowed) return;
    setSending(true);
    try {
      const { data } = await api.post<ChatMessage>(postUrl, { message });
      setMessages((items) => [...items, data]);
      setText("");
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (err) {
      setError(errorMessage(err, "Nachricht konnte nicht gesendet werden."));
    } finally {
      setSending(false);
    }
  }, [allowed, postUrl, sending, text]);

  if (loading) return <LoadingState label="Chat wird geladen ..." />;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.messages}>
        {error ? <Muted style={styles.error}>{error}</Muted> : null}
        {messages.length ? messages.map((message) => (
          <MessageBubble key={message.id} message={message} own={message.user_id === currentUserId || message.sender_id === currentUserId} />
        )) : <EmptyState title={emptyTitle} detail={allowed ? "Schreibe die erste Nachricht." : lockedDetail || error} />}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput
          editable={allowed && !sending}
          multiline
          onChangeText={setText}
          placeholder={allowed ? "Nachricht schreiben ..." : "Chat nicht verfügbar"}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={text}
        />
        <Pressable disabled={!text.trim() || sending || !allowed} onPress={send} style={[styles.send, (!text.trim() || sending || !allowed) && styles.disabled]}>
          <Body style={styles.sendText}>Senden</Body>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message, own }: { message: ChatMessage; own: boolean }) {
  const author = message.author || message.sender;
  const name = own ? "Du" : author?.display_name || author?.username || "Spieler";
  return (
    <View style={[styles.bubble, own && styles.bubbleOwn]}>
      <View style={styles.bubbleHead}>
        <Body style={[styles.author, own && styles.ownText]}>{name}</Body>
        {message.created_at ? <Muted style={own && styles.ownMuted}>{formatDate(message.created_at)}</Muted> : null}
      </View>
      <View style={own && styles.ownRichText}>
        <RichText text={message.message} compact />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  messages: {
    gap: 10,
    padding: 18,
    paddingBottom: 14,
  },
  bubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: "88%",
    padding: 10,
  },
  bubbleOwn: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(41, 182, 232, 0.18)",
    borderColor: "rgba(41, 182, 232, 0.4)",
  },
  bubbleHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 3,
  },
  author: {
    color: colors.cyan,
    fontWeight: "900",
  },
  ownText: {
    color: colors.white,
  },
  ownRichText: {
    opacity: 0.98,
  },
  ownMuted: {
    color: "rgba(255,255,255,0.68)",
  },
  composer: {
    alignItems: "flex-end",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.white,
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  send: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14,
  },
  sendText: {
    color: colors.black,
    fontWeight: "900",
  },
  disabled: {
    opacity: 0.45,
  },
  error: {
    color: colors.live,
  },
});
