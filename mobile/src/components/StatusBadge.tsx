import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { formatStatus } from "../lib/format";
import { colors } from "../theme";
import { Muted } from "./Text";

type StatusTone = "default" | "danger" | "gold" | "success" | "cyan";
type PhaseLike = {
  countdown_kind?: string | null;
  label?: string | null;
  state?: string | null;
  target_at?: string | null;
};

export function StatusBadge({
  label,
  phase,
  status,
  style,
}: {
  label?: string | null;
  phase?: PhaseLike | string | null;
  status?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const [now, setNow] = useState(() => Date.now());
  const targetMs = useMemo(() => targetTime(phase), [phase]);

  useEffect(() => {
    if (!targetMs || targetMs <= Date.now()) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [targetMs]);

  const remaining = targetMs ? formatRemaining(targetMs - now) : "";
  const prefix = remaining ? countdownPrefix(phaseCountdownKind(phase)) : "";
  const statusLabel = formatStatus(label || phaseLabel(phase) || status);
  const text = [statusLabel, prefix && `${prefix} ${remaining}`].filter(Boolean).join(" · ");
  const tone = toneForStatus(`${text} ${status || ""} ${phaseState(phase)}`);
  return (
    <View style={[styles.badge, toneStyles[tone].badge, style]}>
      {phaseState(phase) === "live" ? <View style={[styles.dot, { backgroundColor: toneStyles[tone].text.color }]} /> : null}
      <Muted style={[styles.text, toneStyles[tone].text]}>{text}</Muted>
    </View>
  );
}

function phaseLabel(phase?: PhaseLike | string | null) {
  if (!phase) return "";
  return typeof phase === "string" ? phase : phase.label || phase.state || "";
}

function phaseState(phase?: PhaseLike | string | null) {
  if (!phase || typeof phase === "string") return "";
  return phase.state || "";
}

function phaseCountdownKind(phase?: PhaseLike | string | null) {
  if (!phase || typeof phase === "string") return "";
  return phase.countdown_kind || "";
}

function targetTime(phase?: PhaseLike | string | null) {
  if (!phase || typeof phase === "string" || !phase.target_at) return null;
  const date = new Date(phase.target_at);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function countdownPrefix(kind?: string | null) {
  const prefixes: Record<string, string> = {
    check_in_closes: "Check-in endet in",
    check_in_opens: "Check-in in",
    ends: "endet in",
    registration_closes: "endet in",
    registration_opens: "in",
    starts: "startet in",
  };
  return prefixes[String(kind || "")] || "in";
}

function formatRemaining(ms: number) {
  if (ms <= 0) return "";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}T ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function toneForStatus(value: string): StatusTone {
  const text = normalizeStatusText(value);
  if (/(abgesagt|cancel|rejected|abgelehnt|gesperrt|geschlossen|closed|error|conflict|klärung|klaerung|klarung|disputed|review|prüfung|pruefung|prufung)/.test(text)) return "danger";
  if (/(^|\s)(live|lauft|in_progress)(\s|$)/.test(text)) return "danger";
  if (/(aktiv|active|open|offen|registration_open|check-in|checkin|angemeldet|registered|bestätigt|bestaetigt|bestatigt|confirmed|accepted|approved)/.test(text)) return "success";
  if (/(pending|ausstehend|wartet|vorschlag|draft|entwurf|planned|geplant|anmeldung|scheduled|proposed|reported|result_pending)/.test(text)) return "gold";
  if (/(archiv|beendet|finished|completed|veroeffentlicht|veroffentlicht|published)/.test(text)) return "default";
  return "cyan";
}

function normalizeStatusText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const toneStyles: Record<StatusTone, { badge: ViewStyle; text: { color: string } }> = {
  cyan: {
    badge: { backgroundColor: "rgba(41, 182, 232, 0.12)", borderColor: "rgba(41, 182, 232, 0.3)" },
    text: { color: colors.cyan },
  },
  danger: {
    badge: { backgroundColor: "rgba(255, 59, 48, 0.12)", borderColor: "rgba(255, 59, 48, 0.32)" },
    text: { color: colors.live },
  },
  default: {
    badge: { backgroundColor: "rgba(255, 255, 255, 0.07)", borderColor: colors.border },
    text: { color: colors.muted },
  },
  gold: {
    badge: { backgroundColor: "rgba(255, 215, 0, 0.12)", borderColor: "rgba(255, 215, 0, 0.32)" },
    text: { color: colors.gold },
  },
  success: {
    badge: { backgroundColor: "rgba(0, 255, 136, 0.12)", borderColor: "rgba(0, 255, 136, 0.32)" },
    text: { color: colors.success },
  },
};

const styles = StyleSheet.create({
  badge: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  text: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
});
