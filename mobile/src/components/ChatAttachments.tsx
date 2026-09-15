import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";
import { getThumbnailAsync } from "expo-video-thumbnails";
import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import {
  MAX_CHAT_ATTACHMENTS,
  attachmentKindForAsset,
  authorizedSource,
  canSendChatMessage,
  readyAttachmentIds,
  tooLargeMessage,
  uploadPartForAsset,
  type AttachmentKind,
  type ChatAttachmentDraft,
  type PickedAsset,
} from "../lib/chatAttachments";
import { colors } from "../theme";
import type { ChatAttachment } from "../types";
import { Muted } from "./Text";

const UPLOAD_TIMEOUT_MS = 120_000;

function newLocalId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Anhänge für die nächste Nachricht. Jede ausgewählte Datei wird sofort
 * hochgeladen; beim Senden gehen nur die Kennungen mit.
 */
export function useChatAttachmentDrafts() {
  const [drafts, setDrafts] = useState<ChatAttachmentDraft[]>([]);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const update = useCallback((localId: string, patch: Partial<ChatAttachmentDraft>) => {
    setDrafts((rows) => rows.map((row) => (row.localId === localId ? { ...row, ...patch } : row)));
  }, []);

  const upload = useCallback(async (localId: string, asset: PickedAsset, kind: AttachmentKind) => {
    try {
      const form = new FormData();
      form.append("file", uploadPartForAsset(asset, kind) as unknown as Blob);
      if (kind === "video") {
        try {
          // Das Standbild entsteht auf dem Gerät; der Server hat kein ffmpeg.
          const thumbnail = await getThumbnailAsync(asset.uri, { time: 1000, quality: 0.7 });
          update(localId, { previewUri: thumbnail.uri });
          form.append("poster", { uri: thumbnail.uri, name: "vorschau.jpg", type: "image/jpeg" } as unknown as Blob);
        } catch {
          // Ohne Standbild bleibt das Video trotzdem ein brauchbares Video.
        }
      }
      const { data } = await api.post<ChatAttachment>("/chat-attachments", form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: UPLOAD_TIMEOUT_MS,
      });
      update(localId, { status: "ready", attachment: data });
    } catch (error) {
      update(localId, { status: "error", error: errorMessage(error, "Hochladen fehlgeschlagen.") });
    }
  }, [update]);

  const addAssets = useCallback((assets: PickedAsset[]) => {
    let free = MAX_CHAT_ATTACHMENTS - draftsRef.current.filter((draft) => draft.status !== "error").length;
    const added: ChatAttachmentDraft[] = [];
    for (const asset of assets) {
      const localId = newLocalId();
      const name = asset.fileName || "Anhang";
      const kind = attachmentKindForAsset(asset);
      if (!kind) {
        added.push({ localId, kind: "unknown", name, previewUri: null, status: "error", error: "Nur Bilder und Videos." });
        continue;
      }
      const tooLarge = tooLargeMessage(asset, kind);
      if (tooLarge || free <= 0) {
        added.push({ localId, kind, name, previewUri: null, status: "error", error: tooLarge || `Höchstens ${MAX_CHAT_ATTACHMENTS} Anhänge.` });
        continue;
      }
      free -= 1;
      added.push({ localId, kind, name, previewUri: kind === "image" ? asset.uri : null, status: "uploading" });
      void upload(localId, asset, kind);
    }
    setDrafts((rows) => [...rows, ...added]);
  }, [upload]);

  const pick = useCallback(async () => {
    const free = MAX_CHAT_ATTACHMENTS - draftsRef.current.filter((draft) => draft.status !== "error").length;
    if (free <= 0) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: free,
      orderedSelection: true,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.length) return;
    addAssets(result.assets);
  }, [addAssets]);

  const remove = useCallback((localId: string) => {
    setDrafts((rows) => rows.filter((row) => row.localId !== localId));
  }, []);

  const reset = useCallback(() => setDrafts([]), []);

  return {
    drafts,
    pick,
    addAssets,
    remove,
    reset,
    attachmentIds: readyAttachmentIds(drafts),
    uploading: drafts.some((draft) => draft.status === "uploading"),
    canSend: (text: string) => canSendChatMessage(text, drafts),
  };
}

export function AttachButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityLabel="Bild oder Video anhängen"
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.attach, pressed && styles.pressed, disabled && styles.disabled]}
      testID="chat-attach"
    >
      <Ionicons name="image-outline" size={22} color={colors.cyan} />
    </Pressable>
  );
}

