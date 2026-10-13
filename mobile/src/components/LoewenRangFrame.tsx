import { Canvas, Picture, Skia, createPicture, useImage, type SkPicture } from "@shopify/react-native-skia";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, AppState, Image, PixelRatio, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useFrameCallback, useSharedValue, withDelay, withSequence, withTiming, type FrameInfo } from "react-native-reanimated";
import { ASCENT_TIMING, type AscentMoment, artAroundPhoto, burstDelayMs, popDelayMs } from "../lib/loewenAufstieg";
import {
  STILL_VARIANTS,
  areaFor,
  frameAnimated,
  frameBox,
  frameLabel,
  frameWidthFor,
  overhangSpace,
  plateSpace,
  plateTag,
  prestigeCount,
  shineStrength,
  signaturePlan,
  type FrameBox,
  type FrameVariant,
} from "../lib/loewenRang";
import { useScreenFocused } from "../seasons/screenFocus";
import { colors } from "../theme";
import { frameImage } from "./loewenRangImages";
import { BURST_SECONDS, drawBurst, drawSignature, signatureVisible, type SignatureScene } from "./loewenRangSignature";

// Löwen-Rang in der App (#1457): das Profilbild im Rahmen seines Rangs, wie im Web (LevelAvatarFrame.jsx, #1454).
// Jede Größe hat eine feste Fläche (Profil 220, Karte 150, Liste 92, Podest 64); das Foto wird je Rang so groß, dass
// die Grafik seitlich und unten hineinpasst, oben ragen Krone und Schwingen bis 15 % hinaus (lib/loewenRang.ts).
// Profil und Karte tragen das Schild mit Prestige-Sternen, „LVL n“ und Rauten. Bewegung nur im Profil: ein Glanz über
// das Metall und eine schlanke Signatur je Rang (Funken, Glut, Frost, Blitz) - bei „Bewegung reduzieren“ nichts.

const EMPTY_PICTURE: SkPicture = createPicture(() => undefined);
/** Höchstens etwa 30 Bilder je Sekunde - der Glanz läuft ruhig, schwache Geräte danken es. */
const FRAME_MS = 33;
const EDGE_POINTS = 24;
/** Das Schild wächst mit großer Schrift höchstens 1,3-fach und bleibt 16 Punkte schmaler als die Fläche. */
const PLATE_FONT_MAX = 1.3;
const PLATE_INSET = 16;

type Props = {
  level?: number | null;
  prestige?: number | null;
  /** Rangname vom Server (`rank_name`); sonst aus der eigenen Liste. */
  rankName?: string | null;
  size?: FrameVariant;
  /** Schild unter dem Rahmen (nur Profil und Karte). */
  showBadge?: boolean;
  team?: boolean;
  /**
   * Nur Schmuck für Vorleser: in Listen und auf dem Podest (Standard) liegt der Rahmen in einem antippbaren Eintrag,
   * der Level und Rang selbst im Namen trägt (`frameLabel`) - sonst gäbe es zwei Halte für dieselbe Person.
   */
  decorative?: boolean;
  testID?: string;
  /**
   * Aufstiegs-Moment (#1456, aus `ascentMoment`): beim Level im Rang springen die neuen Rauten auf, beim Rangwechsel
   * blitzt der alte Rahmen weg und der neue rastet ein - dazu ein vereinfachter Moment der Signatur. Bei reduzierter
   * Bewegung nur Aus- und Einblenden.
   */
  ascent?: AscentMoment | null;
  /** Das runde Foto - füllt die Fläche des Fotos. */
  children?: React.ReactNode;
};

