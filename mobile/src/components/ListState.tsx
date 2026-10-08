import React, { useEffect, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import { ActivityIndicator, Animated, StyleSheet, View } from "react-native";
import { offlineLabel, useNetwork } from "../lib/network";
import { colors, radius } from "../theme";
import { Button } from "./Button";
import { useReduceMotion } from "./FadeIn";
import { Body, Muted } from "./Text";

// Zustände einer Liste oder Seite (#1152): leer, Fehler und offline sehen verschieden aus. Leer sagt, was der nächste
// Schritt ist, und hat einen Knopf dafür (oder sagt, warum es keinen gibt); ein Ladefehler hat „Nochmal versuchen“ und
// sagt nie „nichts da“; ohne Netz steht oben in jedem Screen die schmale Leiste „Offline · Stand 14:05“, und der zuletzt
// geladene Stand bleibt stehen. Die Platzhalter beim Laden stehen still, wenn „Bewegung reduzieren“ an ist.

export function LoadingState({ label = "Lade Daten ..." }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.cyan} />
      <Muted>{label}</Muted>
    </View>
  );
}

type EmptyTone = "cyan" | "gold" | "danger";
export type StateAction = { label: string; onPress: () => void; testID?: string };

export function EmptyState({
  detail,
  icon,
  title,
  tone = "cyan",
  action,
  secondaryAction,
  testID,
}: {
  detail?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  tone?: EmptyTone;
  /** Der nächste Schritt - genau ein wichtiger Knopf. */
  action?: StateAction | null;
  /** Ein zweiter, leiser Weg (etwa „Join-Code eingeben“). */
  secondaryAction?: StateAction | null;
  testID?: string;
}) {
  const accent = tone === "danger" ? colors.live : tone === "gold" ? colors.gold : colors.cyan;
  return (
    <View style={styles.center} testID={testID}>
      {icon ? (
        <View style={[styles.iconBadge, { borderColor: accent }]}>
          <Ionicons name={icon} color={accent} size={22} />
        </View>
      ) : null}
      <Body style={styles.emptyTitle} accessibilityRole="header">{title}</Body>
      {detail ? <Muted style={styles.detail}>{detail}</Muted> : null}
      {action || secondaryAction ? (
        <View style={styles.actions}>
          {action ? <Button label={action.label} onPress={action.onPress} testID={action.testID} style={styles.action} /> : null}
          {secondaryAction ? <Button label={secondaryAction.label} variant="secondary" onPress={secondaryAction.onPress} testID={secondaryAction.testID} style={styles.action} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** Was beim Laden schiefging - entscheidet, was der Fehlerzustand sagt. */
export type LoadProblem = { kind: "offline" | "notFound" | "denied" | "error"; message: string };

/** Aus einem Fehler des API-Clients: kein Netz, nicht gefunden (404), nicht erlaubt (401/403) oder etwas anderes. */
export function loadProblem(error: unknown): LoadProblem {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const detail = error.response?.data?.detail;
    const message = typeof detail === "string" ? detail : "";
    if (!error.response) return { kind: "offline", message };
    if (status === 404) return { kind: "notFound", message };
    if (status === 401 || status === 403) return { kind: "denied", message };
    return { kind: "error", message };
  }
  return { kind: "error", message: error instanceof Error ? error.message : "" };
}

const PROBLEM_TEXT: Record<LoadProblem["kind"], { title: string; detail: string; icon: keyof typeof Ionicons.glyphMap }> = {
  offline: { title: "Ohne Netz", detail: "Sobald dein Handy wieder Netz hat, lädt es hier weiter. Nichts ist verloren.", icon: "cloud-offline-outline" },
  notFound: { title: "Nicht gefunden", detail: "Das gibt es nicht (mehr) oder es ist nicht sichtbar.", icon: "search-outline" },
  denied: { title: "Nicht freigegeben", detail: "Das sehen nur Mitglieder oder die zuständige Leitung.", icon: "lock-closed-outline" },
  error: { title: "Laden hat nicht geklappt", detail: "Das liegt an der Verbindung oder am Server, nicht an dir.", icon: "alert-circle-outline" },
};

/**
 * Ein Ladefehler - nie „nichts da“. Mit `problem` (aus `loadProblem`) sagt er, was los ist: ohne Netz und bei
 * anderen Fehlern mit „Nochmal versuchen“, bei „nicht gefunden“ der Text der Seite (`title`/`detail`). Ohne `problem`
 * zeigt er `title` und `detail` wie bisher.
 */
export function ErrorState({
  title,
  detail,
  problem = null,
  onRetry,
  action,
  testID = "error-state",
}: {
  title?: string;
  detail?: string;
  problem?: LoadProblem | null;
  onRetry?: (() => void) | null;
  /** Statt „Nochmal versuchen“ ein anderer Weg (etwa bei „nicht gefunden“ zur Übersicht). */
  action?: StateAction | null;
  testID?: string;
}) {
  const kind = problem?.kind || "error";
  const known = PROBLEM_TEXT[kind];
  const pageText = !problem || kind === "notFound" || kind === "denied";
  const shownTitle = (pageText && title) || known.title;
  const shownDetail = (pageText && detail) || (kind === "denied" && problem?.message) || known.detail;
  const retry = onRetry && (kind === "offline" || kind === "error") ? onRetry : null;
  return (
    <View style={styles.center} testID={testID} data-kind={problem ? kind : undefined} accessibilityLiveRegion="polite">
      <View style={[styles.iconBadge, styles.problemBadge, kind === "offline" && styles.offlineBadge]}>
        <Ionicons name={problem ? known.icon : "alert-circle-outline"} color={kind === "offline" ? colors.gold : colors.live} size={22} />
      </View>
      <Body style={styles.emptyTitle} accessibilityRole="header">{shownTitle}</Body>
      <Muted style={styles.detail}>{shownDetail}</Muted>
      {retry ? <Button label="Nochmal versuchen" icon="refresh" arrow={false} onPress={retry} testID={`${testID}-retry`} style={styles.action} /> : null}
      {!retry && action ? <Button label={action.label} variant="secondary" onPress={action.onPress} testID={action.testID} style={styles.action} /> : null}
    </View>
  );
}

/**
 * Ein Teil kam nicht (#1001, #1152): der Rest bleibt stehen, das Fehlende behält den letzten Stand - eine Zeile sagt
 * es und bietet „Nochmal versuchen“ an.
 */
export function PartialLoadNotice({ problem, onRetry, testID = "partial-load" }: { problem: LoadProblem; onRetry: () => void; testID?: string }) {
  const offline = problem.kind === "offline";
  return (
    <View style={styles.partial} testID={testID} accessibilityLiveRegion="polite">
      <Ionicons name={offline ? "cloud-offline-outline" : "alert-circle-outline"} color={colors.gold} size={16} />
      <Muted style={styles.partialText}>{offline ? "Ohne Netz – manches ist vom letzten Laden." : "Nicht alles geladen – manches ist vom letzten Laden."}</Muted>
      <Button compact variant="secondary" label="Nochmal" accessibilityLabel="Nochmal versuchen" onPress={onRetry} testID={`${testID}-retry`} />
    </View>
  );
}

/**
 * Die schmale Leiste oben in jedem Screen (#1152): „Offline · Stand 14:05 · zum Aktualisieren ziehen“, solange das Netz
 * fehlt. Der Stand ist die Zeit der gezeigten Daten (lib/network.ts). Verschwindet von selbst, wenn das Netz wieder da ist.
 */
export function OfflineBar() {
  const { offline, stand } = useNetwork();
  if (!offline) return null;
  const label = offlineLabel(stand);
  return (
    <View style={styles.bar} testID="offline-bar" accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={`${label}. Zum Aktualisieren nach unten ziehen.`}>
      <Ionicons name="cloud-offline-outline" color={colors.gold} size={15} />
      <Muted style={styles.barText} numberOfLines={2}>{label} · zum Aktualisieren ziehen</Muted>
    </View>
  );
}

/** Früher eine Karte je Screen - jetzt sagt das die Leiste oben; bleibt für Hinweise, die nicht das Netz betreffen. */
export function OfflineNotice({
  detail = "Du siehst gespeicherte Daten. Ziehe zum Aktualisieren, sobald dein Netz wieder stabil ist.",
  title = "Offline-Modus",
}: {
  detail?: string;
  title?: string;
}) {
  return (
    <View style={styles.notice}>
      <View style={styles.noticeIcon}>
        <Ionicons name="cloud-offline-outline" color={colors.gold} size={18} />
      </View>
      <View style={styles.noticeText}>
        <Body style={styles.noticeTitle}>{title}</Body>
        <Muted>{detail}</Muted>
      </View>
    </View>
  );
}

/**
 * SkeletonCard – Platzhalter für Listeneinträge während des Ladens; atmet leicht, steht mit „Bewegung reduzieren“ still.
 * Verwendung: <SkeletonCard hasImage /> oder <SkeletonCard lines={2} />
 */
export function SkeletonCard({ hasImage = true, lines = 3 }: { hasImage?: boolean; lines?: number }) {
  const reduce = useReduceMotion();
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (reduce) {
      opacity.setValue(0.5);
      return undefined;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity, reduce]);

  return (
    <Animated.View style={[skeletonStyles.card, { opacity }]} testID="skeleton-card" data-still={reduce ? "1" : "0"}>
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
    <View style={{ gap: 12, paddingTop: 8 }} accessibilityLabel="Lädt" accessibilityState={{ busy: true }}>
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
    borderRadius: radius.lg,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  problemBadge: {
    borderColor: "rgba(255, 59, 48, 0.5)",
  },
  offlineBadge: {
    borderColor: "rgba(255, 215, 0, 0.45)",
  },
  emptyTitle: {
    fontWeight: "800",
    textAlign: "center",
  },
  detail: {
    textAlign: "center",
  },
  actions: {
    alignSelf: "stretch",
    gap: 8,
    marginTop: 6,
  },
  action: {
    alignSelf: "stretch",
  },
  partial: {
    alignItems: "center",
    borderColor: "rgba(255, 215, 0, 0.3)",
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  partialText: {
    color: colors.gold,
    flex: 1,
  },
  bar: {
    alignItems: "center",
    backgroundColor: "rgba(255, 215, 0, 0.1)",
    borderBottomColor: "rgba(255, 215, 0, 0.3)",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 30,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  barText: {
    color: colors.gold,
    flex: 1,
    fontWeight: "800",
  },
  notice: {
    alignItems: "center",
    backgroundColor: "rgba(255, 215, 0, 0.08)",
    borderColor: "rgba(255, 215, 0, 0.24)",
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12,
  },
  noticeIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255, 215, 0, 0.12)",
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
    borderRadius: radius.sm,
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
