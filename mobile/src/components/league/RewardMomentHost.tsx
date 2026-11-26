import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { ceremonyQueue, type CeremonyQueue } from "../../achievements/ceremony/queue";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../lib/api";
import { momentSubtitle, momentTitle, type RewardAward } from "../../lib/leagueRewards";
import {
  forgetMomentDone, markMomentDone, momentToken, momentVersion, momentsDoneHere, planCeremonies, subscribeMomentRequests, type CeremonyItem, type LeagueMoment,
} from "../../lib/leagueMoments";
import { openLink } from "../../lib/openLink";
import { playMoment } from "../../lib/tournamentHaptics";
import { navigateToUrl, openDetail } from "../../navigation/rootNavigation";
import { colors, motion, radius, roles, surfaces } from "../../theme";
import { Button } from "../Button";
import { useReduceMotion } from "../motion";
import { Muted } from "../Text";
import { RewardMomentList } from "./RewardMomentList";
import { SeasonMomentCard } from "./SeasonMoment";
import { otherModalOpen, subscribeModals, useModalGate } from "../../lib/modalGate";

// Zeremonien der Liga (#2173, #2584; Web: components/tls/rewards/RewardWatcher.jsx, RewardMoment.jsx, league/moment/SeasonMoment.jsx,
// docs/LIGA.md F.4 und F.8): Nach dem Anmelden fragt die App, welche Saisonende-Momente und Belohnungen noch nicht gefeiert wurden, und
// zeigt sie nacheinander - zuerst der Ausgang der Season (Meister, Aufstieg, Abstieg), dann je Staffel ein Paket Belohnungen. Nie zugleich
// mit einer Erfolgs-Zeremonie (die wartet nicht, die Liga wartet auf sie), nie zwei Fenster übereinander.
// Ein Moment wird direkt vor dem Zeigen für dieses Gerät geholt (lib/leagueMoments: Geräte-Schlüssel je Gerät und Konto) und erst nach
// dem Schließen als fertig gemeldet; der Meister bringt seine Belohnungen als zweite Karte mit. Belohnungen gelten nach dem Schließen als
// gesehen. Detail-Runde der Belohnungen: die Karte hebt sich an, die Belohnungen bauen sich gestaffelt auf, jede Vorlage leuchtet einmal
// in ihrem Metall auf, dazu einmal die Sieg-Vibration. Mit „Bewegung reduzieren“ steht alles sofort da, die Vibration bleibt.

const ease = Easing.bezier(motion.ease[0], motion.ease[1], motion.ease[2], motion.ease[3]);

type HostItem = CeremonyItem & { claimed?: boolean };

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
        <RewardMomentList rewards={rewards} />
      </ScrollView>
      <Muted style={styles.meta}>Du findest sie in deinem Profil unter „Auszeichnungen“.</Muted>
      <Button label="Weiter" onPress={onClose} testID="reward-moment-close" />
    </Animated.View>
  );
}

/** Beim Zurückkommen in den Vordergrund höchstens so oft nach neuen Momenten und Belohnungen fragen. */
export const UNSEEN_THROTTLE_MS = 5 * 60 * 1000;

/** Fertig melden: erst die Marke auf dem Gerät (mit dem Stand des Moments, Nr. 277), dann der Server - kommt er an, geht die Marke
 * wieder. Bewusst still. */
function reportDone(userId: string, moment: LeagueMoment) {
  void markMomentDone(userId, moment.id, momentVersion(moment))
    .then(() => api.post("/me/league-moments/done", { ids: [moment.id] }))
    .then(() => forgetMomentDone(userId, moment.id))
    .catch(() => {});
}

const MODAL_ID = "reward-moment";
const otherOpen = () => otherModalOpen(MODAL_ID);

