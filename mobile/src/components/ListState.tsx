import React, { useEffect, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
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

type EmptyTone = "cyan" | "gold" | "danger";

export function EmptyState({
  detail,
  icon,
  title,
  tone = "cyan",
}: {
  detail?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  tone?: EmptyTone;
}) {
  const accent = tone === "danger" ? colors.live : tone === "gold" ? colors.gold : colors.cyan;
  return (
    <View style={styles.center}>
      {icon ? (
        <View style={[styles.iconBadge, { borderColor: accent }]}>
          <Ionicons name={icon} color={accent} size={22} />
        </View>
      ) : null}
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
    gap: 9,
    paddingHorizontal: 18,
    paddingVertical: 28,
  },
  iconBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  emptyTitle: {
    fontWeight: "800",
    textAlign: "center",
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
