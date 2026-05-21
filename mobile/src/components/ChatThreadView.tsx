import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import type { ContentTarget } from "../lib/contentLinks";
import { colors } from "../theme";
import type { ChatMessage } from "../types";
import { EmptyState, SkeletonList } from "./ListState";
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
  mentionSearchUrl?: string;
  onOpenProfile?: (username: string) => void;
};

export function ChatThreadView({
  listUrl,
  postUrl,
  currentUserId,
  emptyTitle,
  lockedDetail,
  extractMessages = (data) => (Array.isArray(data) ? data as ChatMessage[] : []),
  canSend = () => true,
  mentionSearchUrl,
  onOpenProfile,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [mentionCandidates, setMentionCandidates] = useState<Array<{ id: string; username?: string; display_name?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState(true);
  const [composerHeight, setComposerHeight] = useState(88);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const nearBottomRef = useRef(true);
  const didInitialScroll = useRef(false);
  const composerBottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 8 : 10);

  const scrollToLatest = useCallback((animated = false) => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated }));
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get(listUrl);
      setMessages(extractMessages(data));
      setAllowed(canSend(data));
      if (!didInitialScroll.current || nearBottomRef.current) {
        scrollToLatest(false);
        didInitialScroll.current = true;
      }
    } catch (err) {
      setAllowed(false);
      setError(errorMessage(err, lockedDetail || "Chat konnte nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, [canSend, extractMessages, listUrl, lockedDetail, scrollToLatest]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 7000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const onShow = () => {
      if (nearBottomRef.current) scrollToLatest(true);
      setTimeout(() => {
        if (nearBottomRef.current) scrollToLatest(true);
      }, 120);
    };
    const onHide = () => {
      if (nearBottomRef.current) scrollToLatest(false);
    };
    const showSub = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", onShow);
    const changeSub = Platform.OS === "ios" ? Keyboard.addListener("keyboardWillChangeFrame", onShow) : undefined;
    const hideSub = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", onHide);
    return () => {
      showSub.remove();
      changeSub?.remove();
      hideSub.remove();
    };
  }, [scrollToLatest]);

  useEffect(() => {
    if (!mentionSearchUrl) {
      setMentionCandidates([]);
      return undefined;
    }
    const query = mentionQuery(text);
    if (!query || query.length < 2) {
      setMentionCandidates([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const separator = mentionSearchUrl.includes("?") ? "&" : "?";
        const { data } = await api.get(`${mentionSearchUrl}${separator}q=${encodeURIComponent(query)}`);
        setMentionCandidates(Array.isArray(data) ? data : []);
      } catch {
        setMentionCandidates([]);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [mentionSearchUrl, text]);

  const send = useCallback(async () => {
    const message = text.trim();
    if (!message || sending || !allowed) return;
    setSending(true);
    try {
      const { data } = await api.post<ChatMessage>(postUrl, { message });
      setMessages((items) => [...items, data]);
      setText("");
      nearBottomRef.current = true;
      setTimeout(() => scrollToLatest(true), 50);
    } catch (err) {
      setError(errorMessage(err, "Nachricht konnte nicht gesendet werden."));
    } finally {
      setSending(false);
    }
  }, [allowed, postUrl, scrollToLatest, sending, text]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    nearBottomRef.current = distanceFromBottom < 96;
  }, []);

  if (loading) return <SkeletonList count={5} hasImage={false} />;

  return (
    <View style={styles.wrap}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroller}
        contentContainerStyle={[styles.messages, { paddingBottom: composerHeight + 18 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        onContentSizeChange={() => {
          if (!didInitialScroll.current || nearBottomRef.current) scrollToLatest(false);
        }}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {error ? <Muted style={styles.error}>{error}</Muted> : null}
        {messages.length ? messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onOpenProfile={onOpenProfile}
            own={message.user_id === currentUserId || message.sender_id === currentUserId}
          />
        )) : <EmptyState title={emptyTitle} detail={allowed ? "Schreibe die erste Nachricht." : lockedDetail || error} />}
      </ScrollView>
      <KeyboardStickyView
        offset={{ closed: 0, opened: 0 }}
        onLayout={(event) => setComposerHeight(Math.ceil(event.nativeEvent.layout.height))}
        style={styles.composerDock}
      >
        {mentionCandidates.length ? (
          <View style={styles.suggestions}>
            {mentionCandidates.map((candidate) => (
              <Pressable key={candidate.id} onPress={() => {
                if (!candidate.username) return;
                setText((current) => current.replace(/(^|\s)@([A-Za-z0-9_.-]{1,32})$/, `$1@${candidate.username} `));
                setMentionCandidates([]);
              }} style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}>
                <Body style={styles.author}>{candidate.display_name || candidate.username}</Body>
                {candidate.username ? <Muted>@{candidate.username}</Muted> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={[styles.composer, { paddingBottom: composerBottomInset }]}>
          <TextInput
            editable={allowed && !sending}
            multiline
            onChangeText={setText}
            placeholder={allowed ? "Nachricht schreiben ..." : "Chat nicht verfügbar"}
            placeholderTextColor={colors.muted}
            style={styles.input}
            onFocus={() => {
              nearBottomRef.current = true;
              setTimeout(() => scrollToLatest(true), 80);
              setTimeout(() => scrollToLatest(true), 260);
            }}
            onSubmitEditing={() => {
              if (!text.includes("\n")) Keyboard.dismiss();
            }}
            value={text}
          />
          <Pressable disabled={!text.trim() || sending || !allowed} onPress={send} style={[styles.send, (!text.trim() || sending || !allowed) && styles.disabled]}>
            <Body style={styles.sendText}>Senden</Body>
          </Pressable>
        </View>
      </KeyboardStickyView>
    </View>
  );
}

function MessageBubble({ message, own, onOpenProfile }: { message: ChatMessage; own: boolean; onOpenProfile?: (username: string) => void }) {
  const author = message.author || message.sender;
  const name = own ? "Du" : author?.display_name || author?.username || "Spieler";
  const openContent = useCallback((target: ContentTarget) => {
    if (target.type === "profile" && onOpenProfile) onOpenProfile(target.id);
  }, [onOpenProfile]);
  return (
    <View style={[styles.bubble, own && styles.bubbleOwn]}>
      <View style={styles.bubbleHead}>
        <Body
          onPress={() => {
            if (author?.username && onOpenProfile) onOpenProfile(author.username);
          }}
          style={[styles.author, own && styles.ownText]}
        >
          {name}
        </Body>
        {message.created_at ? <Muted style={own && styles.ownMuted}>{formatDate(message.created_at)}</Muted> : null}
      </View>
      <View style={own && styles.ownRichText}>
        <RichText text={message.message} compact onOpenContent={openContent} />
      </View>
    </View>
  );
}

function mentionQuery(value: string) {
  const match = value.match(/(^|\s)@([A-Za-z0-9_.-]{1,32})$/);
  return match?.[2] || "";
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  scroller: {
    flex: 1,
  },
  messages: {
    gap: 10,
    padding: 18,
    paddingBottom: 14,
  },
  composerDock: {
    backgroundColor: colors.black,
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
  suggestions: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderTopWidth: 1,
    gap: 6,
    padding: 10,
  },
  suggestion: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
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
  pressed: {
    opacity: 0.72,
  },
  error: {
    color: colors.live,
  },
});
