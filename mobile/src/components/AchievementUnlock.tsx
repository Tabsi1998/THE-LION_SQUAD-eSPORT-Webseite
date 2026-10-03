import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme";
import { useReduceMotion } from "./FadeIn";
import { useSeasonOverlay } from "../seasons/anchors";
import { Badge } from "../achievements/Badge";
import { type Look, lookFor } from "../achievements/badgeArt";

export type UnlockTier = {
  code?: string;
  name?: string;
  description?: string;
  level?: number;
  level_name?: string;
  points?: number;
  /** Erfolge II (E13, #623): Material, Rang und Motiv – fehlen sie (alte Meldungen), gilt das Level. */
  material?: string | null;
  rank?: number | null;
  art?: string | null;
  icon?: string | null;
  group_art?: string | null;
  group_icon?: string | null;
  group_name?: string;
};

/** Das Material einer Stufe als Look (Farben, Name, Rang 1–9). */
export function unlockLook(tier: UnlockTier): Look {
  return lookFor(tier.material, tier.level);
}

/** Die Stufe, die das Fenster trägt: das höchste Material. */
export function topTier(tiers: UnlockTier[]): UnlockTier | null {
  return tiers.reduce<UnlockTier | null>((best, tier) => (!best || unlockLook(tier).rank > unlockLook(best).rank ? tier : best), null);
}

/** Haptik je Material: Holz bis Bronze leicht, Silber und Gold mittel, Platin und Diamant schwer, Legendär als Muster. */
export function hapticKind(look: Look): "light" | "medium" | "heavy" | "pattern" {
  if (look.key === "legendary") return "pattern";
  if (look.rank >= 6 && look.rank <= 7) return "heavy";
  if (look.rank >= 4) return "medium";
  return "light";
}

async function playHaptics(look: Look) {
  try {
    const kind = hapticKind(look);
    if (kind === "pattern") {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      for (let i = 0; i < 3; i++) {
        // Promise.resolve: auch wenn ein Gerät (oder ein Test) kein Versprechen zurückgibt, bleibt es still.
        setTimeout(() => { Promise.resolve(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)).catch(() => {}); }, 180 + i * 150);
      }
    } else if (kind === "heavy") {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } else if (kind === "medium") {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  } catch {
    /* haptics unavailable on this device/simulator */
  }
}

const CONFETTI = Array.from({ length: 14 }, (_, i) => i);

function ConfettiPiece({ index, color }: { index: number; color: string }) {
  const fall = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fall, {
      toValue: 1,
      duration: 2600 + (index % 5) * 300,
      delay: 200 + (index % 7) * 120,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fall, index]);
  const translateY = fall.interpolate({ inputRange: [0, 1], outputRange: [-30, 520] });
  const opacity = fall.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 1, 1, 0] });
  const rotate = fall.interpolate({ inputRange: [0, 1], outputRange: ["0deg", index % 2 ? "360deg" : "-360deg"] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: `${(index * 37) % 100}%`,
        width: 8,
        height: 8,
        borderRadius: 1,
        backgroundColor: color,
        opacity,
        transform: [{ translateY }, { rotate }],
      }}
    />
  );
}

