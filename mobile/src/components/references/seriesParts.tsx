import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Linking, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { motionEasing } from "../../lib/motion";
import { chipLabel, chipWhen, type WeekendRound } from "../../lib/raceWeekend";
import { PUBLIC_STATE_LABELS, stateTone, type StateTone } from "../../lib/referenceSeason";
import { adjustmentMark, adjustmentSum, adjustmentTitle, cancelledText, noScoreText, successorLink, type AdjustedRow, type Successor } from "../../lib/seriesSpecialRules";
import { partnerHead, partnerPath, type PartnerBadge, type SeasonPartners } from "../../lib/seriesPartners";
import { dayLabel } from "../../lib/seriesFormat";
import { WEB_BASE_URL } from "../../lib/siteUrls";
import { colors, roles, surfaces } from "../../theme";
import { useReduceMotion } from "../FadeIn";
import { MediaImage } from "../MediaImage";
import { Body, Muted } from "../Text";
import { ink } from "./parts";

// Bausteine der Serien in der App (#1974): Stand-Chip, Lauf-Chips einer Runde (#1930), Hinweis „Saison abgebrochen“ mit
// Nachfolger und „Ohne Wertung“ (#1960), die Marke „−5“ an den Punkten, „Veranstaltet von“ und das Partner-Abzeichen
// (#1934) und ein einmaliges Aufleuchten. Wie die übrigen Referenz-Bausteine (parts.tsx): Bewegung nur als Hinweis und
// kurz, mit „Bewegung reduzieren“ steht alles sofort da.

export const STATE_STYLES: Record<StateTone, { fg: string; bg: string }> = {
  done: { fg: roles.ok, bg: "rgba(31,208,142,0.12)" },
  today: { fg: "#06121A", bg: roles.honor },
  missing: { fg: roles.warn, bg: "rgba(255,159,67,0.12)" },
  cancelled: { fg: roles.warn, bg: "rgba(255,159,67,0.12)" },
  postponed: { fg: roles.event, bg: "rgba(159,122,234,0.12)" },
  planned: { fg: ink.muted, bg: surfaces.s2 },
};

export function StateChip({ label, tone }: { label: string; tone: StateTone }) {
  if (!label) return null;
  const look = STATE_STYLES[tone];
  return <Muted style={[styles.state, { color: look.fg, backgroundColor: look.bg }]}>{label}</Muted>;
}

/** Die Läufe einer Runde als Chips (#1930): „Quali 19:30 · Sprint · Rennen“ je in der Farbe ihres Stands, umbrechend -
 * so steht auch der letzte Lauf mit Uhrzeit da. Tippen öffnet die Runde mit diesem Lauf - ohne Ziel (älterer Server) nur
 * zum Lesen. */
export function SessionChips<T extends WeekendRound>({ rounds, onOpen, testID }: { rounds: T[]; onOpen?: ((round: T) => void) | null; testID?: string }) {
  if (rounds.length < 1) return null;
  return (
    <View style={styles.chips} accessibilityLabel="Läufe der Runde" testID={testID}>
      {rounds.map((round) => {
        const tone = stateTone(round.state);
        const look = STATE_STYLES[tone];
        const when = chipWhen(round, rounds[0]);
        const label = [String(round.session || "").trim() || "Rennen", [dayLabel(round.club_day), round.time].filter(Boolean).join(" · "), PUBLIC_STATE_LABELS[String(round.state)]].filter(Boolean).join(", ");
        const content = (
          <>
            <View style={[styles.chipDot, { backgroundColor: tone === "planned" ? ink.quiet : tone === "today" ? roles.honor : look.fg }]} />
            <Body style={[styles.chipText, round.state === "cancelled" && styles.chipCancelled]}>{chipLabel(round)}</Body>
            {when ? <Muted style={styles.chipTime}>{when}</Muted> : null}
          </>
        );
        return onOpen ? (
          <Pressable
            key={round.id}
            onPress={() => onOpen(round)}
            accessibilityRole="button"
            accessibilityLabel={label}
            hitSlop={{ top: 6, bottom: 6 }}
            style={({ pressed }) => [styles.chip, tone === "today" && styles.chipToday, pressed && styles.pressed]}
            testID={`session-chip-${round.id}`}
          >
            {content}
          </Pressable>
        ) : (
          <View key={round.id} style={[styles.chip, tone === "today" && styles.chipToday]} accessible accessibilityLabel={label} testID={`session-chip-${round.id}`}>
            {content}
          </View>
        );
      })}
    </View>
  );
}

