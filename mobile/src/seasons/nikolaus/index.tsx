import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Animated, Easing, Image, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../auth/AuthContext";
import { Body } from "../../components/Text";
import { api } from "../../lib/api";
import { stickerSource } from "../../lib/stickers";
import { isGuestUser } from "../../live";
import { navigationRef } from "../../navigation/rootNavigation";
import { useScreenFocused } from "../anchors";
import { greetingShownToday, markGreetingShown } from "../christmas/greeting";
import { TAB_BAR } from "../halloween";
import { screenClass } from "../intensity";
import { anyOverlayOpen, subscribeQuiet } from "../quiet";
import { useSeason, type ActiveSeason } from "../SeasonProvider";
import { BootSvg, VoucherSvg } from "./BootSvg";
import { CARD_MS, OPEN_MS, bootWidth, cardFor, type BootCard, type OpenResult } from "./boot";

// Nikolaus in der App (X3 #736, S11 #642 „Stiefel im Tab Mehr“): am 6. Dezember steht der Stiefel im Tab „Mehr“ auf
// der Kante der ersten Karte, das Tab-Symbol wird zum Stiefel, und einmal am Tag sagt eine Karte „Der Nikolaus war da“
// mit dem Weg zum Stiefel. Antippen: der Stiefel wackelt (leichtes Tippen in der Hand), der Gutschein steigt heraus,
// darunter erscheint die Karte mit dem Sticker, den der Nikolaus dieser Person bringt (einer je Person und Jahr, der
// Server entscheidet) - beim neuen Sticker ein kurzes Erfolgs-Tippen. Danach steht der Stiefel ruhig und gekippt da.
// „dezent“ und „Bewegung reduzieren“: nichts wackelt, die Karte steht gleich da.

export const SHELF_HEIGHT = 58;
export const HINT_DELAY_MS = 1800;
export const HINT_MS = 12000;
const HINT_KEY = "nikolaus-hint";

export type BootState = { active: boolean; year?: number; opened: boolean; sticker?: OpenResult["sticker"] };

let pendingState: Promise<BootState | null> | null = null;
let pendingUser: string | null = null;

/** Der Stiefel für diese Person - Stiefel und Hinweis fragen einmal gemeinsam; ohne Konto (Gast): nichts. */
export function loadBootState(userId: string | null): Promise<BootState | null> {
  if (!userId) return Promise.resolve(null);
  if (pendingUser !== userId || !pendingState) {
    pendingUser = userId;
    pendingState = api.get<BootState>("/seasonal/nikolaus").then(({ data }) => data || null).catch(() => null);
  }
  return pendingState;
}

/** Nach dem Öffnen weiß der Hinweis, dass er nicht mehr kommen muss. */
function rememberOpened(userId: string, state: BootState) {
  pendingUser = userId;
  pendingState = Promise.resolve(state);
}

/** Nur für Tests: den gemeinsamen Abruf vergessen. */
export function resetBootState() {
  pendingState = null;
  pendingUser = null;
}

function useMember(): string | null {
  const { user } = useAuth();
  return user && !isGuestUser(user) ? user.id : null;
}

/** Die Karte unter dem Stiefel: Sticker, Gruß, wo man ihn findet. Antippen schließt. */
function ShelfCard({ card, onClose, width }: { card: BootCard; onClose: () => void; width: number }) {
  const source = card.sticker ? stickerSource(card.sticker.url) : null;
  return (
    <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={`${card.title}. ${card.sticker ? `${card.sticker.name}. ` : ""}${card.text} Schließen`} style={[styles.card, { width }]} testID="nikolaus-card">
      <View style={styles.cardTail} />
      {source ? <Image source={source} resizeMode="contain" style={styles.cardSticker} testID="nikolaus-card-sticker" /> : null}
      <View style={styles.cardTexts}>
        <Body style={styles.cardTitle}>{card.title}</Body>
        {card.sticker ? <Body style={styles.cardName}>{card.sticker.name}</Body> : null}
        <Body style={styles.cardText} testID="nikolaus-card-text">{card.text}</Body>
      </View>
    </Pressable>
  );
}

/**
 * Der Stiefel im Tab „Mehr“: steht rechts im Kopf auf der Kante der ersten Karte. Angemeldet weiß er, ob er heuer schon
 * geöffnet wurde; Antippen öffnet ihn - die Antwort des Servers läuft parallel zum Wackeln, die Karte kommt, wenn
 * beides fertig ist. Selten ein kleines Wippen, solange er voll ist und man hinsieht.
 */
