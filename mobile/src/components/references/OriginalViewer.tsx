import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, FlatList, Linking, Modal, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { resolveMediaUrl } from "../../lib/api";
import { originalLabel, originalSrc, originalsButtonLabel, sourceLink, viewerWidth, type OriginalItem } from "../../lib/referenceOriginals";
import { colors } from "../../theme";
import { Button } from "../Button";
import { MediaImage } from "../MediaImage";
import { useReduceMotion } from "../motion";
import { Body, Muted } from "../Text";
import { ZoomableImage } from "../ZoomableImage";
import { ink } from "./parts";

// „Original ansehen“ (#1933) in der App, wie im Web (OriginalViewer.jsx): die Bilder des Veranstalters zu einem Termin
// im Vollbild. Wischen blättert (ohne Zoom), zwei Finger zoomen und verschieben (ZoomableImage, auf Android und iOS
// gleich), Pfeile und die Vorschauleiste unten springen zu einem Bild, „Schließen“ oder Zurück schließt. Der Vorleser
// hört bei jedem Bild „Bild 2 von 3: Rennen“. Bilder kommen nur von der öffentlichen Adresse des eigenen Servers; der
// Quellen-Link öffnet sich nur als https. Mit „Bewegung reduzieren“ blendet nichts ein und blättert ohne Gleiten.

const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };

function labelOf(item: OriginalItem): string {
  return item.label || originalLabel(item);
}

