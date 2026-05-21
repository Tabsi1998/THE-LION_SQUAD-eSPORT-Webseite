import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { formatStatus } from "../lib/format";
import { colors } from "../theme";
import { Muted } from "./Text";

type StatusTone = "default" | "danger" | "gold" | "success" | "cyan";

export function StatusBadge({
  label,
  phase,
  status,
  style,
}: {
  label?: string | null;
  phase?: { label?: string | null; state?: string | null } | string | null;
  status?: string | null;
  style?: StyleProp<ViewStyle>;
}) {
  const text = label || phaseLabel(phase) || formatStatus(status);
  const tone = toneForStatus(`${text} ${status || ""} ${phaseState(phase)}`);
  return (
    <View style={[styles.badge, toneStyles[tone].badge, style]}>
      <Muted style={[styles.text, toneStyles[tone].text]}>{text}</Muted>
    </View>
  );
}

function phaseLabel(phase?: { label?: string | null } | string | null) {
  if (!phase) return "";
  return typeof phase === "string" ? phase : phase.label || "";
}

function phaseState(phase?: { state?: string | null } | string | null) {
  if (!phase || typeof phase === "string") return "";
  return phase.state || "";
}

function toneForStatus(value: string): StatusTone {
  const text = normalizeStatusText(value);
  if (/(abgesagt|cancel|rejected|abgelehnt|gesperrt|geschlossen|closed|error|conflict|klaerung|klarung|disputed|review|pruefung|prufung)/.test(text)) return "danger";
  if (/(live|aktiv|active|open|offen|registration_open|check-in|checkin|angemeldet|registered|bestaetigt|bestatigt|confirmed|accepted|approved)/.test(text)) return "success";
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
    alignSelf: "flex-start",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  text: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
});
