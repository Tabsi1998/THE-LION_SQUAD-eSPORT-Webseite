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

export function ErrorState({ title = "Fehler beim Laden", detail }: { title?: string; detail?: string }) {
  return <EmptyState icon="alert-circle-outline" title={title} detail={detail} tone="danger" />;
}

export function OfflineNotice({
  detail = "Du siehst gespeicherte Daten. Ziehe zum Aktualisieren, sobald dein Netz wieder stabil ist.",
}: {
  detail?: string;
}) {
  return (
    <View style={styles.notice}>
      <View style={styles.noticeIcon}>
        <Ionicons name="cloud-offline-outline" color={colors.gold} size={18} />
      </View>
      <View style={styles.noticeText}>
        <Body style={styles.noticeTitle}>Offline-Modus</Body>
        <Muted>{detail}</Muted>
      </View>
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
  notice: {
    alignItems: "center",
    backgroundColor: "rgba(255, 215, 0, 0.08)",
    borderColor: "rgba(255, 215, 0, 0.24)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12,
  },
  noticeIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255, 215, 0, 0.12)",
    borderRadius: 8,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  noticeText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  noticeTitle: {
    color: colors.gold,
    fontWeight: "900",
  },
});

const skeletonStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  image: {
    backgroundColor: "rgba(255, 255, 255, 0.07)",
    height: 138,
    width: "100%",
  },
  body: {
    gap: 8,
    padding: 14,
  },
  line: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
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
