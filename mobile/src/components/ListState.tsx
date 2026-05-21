import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, StyleSheet, View } from "react-native";
import { colors } from "../theme";
import { Body, Muted } from "./Text";

export function LoadingState({ label = "Lade Daten ..." }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.cyan} />
      <Muted>{label}</Muted>
    </View>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.center}>
      <Body style={styles.emptyTitle}>{title}</Body>
      {detail ? <Muted style={styles.detail}>{detail}</Muted> : null}
    </View>
  );
}

/**
 * SkeletonCard – animierter Platzhalter für Listeneinträge während des Ladens.
 * Verwendung: <SkeletonCard hasImage /> oder <SkeletonCard lines={2} />
 */
export function SkeletonCard({ hasImage = true, lines = 3 }: { hasImage?: boolean; lines?: number }) {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View style={[skeletonStyles.card, { opacity }]}>
      {hasImage && <View style={skeletonStyles.image} />}
      <View style={skeletonStyles.body}>
        {Array.from({ length: lines }).map((_, i) => (
          <View
            key={i}
            style={[
              skeletonStyles.line,
              i === 0 && skeletonStyles.lineTitle,
              i === lines - 1 && skeletonStyles.lineShort,
            ]}
          />
        ))}
      </View>
    </Animated.View>
  );
}

/**
 * SkeletonList – zeigt n SkeletonCards als Platzhalter.
 */
export function SkeletonList({ count = 4, hasImage = true }: { count?: number; hasImage?: boolean }) {
  const items = Array.from({ length: count });
  return (
    <View style={{ gap: 12, paddingTop: 8 }}>
      {items.map((_, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <React.Fragment key={i}>
          <SkeletonCard hasImage={hasImage} />
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 28,
  },
  emptyTitle: {
    fontWeight: "800",
  },
  detail: {
    textAlign: "center",
  },
});

const skeletonStyles = StyleSheet.create({
  card: {
    backgroundColor: "#1A1A1A",
    borderRadius: 8,
    overflow: "hidden",
  },
  image: {
    backgroundColor: "#2A2A2A",
    height: 138,
    width: "100%",
  },
  body: {
    gap: 8,
    padding: 14,
  },
  line: {
    backgroundColor: "#2A2A2A",
    borderRadius: 4,
    height: 12,
    width: "90%",
  },
  lineTitle: {
    height: 16,
    width: "75%",
  },
  lineShort: {
    width: "50%",
  },
});
