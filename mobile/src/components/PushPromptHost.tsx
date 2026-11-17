import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthContext";
import { whenFriendsHintClosed } from "../lib/friendsHint";
import { anyModalOpen, whenNoModalOpen } from "../lib/modalGate";
import { motionEasing } from "../lib/motion";
import { isGuestUser } from "../live";
import { askPushPermission, getPushPermission } from "../notifications/PushService";
import { isPushAsked, onPushPrompt, shouldAskForPush, type PushPromptReason } from "../notifications/pushPrompt";
import { useSeasonOverlay } from "../seasons/anchors";
import { colors, motion, radius } from "../theme";
import { Button } from "./Button";
import { Glow, StaggerIn, useReduceMotion } from "./motion";
import { Body, Heading, Muted } from "./Text";

// „Sollen wir dich rufen, wenn du dran bist?“ (#1208): die eigene Erklärung vor der Frage von Android - ein Blatt von unten
// wie „Spielst du auch mit?“, nach einer Turnier- oder Event-Anmeldung (oder beim nächsten Öffnen, wenn das Team
// angemeldet wurde; lib: notifications/pushPrompt). Erst „Ja, rufen“ ruft die Frage des Systems auf. „Später“ und Zurück
// schließen still - gefragt wird erst bei der nächsten Anmeldung wieder. Ein offener Freunde-Hinweis und andere Fenster
// (Abstimmung, Belohnung, Zeremonie, Passkey, „Spielst du auch mit?“, lib/modalGate) gehen vor. Die Zeile über der Frage
// sagt den Anlass: die eigene Anmeldung oder das angemeldete Team.
// Bewegung: Das Blatt steigt auf (Verschieben und Deckkraft), die drei Zeilen staffeln, die Glocke leuchtet einmal auf;
// mit „Bewegung reduzieren“ steht alles sofort.

export const PUSH_PROMPT_TITLE = "Sollen wir dich rufen, wenn du dran bist?";
export const PUSH_PROMPT_LINES: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }[] = [
  { icon: "megaphone-outline", title: "Aufruf", text: "Du bist dran, dein Match geht los." },
  { icon: "checkmark-circle-outline", title: "Check-in", text: "Der Check-in ist offen." },
  { icon: "trophy-outline", title: "Ergebnis", text: "Dein Ergebnis steht fest." },
];

/** Die Zeile über der Frage, je nach Anlass. */
export const PUSH_PROMPT_EYEBROW: Record<PushPromptReason, string> = {
  own: "NACH DEINER ANMELDUNG",
  team: "DEIN TEAM IST ANGEMELDET",
};

const RISE_PX = 24;
/** Nach dem Schließen eines anderen Fensters kurz Luft lassen, bevor das Blatt kommt. */
export const AFTER_MODAL_MS = 350;

export function PushPromptHost() {
  const { user } = useAuth();
  const userId = user && !isGuestUser(user) ? user.id : null;
  const userRef = useRef(userId);
  userRef.current = userId;
  const [open, setOpen] = useState<PushPromptReason | null>(null);
  const openRef = useRef<PushPromptReason | null>(null);
  openRef.current = open;
  const [busy, setBusy] = useState(false);

  useEffect(() => onPushPrompt((request) => {
    const askedFor = userRef.current;
    if (!askedFor) return;
    void (async () => {
      await request.after;
      // Nie zwei Fragen übereinander: erst den Freunde-Hinweis beantworten lassen, dann jedes andere offene Fenster.
      await whenFriendsHintClosed();
      while (anyModalOpen()) {
        await whenNoModalOpen();
        await new Promise((resolve) => setTimeout(resolve, AFTER_MODAL_MS));
      }
      const [permission, asked] = await Promise.all([getPushPermission(), isPushAsked()]);
      if (!shouldAskForPush(permission, asked) || userRef.current !== askedFor || openRef.current) return;
      setOpen(request.reason || "own");
    })().catch(() => {});
  }), []);

  // Abmelden oder Kontowechsel: Das Blatt gehört dem vorigen Konto.
  useEffect(() => {
    setOpen(null);
  }, [userId]);

  const later = () => {
    if (!busy) setOpen(null);
  };

  const yes = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await askPushPermission();
    } finally {
      setBusy(false);
      setOpen(null);
    }
  };

  if (!open) return null;
  return <PushPromptSheet reason={open} busy={busy} onYes={() => { void yes(); }} onLater={later} />;
}