export function LoewenRangFrame({ level, prestige, rankName, size = "list", showBadge = true, team = false, decorative, ascent = null, testID, children }: Props) {
  const { width } = useWindowDimensions();
  const area = areaFor(size, width);
  const box = useMemo(() => frameBox(level, area), [level, area]);
  const reduceMotion = useReduceMotionKnown();
  const still = STILL_VARIANTS.has(size);
  const stars = prestigeCount(prestige);
  const plate = showBadge && !still;
  const source = frameImage(box.info.key, frameWidthFor(box.art.size, PixelRatio.get()));
  const label = frameLabel(level, { rankName, prestige, team });
  const animated = frameAnimated(size, reduceMotion);
  const hidden = decorative ?? still;
  const moment = ascent && !still && ascent.level === box.info.level ? ascent : null;
  // Ob Teilchen und Springen laufen, entscheidet die Zeremonie (Gerät „Bewegung reduzieren“ und „dezent“).
  const motion = Boolean(moment?.particles);
  const oldArt = useMemo(() => (moment?.kind === "rank" ? artAroundPhoto(moment.previous, { size: box.photo, left: box.photoLeft, top: box.photoTop }) : null), [moment, box]);
  const oldSource = oldArt && moment ? frameImage(moment.from.key, frameWidthFor(oldArt.size, PixelRatio.get())) : null;
  const artRect = { left: box.art.left, top: box.art.top, width: box.art.size, height: box.art.size };
  const a11y = hidden
    ? { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const }
    : { accessible: true, accessibilityRole: "image" as const, accessibilityLabel: label };

  return (
    <View
      {...a11y}
      pointerEvents="none"
      style={{ width: area, height: area, marginTop: overhangSpace(size, area), marginBottom: plate ? plateSpace(size, stars) : 0 }}
      testID={testID}
    >
      <View style={[styles.photo, { left: box.photoLeft, top: box.photoTop, width: box.photo, height: box.photo, borderRadius: box.photo / 2 }]}>
        {children}
      </View>
      {moment ? (
        <AscentArt moment={moment} motion={motion} rect={artRect} source={source} old={oldArt && oldSource ? { rect: { left: oldArt.left, top: oldArt.top, width: oldArt.size, height: oldArt.size }, source: oldSource } : null} />
      ) : (
        <Image
          source={source}
          style={[styles.art, artRect]}
          resizeMode="contain"
          fadeDuration={still ? 0 : undefined}
          testID="loewen-rang-art"
        />
      )}
      {animated && !moment ? <Signature box={box} level={level} source={source as number} /> : null}
      {moment && motion ? <AscentBurst box={box} moment={moment} /> : null}
      {plate ? <Plate box={box} stars={stars} size={size} tag={plateTag(level, { team })} ascent={motion ? moment : null} /> : null}
    </View>
  );
}

