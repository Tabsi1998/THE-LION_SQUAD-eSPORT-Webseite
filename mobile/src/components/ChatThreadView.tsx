import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, errorMessage } from "../lib/api";
import { continuesMessageGroup, formatChatTime } from "../lib/format";
import type { ContentTarget } from "../lib/contentLinks";
import { colors } from "../theme";
import type { ChatMessage } from "../types";
import { resourceFromPath } from "../realtime/liveChanges";
import { useLiveRefresh } from "../realtime/LiveChangesProvider";
import { AttachButton, AttachmentDraftsRow, MessageAttachments, useChatAttachmentDrafts } from "./ChatAttachments";
import { MessageSticker, StickerButton, StickerPicker } from "./ChatStickers";
import type { CatalogSticker } from "../lib/stickers";
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
  /** Lange auf eine fremde Nachricht drücken: melden (#414). */
  onReportMessage?: (message: ChatMessage) => void;
  /** Die ganze Antwort des Servers - für Direktnachrichten mit Gegenüber und Blockier-Stand. */
  onData?: (data: unknown) => void;
  /** Ändert sich der Wert, lädt der Chat neu - etwa nach Blockieren oder Freigeben. */
  refreshToken?: number;
};

// Außerhalb der Komponente, damit sie über alle Renderdurchläufe dieselben
// bleiben. Als Standardwert im Parameter entstand bei jedem Rendern eine neue
// Funktion, damit ein neues load - und der Effekt lud sofort wieder: Team- und
// Turnierchat fragten den Server ohne Pause ab.
const allMessages = (data: unknown) => (Array.isArray(data) ? data as ChatMessage[] : []);
const alwaysAllowed = () => true;