/** Das Blatt selbst - nur, solange es offen ist (Abstand unten, Saison-Deko und Bewegung erst dann). */
function PushPromptSheet({ reason, busy, onYes, onLater }: { reason: PushPromptReason; busy: boolean; onYes: () => void; onLater: () => void }) {
  const reduce = useReduceMotion();
  const insets = useSafeAreaInsets();
  useSeasonOverlay("push-prompt-sheet", true);
  const later = onLater;
  return (
    <Modal visible transparent animationType={reduce ? "none" : "fade"} onRequestClose={later} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={later} accessible={false} testID="push-prompt-backdrop" />
        <Rise still={reduce}>
          <View style={[styles.sheet, { paddingBottom: 24 + insets.bottom }]} testID="push-prompt-sheet" accessibilityViewIsModal>
            <View style={styles.top}>
              <View style={styles.bell}>
                <Ionicons name="notifications" size={22} color={colors.cyan} />
                <Glow active delay={motion.slow} radius={radius.lg} />
              </View>
              <View style={styles.flex}>
                <Muted style={styles.eyebrow} testID="push-prompt-eyebrow">{PUSH_PROMPT_EYEBROW[reason]}</Muted>
                <Heading style={styles.question} accessibilityRole="header">{PUSH_PROMPT_TITLE}</Heading>
              </View>
            </View>
            <StaggerIn style={styles.lines} play={!reduce}>
              {PUSH_PROMPT_LINES.map((line) => (
                <View key={line.title} style={styles.line} testID={`push-prompt-line-${line.title}`}>
                  <Ionicons name={line.icon} size={18} color={colors.gold} />
                  <Body style={styles.flex}>
                    <Body style={styles.lineTitle}>{line.title}: </Body>
                    {line.text}
                  </Body>
                </View>
              ))}
            </StaggerIn>
            <Muted style={styles.small}>Bei „Ja“ fragt Android einmal nach der Erlaubnis. Welche Meldungen kommen, stellst du unter Einstellungen → Benachrichtigungen ein.</Muted>
            <View style={styles.buttons}>
              <Button label="Ja, rufen" icon="notifications-outline" arrow={false} busy={busy} onPress={onYes} testID="push-prompt-yes" />
              <Button label="Später" variant="quiet" disabled={busy} onPress={later} testID="push-prompt-later" />
            </View>
          </View>
        </Rise>
      </View>
    </Modal>
  );
}

/** Das Blatt steigt beim Öffnen leise auf - nur Verschieben und Deckkraft; mit „Bewegung reduzieren“ steht es sofort. */
function Rise({ still, children }: { still: boolean; children: React.ReactNode }) {
  const value = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) {
      value.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(value, { toValue: 1, duration: motion.slow, easing: motionEasing, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [still, value]);
  if (still) return <View>{children}</View>;
  const translateY = value.interpolate({ inputRange: [0, 1], outputRange: [RISE_PX, 0] });
  return <Animated.View style={{ opacity: value, transform: [{ translateY }] }}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.75)", flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.black, borderColor: "rgba(255,215,0,0.3)", borderTopLeftRadius: 14, borderTopRightRadius: 14, borderWidth: 1, gap: 14, padding: 18 },
  top: { alignItems: "center", flexDirection: "row", gap: 12 },
  bell: { alignItems: "center", backgroundColor: "rgba(41,182,232,0.12)", borderRadius: radius.lg, height: 44, justifyContent: "center", width: 44 },
  flex: { flex: 1, gap: 2 },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  question: { fontSize: 22 },
  lines: { gap: 8 },
  line: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 },
  lineTitle: { fontWeight: "900" },
  small: { fontSize: 12 },
  buttons: { gap: 8 },
});