/** „Ohne Wertung · Zu wenig Fahrer – …“ am Termin (#1960); `label` nennt bei mehreren Läufen den Lauf. */
export function NoScoreNote({ round, label = "" }: { round: { no_score_reason?: string | null; no_score_note?: string | null }; label?: string }) {
  const text = noScoreText(round);
  if (!text) return null;
  return <Muted style={styles.noScore} testID="series-no-score">{label ? `${label}: ${text}` : text}</Muted>;
}

/** „Saison abgebrochen am … – Grund. Die gefahrenen Ergebnisse bleiben stehen – ohne Meister.“ mit dem Weg zum
 * Nachfolger (#1960). Ohne beides nichts. */
export function SeasonNotice({ series, successor, onOpenSuccessor, style }: {
  series: { status?: string | null; cancelled_on?: string | null; cancel_reason?: string | null } | null | undefined;
  successor?: Successor;
  onOpenSuccessor?: (target: { lineage: string; season: string }) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const text = cancelledText(series);
  const next = successorLink(successor);
  if (!text && !next) return null;
  return (
    <View style={[styles.notice, style]} accessibilityRole="summary" testID="series-season-notice">
      {text ? (
        <View style={styles.noticeRow}>
          <Ionicons name="warning-outline" size={16} color={roles.warn} />
          <Body style={styles.noticeText}>{`${text}. Die gefahrenen Ergebnisse bleiben stehen – ohne Meister.`}</Body>
        </View>
      ) : null}
      {next && onOpenSuccessor ? (
        <Pressable
          onPress={() => onOpenSuccessor({ lineage: next.lineage, season: next.season })}
          accessibilityRole="button"
          accessibilityLabel={`Nachfolger: ${next.label}`}
          style={({ pressed }) => [styles.successor, pressed && styles.pressed]}
          testID="series-successor"
        >
          <Body style={styles.successorText}>{`Nachfolger: ${next.label}`}</Body>
          <Ionicons name="arrow-forward" size={14} color={colors.cyan} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Die Marke an den Punkten (#1960): „−5“ rot, „+2“ grün - der Grund für Vorleser. */
export function AdjustmentMark({ row, rounds }: { row: AdjustedRow; rounds?: WeekendRound[] }) {
  const mark = adjustmentMark(row);
  if (!mark) return null;
  return (
    <Muted
      style={[styles.adjustment, { color: adjustmentSum(row) < 0 ? "#FCA5A5" : "#6EE7B7" }]}
      accessibilityLabel={adjustmentTitle(row, rounds)}
      testID="series-adjustment"
    >
      {mark}
    </Muted>
  );
}

function openPartner(partner: PartnerBadge) {
  const path = partnerPath(partner);
  if (path) Linking.openURL(`${WEB_BASE_URL}${path}`).catch(() => {});
}

/** „Veranstaltet von“ mit Logo und Name (#1934), darunter „Mit A · B“. Ein Partner öffnet seine Seite im Web. */
export function SeriesPartners({ partners }: { partners: SeasonPartners }) {
  const { organizers, contributors } = partnerHead(partners);
  if (!organizers.length && !contributors.length) return null;
  return (
    <View style={styles.partners} testID="series-partners">
      {organizers.length ? (
        <View style={styles.hostRow}>
          <Muted style={styles.hostLabel}>Veranstaltet von</Muted>
          {organizers.map((partner) => (
            <Pressable
              key={partner.id || partner.name || ""}
              onPress={() => openPartner(partner)}
              accessibilityRole="link"
              accessibilityLabel={`Veranstaltet von ${partner.name}`}
              style={({ pressed }) => [styles.host, pressed && styles.pressed]}
              testID={`series-organizer-${partner.slug || partner.id}`}
            >
              {partner.logo_url ? <MediaImage uri={partner.logo_url} resizeMode="contain" width={320} style={styles.hostLogo} /> : null}
              <Body style={styles.hostName}>{partner.name}</Body>
            </Pressable>
          ))}
        </View>
      ) : null}
      {contributors.length ? (
        <Muted style={styles.contributors} testID="series-contributors">
          {"Mit "}
          {contributors.map((partner, index) => (
            <Muted key={partner.id || partner.name || index} style={styles.contributor} onPress={() => openPartner(partner)} accessibilityRole="link">
              {`${index ? " · " : ""}${partner.name}`}
            </Muted>
          ))}
        </Muted>
      ) : null}
    </View>
  );
}

/** Kleines Abzeichen „Logo Name · Partner“ an einer laufenden Saison oder Spur (#1934) - kein Link, die Karte führt. */
export function PartnerHostBadge({ partner }: { partner: PartnerBadge | null | undefined }) {
  if (!partner?.name) return null;
  return (
    <View style={styles.badge} accessible accessibilityLabel={`Veranstaltet von ${partner.name}, Partner des Vereins`} testID="partner-host-badge">
      {partner.logo_url ? <MediaImage uri={partner.logo_url} resizeMode="contain" width={160} style={styles.badgeLogo} /> : null}
      <Muted style={styles.badgeName} numberOfLines={1}>{partner.name}</Muted>
      <Muted style={styles.badgeTail}>· Partner</Muted>
    </View>
  );
}

/**
 * Einmal aufleuchten (#1974, Detail-Runde): eine Fläche in `color` blendet nach `delay` kurz ein und wieder aus - an
 * Vereinszeilen, nachdem ihre Zeit hochgezählt hat, und an einer gewonnenen Map. `trigger` spielt es erneut ab (neuer
 * Reiter). Mit „Bewegung reduzieren“ nichts.
 */
export function GlowOnce({ delay = 0, color = colors.cyan, peak = 0.16, trigger, radius = 6 }: { delay?: number; color?: string; peak?: number; trigger?: unknown; radius?: number }) {
  const reduce = useReduceMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) {
      value.setValue(0);
      return undefined;
    }
    value.setValue(0);
    const animation = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(value, { toValue: 1, duration: 220, easing: motionEasing, useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: 520, easing: motionEasing, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [delay, reduce, trigger, value]);
  if (reduce) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: color, borderRadius: radius, opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0, peak] }) }]}
    />
  );
}