// Der Stiefel im Dashboard-Kopf (#852) bittet „öffnen“ - der Stiefel unter „Mehr“ erledigt es, sobald er zu sehen ist.
let openRequested = false;
const openListeners = new Set<() => void>();

/** Den Stiefel bitten, sich zu öffnen, sobald er zu sehen ist. */
export function requestBootOpen(): void {
  openRequested = true;
  openListeners.forEach((listener) => listener());
}

/** Für Tests: keine offene Bitte. */
export function resetBootOpenRequest(): void {
  openRequested = false;
}

/** Ab dem Moment, in dem „Mehr“ zu sehen ist, bis der Stiefel sich öffnet - man soll ihn dabei sehen. */
export const OPEN_AFTER_MS = 450;

/** Der kleine Stiefel im Dashboard-Kopf unter dem Kranz (#852): ein Tipp führt zu „Mehr“ und öffnet ihn dort. */
export function NikolausWidget({ season }: { season: ActiveSeason; screen: string }) {
  const go = () => {
    requestBootOpen();
    if (navigationRef.isReady()) navigationRef.navigate("More", { screen: "MoreHub" } as never);
  };
  return (
    <Pressable onPress={go} accessibilityRole="button" accessibilityLabel={`${season.texts?.greeting || "Der Nikolaus war da"} – zum Stiefel`} hitSlop={6} style={styles.widget} testID="nikolaus-widget">
      <BootSvg height={26} />
    </Pressable>
  );
}