export function AttachmentDraftsRow({ drafts, onRemove }: { drafts: ChatAttachmentDraft[]; onRemove: (localId: string) => void }) {
  if (!drafts.length) return null;
  const errors = [...new Set(drafts.filter((draft) => draft.status === "error").map((draft) => draft.error))];
  return (
    <View style={styles.draftsWrap} testID="chat-attachment-drafts">
      <View style={styles.draftsRow}>
        {drafts.map((draft) => (
          <View key={draft.localId} style={[styles.draft, draft.status === "error" && styles.draftError]}>
            {draft.previewUri ? (
              <Image source={{ uri: draft.previewUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : (
              <Ionicons name={draft.kind === "video" ? "film-outline" : "alert-circle-outline"} size={22} color={colors.muted} />
            )}
            {draft.status === "uploading" ? (
              <View style={styles.draftOverlay} accessibilityLabel="Wird hochgeladen">
                <ActivityIndicator color={colors.cyan} />
              </View>
            ) : null}
            <Pressable
              accessibilityLabel={`${draft.name} entfernen`}
              hitSlop={8}
              onPress={() => onRemove(draft.localId)}
              style={styles.draftRemove}
            >
              <Ionicons name="close" size={14} color={colors.white} />
            </Pressable>
          </View>
        ))}
      </View>
      {errors.length ? <Muted style={styles.errorText}>{errors.join(" ")}</Muted> : null}
    </View>
  );
}

export function MessageAttachments({ attachments }: { attachments?: ChatAttachment[] | null }) {
  const { accessToken } = useAuth();
  const [open, setOpen] = useState<ChatAttachment | null>(null);
  const items = attachments ?? [];
  if (!items.length) return null;
  const several = items.length > 1;
  return (
    <View style={styles.grid} testID="chat-message-attachments">
      {items.map((item) => (
        <AttachmentTile key={item.id} item={item} token={accessToken} small={several} onOpen={() => setOpen(item)} />
      ))}
      <AttachmentViewer item={open} token={accessToken} onClose={() => setOpen(null)} />
    </View>
  );
}

/**
 * Eine Kachel je Anhang. Lädt das Bild nicht, steht das dran - vorher blieb
 * die Kachel einfach schwarz, und niemand sah, ob es 404, 401 oder ein
 * Decoder-Fehler war (#238). Ein Tipp versucht es noch einmal.
 */
function AttachmentTile({ item, token, small, onOpen }: { item: ChatAttachment; token: string | null; small: boolean; onOpen: () => void }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const preview = item.kind === "video"
    ? authorizedSource(item.poster_url, token)
    : authorizedSource(item.url, token, 800);
  const failed = state === "error";
  return (
    <Pressable
      accessibilityLabel={failed ? "Bild erneut laden" : item.kind === "video" ? "Video abspielen" : "Bild öffnen"}
      accessibilityRole="imagebutton"
      onPress={() => {
        if (failed) {
          setState("loading");
          setError("");
          setAttempt((count) => count + 1);
          return;
        }
        onOpen();
      }}
      style={[styles.tile, small && styles.tileSmall]}
    >
      {preview && !failed ? (
        <Image
          key={attempt}
          source={preview}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          testID={`chat-attachment-image-${item.id}`}
          onLoad={() => setState("ready")}
          onError={(event) => {
            setState("error");
            setError(String(event?.nativeEvent?.error || "").slice(0, 80));
          }}
        />
      ) : null}
      {!preview ? <Ionicons name="film-outline" size={28} color={colors.muted} /> : null}
      {preview && state === "loading" ? (
        <View style={styles.tileState} accessibilityLabel="Bild wird geladen">
          <ActivityIndicator color={colors.cyan} />
        </View>
      ) : null}
      {failed ? (
        <View style={styles.tileState} testID={`chat-attachment-error-${item.id}`}>
          <Ionicons name="image-outline" size={22} color={colors.muted} />
          <Muted style={styles.tileStateText} numberOfLines={2}>Bild konnte nicht geladen werden{error ? ` (${error})` : ""}. Tippen zum Wiederholen.</Muted>
        </View>
      ) : null}
      {item.kind === "video" && !failed ? (
        <View style={styles.playBadge}>
          <Ionicons name="play" size={20} color={colors.white} />
        </View>
      ) : null}
    </Pressable>
  );
}

function AttachmentViewer({ item, token, onClose }: { item: ChatAttachment | null; token: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={Boolean(item)}>
      <View style={styles.viewer}>
        {item?.kind === "video" ? (
          <VideoAttachmentPlayer item={item} token={token} />
        ) : item ? (
          <Image source={authorizedSource(item.url, token, 1600) ?? undefined} style={styles.viewerImage} resizeMode="contain" />
        ) : null}
        <Pressable
          accessibilityLabel="Schließen"
          accessibilityRole="button"
          hitSlop={10}
          onPress={onClose}
          style={[styles.viewerClose, { top: insets.top + 12 }]}
        >
          <Ionicons name="close" size={26} color={colors.white} />
        </Pressable>
      </View>
    </Modal>
  );
}

function VideoAttachmentPlayer({ item, token }: { item: ChatAttachment; token: string | null }) {
  const player = useVideoPlayer(authorizedSource(item.url, token) as VideoSource, (instance) => {
    instance.play();
  });
  return <VideoView player={player} style={styles.viewerVideo} nativeControls contentFit="contain" />;
}

export function attachmentErrorText(error: unknown) {
  return errorMessage(error, "Hochladen fehlgeschlagen.");
}

const styles = StyleSheet.create({
  attach: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  disabled: {
    opacity: 0.45,
  },
  draft: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 56,
    justifyContent: "center",
    overflow: "hidden",
    width: 56,
  },
  draftError: {
    borderColor: colors.live,
  },
  draftOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
  },
  draftRemove: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 10,
    height: 20,
    justifyContent: "center",
    position: "absolute",
    right: 2,
    top: 2,
    width: 20,
  },
  draftsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  draftsWrap: {
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  errorText: {
    color: colors.live,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  playBadge: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  pressed: {
    opacity: 0.72,
  },
  tile: {
    alignItems: "center",
    backgroundColor: colors.black,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 160,
    justifyContent: "center",
    overflow: "hidden",
    width: 220,
  },
  tileSmall: {
    height: 108,
    width: 108,
  },
  tileState: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    backgroundColor: colors.surface,
    gap: 6,
    justifyContent: "center",
    padding: 8,
  },
  tileStateText: {
    fontSize: 11,
    textAlign: "center",
  },
  viewer: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.94)",
    flex: 1,
    justifyContent: "center",
  },
  viewerClose: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    position: "absolute",
    right: 16,
    width: 44,
  },
  viewerImage: {
    height: "100%",
    width: "100%",
  },
  viewerVideo: {
    height: "70%",
    width: "100%",
  },
});
