import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { formatDate } from "../lib/format";
import { colors } from "../theme";
import { Body, Muted } from "./Text";
import { MediaImage } from "./MediaImage";
import { StatusBadge } from "./StatusBadge";

export type ContentCardKind = "event" | "fastlap" | "news" | "team" | "tournament";

export function ContentCard({
  date,
  description,
  detail,
  image,
  kind,
  label,
  onPress,
  phase,
  status,
  title,
}: {
  date?: string | null;
  description?: string | null;
  detail?: string | null;
  image?: string | null;
  kind: ContentCardKind;
  label?: string | null;
  onPress?: () => void;
  phase?: { label?: string | null; state?: string | null } | string | null;
  status?: string | null;
  title?: string | null;
}) {
  const accent = accentForKind(kind);
  const body = stripText(description || detail || "");
  const content = (
    <>
      <MediaImage
        uri={image}
        style={styles.image}
        fallback={<Ionicons name={iconForKind(kind)} color={accent} size={24} />}
      />
      <View style={styles.body}>
        <View style={styles.kindRow}>
          <Ionicons name={iconForKind(kind)} color={accent} size={13} />
          <Muted style={[styles.kind, { color: accent }]}>{labelForKind(kind)}</Muted>
        </View>
        <Body style={styles.title}>{title || labelForKind(kind)}</Body>
        <View style={styles.metaRow}>
          {date ? <Muted>{formatDate(date)}</Muted> : null}
          {label || phase || status ? <StatusBadge label={label} phase={phase} status={status} /> : null}
        </View>
        {body ? <Muted numberOfLines={2}>{body}</Muted> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" color={colors.muted} size={18} /> : null}
    </>
  );

  if (!onPress) return <View style={styles.card}>{content}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

function labelForKind(kind: ContentCardKind) {
  if (kind === "event") return "Event";
  if (kind === "fastlap") return "Fast Lap";
  if (kind === "news") return "News";
  if (kind === "team") return "Team";
  return "Turnier";
}

function iconForKind(kind: ContentCardKind) {
  if (kind === "event") return "calendar-outline";
  if (kind === "fastlap") return "speedometer-outline";
  if (kind === "news") return "newspaper-outline";
  if (kind === "team") return "people-outline";
  return "trophy-outline";
}

function accentForKind(kind: ContentCardKind) {
  if (kind === "event") return "#9F7AEA";
  if (kind === "fastlap") return colors.cyan;
  if (kind === "news") return colors.cyan;
  if (kind === "team") return colors.success;
  return colors.gold;
}

function stripText(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/[#*_`]/g, "").replace(/\s+/g, " ").trim();
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    overflow: "hidden",
    paddingRight: 10,
  },
  image: {
    borderRadius: 0,
    borderWidth: 0,
    height: 104,
    width: 104,
  },
  body: {
    flex: 1,
    gap: 3,
    minWidth: 0,
    paddingVertical: 10,
  },
  kindRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
  },
  kind: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  pressed: {
    opacity: 0.72,
  },
  title: {
    fontWeight: "900",
  },
});