const styles = StyleSheet.create({
  state: { borderRadius: 4, fontSize: 11, fontWeight: "800", letterSpacing: 0.9, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 2, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { alignItems: "center", backgroundColor: surfaces.s2, borderColor: "rgba(255,255,255,0.1)", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 6, minHeight: 30, paddingHorizontal: 10 },
  chipToday: { borderColor: "rgba(255,215,0,0.45)" },
  chipDot: { borderRadius: 3, height: 6, width: 6 },
  chipText: { color: ink.soft, fontSize: 12, fontWeight: "700" },
  chipCancelled: { color: ink.muted, textDecorationLine: "line-through" },
  chipTime: { color: ink.quiet, fontSize: 12, fontVariant: ["tabular-nums"] },
  noScore: { color: "rgba(253,230,138,0.85)", fontSize: 12 },
  notice: { backgroundColor: "rgba(255,159,67,0.06)", borderColor: "rgba(255,159,67,0.3)", borderRadius: 8, borderWidth: 1, gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  noticeRow: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  noticeText: { color: ink.second, flex: 1, fontSize: 13, lineHeight: 18 },
  successor: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 6, minHeight: 32 },
  successorText: { color: colors.cyan, fontSize: 13, fontWeight: "700" },
  adjustment: { fontSize: 11, fontVariant: ["tabular-nums"], fontWeight: "800", textDecorationLine: "underline", textDecorationStyle: "dotted" },
  partners: { gap: 6 },
  hostRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 10 },
  hostLabel: { color: ink.quiet, fontSize: 11, fontWeight: "800", letterSpacing: 1.6, textTransform: "uppercase" },
  host: { alignItems: "center", flexDirection: "row", gap: 8, minHeight: 36 },
  hostLogo: { backgroundColor: "transparent", borderWidth: 0, height: 28, width: 72 },
  hostName: { color: ink.text, fontSize: 14, fontWeight: "700" },
  contributors: { color: ink.quiet, fontSize: 13 },
  contributor: { color: ink.second, fontSize: 13 },
  badge: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)", borderRadius: 999, borderWidth: 1, flexDirection: "row", gap: 5, maxWidth: "100%", paddingHorizontal: 8, paddingVertical: 2 },
  badgeLogo: { backgroundColor: "transparent", borderWidth: 0, height: 14, width: 28 },
  badgeName: { color: ink.soft, flexShrink: 1, fontSize: 11, fontWeight: "700" },
  badgeTail: { color: ink.quiet, fontSize: 11 },
  pressed: { opacity: 0.72 },
});
