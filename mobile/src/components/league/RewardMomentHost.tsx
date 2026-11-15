import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { ceremonyQueue, type CeremonyQueue } from "../../achievements/ceremony/queue";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../lib/api";
import { artLines, metalColor, momentSubtitle, momentTitle, rewardPackages, type RewardAward } from "../../lib/leagueRewards";
import { playMoment } from "../../lib/tournamentHaptics";
import { colors, motion, radius, roles, surfaces } from "../../theme";
import { Button } from "../Button";
import { Glow, StaggerIn, useReduceMotion } from "../motion";
import { Body, Muted } from "../Text";
import { RewardArt } from "./RewardArt";

// Zeremonie bei neuer Belohnung (#2173, Web: components/tls/rewards/RewardWatcher.jsx und RewardMoment.jsx, docs/LIGA.md F.4, Nr. 165):
// Nach dem Anmelden fragt die App einmal, welche Belohnungen noch nicht gefeiert wurden, und zeigt je Staffel ein Paket - nie zugleich
// mit einer Erfolgs-Zeremonie (die wartet nicht, die Belohnung wartet auf sie). Erst wenn sie geschlossen ist, gilt sie als gesehen.
// Detail-Runde: die Karte hebt sich an und blendet ein, die Belohnungen bauen sich gestaffelt auf, jede Vorlage leuchtet einmal in
// ihrem Metall auf, dazu einmal die Sieg-Vibration. Mit „Bewegung reduzieren“ steht alles sofort da, die Vibration bleibt.

const ease = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);

function MomentCard({ rewards, onClose }: { rewards: RewardAward[]; onClose: () => void }) {
  const reduce = useReduceMotion();
  const shown = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    shown.value = reduce ? 1 : withTiming(1, { duration: motion.slow, easing: ease });
    return playMoment("win");
    // Einmal beim Erscheinen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rise = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * 12 }, { scale: 0.96 + shown.value * 0.04 }] }));
  return (
    <Animated.View style={[styles.card, rise]} accessibilityViewIsModal testID="reward-moment">
      <Text style={styles.eyebrow}>{momentSubtitle(rewards)}</Text>
      <Text style={styles.title} accessibilityRole="header" testID="reward-moment-title">{momentTitle(rewards)}</Text>
      {/* Viele Belohnungen oder große Schrift: die Liste scrollt, Überschrift und „Weiter“ bleiben sichtbar. */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} testID="reward-moment-scroll">
      <StaggerIn style={styles.list}>
        {rewards.map((award, index) => (
          <View key={award.id} style={[styles.row, { borderColor: metalColor(award.reward?.art?.metal) }]} testID={`reward-moment-${award.id}`}>
            <RewardArt reward={award.reward} size={56} />
            <View style={styles.text}>
              <Text style={[styles.kind, { color: metalColor(award.reward?.art?.metal) }]}>{award.reward?.kind_label}</Text>
              <Body style={styles.name} numberOfLines={2}>{award.reward?.name}</Body>
              <Muted style={styles.meta} numberOfLines={2}>{artLines(award.reward?.art).join(" · ")}</Muted>
              {award.team?.name ? <Muted style={styles.meta} numberOfLines={1}>{award.team.name}</Muted> : null}
            </View>
            <Glow active color={metalColor(award.reward?.art?.metal)} peak={0.25} delay={300 + index * 120} />
          </View>
        ))}
      </StaggerIn>
      </ScrollView>
      <Muted style={styles.meta}>Du findest sie in deinem Profil unter „Auszeichnungen“.</Muted>
      <Button label="Weiter" onPress={onClose} testID="reward-moment-close" />
    </Animated.View>
  );
}

/** Beim Zurückkommen in den Vordergrund höchstens so oft nach neuen Belohnungen fragen. */
export const UNSEEN_THROTTLE_MS = 5 * 60 * 1000;

export function RewardMomentHost({ queue = ceremonyQueue }: { queue?: CeremonyQueue }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [packages, setPackages] = useState<RewardAward[][]>([]);
  const queued = useRef(new Set<string>());
  // Läuft eine Erfolgs-Zeremonie, wartet die Belohnung - nie zwei Momente übereinander.
  const busy = useSyncExternalStore(queue.subscribe, () => Boolean(queue.getCurrent()), () => false);

  // Nachfragen beim Anmelden und beim Zurückkommen in den Vordergrund - dort höchstens alle UNSEEN_THROTTLE_MS, damit ein
  // kurzes Wechseln der App keinen Abruf auslöst. Schon eingereihte Belohnungen kommen nie ein zweites Mal.
  const lastFetch = useRef(0);
  const fetchUnseen = useCallback((isCurrent: () => boolean) => {
    lastFetch.current = Date.now();
    api.get<{ rewards?: RewardAward[] }>("/me/rewards/unseen").then(({ data }) => {
      if (!isCurrent()) return;
      const fresh = (data?.rewards || []).filter((award) => award?.reward && !queued.current.has(award.id));
      if (!fresh.length) return;
      fresh.forEach((award) => queued.current.add(award.id));
      setPackages((rest) => [...rest, ...rewardPackages(fresh)]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setPackages([]);
    queued.current = new Set();
    if (!userId) return undefined;
    let alive = true;
    const isCurrent = () => alive;
    fetchUnseen(isCurrent);
    const subscription = AppState.addEventListener?.("change", (state) => {
      if (state === "active" && Date.now() - lastFetch.current >= UNSEEN_THROTTLE_MS) fetchUnseen(isCurrent);
    });
    return () => {
      alive = false;
      subscription?.remove?.();
    };
  }, [fetchUnseen, userId]);

  const current = packages[0] || null;
  const close = useCallback(() => {
    if (!current) return;
    api.post("/me/rewards/seen", { ids: current.map((award) => award.id) }).catch(() => {});
    setPackages((rest) => rest.slice(1));
  }, [current]);

  if (!current || busy) return null;
  return (
    <Modal transparent animationType="none" visible onRequestClose={close} statusBarTranslucent>
      <View style={styles.backdrop}>
        <MomentCard key={current[0]?.id} rewards={current} onClose={close} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.78)", flex: 1, justifyContent: "center", padding: 18 },
  card: { backgroundColor: surfaces.s2, borderColor: "rgba(255,215,0,0.45)", borderRadius: radius.lg, borderWidth: 1, gap: 12, maxHeight: "90%", maxWidth: 440, padding: 18, width: "100%" },
  scroll: { flexGrow: 0, flexShrink: 1, maxHeight: 420 },
  scrollContent: { paddingBottom: 2 },
  eyebrow: { color: roles.honor, fontSize: 11, fontWeight: "900", letterSpacing: 1.6, textTransform: "uppercase" },
  title: { color: colors.white, fontSize: 24, fontWeight: "900", textTransform: "uppercase" },
  list: { gap: 8 },
  row: { alignItems: "center", backgroundColor: surfaces.s1, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: 12, overflow: "hidden", padding: 10 },
  text: { flex: 1, minWidth: 0 },
  kind: { fontSize: 10, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  name: { fontWeight: "900" },
  meta: { fontSize: 12 },
});
