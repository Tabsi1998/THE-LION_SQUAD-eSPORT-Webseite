import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme";

export type UnlockTier = {
  code?: string;
  name?: string;
  description?: string;
  level?: number;
  level_name?: string;
  points?: number;
};

const RARITY: Record<number, { name: string; color: string; secondary?: string; confetti: boolean }> = {
  1: { name: "Bronze", color: "#CD7F32", confetti: false },
  2: { name: "Silber", color: "#C0C0C0", confetti: false },
  3: { name: "Gold", color: "#FFD700", confetti: true },
  4: { name: "Platin", color: "#29B6E8", confetti: true },
  5: { name: "Legendär", color: "#FF3B30", secondary: "#FFD700", confetti: true },
};

const LEVEL_META: Record<number, { name: string; color: string }> = {
  1: { name: "Bronze", color: "#CD7F32" },
  2: { name: "Silber", color: "#C0C0C0" },
  3: { name: "Gold", color: "#FFD700" },
  4: { name: "Platin", color: "#29B6E8" },
  5: { name: "Legendär", color: "#FF3B30" },
};

async function playHaptics(level: number) {
  try {
    if (level >= 5) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      for (let i = 0; i < 3; i++) {
        setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}), 180 + i * 150);
      }
    } else if (level >= 3) {
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
  const maxLevel = useMemo(
    () => (open ? Math.min(5, Math.max(1, tiers.reduce((m, t) => Math.max(m, Number(t.level) || 1), 1))) : 1),
    [tiers, open],
  );
  const R = RARITY[maxLevel];
  const totalPoints = useMemo(() => tiers.reduce((s, t) => s + (Number(t.points) || 0), 0), [tiers]);

  const scale = useRef(new Animated.Value(0.7)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!open) return;
    playHaptics(maxLevel);
    scale.setValue(0.7);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6, tension: 90 }),
      Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
    const timer = setTimeout(onClose, 8000);
    return () => clearTimeout(timer);
  }, [open, maxLevel, scale, opacity, onClose]);

  if (!open) return null;

  const confettiColors = maxLevel >= 5 ? [R.color, R.secondary || "#fff", "#fff"] : ["#29B6E8", "#FFD700", "#00FF88", "#FF3B30"];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} testID="achievement-unlock-overlay">
        {R.confetti && (
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

          <View style={[styles.medal, { borderColor: R.color, backgroundColor: `${R.color}18` }]}>
            <Ionicons name="trophy" size={40} color={maxLevel >= 5 ? R.secondary : R.color} />
          </View>

          <Text style={[styles.sub, { color: R.color }]}>{sub || `${R.name} freigeschaltet`}</Text>
          <Text style={styles.heading}>
            {heading || (tiers.length === 1 ? "Neues Achievement!" : `${tiers.length} neue Achievements!`)}
          </Text>

          <ScrollView style={styles.list} contentContainerStyle={{ gap: 8 }}>
            {tiers.map((tier, index) => {
              const lvl = LEVEL_META[Number(tier.level) || 1] || LEVEL_META[1];
              return (
                <View
                  key={tier.code || index}
                  style={[styles.tierRow, { borderLeftColor: lvl.color }]}
                  testID={`unlock-tier-${tier.code || index}`}
                >
                  <Ionicons name="ribbon" size={22} color={lvl.color} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.tierLevel, { color: lvl.color }]}>{tier.level_name || lvl.name}</Text>
                    <Text style={styles.tierName} numberOfLines={1}>
                      {tier.name}
                    </Text>
                  </View>
                  <Text style={[styles.points, { color: lvl.color }]}>+{tier.points || 0}</Text>
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
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
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