export function NikolausShelf({ season }: { season: ActiveSeason; screen: string }) {
  const userId = useMember();
  const { reducedMotion } = useSeason();
  const focused = useScreenFocused();
  const { width } = useWindowDimensions();
  const still = season.effective === "subtle" || reducedMotion;
  const greeting = season.texts?.greeting || "";
  const [opened, setOpened] = useState(false);
  const [phase, setPhase] = useState<"idle" | "opening" | "card">("idle");
  const [card, setCard] = useState<BootCard | null>(null);
  // Zwei getrennte Werte: das seltene Wippen räumt beim Phasenwechsel auf - mit einem gemeinsamen Wert brach das
  // Aufräumen das Wackeln beim Öffnen ab (und mit ihm das Aufsteigen des Gutscheins).
  const idle = useRef(new Animated.Value(0)).current;
  const wobble = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  // Bitte aus dem Dashboard-Kopf (#852): ist „Mehr“ zu sehen, öffnet sich der Stiefel kurz danach von selbst.
  const [asked, setAsked] = useState(() => openRequested);
  useEffect(() => {
    const listener = () => setAsked(true);
    openListeners.add(listener);
    return () => {
      openListeners.delete(listener);
    };
  }, []);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setOpened(false);
    void loadBootState(userId).then((state) => {
      if (!cancelled && state?.active) setOpened(Boolean(state.opened));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  useEffect(() => () => timers.current.forEach((handle) => clearTimeout(handle)), []);

  // Selten ein kleines Wippen - nur voll, sichtbar und mit Bewegung.
  useEffect(() => {
    if (still || opened || !focused || phase !== "idle") return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(8000),
        Animated.timing(idle, { toValue: -0.5, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(idle, { toValue: 0.38, duration: 220, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(idle, { toValue: 0, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      idle.setValue(0);
    };
  }, [still, opened, focused, phase, idle]);

  const close = () => {
    timers.current.forEach((handle) => clearTimeout(handle));
    timers.current = [];
    setCard(null);
    setPhase("idle");
    // Erst jetzt zurück: geöffnet ist der Gutschein ohnehin weg; ohne Konto steckt er danach wieder im Stiefel. Beim
    // Erscheinen der Karte zurückgesetzt, blitzte er sonst kurz im Stiefel auf, bevor der Stiefel als benutzt galt.
    rise.setValue(0);
  };

  const open = async () => {
    if (busy.current) return;
    busy.current = true;
    close();
    // Ein Versprechen oder nichts (ältere Geräte): beides geht durch Promise.resolve.
    void Promise.resolve(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => {});
    const started = Date.now();
    if (!still) {
      setPhase("opening");
      wobble.setValue(0);
      rise.setValue(0);
      Animated.parallel([
        Animated.sequence([
          Animated.timing(wobble, { toValue: -1, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(wobble, { toValue: 0.75, duration: 180, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(wobble, { toValue: -0.375, duration: 150, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(wobble, { toValue: 0, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]),
        Animated.timing(rise, { toValue: 1, duration: OPEN_MS - 150, delay: 150, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
    let next: BootCard;
    if (!userId) {
      next = cardFor({ reason: "guest", greeting });
    } else {
      try {
        const { data } = await api.post<OpenResult>("/seasonal/nikolaus/open");
        next = cardFor({ result: data, greeting });
        setOpened(true);
        rememberOpened(userId, { active: true, year: data?.year, opened: true, sticker: data?.sticker || null });
      } catch (error) {
        const status = (error as { response?: { status?: number } } | null)?.response?.status;
        next = cardFor({ reason: status === 409 ? "closed" : "error", greeting });
      }
    }
    const wait = still ? 0 : Math.max(0, OPEN_MS - (Date.now() - started));
    timers.current.push(setTimeout(() => {
      busy.current = false;
      setCard(next);
      setPhase("card");
      if (next.kind === "new") void Promise.resolve(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)).catch(() => {});
    }, wait));
    timers.current.push(setTimeout(close, wait + CARD_MS));
  };
  useEffect(() => {
    if (!asked || !focused) return undefined;
    // Erst beim Öffnen gilt die Bitte als erledigt - wer vorher wegwischt, bekommt sie beim nächsten Mal.
    const timer = setTimeout(() => {
      setAsked(false);
      if (!openRequested) return;
      openRequested = false;
      void open();
    }, OPEN_AFTER_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, focused]);

  const used = opened && phase !== "opening";
  const boxWidth = bootWidth(SHELF_HEIGHT);
  // Drehen um die Sohle: der Kasten ist doppelt so hoch und hat seine Mitte auf der Sohle (die Bauweise, die auf
  // Android sauber dreht - siehe Kranz und Katze).
  const rotate = Animated.add(idle, wobble).interpolate({ inputRange: [-1, 1], outputRange: ["-8deg", "8deg"], extrapolate: "clamp" });
  const voucherStyle = {
    opacity: rise.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 1, 0] }),
    transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, -SHELF_HEIGHT * 0.4] }) }],
  };
  return (
    <View pointerEvents="box-none" style={styles.shelf} testID="nikolaus-shelf">
      <Animated.View pointerEvents="box-none" style={[styles.pivot, { width: boxWidth, height: SHELF_HEIGHT * 2, transform: [{ rotate }] }]}>
        <Pressable
          onPress={() => void open()}
          accessibilityRole="button"
          accessibilityLabel={used ? "Nikolausstiefel – schon geöffnet, noch einmal ansehen" : "Nikolausstiefel öffnen"}
          hitSlop={8}
          style={{ width: boxWidth, height: SHELF_HEIGHT }}
          testID="nikolaus-boot"
          accessibilityState={{ busy: phase === "opening" }}
        >
          {!used ? (
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, voucherStyle]} testID="nikolaus-voucher">
              <VoucherSvg height={SHELF_HEIGHT} />
            </Animated.View>
          ) : null}
          <BootSvg height={SHELF_HEIGHT} used={used} />
        </Pressable>
      </Animated.View>
      {card ? <ShelfCard card={card} onClose={close} width={Math.min(320, width - 36)} /> : null}
    </View>
  );
}

/** Das Tab-Symbol „Mehr“ am Nikolaustag: der Stiefel. */
export function NikolausTabIcon({ size }: { size: number }) {
  return <BootSvg height={size + 6} />;
}

type HintState = "waiting" | "open" | "done";

/**
 * Der Hinweis über der Tab-Leiste: einmal am Tag „Der Nikolaus war da“ mit dem Weg in den Tab „Mehr“ - nicht für wen,
 * der heuer schon geöffnet hat, nicht auf stillen Screens, nicht über einem Dialog und nicht im Tab „Mehr“ selbst.
 */
export function NikolausGreeting({ season, screen }: { season: ActiveSeason; screen: string }) {
  const userId = useMember();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [state, setState] = useState<HintState>("waiting");
  const [covered, setCovered] = useState(() => anyOverlayOpen());
  useEffect(() => subscribeQuiet((quiet) => setCovered(quiet.overlays.length > 0)), []);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") setState((current) => (current === "done" ? "waiting" : current));
    });
    return () => subscription.remove();
  }, []);
  const allowed = screenClass(screen) !== "quiet" && screen !== "MoreHub" && !covered;
  useEffect(() => {
    if (state === "done") return undefined;
    if (!allowed) {
      if (state === "open") setState("done");
      return undefined;
    }
    if (state === "open") {
      const hide = setTimeout(() => setState("done"), HINT_MS);
      return () => clearTimeout(hide);
    }
    let cancelled = false;
    let show: ReturnType<typeof setTimeout> | null = null;
    void Promise.all([greetingShownToday(HINT_KEY), loadBootState(userId)]).then(([shown, boot]) => {
      if (cancelled) return;
      if (shown || boot?.opened) {
        setState("done");
        return;
      }
      show = setTimeout(() => {
        if (cancelled) return;
        void markGreetingShown(HINT_KEY);
        setState("open");
      }, HINT_DELAY_MS);
    });
    return () => {
      cancelled = true;
      if (show) clearTimeout(show);
    };
  }, [allowed, state, userId]);
  const text = useMemo(() => (userId ? "Im Tab „Mehr“ steht dein Stiefel – schau hinein!" : "Im Tab „Mehr“ steht ein Stiefel. Wer angemeldet ist, findet darin einen Sticker."), [userId]);
  if (state !== "open") return null;
  const toBoot = () => {
    setState("done");
    if (navigationRef.isReady()) navigationRef.navigate("More", { screen: "MoreHub" } as never);
  };
  return (
    <View pointerEvents="box-none" style={[styles.hintWrap, { bottom: TAB_BAR + Math.max(insets.bottom, 8) + 12, width: Math.min(width - 32, 440), left: Math.max(16, (width - 440) / 2) }]}>
      <Pressable onPress={() => setState("done")} accessible={false} style={styles.hint} testID="nikolaus-hint">
        <BootSvg height={44} />
        <View style={styles.hintTexts}>
          <Body style={styles.cardTitle}>{season.texts?.greeting || "Der Nikolaus war da"}</Body>
          <Body style={styles.hintText}>{text}</Body>
          <Pressable accessibilityRole="button" onPress={toBoot} style={styles.hintButton} hitSlop={6} testID="nikolaus-hint-go">
            <Body style={styles.hintButtonText}>Zum Stiefel</Body>
          </Pressable>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  widget: { width: 26, height: 30, alignItems: "center", justifyContent: "flex-end" },
  // Der Platz rechts im Kopf: die Sohle steht auf der Oberkante der ersten Karte (18 Punkte Abstand im Screen), links
  // neben der schwebenden Glocke (40 Punkte breit, 14 vom Rand - der Kopf beginnt 18 vom Rand).
  shelf: { position: "absolute", right: 48, bottom: -18, alignItems: "flex-end", zIndex: 3 },
  pivot: { justifyContent: "flex-start", marginBottom: -SHELF_HEIGHT },
  card: { position: "absolute", top: SHELF_HEIGHT + 10, right: -48, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingLeft: 12, paddingRight: 14, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255, 200, 140, 0.35)", backgroundColor: "#170d0e", shadowColor: "#000", shadowOpacity: 0.55, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  cardTail: { position: "absolute", top: -7, right: 66, width: 12, height: 12, backgroundColor: "#170d0e", borderLeftWidth: 1, borderTopWidth: 1, borderColor: "rgba(255, 200, 140, 0.35)", transform: [{ rotate: "45deg" }] },
  cardSticker: { width: 64, height: 64 },
  cardTexts: { flex: 1, minWidth: 0 },
  cardTitle: { color: "#ffc857", fontSize: 11, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" },
  cardName: { color: "#fff4e6", fontSize: 17, fontWeight: "800", marginTop: 2 },
  cardText: { color: "rgba(255, 244, 230, 0.85)", fontSize: 14, lineHeight: 19, marginTop: 2 },
  hintWrap: { position: "absolute" },
  hint: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255, 200, 140, 0.35)", backgroundColor: "#170d0e", shadowColor: "#000", shadowOpacity: 0.55, shadowRadius: 25, shadowOffset: { width: 0, height: 18 }, elevation: 12 },
  hintTexts: { flex: 1, minWidth: 0 },
  hintText: { color: "#fff4e6", fontSize: 15, lineHeight: 20, marginTop: 2 },
  hintButton: { alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: "#d4282c" },
  hintButtonText: { color: "#ffffff", fontSize: 13, fontWeight: "800" },
});
