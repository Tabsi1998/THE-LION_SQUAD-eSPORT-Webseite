import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { searchStickers, stickerSource, type CatalogSticker, type StickerPack } from "../lib/stickers";
import { colors } from "../theme";
import type { ChatSticker } from "../types";
import { Body, Muted } from "./Text";

// Ein Katalog für alle Chats der App. Beim Öffnen wird er trotzdem neu geholt,
// damit ein frisch angelegtes Paket ohne Neustart erscheint.
let cachedPacks: StickerPack[] | null = null;

export function StickerButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityLabel="Sticker"
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}
      testID="chat-stickers"
    >
      <Ionicons name="happy-outline" size={22} color={colors.cyan} />
    </Pressable>
  );
}

/** Auswahl von unten. Ein Tipp sendet den Sticker sofort, wie im Messenger. */
export function StickerPicker({ visible, onClose, onPick }: {
  visible: boolean;
  onClose: () => void;
  onPick: (sticker: CatalogSticker) => void;
}) {
  const insets = useSafeAreaInsets();
  const [packs, setPacks] = useState<StickerPack[] | null>(cachedPacks);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [activePackId, setActivePackId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    api.get<{ packs?: StickerPack[] }>("/stickers")
      .then(({ data }) => {
        if (cancelled) return;
        cachedPacks = Array.isArray(data?.packs) ? data.packs : [];
        setPacks(cachedPacks);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled && !cachedPacks) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const list = packs ?? [];
  const activePack = list.find((pack) => pack.id === activePackId) ?? list[0];
  const searching = Boolean(query.trim());
  const visibleStickers = searching ? searchStickers(list, query) : activePack?.stickers ?? [];

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="Sticker schließen" onPress={onClose} style={styles.backdrop} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} testID="chat-sticker-picker">
          <View style={styles.sheetHead}>
            <TextInput
              accessibilityLabel="Sticker suchen"
              onChangeText={setQuery}
              placeholder="Sticker suchen, z. B. Pokal"
              placeholderTextColor={colors.muted}
              style={styles.search}
              testID="chat-sticker-search"
              value={query}
            />
            <Pressable accessibilityLabel="Schließen" accessibilityRole="button" hitSlop={8} onPress={onClose} style={styles.close}>
              <Ionicons name="close" size={22} color={colors.white} />
            </Pressable>
          </View>
          {!searching && list.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.packs} keyboardShouldPersistTaps="handled">
              {list.map((pack) => {
                const selected = pack.id === activePack?.id;
                return (
                  <Pressable
                    key={pack.id}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    onPress={() => setActivePackId(pack.id)}
                    style={[styles.packChip, selected && styles.packChipActive]}
                  >
                    <Body style={[styles.packLabel, selected && styles.packLabelActive]}>{pack.name}</Body>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          <ScrollView contentContainerStyle={styles.grid} keyboardShouldPersistTaps="handled">
            {visibleStickers.map((sticker) => (
              <Pressable
                key={sticker.id}
                accessibilityLabel={`Sticker ${sticker.name} senden`}
                accessibilityRole="button"
                onPress={() => onPick(sticker)}
                style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
                testID={`chat-sticker-${sticker.id}`}
              >
                <Image source={stickerSource(sticker.url) ?? undefined} style={styles.cellImage} resizeMode="contain" />
              </Pressable>
            ))}
          </ScrollView>
          {packs === null && !failed ? <ActivityIndicator color={colors.cyan} style={styles.status} /> : null}
          {failed ? <Muted style={[styles.status, styles.errorText]}>Sticker konnten nicht geladen werden.</Muted> : null}
          {packs !== null && searching && !visibleStickers.length ? (
            <Muted style={styles.status}>Kein Sticker passt zu „{query.trim()}“.</Muted>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export function MessageSticker({ sticker }: { sticker?: ChatSticker | null }) {
  const source = stickerSource(sticker?.url);
  if (!sticker || !source) return null;
  return (
    <Image
      accessibilityLabel={`Sticker: ${sticker.name}`}
      resizeMode="contain"
      source={source}
      style={styles.messageSticker}
      testID="chat-message-sticker"
    />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  button: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  cell: {
    alignItems: "center",
    borderRadius: 8,
    height: 72,
    justifyContent: "center",
    padding: 6,
    width: "25%",
  },
  cellImage: {
    height: "100%",
    width: "100%",
  },
  close: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  disabled: {
    opacity: 0.45,
  },
  errorText: {
    color: colors.live,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  messageSticker: {
    height: 112,
    marginTop: 4,
    width: 112,
  },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  packChip: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  packChipActive: {
    backgroundColor: "rgba(41, 182, 232, 0.14)",
    borderColor: "rgba(41, 182, 232, 0.6)",
  },
  packLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
  },
  packLabelActive: {
    color: colors.cyan,
  },
  packs: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pressed: {
    opacity: 0.72,
  },
  search: {
    backgroundColor: colors.black,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.white,
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    maxHeight: "65%",
    paddingTop: 12,
  },
  sheetHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
  },
  status: {
    paddingVertical: 18,
    textAlign: "center",
  },
});