export function ChatThreadView({
  listUrl,
  postUrl,
  currentUserId,
  emptyTitle,
  lockedDetail,
  extractMessages = allMessages,
  canSend = alwaysAllowed,
  mentionSearchUrl,
  onOpenProfile,
  onReportMessage,
  onData,
  refreshToken = 0,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [mentionCandidates, setMentionCandidates] = useState<Array<{ id: string; username?: string; display_name?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [allowed, setAllowed] = useState(true);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const nearBottomRef = useRef(true);
  const didInitialScroll = useRef(false);
  const composerBottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 8 : 10);
  const attachments = useChatAttachmentDrafts();
  const [stickersOpen, setStickersOpen] = useState(false);

  const scrollToLatest = useCallback((animated = false) => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated }));
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get(listUrl);
      setMessages(extractMessages(data));
      setAllowed(canSend(data));
      onData?.(data);
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
  }, [canSend, extractMessages, listUrl, lockedDetail, onData, scrollToLatest]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);
  // /messages/direct/... -> messages, /teams/.../chat -> teams, /tournaments/.../chat -> tournaments
  const liveResources = useMemo(() => [resourceFromPath(listUrl)], [listUrl]);
  useLiveRefresh(load, liveResources, { fallbackMs: 7000 });

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
    if (!attachments.canSend(message) || sending || !allowed) return;
    setSending(true);
    try {
      const { data } = await api.post<ChatMessage>(postUrl, { message, attachment_ids: attachments.attachmentIds });
      setMessages((items) => [...items, data]);
      setText("");
      attachments.reset();
      nearBottomRef.current = true;
      setTimeout(() => scrollToLatest(true), 50);
    } catch (err) {
      setError(errorMessage(err, "Nachricht konnte nicht gesendet werden."));
    } finally {
      setSending(false);
    }
  }, [allowed, attachments, postUrl, scrollToLatest, sending, text]);

  const sendSticker = useCallback(async (sticker: CatalogSticker) => {
    if (sending || !allowed) return;
    setStickersOpen(false);
    setSending(true);
    try {
      const { data } = await api.post<ChatMessage>(postUrl, { sticker_id: sticker.id });
      setMessages((items) => [...items, data]);
      nearBottomRef.current = true;
      setTimeout(() => scrollToLatest(true), 50);
    } catch (err) {
      setError(errorMessage(err, "Sticker konnte nicht gesendet werden."));
    } finally {
      setSending(false);
    }
  }, [allowed, postUrl, scrollToLatest, sending]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    nearBottomRef.current = distanceFromBottom < 96;
  }, []);

  if (loading) return <SkeletonList count={5} hasImage={false} />;

  // Liste und Eingabezeile stehen untereinander in einem Block. Öffnet sich die
  // Tastatur, bekommt der Block unten genau so viel Abstand, wie die Tastatur
  // ihn wirklich überdeckt - automaticOffset misst dafür die Lage am Bildschirm,
  // Tab-Leiste und Safe-Area spielen keine Rolle. Vorher schob eine
  // KeyboardStickyView nur die Eingabezeile um die volle Tastaturhöhe nach oben;
  // in der Tab-Ansicht endet der Bildschirm aber über der Tab-Leiste, die Zeile
  // schwebte darüber, und die Liste lief unter ihr weiter (#210).
  return (
    <KeyboardAvoidingView behavior="padding" automaticOffset style={styles.wrap}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroller}
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        onContentSizeChange={() => {
          if (!didInitialScroll.current || nearBottomRef.current) scrollToLatest(false);
        }}
        onLayout={() => {
          // Die Liste wird kleiner, wenn die Tastatur kommt: unten bleiben.
          if (nearBottomRef.current) scrollToLatest(false);
        }}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        {error ? <Muted style={styles.error}>{error}</Muted> : null}
        {messages.length ? messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            grouped={continuesMessageGroup(messages[index - 1], message)}
            onOpenProfile={onOpenProfile}
            onReport={onReportMessage}
            own={message.user_id === currentUserId || message.sender_id === currentUserId}
          />
        )) : <EmptyState title={emptyTitle} detail={allowed ? "Schreibe die erste Nachricht." : lockedDetail || error} />}
      </ScrollView>
      <View style={styles.composerDock}>
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
        <AttachmentDraftsRow drafts={attachments.drafts} onRemove={attachments.remove} />
        <View style={[styles.composer, { paddingBottom: composerBottomInset }]}>
          <AttachButton disabled={!allowed || sending} onPress={() => { void attachments.pick(); }} />
          <StickerButton disabled={!allowed || sending} onPress={() => setStickersOpen(true)} />
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
          <Pressable disabled={!attachments.canSend(text) || sending || !allowed} onPress={send} style={[styles.send, (!attachments.canSend(text) || sending || !allowed) && styles.disabled]}>
            <Body style={styles.sendText}>Senden</Body>
          </Pressable>
        </View>
      </View>
      <StickerPicker visible={stickersOpen} onClose={() => setStickersOpen(false)} onPick={(sticker) => { void sendSticker(sticker); }} />
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message, own, grouped, onOpenProfile, onReport }: {
  message: ChatMessage;
  own: boolean;
  /** Folgt kurz auf eine Nachricht desselben Absenders: kein eigener Kopf. */
  grouped: boolean;
  onOpenProfile?: (username: string) => void;
  onReport?: (message: ChatMessage) => void;
}) {
  const author = message.author || message.sender;
  const name = own ? "Du" : author?.display_name || author?.username || "Spieler";
  const openContent = useCallback((target: ContentTarget) => {
    if (target.type === "profile" && onOpenProfile) onOpenProfile(target.id);
  }, [onOpenProfile]);
  // Fremde Nachrichten lassen sich mit langem Druck melden (#414); eigene nicht.
  const reportable = Boolean(onReport && !own);
  return (
    <Pressable
      onLongPress={reportable ? () => onReport?.(message) : undefined}
      delayLongPress={350}
      disabled={!reportable}
      accessibilityHint={reportable ? "Lange drücken, um die Nachricht zu melden" : undefined}
      style={[styles.bubble, own && styles.bubbleOwn, grouped && styles.bubbleGrouped]}
      testID={`chat-message-${message.id}`}
    >
      {grouped ? null : (
        <View style={styles.bubbleHead}>
          <Body
            onPress={() => {
              if (author?.username && onOpenProfile) onOpenProfile(author.username);
            }}
            style={[styles.author, own && styles.ownText]}
          >
            {name}
          </Body>
          {message.created_at ? <Muted style={own && styles.ownMuted}>{formatChatTime(message.created_at)}</Muted> : null}
        </View>
      )}
      {message.message ? (
        <View style={own && styles.ownRichText}>
          <RichText text={message.message} compact onOpenContent={openContent} />
        </View>
      ) : null}
      <MessageAttachments attachments={message.attachments} />
      <MessageSticker sticker={message.sticker} />
    </Pressable>
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
  bubbleGrouped: {
    marginTop: -6,
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