export function AchievementUnlockModal({
  tiers,
  onClose,
  heading,
  sub,
}: {
  tiers: UnlockTier[];
  onClose: () => void;
  heading?: string;
  sub?: string;
}) {
  const open = Array.isArray(tiers) && tiers.length > 0;
  useSeasonOverlay("achievement-unlock", open);
  const top = useMemo(() => (open ? topTier(tiers) : null), [tiers, open]);
  const look = useMemo(() => unlockLook(top || {}), [top]);
  // Konfetti ab Gold; Legendär mit Gold als zweiter Farbe.
  const R = { name: look.name, color: look.rim, secondary: look.key === "legendary" ? look.accent || "#FFD700" : undefined, confetti: look.rank >= 5 };
  const totalPoints = useMemo(() => tiers.reduce((s, t) => s + (Number(t.points) || 0), 0), [tiers]);

  const scale = useRef(new Animated.Value(0.7)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  // „Bewegung reduzieren“ am Handy (#218): der Moment erscheint, aber nichts federt oder regnet.
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (!open) return;
    playHaptics(look);
    if (reduceMotion) {
      scale.setValue(1);
      opacity.setValue(1);
    } else {
      scale.setValue(0.7);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6, tension: 90 }),
        Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      ]).start();
    }
    const timer = setTimeout(onClose, 8000);
    return () => clearTimeout(timer);
  }, [open, look, scale, opacity, onClose, reduceMotion]);

  if (!open) return null;

  const confettiColors = look.key === "legendary" ? [R.color, R.secondary || "#fff", "#fff"] : ["#29B6E8", "#FFD700", "#00FF88", "#FF3B30"];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} testID="achievement-unlock-overlay">
        {R.confetti && !reduceMotion && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {CONFETTI.map((i) => (
              <ConfettiPiece key={i} index={i} color={confettiColors[i % confettiColors.length]} />
            ))}
          </View>
        )}
        <Animated.View
          style={[styles.card, { borderColor: `${R.color}66`, shadowColor: R.color, opacity, transform: [{ scale }] }]}
          onStartShouldSetResponder={() => true}
        >
          <Pressable style={styles.close} onPress={onClose} hitSlop={12} testID="achievement-unlock-close">
            <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
          </Pressable>

          <View style={styles.medal} testID="achievement-unlock-badge">
            <Badge material={look.key} rank={top?.rank} art={top?.art || top?.group_art} icon={top?.group_icon || top?.icon} size={104} />
          </View>

          <Text style={[styles.sub, { color: R.color }]}>{sub || `${R.name} freigeschaltet`}</Text>
          <Text style={styles.heading}>
            {heading || (tiers.length === 1 ? "Neues Achievement!" : `${tiers.length} neue Achievements!`)}
          </Text>

          <ScrollView style={styles.list} contentContainerStyle={{ gap: 8 }}>
            {tiers.map((tier, index) => {
              const own = unlockLook(tier);
              return (
                <View
                  key={tier.code || index}
                  style={[styles.tierRow, { borderLeftColor: own.rim }]}
                  testID={`unlock-tier-${tier.code || index}`}
                >
                  <Badge material={own.key} rank={tier.rank} art={tier.art || tier.group_art} icon={tier.group_icon || tier.icon} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.tierLevel, { color: own.rim }]}>{own.name}{tier.group_name ? ` · ${tier.group_name}` : ""}</Text>
                    <Text style={styles.tierName} numberOfLines={1}>
                      {tier.name}
                    </Text>
                  </View>
                  <Text style={[styles.points, { color: own.rim }]}>+{tier.points || 0}</Text>
                </View>
              );
            })}
          </ScrollView>

          {totalPoints > 0 && (
            <View style={[styles.totalPill, { borderColor: `${R.color}44`, backgroundColor: `${R.color}12` }]}>
              <Text style={[styles.totalText, { color: R.secondary || R.color }]}>+{totalPoints} Punkte insgesamt</Text>
            </View>
          )}
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.86)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 20,
    alignItems: "center",
    shadowOpacity: 0.4,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  close: { position: "absolute", top: 12, right: 12, zIndex: 2 },
  medal: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  sub: { fontSize: 11, fontWeight: "800", letterSpacing: 3, textTransform: "uppercase" },
  heading: { color: colors.white, fontSize: 24, fontWeight: "900", textTransform: "uppercase", marginTop: 4, textAlign: "center" },
  list: { width: "100%", maxHeight: 260, marginTop: 16 },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  tierLevel: { fontSize: 10, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  tierName: { color: colors.white, fontSize: 15, fontWeight: "600" },
  points: { fontSize: 13, fontWeight: "800" },
  totalPill: { marginTop: 16, paddingHorizontal: 16, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1 },
  totalText: { fontSize: 12, fontWeight: "900", letterSpacing: 1.5, textTransform: "uppercase" },
});