/** Vollbild mit allen Bildern; `start`: das zuerst gezeigte. */
export function OriginalViewer({ items, start = 0, title = "", visible, onClose }: {
  items: OriginalItem[];
  start?: number;
  title?: string;
  visible: boolean;
  onClose: () => void;
}) {
  const reduce = useReduceMotion();
  // Ränder des Geräts (Kamera-Loch, Gestenleiste) - ohne Rahmen der App (etwa im Test) einfach null.
  const insets = useContext(SafeAreaInsetsContext) || NO_INSETS;
  const count = items.length;
  const first = Math.min(Math.max(start, 0), Math.max(0, count - 1));
  const [index, setIndex] = useState(first);
  const [zoomed, setZoomed] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const list = useRef<FlatList<OriginalItem>>(null);
  const item = items[index] || items[0];

  // Beim Öffnen wieder beim Startbild.
  useEffect(() => {
    if (visible) setIndex(first);
  }, [visible, first]);

  // Der Vorleser hört, welches Bild jetzt zu sehen ist.
  useEffect(() => {
    if (!visible || !item) return;
    AccessibilityInfo.announceForAccessibility?.(`Bild ${index + 1} von ${count}: ${labelOf(item)}`);
  }, [visible, index, count, item]);

  const show = useCallback((next: number) => {
    if (!count) return;
    const target = (next + count) % count;
    setIndex(target);
    setZoomed(false);
    list.current?.scrollToIndex?.({ index: target, animated: !reduce });
  }, [count, reduce]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setSize((now) => (now && now.width === width && now.height === height ? now : { width, height }));
  };

  if (!item) return null;
  const source = sourceLink(item);
  return (
    <Modal visible={visible} onRequestClose={onClose} animationType={reduce ? "none" : "fade"} statusBarTranslucent supportedOrientations={["portrait", "landscape"]}>
      <View
        style={[styles.root, { paddingBottom: Math.max(14, insets.bottom), paddingTop: Math.max(12, insets.top) }]}
        accessibilityViewIsModal
        accessibilityLabel={title ? `Original-Bilder: ${title}` : "Original-Bilder"}
        testID="original-viewer"
      >
        <View style={styles.header}>
          <View style={styles.flex}>
            {title ? <Muted style={styles.title} numberOfLines={1}>{title}</Muted> : null}
            <Body style={styles.label} numberOfLines={1} testID="original-viewer-label">{labelOf(item)}</Body>
          </View>
          {count > 1 ? <Muted style={styles.count} testID="original-viewer-count">{`${index + 1} / ${count}`}</Muted> : null}
          <IconButton icon="close" label="Schließen" onPress={onClose} testID="original-viewer-close" />
        </View>

        <View style={styles.stage} onLayout={onLayout} testID="original-viewer-stage">
          {size ? (
            <FlatList
              ref={list}
              data={items}
              horizontal
              pagingEnabled
              scrollEnabled={!zoomed && count > 1}
              initialScrollIndex={first}
              getItemLayout={(_, position) => ({ length: size.width, offset: size.width * position, index: position })}
              keyExtractor={(entry, position) => String(entry.id || position)}
              onMomentumScrollEnd={(event) => {
                const next = Math.round(event.nativeEvent.contentOffset.x / size.width);
                if (next >= 0 && next < count) setIndex(next);
                setZoomed(false);
              }}
              showsHorizontalScrollIndicator={false}
              renderItem={({ item: entry, index: position }) => (
                <View style={{ width: size.width, height: size.height }} testID={`original-viewer-slide-${position}`}>
                  <ZoomableImage
                    uri={resolveMediaUrl(originalSrc(entry.url, viewerWidth(entry)))}
                    width={size.width}
                    height={size.height}
                    active={position === index}
                    label={`Original des Veranstalters: ${labelOf(entry)}`}
                    onTap={() => undefined}
                    onZoomChange={(value) => {
                      if (position === index) setZoomed(value);
                    }}
                    testID={`original-viewer-image-${position}`}
                  />
                </View>
              )}
            />
          ) : null}
          {count > 1 ? (
            <>
              <IconButton icon="chevron-back" label="Voriges Bild" onPress={() => show(index - 1)} style={[styles.nav, styles.navPrev]} testID="original-viewer-prev" />
              <IconButton icon="chevron-forward" label="Nächstes Bild" onPress={() => show(index + 1)} style={[styles.nav, styles.navNext]} testID="original-viewer-next" />
            </>
          ) : null}
        </View>

        <View style={styles.footer}>
          {source ? (
            <Pressable
              onPress={() => { Linking.openURL(source).catch(() => {}); }}
              accessibilityRole="link"
              accessibilityLabel="Quelle beim Veranstalter, öffnet im Browser"
              hitSlop={8}
              style={({ pressed }) => [styles.source, pressed && styles.pressed]}
              testID="original-viewer-source"
            >
              <Muted style={styles.sourceText}>Quelle beim Veranstalter</Muted>
              <Ionicons name="open-outline" size={13} color={colors.cyan} />
            </Pressable>
          ) : null}
          {count > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs} accessibilityLabel="Alle Bilder" testID="original-viewer-thumbs">
              {items.map((entry, position) => {
                const on = position === index;
                return (
                  <Pressable
                    key={String(entry.id || position)}
                    onPress={() => show(position)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Bild ${position + 1}: ${labelOf(entry)}`}
                    style={({ pressed }) => [styles.thumb, on && styles.thumbOn, pressed && styles.pressed]}
                    testID={`original-viewer-thumb-${position}`}
                  >
                    <MediaImage uri={originalSrc(entry.url, 160)} width={160} style={styles.thumbImage} />
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function IconButton({ icon, label, onPress, style, testID }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [styles.icon, style, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons name={icon} size={24} color={ink.text} />
    </Pressable>
  );
}

/** Knopf „Original ansehen“ - nur, wenn es öffentliche Bilder gibt (ein älterer Server schickt keine). */
export function OriginalsButton({ items, title = "", style, testID = "originals-open" }: {
  items: OriginalItem[] | null | undefined;
  title?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const list = items || [];
  if (!list.length) return null;
  return (
    <>
      <Button
        label={list.length > 1 ? `Original ansehen (${list.length})` : "Original ansehen"}
        accessibilityLabel={originalsButtonLabel(list.length)}
        variant="quiet"
        compact
        icon="images-outline"
        arrow={false}
        onPress={() => setOpen(true)}
        style={[styles.button, style]}
        testID={testID}
      />
      {open ? <OriginalViewer items={list} title={title} visible onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: "#000000", flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  header: { alignItems: "center", flexDirection: "row", gap: 12, paddingBottom: 8, paddingHorizontal: 16 },
  title: { color: "rgba(255,255,255,0.55)", fontSize: 12 },
  label: { color: ink.text, fontSize: 15, fontWeight: "800" },
  count: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontVariant: ["tabular-nums"] },
  icon: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  stage: { flex: 1, justifyContent: "center", minHeight: 0 },
  nav: { position: "absolute", top: "50%", marginTop: -22, backgroundColor: "rgba(0,0,0,0.55)" },
  navPrev: { left: 8 },
  navNext: { right: 8 },
  footer: { alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 10 },
  source: { alignItems: "center", flexDirection: "row", gap: 6, minHeight: 32 },
  sourceText: { color: colors.cyan, fontSize: 12 },
  thumbs: { gap: 8, paddingHorizontal: 4 },
  thumb: { borderColor: "transparent", borderRadius: 4, borderWidth: 2, opacity: 0.6, overflow: "hidden" },
  thumbOn: { borderColor: colors.cyan, opacity: 1 },
  thumbImage: { borderWidth: 0, height: 40, width: 64 },
  button: { alignSelf: "flex-start" },
  pressed: { opacity: 0.72 },
});
