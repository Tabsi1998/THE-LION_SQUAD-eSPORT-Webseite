import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Alert, Animated, Clipboard, Linking, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { Button } from "../Button";
import { Card } from "../Card";
import { useReduceMotion } from "../FadeIn";
import { Body, Muted } from "../Text";
import { api } from "../../lib/api";
import { MOTION, motionEasing } from "../../lib/motion";
import { SUBSCRIBE_GUIDE, personalFeedUrls, subscriptionLine, type Subscription } from "../../lib/myCalendar";
import { WEB_BASE_URL } from "../../lib/siteUrls";
import { viennaDateTime } from "../../lib/vienna";
import { colors, radius, roles } from "../../theme";

// Mein Kalender-Abo (#1189, #1788): der persönliche Link - nur die eigenen Termine, für die Kalender-App am Handy. Ein
// Baustein für „Mein Kalender“ und den Eintrag in den Einstellungen; dieselben Endpunkte und Worte wie im Web
// (frontend/src/components/calendar/PersonalFeedCard.jsx). Gespeichert ist am Server nur ein Hash: die Adresse steht nur
// direkt nach dem Erzeugen da, nur in diesem Zustand - nie im Speicher des Geräts, nie im Protokoll. „Neu erzeugen“
// sperrt die alte Adresse, „Abschalten“ alle - beides mit Rückfrage.

type Fresh = { https: string; webcal: string; google: string };
const PROBLEM = "Das hat gerade nicht geklappt. Bitte später noch einmal.";
const COPIED_MS = 2000;