function Plate({ box, stars, size, tag, ascent = null }: { box: FrameBox; stars: number; size: FrameVariant; tag: string; ascent?: AscentMoment | null }) {
  const { info } = box;
  const small = size === "card";
  const pops = ascent?.pops || [];
  const centerX = box.photoLeft + box.photo / 2;
  return (
    <View style={[styles.plate, { top: box.plateTop, left: centerX - box.area / 2, width: box.area }]} testID="loewen-rang-plate">
      {stars > 0 ? <Text style={styles.stars} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={PLATE_FONT_MAX} testID="loewen-rang-stars">{"★".repeat(stars)}</Text> : null}
      <View style={[styles.tag, small && styles.tagSmall, { backgroundColor: info.color, maxWidth: box.area - PLATE_INSET }]}>
        {/* Große Systemschrift: das Schild wächst mit, aber höchstens 1,3-fach und nie breiter als die Fläche - was
            nicht passt, wird kleiner statt abgeschnitten. */}
        <Text
          style={[styles.tagText, small && styles.tagTextSmall]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          maxFontSizeMultiplier={PLATE_FONT_MAX}
          testID="loewen-rang-tag"
        >
          {tag}
        </Text>
      </View>
      <View style={styles.pips} testID="loewen-rang-pips">
        {Array.from({ length: info.pips }, (_, index) => {
          const on = index < info.filled;
          const pipStyle = [styles.pip, small && styles.pipSmall, { borderColor: on ? info.color : `${info.color}AA` }, on && [styles.pipOn, { backgroundColor: info.color, shadowColor: info.color }]];
          const order = pops.indexOf(index);
          if (ascent && order >= 0) return <PopPip key={index} style={pipStyle} delay={popDelayMs(ascent.kind, order)} />;
          return <View key={index} style={pipStyle} testID={on ? "loewen-rang-pip-on" : "loewen-rang-pip"} />;
        })}
      </View>
    </View>
  );
}

/** Eine Raute, die beim Aufstieg aufspringt: 2,2-fach groß, dann zurück auf ihre Größe (#1456). */
function PopPip({ style, delay }: { style: React.ComponentProps<typeof View>["style"]; delay: number }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = withDelay(delay, withSequence(withTiming(2.2, { duration: 0 }), withTiming(1, { duration: 420, easing: Easing.out(Easing.quad) })));
    // Einmal je Aufstieg.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const animated = useAnimatedStyle(() => ({ transform: [{ rotate: "45deg" }, { scale: scale.value }] }));
  return <Animated.View style={[style, animated]} testID="loewen-rang-pip-pop" />;
}

/**
 * Der Rahmen beim Aufstieg (#1456). Rangwechsel: der alte Rahmen blitzt weg (größer, durchsichtig), der neue rastet ein
 * (aus 1,3-fach zurück auf seine Größe). Level im Rang: der Rahmen bleibt stehen. Reduziert: nur Aus- und Einblenden.
 */
function AscentArt({ moment, motion, rect, source, old }: {
  moment: AscentMoment;
  motion: boolean;
  rect: { left: number; top: number; width: number; height: number };
  source: ReturnType<typeof frameImage>;
  old: { rect: { left: number; top: number; width: number; height: number }; source: ReturnType<typeof frameImage> } | null;
}) {
  const rank = moment.kind === "rank";
  const fresh = useSharedValue(rank ? 0 : 1);
  const gone = useSharedValue(0);
  useEffect(() => {
    if (!rank) return;
    const { hold, out } = ASCENT_TIMING;
    gone.value = withDelay(hold, withTiming(1, { duration: motion ? out : 400 }));
    fresh.value = withDelay(hold + (motion ? out : 300), withTiming(1, { duration: motion ? ASCENT_TIMING.in : 500, easing: Easing.out(Easing.quad) }));
    // Einmal je Aufstieg.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const freshStyle = useAnimatedStyle(() => ({ opacity: fresh.value, transform: [{ scale: motion ? 1.3 - 0.3 * fresh.value : 1 }] }));
  const oldStyle = useAnimatedStyle(() => ({ opacity: 1 - gone.value, transform: [{ scale: motion ? 1 + 0.12 * gone.value : 1 }] }));
  return (
    <>
      {old ? (
        <Animated.View pointerEvents="none" style={[styles.art, old.rect, oldStyle]} testID="loewen-ascent-old">
          <Image source={old.source} style={styles.fill} resizeMode="contain" />
        </Animated.View>
      ) : null}
      <Animated.View pointerEvents="none" style={[styles.art, rect, freshStyle]}>
        <Image source={source} style={styles.fill} resizeMode="contain" testID="loewen-rang-art" />
      </Animated.View>
    </>
  );
}

/**
 * Der vereinfachte Moment der Signatur beim Aufstieg (#1456): Druckwelle und Teilchen in der Farbe des Rangs, auf einer
 * Zeichenfläche, die 30 % über die Grafik hinausreicht. Läuft nur, solange App und Screen vorne sind, einmal - danach
 * steht die Bildschleife.
 */
function AscentBurst({ box, moment }: { box: FrameBox; moment: AscentMoment }) {
  const appActive = useAppActive();
  const focused = useScreenFocused();
  const [finished, setFinished] = useState(false);
  const running = appActive && focused && !finished;
  const picture = useSharedValue<SkPicture>(EMPTY_PICTURE);
  const last = useSharedValue(-FRAME_MS);
  const ended = useSharedValue(false);
  const pad = box.art.size * 0.3;
  const scene = useMemo<SignatureScene>(() => {
    const plan = signaturePlan(moment.level);
    const S = box.art.size;
    const edge = box.ring.edge || [];
    const step = Math.max(1, Math.floor(edge.length / EDGE_POINTS));
    return {
      size: S + 2 * pad,
      ringX: box.ring.cx * S + pad,
      ringY: box.ring.cy * S + pad,
      ringR: box.ring.r * S,
      kind: plan.kind,
      color: plan.color,
      count: 0,
      strength: 1,
      shine: 0,
      edge: edge.filter((_, index) => index % step === 0).slice(0, EDGE_POINTS).map(([x, y]) => [x * S + pad, y * S + pad] as [number, number]),
    };
  }, [box, moment.level, pad]);
  const delay = burstDelayMs(moment.kind) / 1000;
  const strong = moment.strong;

  const step = useCallback((frame: FrameInfo) => {
    "worklet";
    const now = frame.timeSinceFirstFrame;
    if (now - last.value < FRAME_MS) return;
    last.value = now;
    const t = now / 1000 - delay;
    if (t < 0) return;
    if (t > BURST_SECONDS) {
      if (!ended.value) {
        ended.value = true;
        picture.value = EMPTY_PICTURE;
        runOnJS(setFinished)(true);
      }
      return;
    }
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, scene.size, scene.size));
    drawBurst(canvas, scene, t, strong);
    picture.value = recorder.finishRecordingAsPicture();
  }, [scene, delay, strong, last, ended, picture]);

  const frame = useFrameCallback(step, running);
  useEffect(() => {
    frame.setActive(running);
  }, [running, frame]);

  return (
    <Canvas
      style={[styles.art, { left: box.art.left - pad, top: box.art.top - pad, width: scene.size, height: scene.size }]}
      pointerEvents="none"
      testID="loewen-ascent-burst"
    >
      <Picture picture={picture} />
    </Canvas>
  );
}

/**
 * „Bewegung reduzieren“ - bis das Handy geantwortet hat, gilt ja: so blitzt bei Menschen, die keine Bewegung wollen,
 * nicht einmal kurz ein Glanz auf.
 */
function useReduceMotionKnown(): boolean {
  const [reduce, setReduce] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    Promise.resolve(AccessibilityInfo.isReduceMotionEnabled())
      .then((value) => { if (active) setReduce(Boolean(value)); })
      .catch(() => { if (active) setReduce(true); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => setReduce(Boolean(value)));
    return () => {
      active = false;
      subscription?.remove?.();
    };
  }, []);
  return reduce !== false;
}

