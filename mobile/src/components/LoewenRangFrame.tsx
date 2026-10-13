import { Canvas, Picture, Skia, createPicture, useImage, type SkPicture } from "@shopify/react-native-skia";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, AppState, Image, PixelRatio, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useFrameCallback, useSharedValue, type FrameInfo } from "react-native-reanimated";
import {
  STILL_VARIANTS,
  areaFor,
  frameAnimated,
  frameBox,
  frameLabel,
  frameWidthFor,
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
import { drawSignature, type SignatureScene } from "./loewenRangSignature";

// Löwen-Rang in der App (#1457): das Profilbild im Rahmen seines Rangs, wie im Web (LevelAvatarFrame.jsx, #1454).
// Jede Größe hat eine feste Fläche (Profil 220, Karte 150, Liste 92, Podest 64); das Foto wird je Rang so groß, dass
// die Grafik seitlich und unten hineinpasst, oben ragen Krone und Schwingen bis 15 % hinaus (lib/loewenRang.ts).
// Profil und Karte tragen das Schild mit Prestige-Sternen, „LVL n“ und Rauten. Bewegung nur im Profil: ein Glanz über
// das Metall und eine schlanke Signatur je Rang (Funken, Glut, Frost, Blitz) - bei „Bewegung reduzieren“ nichts.

const EMPTY_PICTURE: SkPicture = createPicture(() => undefined);
/** Höchstens etwa 30 Bilder je Sekunde - der Glanz läuft ruhig, schwache Geräte danken es. */
const FRAME_MS = 33;
const EDGE_POINTS = 24;

type Props = {
  level?: number | null;
  prestige?: number | null;
  /** Rangname vom Server (`rank_name`); sonst aus der eigenen Liste. */
  rankName?: string | null;
  size?: FrameVariant;
  /** Schild unter dem Rahmen (nur Profil und Karte). */
  showBadge?: boolean;
  team?: boolean;
  testID?: string;
  /** Das runde Foto - füllt die Fläche des Fotos. */
  children?: React.ReactNode;
};

export function LoewenRangFrame({ level, prestige, rankName, size = "list", showBadge = true, team = false, testID, children }: Props) {
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

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      pointerEvents="none"
      style={{ width: area, height: area, marginBottom: plate ? plateSpace(size, stars) : 0 }}
      testID={testID}
    >
      <View style={[styles.photo, { left: box.photoLeft, top: box.photoTop, width: box.photo, height: box.photo, borderRadius: box.photo / 2 }]}>
        {children}
      </View>
      <Image
        source={source}
        style={[styles.art, { left: box.art.left, top: box.art.top, width: box.art.size, height: box.art.size }]}
        resizeMode="contain"
        fadeDuration={still ? 0 : undefined}
        testID="loewen-rang-art"
      />
      {animated ? <Signature box={box} level={level} source={source as number} /> : null}
      {plate ? <Plate box={box} stars={stars} size={size} tag={plateTag(level, { team })} /> : null}
    </View>
  );
}

function Plate({ box, stars, size, tag }: { box: FrameBox; stars: number; size: FrameVariant; tag: string }) {
  const { info } = box;
  const small = size === "card";
  const centerX = box.photoLeft + box.photo / 2;
  return (
    <View style={[styles.plate, { top: box.plateTop, left: centerX - box.area / 2, width: box.area }]} testID="loewen-rang-plate">
      {stars > 0 ? <Text style={styles.stars} testID="loewen-rang-stars">{"★".repeat(stars)}</Text> : null}
      <View style={[styles.tag, small && styles.tagSmall, { backgroundColor: info.color }]}>
        <Text style={[styles.tagText, small && styles.tagTextSmall]}>{tag}</Text>
      </View>
      <View style={styles.pips} testID="loewen-rang-pips">
        {Array.from({ length: info.pips }, (_, index) => {
          const on = index < info.filled;
          return (
            <View
              key={index}
              style={[styles.pip, small && styles.pipSmall, { borderColor: on ? info.color : `${info.color}AA` }, on && [styles.pipOn, { backgroundColor: info.color, shadowColor: info.color }]]}
              testID={on ? "loewen-rang-pip-on" : "loewen-rang-pip"}
            />
          );
        })}
      </View>
    </View>
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
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, scene.size, scene.size));
    drawSignature(canvas, scene, now / 1000, image);
    picture.value = recorder.finishRecordingAsPicture();
  }, [scene, image, last, picture]);

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