export function PersonalFeedCard({ onStatus, style, testID = "calendar-personal" }: {
  onStatus?: (status: Subscription) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const [status, setStatus] = useState<Subscription | null>(null);
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [guide, setGuide] = useState(false);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  const remember = useCallback((next: Subscription) => {
    setStatus(next);
    statusRef.current?.(next);
  }, []);

  useEffect(() => {
    let alive = true;
    api.get<Subscription>("/calendar/personal")
      .then(({ data }) => { if (alive) remember({ active: Boolean(data?.active), created_at: data?.created_at || null, last_used_at: data?.last_used_at || null }); })
      .catch(() => { if (alive) remember({ active: false }); });
    return () => {
      alive = false;
    };
  }, [remember]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setProblem("");
    try {
      await action();
    } catch {
      setProblem(PROBLEM);
    } finally {
      setBusy(false);
    }
  };
  const issue = () => run(async () => {
    const { data } = await api.post<{ path: string; created_at?: string | null }>("/calendar/personal");
    if (!data?.path) throw new Error("ohne Adresse");
    setFresh(personalFeedUrls(WEB_BASE_URL, data.path));
    remember({ active: true, created_at: data.created_at || null, last_used_at: null });
  });
  const revoke = () => run(async () => {
    await api.delete("/calendar/personal");
    setFresh(null);
    remember({ active: false });
  });

  const askCreate = () => Alert.alert(
    "Persönliches Abo einrichten?",
    "Du bekommst eine private Adresse nur mit deinen Terminen. Wir zeigen sie nur dieses eine Mal – gib sie nicht weiter.",
    [{ text: "Abbrechen", style: "cancel" }, { text: "Einrichten", onPress: () => { void issue(); } }],
  );
  const askRenew = () => Alert.alert(
    "Neue Adresse erzeugen?",
    "Die alte Adresse gilt danach nicht mehr – Kalender damit bekommen keine Termine mehr.",
    [{ text: "Abbrechen", style: "cancel" }, { text: "Ja, neu erzeugen", style: "destructive", onPress: () => { void issue(); } }],
  );
  const askRevoke = () => Alert.alert(
    "Abo abschalten?",
    "Dein Abo endet: Kalender mit dieser Adresse bekommen keine Termine mehr. Einrichten kannst du es jederzeit neu.",
    [{ text: "Abbrechen", style: "cancel" }, { text: "Ja, abschalten", style: "destructive", onPress: () => { void revoke(); } }],
  );

  if (!status) return null;
  return (
    <Card style={[styles.card, style]} testID={testID}>
      <View style={styles.eyebrow}>
        <Ionicons name="calendar-outline" size={15} color={roles.honor} />
        <Muted style={styles.eyebrowText}>AUTOMATISCH IN DEINEN KALENDER</Muted>
      </View>
      <Muted>
        Einmal abonnieren – danach erscheint jede Anmeldung von selbst im Handy- oder PC-Kalender: Events, Turniere (auch mit deinem Team), gefahrene Fast Laps, zugesagte Versammlungen und deine Schichten. Die Adresse ist privat – gib sie nicht weiter.
      </Muted>
      {fresh ? (
        <View style={styles.block}>
          <View style={styles.address}>
            <Body selectable style={styles.addressText} testID={`${testID}-url`} accessibilityLabel="Deine Abo-Adresse">{fresh.https}</Body>
          </View>
          <View style={styles.buttons}>
            <CopyButton url={fresh.https} testID={`${testID}-copy`} />
            <Button label="Im Kalender öffnen" compact icon="open-outline" arrow={false} onPress={() => { Linking.openURL(fresh.webcal).catch(() => setProblem("Keine Kalender-App gefunden – kopier die Adresse und füg sie im Kalender ein.")); }} testID={`${testID}-webcal`} />
            <Button label="Google Kalender" variant="quiet" compact onPress={() => { Linking.openURL(fresh.google).catch(() => undefined); }} testID={`${testID}-google`} />
          </View>
          <Muted style={styles.once} testID={`${testID}-once`}>Kopier sie jetzt: Wir zeigen sie nur dieses eine Mal.</Muted>
        </View>
      ) : status.active ? (
        <Muted testID={`${testID}-active`}>
          {subscriptionLine(status, (value, options) => viennaDateTime(value, options))} Die Adresse zeigen wir nur beim Erzeugen – brauchst du sie wieder, erzeug eine neue.
        </Muted>
      ) : null}
      {problem ? <Muted style={styles.problem} accessibilityRole="alert" testID={`${testID}-problem`}>{problem}</Muted> : null}
      <View style={styles.buttons}>
        {!status.active ? (
          <Button label="Abo einrichten" compact busy={busy} onPress={askCreate} testID={`${testID}-create`} />
        ) : (
          <>
            <Button label="Neu erzeugen" variant="quiet" compact busy={busy} onPress={askRenew} testID={`${testID}-renew`} />
            <Button label="Abschalten" variant="danger" compact busy={busy} onPress={askRevoke} testID={`${testID}-revoke`} />
          </>
        )}
      </View>
      <Pressable
        onPress={() => setGuide((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: guide }}
        style={({ pressed }) => [styles.guideToggle, pressed && styles.pressed]}
        testID={`${testID}-guide`}
      >
        <Body style={styles.guideToggleText}>So geht&apos;s in deinem Kalender</Body>
        <Ionicons name={guide ? "chevron-up" : "chevron-down"} size={16} color={colors.cyan} />
      </Pressable>
      {guide ? (
        <View style={styles.guide} testID={`${testID}-guide-list`}>
          {SUBSCRIBE_GUIDE.map((entry) => (
            <Muted key={entry.key}><Muted style={styles.guideLabel}>{entry.label}: </Muted>{entry.text}</Muted>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/**
 * Kopieren mit kurzem Haken-Moment (#1788): leichte Vibration, das Symbol wird zum Haken, „Kopiert“ steht zwei Sekunden
 * da und der Knopf federt einmal nach - mit „Bewegung reduzieren“ nur der Wechsel ohne Bewegung. Der Vorleser hört
 * „Abo-Adresse kopiert“.
 */
function CopyButton({ url, testID }: { url: string; testID: string }) {
  const reduce = useReduceMotion();
  const [copied, setCopied] = useState(false);
  const pop = useRef(new Animated.Value(1)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = () => {
    Clipboard.setString(url);
    // Ohne Vibration (Gerät, Einstellung) bleibt es still - der Haken zeigt es trotzdem.
    Promise.resolve(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => undefined);
    AccessibilityInfo.announceForAccessibility("Abo-Adresse kopiert");
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    if (!reduce) {
      pop.setValue(0.94);
      Animated.timing(pop, { toValue: 1, duration: MOTION.fast, easing: motionEasing, useNativeDriver: true }).start();
    }
  };

  // Feste Mindestbreite: „Kopieren“ und „Kopiert“ springen nicht, und Android bricht Symbol und Text nicht um
  // (Geräteprobe #1788: ohne sie rutschte das Symbol über den Text).
  return (
    <Animated.View style={{ transform: [{ scale: pop }] }}>
      <Button
        label={copied ? "Kopiert" : "Kopieren"}
        variant="secondary"
        compact
        icon={copied ? "checkmark" : "copy-outline"}
        accessibilityLabel={copied ? "Abo-Adresse kopiert" : "Abo-Adresse kopieren"}
        onPress={copy}
        testID={testID}
        style={styles.copy}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderColor: "rgba(255,215,0,0.4)",
    gap: 10,
  },
  eyebrow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  eyebrowText: {
    color: roles.honor,
    fontWeight: "900",
    letterSpacing: 1,
  },
  block: {
    gap: 10,
  },
  address: {
    backgroundColor: colors.black,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  addressText: {
    fontFamily: "monospace",
    fontSize: 12,
  },
  copy: {
    minWidth: 132,
  },
  buttons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  once: {
    color: roles.warn,
  },
  problem: {
    color: colors.live,
  },
  guideToggle: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 48,
  },
  guideToggleText: {
    color: colors.cyan,
    fontWeight: "800",
  },
  guide: {
    gap: 6,
  },
  guideLabel: {
    color: colors.white,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.72,
  },
});