export function RewardMomentHost({ queue = ceremonyQueue }: { queue?: CeremonyQueue }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [items, setItems] = useState<HostItem[]>([]);
  const queued = useRef(new Set<string>());
  // Läuft eine Erfolgs-Zeremonie oder ist ein anderes Fenster offen (Abstimmung, Passkey-Einladung, „Spielst du auch mit?“), wartet die
  // Liga - nie zwei Fenster übereinander. Erst wenn alles zu ist, wird ein Moment für dieses Gerät geholt.
  const ceremony = useSyncExternalStore(queue.subscribe, () => Boolean(queue.getCurrent()), () => false);
  const blocked = useSyncExternalStore(subscribeModals, otherOpen, () => false);
  const busy = ceremony || blocked;

  // Nachfragen beim Anmelden und beim Zurückkommen in den Vordergrund - dort höchstens alle UNSEEN_THROTTLE_MS, damit ein
  // kurzes Wechseln der App keinen Abruf auslöst. Schon Eingereihtes kommt nie ein zweites Mal. Bewusst still: Feiern sind eine Zugabe.
  const lastFetch = useRef(0);
  const fetchUnseen = useCallback((isCurrent: () => boolean) => {
    if (!userId) return;
    lastFetch.current = Date.now();
    const moments = api.get<{ moments?: LeagueMoment[] }>("/me/league-moments/unseen")
      .then(({ data }) => (Array.isArray(data?.moments) ? data.moments : []), () => [] as LeagueMoment[]);
    const rewards = api.get<{ rewards?: RewardAward[] }>("/me/rewards/unseen")
      .then(({ data }) => (Array.isArray(data?.rewards) ? data.rewards : []), () => [] as RewardAward[]);
    const done = momentsDoneHere(userId).catch(() => new Map<string, string>());
    void Promise.all([moments, rewards, done]).then(([momentRows, rewardRows, doneHere]) => {
      // Eine späte Antwort für ein anderes Konto (Kontowechsel) oder nach dem Abmelden zählt nie.
      if (!isCurrent()) return;
      const plan = planCeremonies(momentRows, rewardRows, { queued: queued.current, doneHere });
      plan.reportDone.forEach((moment) => reportDone(userId, moment));
      plan.stale.forEach((id) => { void forgetMomentDone(userId, id).catch(() => {}); });
      if (plan.items.length) setItems((rest) => [...rest, ...plan.items]);
    });
  }, [userId]);

  useEffect(() => {
    setItems([]);
    queued.current = new Set();
    if (!userId) return undefined;
    // Je Konto ein eigenes Flag: Nach einem Kontowechsel bleibt das alte auf „vorbei“ - eine späte Antwort für A landet nie bei B.
    let alive = true;
    const isCurrent = () => alive;
    fetchUnseen(isCurrent);
    const subscription = AppState.addEventListener?.("change", (state) => {
      if (state === "active" && Date.now() - lastFetch.current >= UNSEEN_THROTTLE_MS) fetchUnseen(isCurrent);
    });
    // „Moment ansehen“ am Hinweis (ohne Zählung, nur einmal in der Schlange) und das Antippen der Nachricht (gleich nachsehen).
    const unsubscribe = subscribeMomentRequests((request) => {
      if (request.kind === "fetch") {
        fetchUnseen(isCurrent);
        return;
      }
      const key = `replay:${request.moment.id}`;
      setItems((rest) => (rest.some((item) => item.key === key) ? rest : [...rest, { kind: "moment", key, moment: request.moment, rewards: [], replay: true }]));
    });
    return () => {
      alive = false;
      subscription?.remove?.();
      unsubscribe();
    };
  }, [fetchUnseen, userId]);

  const head = items[0] || null;

  // Direkt vor dem Zeigen: den Moment für dieses Gerät holen. Nur was der Server zuspricht, wird gezeigt. Hatte ein anderes Gerät ihn
  // schon (oder scheitert das Holen), bleibt er für den nächsten Start - die Belohnungen des Meisters zeigt dieses Gerät dann allein.
  useEffect(() => {
    if (!userId || !head || head.kind !== "moment" || head.replay || head.claimed !== undefined || busy) return undefined;
    let current = true;
    const id = head.moment.id;
    momentToken(userId)
      .then((token) => api.post<{ claimed?: string[] }>("/me/league-moments/seen", { ids: [id], token }))
      .then(({ data }) => Array.isArray(data?.claimed) && data.claimed.includes(id), () => false)
      .then((claimed) => {
        if (!current) return;
        setItems((rest) => {
          const first = rest[0];
          if (!first || first.key !== head.key || first.kind !== "moment") return rest;
          if (claimed) return [{ ...first, claimed: true }, ...rest.slice(1)];
          // Nicht geholt: Beim nächsten Nachsehen (Vordergrund nach der Drossel, Push) kommt er wieder in Frage, nicht erst nach einem Neustart.
          queued.current.delete(first.key);
          const alone: HostItem[] = first.rewards.length ? [{ kind: "rewards", key: `rewards:${first.rewards.map((award) => award.id).join("-")}`, rewards: first.rewards }] : [];
          return [...alone, ...rest.slice(1)];
        });
      });
    return () => { current = false; };
  }, [busy, head, userId]);

  const close = useCallback((rewardsShown = true) => {
    if (!head) return;
    if (head.kind === "moment") {
      if (!head.replay && head.claimed && userId) reportDone(userId, head.moment);
      // Die Belohnungen des Meisters sind gesehen, wenn die zweite Karte kam - schließt die Person vorher, kommen sie später wie bisher.
      if (!head.replay && rewardsShown && head.rewards.length) api.post("/me/rewards/seen", { ids: head.rewards.map((award) => award.id) }).catch(() => {});
    } else {
      api.post("/me/rewards/seen", { ids: head.rewards.map((award) => award.id) }).catch(() => {});
    }
    setItems((rest) => rest.slice(1));
  }, [head, userId]);

  const visible = Boolean(head && !busy && (head.kind === "rewards" || head.replay || head.claimed));
  // Nie zwei Fenster übereinander (#1208): die Frage nach Benachrichtigungen wartet.
  useModalGate(MODAL_ID, visible);

  if (!head || !visible) return null;
  return (
    <Modal transparent animationType="none" visible onRequestClose={() => close(false)} statusBarTranslucent>
      <View style={styles.backdrop}>
        {head.kind === "moment" ? (
          <SeasonMomentCard
            key={head.key}
            item={head}
            onClose={close}
            onNextStep={(moment) => {
              close(false);
              // „Startrecht zusagen“: zur Teamseite mit dem Antrag - sonst dorthin, wohin der Server zeigt.
              if (moment.team_id) openDetail("TeamDetail", { id: moment.team_id });
              else navigateToUrl(moment.next_step?.url);
            }}
            onFinal={(moment) => {
              close(false);
              openLink(moment.url);
            }}
          />
        ) : <MomentCard key={head.key} rewards={head.rewards} onClose={() => close()} />}
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
  meta: { fontSize: 12 },
});