/** Die App ist vorne - im Hintergrund steht die Signatur still. */
function useAppActive(): boolean {
  const [active, setActive] = useState(() => AppState.currentState !== "background" && AppState.currentState !== "inactive");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => setActive(status !== "background" && status !== "inactive"));
    return () => subscription?.remove?.();
  }, []);
  return active;
}

function Signature({ box, level, source }: { box: FrameBox; level?: number | null; source: number }) {
  const image = useImage(source);
  // Nur solange App und Screen vorne sind - ein Profil unter einem anderen Screen bleibt geladen, aber still.
  const appActive = useAppActive();
  const focused = useScreenFocused();
  const running = appActive && focused;
  const picture = useSharedValue<SkPicture>(EMPTY_PICTURE);
  const last = useSharedValue(-FRAME_MS);
  const blank = useSharedValue(true);
  const scene = useMemo<SignatureScene>(() => {
    const plan = signaturePlan(level);
    const S = box.art.size;
    const edge = box.ring.edge || [];
    const step = Math.max(1, Math.floor(edge.length / EDGE_POINTS));
    return {
      size: S,
      ringX: box.ring.cx * S,
      ringY: box.ring.cy * S,
      ringR: box.ring.r * S,
      kind: plan.kind,
      color: plan.color,
      count: plan.count,
      strength: plan.strength,
      shine: shineStrength(level),
      edge: edge.filter((_, index) => index % step === 0).slice(0, EDGE_POINTS).map(([x, y]) => [x * S, y * S] as [number, number]),
    };
  }, [box, level]);

  const step = useCallback((frame: FrameInfo) => {
    "worklet";
    const now = frame.timeSinceFirstFrame;
    if (now - last.value < FRAME_MS) return;
    last.value = now;
    // Ruhe (Glanz-Pause, keine Teilchen, zwischen zwei Blitzen): nichts aufzeichnen. Einmal leeren, dann bleibt das
    // leere Bild stehen.
    if (!signatureVisible(scene, now / 1000, image !== null)) {
      if (!blank.value) {
        picture.value = EMPTY_PICTURE;
        blank.value = true;
      }
      return;
    }
    blank.value = false;
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, scene.size, scene.size));
    drawSignature(canvas, scene, now / 1000, image);
    picture.value = recorder.finishRecordingAsPicture();
  }, [scene, image, last, picture, blank]);

  const frame = useFrameCallback(step, running);
  useEffect(() => {
    frame.setActive(running);
  }, [running, frame]);

  return (
    <Canvas
      style={[styles.art, { left: box.art.left, top: box.art.top, width: box.art.size, height: box.art.size }]}
      pointerEvents="none"
      testID="loewen-rang-signature"
    >
      <Picture picture={picture} />
    </Canvas>
  );
}

const styles = StyleSheet.create({
  photo: {
    alignItems: "center",
    backgroundColor: "#0C1216",
    justifyContent: "center",
    overflow: "hidden",
    position: "absolute",
  },
  art: {
    position: "absolute",
  },
  fill: {
    height: "100%",
    width: "100%",
  },
  plate: {
    alignItems: "center",
    gap: 4,
    position: "absolute",
  },
  stars: {
    color: colors.gold,
    fontSize: 11,
    letterSpacing: 1.5,
    lineHeight: 13,
    textShadowColor: "rgba(255,215,0,0.6)",
    textShadowRadius: 6,
  },
  tag: {
    borderRadius: 2,
    elevation: 6,
    paddingHorizontal: 10,
    paddingVertical: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.7,
    shadowRadius: 7,
  },
  tagSmall: {
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  tagText: {
    color: colors.black,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
    letterSpacing: 1.9,
  },
  tagTextSmall: {
    fontSize: 10,
    letterSpacing: 1.6,
  },
  pips: {
    flexDirection: "row",
    gap: 5,
  },
  pip: {
    backgroundColor: "rgba(0,0,0,0.6)",
    borderWidth: 1.5,
    height: 8,
    transform: [{ rotate: "45deg" }],
    width: 8,
  },
  pipOn: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 3,
  },
  pipSmall: {
    height: 6,
    width: 6,
  },
});
