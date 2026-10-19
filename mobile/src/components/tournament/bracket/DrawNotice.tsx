import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { ADVANCEMENT_MODE_LABELS, ADVANCEMENT_MODE_TEXTS, drawReadyText, type DrawStatus, type ReadyDraw } from "../../../lib/advancement";
import { matchName } from "../../../lib/bracketNames";
import type { AdvancementMode, BracketMatch } from "../../../lib/bracketGraph";
import type { MotionPlan } from "../../../lib/bracketMotion";
import { radius, roles, surfaces } from "../../../theme";
import { Flash } from "./BracketMotion";
import { riseInStyle } from "./motion";

// Weiterkommen über dem Baum (#1633): in welchem Modus gespielt wird (Antippen erklärt ihn - Texte wie im Web) und was
// gerade passiert. Steht der Topf der Show-Auslosung, steht „Auslosung bereit · 8 Namen“ in Gold - aus den Daten, auch
// nach dem Neuladen, bis gelost ist. Wird er gerade bereit, kommt der Hinweis von unten herein und leuchtet einmal auf;
// ein sofort gezogener Platz sagt kurz „Zufällig gezogen · NeonFalke → E“ (wie am TV) und geht nach ein paar Sekunden.
// „Bewegung reduzieren“: alles steht sofort da.

export const ASSIGNED_NOTE_MS = 4000;
const FONT_SCALE = 1.3;

type Props = {
  modes: AdvancementMode[];
  statuses: DrawStatus[];
  ready: ReadyDraw[];
  plan: MotionPlan | null;
  matches: BracketMatch[];
  nameOf: (registrationId: string) => string;
  reduce: boolean;
};

/** „Zufällig gezogen · NeonFalke → E“ bzw. „Zufällig gezogen · 3 Namen auf ihre Plätze“ - wie der Banner am TV. */
export function assignedText(rows: Array<{ matchId: string; registrationId: string }>, matches: BracketMatch[], nameOf: (id: string) => string) {
  if (!rows.length) return "";
  if (rows.length > 1) return `Zufällig gezogen · ${rows.length} Namen auf ihre Plätze`;
  const [row] = rows;
  const match = matches.find((candidate) => candidate.id === row.matchId);
  return `Zufällig gezogen · ${nameOf(row.registrationId) || "Weiterkommer"} → ${matchName(match) || "nächstes Spiel"}`;
}

export function DrawNotice({ modes, statuses, ready, plan, matches, nameOf, reduce }: Props) {
  const [open, setOpen] = useState(false);
  const note = plan?.assigned.length ? assignedText(plan.assigned, matches, nameOf) : "";
  const [shown, setShown] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => {
    if (note && plan) setShown({ key: plan.key, text: note });
  }, [note, plan]);
  // Geht von selbst - auch wenn inzwischen ein neuer Stand ohne gezogenen Platz kam.
  useEffect(() => {
    if (!shown) return undefined;
    const timer = setTimeout(() => setShown(null), ASSIGNED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  const fresh = Boolean(plan?.ready.length);
  const label = modes.map((mode) => ADVANCEMENT_MODE_LABELS[mode]).join(" / ");
  const lines = statuses.filter((status) => !(ready.length && status.tone === "ready"));
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Weiterkommen: ${label}. ${open ? "Erklärung ausblenden" : "Erklärung zeigen"}`}
        hitSlop={8}
        style={styles.modeRow}
        testID="bracket-mode"
      >
        <Text style={styles.modeLabel} maxFontSizeMultiplier={FONT_SCALE}>Weiterkommen</Text>
        <Text style={styles.modeName} maxFontSizeMultiplier={FONT_SCALE}>{label}</Text>
        <Text style={styles.modeMore} maxFontSizeMultiplier={FONT_SCALE}>{open ? "weniger" : "wie?"}</Text>
      </Pressable>
      {open ? (
        <Text style={styles.explain} testID="bracket-mode-text" maxFontSizeMultiplier={FONT_SCALE}>
          {modes.map((mode) => (modes.length > 1 ? `${ADVANCEMENT_MODE_LABELS[mode]}: ${ADVANCEMENT_MODE_TEXTS[mode]}` : ADVANCEMENT_MODE_TEXTS[mode])).join("\n")}
        </Text>
      ) : null}
      {ready.length ? (
        <Animated.View
          key={fresh ? `ready-${plan?.key}` : "ready"}
          style={[styles.ready, fresh ? riseInStyle(reduce) : null]}
          testID="bracket-draw-ready"
          accessibilityLiveRegion="polite"
        >
          {fresh ? <Flash reduce={reduce} delay={120} color="rgba(255,215,0,0.18)" /> : null}
          <Text style={styles.readyText} maxFontSizeMultiplier={FONT_SCALE}>{drawReadyText(ready)}</Text>
          <Text style={styles.readySub} maxFontSizeMultiplier={FONT_SCALE}>Die Turnierleitung lost gleich.</Text>
        </Animated.View>
      ) : null}
      {lines.map((status) => (
        <Text key={status.key} style={[styles.status, status.tone === "instant" && styles.statusInstant]} testID="bracket-draw-status" maxFontSizeMultiplier={FONT_SCALE}>
          {[status.round, status.text].filter(Boolean).join(" · ")}
        </Text>
      ))}
      {shown ? (
        <Animated.View key={shown.key} style={[styles.assigned, riseInStyle(reduce)]} testID="bracket-draw-assigned" accessibilityLiveRegion="polite">
          <Text style={styles.assignedText} numberOfLines={2} maxFontSizeMultiplier={FONT_SCALE}>{shown.text}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  modeRow: { alignItems: "baseline", flexDirection: "row", flexWrap: "wrap", gap: 6, minHeight: 32, paddingVertical: 4 },
  modeLabel: { color: roles.quiet, fontSize: 10, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  modeName: { color: roles.brand, flexShrink: 1, fontSize: 13, fontWeight: "900" },
  modeMore: { color: roles.muted, fontSize: 12, fontWeight: "700", textDecorationLine: "underline" },
  explain: { color: roles.muted, fontSize: 12, lineHeight: 17 },
  ready: {
    backgroundColor: "rgba(255,215,0,0.08)",
    borderColor: "rgba(255,215,0,0.5)",
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 2,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  readyText: { color: roles.honor, fontSize: 14, fontWeight: "900" },
  readySub: { color: roles.muted, fontSize: 12 },
  status: { color: roles.muted, fontSize: 12, fontWeight: "700" },
  statusInstant: { color: roles.brand },
  assigned: {
    backgroundColor: surfaces.s2,
    borderColor: "rgba(41,182,232,0.45)",
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  assignedText: { color: roles.brand, fontSize: 13, fontWeight: "800" },
});
