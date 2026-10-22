import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { colors, roles, surfaces } from "../theme";
import { Body } from "./Text";

// Reiterleiste zum Wischen (#1969, Ergänzung zur App im Issue): bis zu `fit` Reiter (Vorgabe vier - so viele fassen 390
// Punkte) teilen sich die Breite wie bisher. Sind es mehr, wird die Leiste wischbar: jeder Reiter gleich breit, der
// nächste schaut halb herein, sie rastet je Reiter ein (Snap), es gibt keine sichtbare Scrollleiste, und an dem Rand, an
// dem es weitergeht, blendet ein weicher Verlauf aus. Der gewählte Reiter rückt beim Tippen ins Bild.

export type SwipeTab<K extends string> = { key: K; label: string };

/** Wie breit ein Reiter ist: alle passen nebeneinander (null) - oder fest, damit der nächste halb hereinschaut. */
export function swipeTabWidth(count: number, width: number, fit = 4): number | null {
  if (count <= fit || width <= 0) return null;
  return Math.floor(width / (fit + 0.5));
}

/** Welche Ränder einen Verlauf zeigen: links, sobald gewischt wurde; rechts, solange noch etwas folgt. */
export function swipeEdges(offset: number, viewport: number, content: number): { start: boolean; end: boolean } {
  return { start: offset > 1, end: offset + viewport < content - 1 };
}

const FADE = 28;

function EdgeFade({ side, color }: { side: "start" | "end"; color: string }) {
  const id = `swipe-fade-${side}`;
  return (
    <View pointerEvents="none" style={[styles.fade, side === "start" ? styles.fadeStart : styles.fadeEnd]} testID={id}>
      <Svg width={FADE} height="100%">
        <Defs>
          <LinearGradient id={id} x1={side === "start" ? "1" : "0"} y1="0" x2={side === "start" ? "0" : "1"} y2="0">
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset="1" stopColor={color} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={FADE} height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/**
 * Eine waagrechte Leiste mit eigenen Reitern oder Chips (unterschiedlich breit, etwa „Rennen 20:30“ oder Streckennamen),
 * die überlaufen kann: wie bei SwipeTabs ohne sichtbare Scrollleiste, mit weichem Verlauf an dem Rand, an dem es
 * weitergeht. Passt alles hinein, gibt es keinen Verlauf.
 */
export function FadeScroll({ children, background = surfaces.base, style, contentContainerStyle, accessibilityRole, accessibilityLabel, testID }: {
  children: React.ReactNode;
  background?: string;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  accessibilityRole?: "tablist";
  accessibilityLabel?: string;
  testID?: string;
}) {
  const [edges, setEdges] = useState({ start: false, end: false });
  const size = useRef({ offset: 0, viewport: 0, content: 0 });
  const update = useCallback(() => {
    const next = swipeEdges(size.current.offset, size.current.viewport, size.current.content);
    setEdges((now) => (now.start === next.start && now.end === next.end ? now : next));
  }, []);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    size.current = { offset: contentOffset.x, viewport: layoutMeasurement.width, content: contentSize.width };
    update();
  }, [update]);
  return (
    <View style={style} accessibilityRole={accessibilityRole} accessibilityLabel={accessibilityLabel} testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={contentContainerStyle}
        onLayout={(event) => { size.current.viewport = event.nativeEvent.layout.width; update(); }}
        onContentSizeChange={(width) => { size.current.content = width; update(); }}
        onScroll={onScroll}
        scrollEventThrottle={32}
        testID={testID ? `${testID}-scroll` : undefined}
      >
        {children}
      </ScrollView>
      {edges.start ? <EdgeFade side="start" color={background} /> : null}
      {edges.end ? <EdgeFade side="end" color={background} /> : null}
    </View>
  );
}

export function SwipeTabs<K extends string>({ items, active, onChange, fit = 4, background = surfaces.base, accessibilityLabel, style, testID }: {
  items: Array<SwipeTab<K>>;
  active: K;
  onChange: (key: K) => void;
  fit?: number;
  /** Farbe, in die der Verlauf am Rand ausblendet - der Grund hinter der Leiste. */
  background?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const [width, setWidth] = useState(0);
  const [edges, setEdges] = useState({ start: false, end: true });
  const scroller = useRef<ScrollView>(null);
  const tabWidth = swipeTabWidth(items.length, width, fit);
  const content = tabWidth ? tabWidth * items.length : 0;

  const onLayout = useCallback((event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width), []);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const next = swipeEdges(contentOffset.x, layoutMeasurement.width, contentSize.width);
    setEdges((now) => (now.start === next.start && now.end === next.end ? now : next));
  }, []);

  // Der gewählte Reiter rückt ins Bild (etwa beim Öffnen direkt auf „Statistik“).
  const index = items.findIndex((item) => item.key === active);
  useEffect(() => {
    if (!tabWidth || index < 0) return;
    const target = Math.max(0, Math.min(content - width, index * tabWidth - tabWidth / 2));
    scroller.current?.scrollTo?.({ x: target, animated: true });
  }, [content, index, tabWidth, width]);

  const tabs = items.map((item) => {
    const on = item.key === active;
    return (
      <Pressable
        key={item.key}
        onPress={() => onChange(item.key)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={item.label}
        style={({ pressed }) => [styles.tab, tabWidth ? { width: tabWidth } : styles.tabFlex, on && styles.tabOn, pressed && styles.pressed]}
        testID={testID ? `${testID}-${item.key}` : undefined}
      >
        <Body style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>{item.label}</Body>
      </Pressable>
    );
  });

  return (
    <View style={[styles.bar, style]} onLayout={onLayout} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} testID={testID}>
      {tabWidth ? (
        <>
          <ScrollView
            ref={scroller}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={tabWidth}
            decelerationRate="fast"
            onScroll={onScroll}
            scrollEventThrottle={32}
            testID={testID ? `${testID}-scroll` : undefined}
          >
            {tabs}
          </ScrollView>
          {edges.start ? <EdgeFade side="start" color={background} /> : null}
          {edges.end ? <EdgeFade side="end" color={background} /> : null}
        </>
      ) : (
        <View style={styles.row}>{tabs}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomColor: "rgba(255,255,255,0.08)", borderBottomWidth: 1 },
  row: { flexDirection: "row" },
  tab: { alignItems: "center", borderBottomColor: "transparent", borderBottomWidth: 2, justifyContent: "center", minHeight: 48, paddingHorizontal: 4 },
  tabFlex: { flex: 1 },
  tabOn: { borderBottomColor: colors.cyan },
  tabText: { color: roles.quiet, fontSize: 14, fontWeight: "700" },
  tabTextOn: { color: colors.white },
  pressed: { opacity: 0.72 },
  fade: { bottom: 0, position: "absolute", top: 0, width: FADE },
  fadeStart: { left: 0 },
  fadeEnd: { right: 0 },
});
