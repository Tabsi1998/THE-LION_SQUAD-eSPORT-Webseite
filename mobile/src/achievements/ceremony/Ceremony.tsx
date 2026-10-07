import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { openTab } from "../../navigation/rootNavigation";
import { useSeasonOverlay } from "../../seasons/anchors";
import { colors, radius } from "../../theme";
import { Badge } from "../Badge";
import { MATERIAL_LOOKS } from "../badgeArt.generated";
import { lookFor, materialName } from "../badgeArt";
import { shareAchievement } from "../share";
import { playHaptics } from "./haptics";
import { playCeremonySound, readCeremonySoundPrefs, writeCeremonyMuted } from "./sounds";
import { Motion } from "./motions";
import { CeremonyParticles } from "./particles";
import { type CeremonyPlan, type CeremonyTier, groupTier, levelTexts, particleKind } from "./select";

// Erfolge II (E13, #623): die Zeremonie in der App - dieselbe Bühne wie im Web (Ceremony.jsx): das Abzeichen kommt
// je Kategorie anders herein, Material bestimmt Look, Partikel und Haptik, Sonderabläufe für die großen Momente
// (erster Erfolg, Gruppe mit Sockel, Kategorie mit Vitrine und Farbflut, Diamant mit Prisma, Legendär mit Banner,
// Stapel zum Durchblättern, Level-Aufstieg mit aufbrechender Zahl). „Bewegung reduzieren“ lässt nur das
// Einblenden übrig. Schließen per Antippen daneben, Zurück-Taste oder Kreuz.

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII"];
const PARTICLE_MS = 4500;

function useEnter(from: number, run: (value: { value: number }) => void) {
  const value = useSharedValue(from);
  useEffect(() => {
    run(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

function TierRow({ tier, index, active, onPick }: { tier: CeremonyTier; index: number; active: boolean; onPick?: (index: number) => void }) {
  const look = lookFor(tier.material, tier.level);
  const t = useEnter(0, (v) => { v.value = withDelay(700 + index * 120, withSpring(1, { stiffness: 260, damping: 22 })); });
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, t.value), transform: [{ translateX: -24 * (1 - t.value) }] }));
  return (
    <Animated.View style={style}>
      <Pressable
        onPress={onPick ? () => onPick(index) : undefined}
        disabled={!onPick}
        style={[styles.tierRow, { borderLeftColor: look.rim }, active && styles.tierRowActive]}
        testID={`ceremony-tier-${tier.code}`}
        accessibilityState={{ selected: active }}
      >
        <Badge material={look.key} rank={tier.rank} art={tier.art || tier.group_art} icon={tier.group_icon || tier.icon} size={40} />
        <View style={styles.tierText}>
          <Text style={[styles.tierLevel, { color: look.rim }]} numberOfLines={1}>{materialName(tier)}{tier.group_name ? ` · ${tier.group_name}` : ""}</Text>
          <Text style={styles.tierName} numberOfLines={1}>{tier.name}</Text>
          {tier.description ? <Text style={styles.tierDescription} numberOfLines={1}>{tier.description}</Text> : null}
        </View>
        <Text style={[styles.points, { color: look.rim }]}>+{tier.points || 0}</Text>
      </Pressable>
    </Animated.View>
  );
}

/** Gruppe abgeschlossen: der Sockel wächst, die sieben Stufen leuchten nacheinander auf. */
function GroupPedestal({ plan, reduced }: { plan: CeremonyPlan; reduced: boolean }) {
  const ladder = ["wood", "iron", "bronze", "silver", "gold", "platinum", "diamond"];
  const shown = groupTier(plan);
  const grow = useEnter(reduced ? 1 : 0, (v) => { if (!reduced) v.value = withDelay(300, withTiming(1, { duration: 600 })); });
  const baseStyle = useAnimatedStyle(() => ({ height: 26 * grow.value }));
  return (
    <View style={styles.pedestal} testID="ceremony-pedestal">
      <View style={styles.pedestalBadges}>
        {ladder.map((material, i) => <PedestalStep key={material} material={material} rank={i + 1} delay={reduced ? 0 : 900 + i * 280} art={shown?.art || shown?.group_art} icon={shown?.group_icon || shown?.icon} />)}
      </View>
      <Animated.View style={[styles.pedestalBase, { backgroundColor: `${plan.accent}66` }, baseStyle]} />
    </View>
  );
}

function PedestalStep({ material, rank, delay, art, icon }: { material: string; rank: number; delay: number; art?: string | null; icon?: string | null }) {
  const t = useEnter(0, (v) => { v.value = withDelay(delay, withTiming(1, { duration: 350 })); });
  const style = useAnimatedStyle(() => ({ opacity: 0.25 + 0.75 * t.value, transform: [{ translateY: 6 * (1 - t.value) }] }));
  return (
    <Animated.View style={style} testID={`ceremony-pedestal-${material}`}>
      <Badge material={material} rank={rank} art={art} icon={icon} size={30} />
    </Animated.View>
  );
}

/** Level-Aufstieg: die alte Zahl bricht auf, die neue fällt ein; Titel alle fünf Level, Sterne bei Prestige. */
function LevelUpStage({ plan, reduced }: { plan: CeremonyPlan; reduced: boolean }) {
  const levelUp = plan.levelUp || { level: 1 };
  const level = Number(levelUp.level || 1);
  const previous = Number(levelUp.previous || level - 1);
  const [shown, setShown] = useState(reduced ? level : previous);
  useEffect(() => {
    if (reduced) {
      setShown(level);
      return undefined;
    }
    const timer = setTimeout(() => setShown(level), 900);
    return () => clearTimeout(timer);
  }, [level, reduced]);
  const old = String(previous);
  const cut = Math.ceil(old.length / 2);
  return (
    <View style={styles.levelStage} testID="ceremony-levelup">
      <View style={styles.levelNumberBox}>
        {shown === previous && !reduced ? (
          <LevelBreak left={old.slice(0, cut)} right={old.slice(cut)} accent={plan.accent} />
        ) : (
          <LevelDrop level={level} accent={plan.accent} reduced={reduced} />
        )}
      </View>
      {levelUp.titleChanged && levelUp.title ? (
        <Text style={[styles.titleBanner, { borderColor: plan.accent, color: plan.accent }]} testID="ceremony-title-banner">Neuer Titel: {levelUp.title}</Text>
      ) : null}
      {Number(levelUp.prestige || 0) > 0 && levelUp.prestigeGained ? (
        <View style={styles.stars} testID="ceremony-prestige-stars" accessibilityLabel={`Prestige ${levelUp.prestige}`}>
          {Array.from({ length: Math.min(5, Number(levelUp.prestige)) }, (_, i) => <Ionicons key={i} name="star" size={16} color="#FFD700" />)}
        </View>
      ) : null}
    </View>
  );
}

/** Die alte Zahl bricht auf: zwei Hälften kippen auseinander und verblassen, kurz bevor die neue fällt. */
function LevelBreak({ left, right, accent }: { left: string; right: string; accent: string }) {
  const t = useEnter(0, (v) => { v.value = withDelay(480, withTiming(1, { duration: 400, easing: Easing.in(Easing.quad) })); });
  const leftStyle = useAnimatedStyle(() => ({ opacity: 1 - t.value, transform: [{ translateX: -40 * t.value }, { rotate: `${-18 * t.value}deg` }] }));
  const rightStyle = useAnimatedStyle(() => ({ opacity: 1 - t.value, transform: [{ translateX: 40 * t.value }, { rotate: `${18 * t.value}deg` }] }));
  return (
    <View style={styles.levelSplit} testID="ceremony-level-old">
      <Animated.Text style={[styles.levelNumber, { color: accent }, leftStyle]}>{left}</Animated.Text>
      <Animated.Text style={[styles.levelNumber, { color: accent }, rightStyle]}>{right}</Animated.Text>
    </View>
  );
}

function LevelDrop({ level, accent, reduced }: { level: number; accent: string; reduced: boolean }) {
  const y = useEnter(reduced ? 0 : -120, (v) => { if (!reduced) v.value = withSpring(0, { stiffness: 380, damping: 14 }); });
  const opacity = useEnter(reduced ? 0 : 0, (v) => { v.value = withTiming(1, { duration: reduced ? 400 : 200 }); });
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: y.value }] }));
  return (
    <Animated.View style={style}>
      <Text style={[styles.levelNumber, { color: accent }]} testID="ceremony-level-number">{level}</Text>
    </Animated.View>
  );
}

/** Blitz, Farbflut und Prisma - die großen Momente füllen kurz den ganzen Schirm. */
function SpecialLight({ plan }: { plan: CeremonyPlan }) {
  const flash = useEnter(0, (v) => { v.value = withSequence(withTiming(0.35, { duration: 180 }), withTiming(0, { duration: 720 })); });
  const flood = useEnter(0, (v) => { v.value = withSequence(withTiming(0.55, { duration: 420 }), withTiming(0, { duration: 980 })); });
  const sweep = useEnter(0, (v) => { v.value = withRepeat(withTiming(1, { duration: 4000, easing: Easing.linear }), -1, false); });
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const floodStyle = useAnimatedStyle(() => ({ opacity: flood.value }));
  const prismStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -600 + 1200 * sweep.value }, { rotate: "-25deg" }] }));
  const lit = plan.sequence === "diamond" || plan.sequence === "legendary" || plan.sequence === "category";
  return (
    <>
      {plan.sequence === "diamond" ? (
        <Animated.View pointerEvents="none" style={[styles.prism, prismStyle]} testID="ceremony-prism">
          {["#FF7AD9", "#FFE066", "#7AFFB2", "#7AB8FF"].map((color) => <View key={color} style={[styles.prismBand, { backgroundColor: color }]} />)}
        </Animated.View>
      ) : null}
      {plan.sequence === "category" ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: plan.accent }, floodStyle]} testID="ceremony-flood" /> : null}
      {lit ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: plan.accent }, flashStyle]} /> : null}
    </>
  );
}

function LegendaryBanner({ reduced }: { reduced: boolean }) {
  const t = useEnter(reduced ? 1 : 0, (v) => { if (!reduced) v.value = withDelay(400, withSpring(1, { stiffness: 200, damping: 18 })); });
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, t.value * 2), transform: [{ perspective: 600 }, { translateY: -48 * (1 - t.value) }, { rotateX: `${-60 * (1 - t.value)}deg` }] }));
  return (
    <Animated.View style={[styles.banner, style]} testID="ceremony-legendary-banner">
      <Text style={styles.bannerText}>Legendär</Text>
    </Animated.View>
  );
}

function Vitrine({ reduced }: { reduced: boolean }) {
  const t = useEnter(reduced ? 1 : 0, (v) => { if (!reduced) v.value = withDelay(300, withTiming(1, { duration: 1200 })); });
  const style = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ scaleX: 1.15 - 0.15 * t.value }] }));
  return <Animated.View pointerEvents="none" style={[styles.vitrine, style]} testID="ceremony-vitrine" />;
}

/** Die nächsten Stufen eines Stapels, aufgefächert hinter der vorderen. */
function StackFan({ tiers }: { tiers: CeremonyTier[] }) {
  return (
    <>
      {tiers.map((tier, i) => (
        <View key={tier.code || i} pointerEvents="none" style={[styles.fanned, { opacity: 0.6, transform: [{ translateX: 70 + i * 34 }, { translateY: 10 + i * 6 }, { rotate: `${8 + i * 6}deg` }, { scale: 0.72 - i * 0.08 }] }]}>
          <Badge material={tier.material} level={tier.level} rank={tier.rank} art={tier.art || tier.group_art} icon={tier.group_icon || tier.icon} size={104} />
        </View>
      ))}
    </>
  );
}

export function ceremonyTexts(plan: CeremonyPlan, count: number) {
  const look = MATERIAL_LOOKS[plan.material] || MATERIAL_LOOKS.gold;
  const isLevelOnly = plan.sequence === "levelup";
  let heading: string;
  if (plan.heading) heading = plan.heading;
  else if (isLevelOnly) heading = levelTexts(plan.levelUp).heading;
  else if (plan.sequence === "first") heading = "Dein erster Erfolg";
  else if (plan.sequence === "group") heading = `${groupTier(plan)?.group_name || "Gruppe"} vollständig`;
  else if (plan.sequence === "category") heading = "Kategorie abgeschlossen";
  else if (plan.sequence === "legendary") heading = String(plan.top?.name || "Legendär").toUpperCase();
  else if (plan.sequence === "diamond") heading = "Diamant";
  else heading = count === 1 ? "Neues Achievement!" : `${count} neue Achievements!`;
  const rank = Number(plan.top?.rank || 0);
  const sub = plan.sub || (isLevelOnly ? levelTexts(plan.levelUp).sub : plan.catchUp ? "Nachgeholte Erfolge" : `${look.name}${rank && rank <= 7 ? ` ${ROMAN[rank]}` : ""} freigeschaltet`);
  return { heading, sub };
}

type SoundUser = { ceremony_sound?: boolean | null; ceremony_volume?: number | null } | null;

export function Ceremony({ plan, onClose, reduced = false, autoClose = true, user = null }: { plan: CeremonyPlan; onClose: () => void; reduced?: boolean; autoClose?: boolean; user?: SoundUser }) {
  useSeasonOverlay("achievement-ceremony", true);
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const tiers = plan.tiers;
  const current = tiers[index] || plan.top;
  const isStack = plan.sequence === "stack";
  const isLevelOnly = plan.sequence === "levelup";
  const [phase, setPhase] = useState<"badge" | "level">(isLevelOnly ? "level" : "badge");
  const [particles, setParticles] = useState(!reduced);
  const duration = reduced ? Math.min(plan.duration, 4500) : plan.duration;
  const look = useMemo(() => lookFor(plan.material), [plan.material]);

  // Haptik und Klang je Material, einmal je Zeremonie - der Klang nur, wenn er weder am Gerät noch im Profil aus ist.
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    playHaptics(look);
    let alive = true;
    void readCeremonySoundPrefs(user).then((prefs) => { if (alive) setMuted(prefs.muted); });
    void playCeremonySound(plan.sound, { user });
    return () => { alive = false; };
    // Einmal je Zeremonie, nicht bei jeder neuen Profil-Kopie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id, look]);
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    void writeCeremonyMuted(next);
    if (!next) void playCeremonySound(plan.sound, { user, force: true });
  };

  // Die Partikel verglühen nach gut vier Sekunden - dann steht auch ihr Takt.
  useEffect(() => {
    if (reduced) return undefined;
    const timer = setTimeout(() => setParticles(false), PARTICLE_MS);
    return () => clearTimeout(timer);
  }, [reduced, plan.id]);

  // Automatisch schließen; ein Level-up am Ende bekommt seine eigene Phase.
  useEffect(() => {
    if (!autoClose) return undefined;
    const timer = setTimeout(() => {
      if (plan.levelUp && phase === "badge") setPhase("level");
      else onClose();
    }, phase === "level" && !isLevelOnly ? 6000 : duration);
    return () => clearTimeout(timer);
  }, [autoClose, duration, onClose, plan.levelUp, phase, isLevelOnly]);

  // Stapel: alle 2,5 s weiter, bis alle durch sind.
  useEffect(() => {
    if (!isStack || reduced || index >= tiers.length - 1) return undefined;
    const timer = setTimeout(() => setIndex((i) => Math.min(tiers.length - 1, i + 1)), plan.autoAdvanceMs);
    return () => clearTimeout(timer);
  }, [isStack, reduced, index, tiers.length, plan.autoAdvanceMs]);

  const card = useEnter(reduced ? 1 : 0, (v) => { v.value = reduced ? 1 : withSpring(1, { stiffness: 220, damping: 20 }); });
  const cardStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, card.value * 1.5), transform: [{ translateY: 30 * (1 - card.value) }, { scale: 0.8 + 0.2 * card.value }] }));

  const { heading, sub } = ceremonyTexts(plan, tiers.length);
  const levelPhase = phase === "level" && !isLevelOnly;
  const showBadge = phase === "badge" && !isLevelOnly;
  const share = () => {
    if (!plan.shareId) return;
    void shareAchievement({ awardId: plan.shareId, name: String(plan.top?.name || "Erfolg"), materialName: plan.top ? materialName(plan.top) : null });
  };
  const toAchievements = () => {
    onClose();
    // Die eigenen Erfolge stehen im Tab Profil (#1149, #1150).
    openTab("Profile", { tab: "achievements" });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        testID="achievement-unlock-overlay"
        accessibilityLabel={heading}
        accessibilityViewIsModal
      >
        {!reduced ? <SpecialLight plan={plan} /> : null}
        {(showBadge || isLevelOnly) && particles && !reduced ? (
          <CeremonyParticles kind={isLevelOnly ? "glint" : particleKind(plan.material)} count={plan.particles} width={width} height={height} origin={{ x: width / 2, y: height * 0.38 }} />
        ) : null}
        <Animated.View style={[styles.card, { borderColor: plan.accent, shadowColor: plan.accent }, cardStyle]} onStartShouldSetResponder={() => true} testID="ceremony-card">
          {plan.sequence === "legendary" ? <LegendaryBanner reduced={reduced} /> : null}
          <Pressable style={styles.mute} onPress={toggleMute} hitSlop={12} testID="achievement-unlock-mute" accessibilityRole="button" accessibilityLabel={muted ? "Ton einschalten" : "Ton ausschalten"}>
            <Ionicons name={muted ? "volume-mute" : "volume-high"} size={20} color="rgba(255,255,255,0.5)" />
          </Pressable>
          <Pressable style={styles.close} onPress={onClose} hitSlop={12} testID="achievement-unlock-close" accessibilityRole="button" accessibilityLabel="Schließen">
            <Ionicons name="close" size={22} color="rgba(255,255,255,0.5)" />
          </Pressable>

          <View style={[styles.stage, plan.sequence === "legendary" && styles.stageLegendary]} testID="ceremony-stage">
            {plan.sequence === "category" ? <Vitrine reduced={reduced} /> : null}
            {showBadge ? (
              <>
                {isStack && !reduced ? <StackFan tiers={tiers.slice(index + 1, index + 4)} /> : null}
                <Motion
                  key={`${plan.id}-${current?.code || index}`}
                  motion={plan.motion}
                  reduced={reduced}
                  accent={plan.accent}
                  badge={<Badge material={current?.material || plan.material} level={current?.level} rank={current?.rank} art={current?.art || current?.group_art} icon={current?.group_icon || current?.icon} size={128} title={current?.name} testID="ceremony-badge" />}
                />
              </>
            ) : (
              <LevelUpStage plan={plan} reduced={reduced} />
            )}
          </View>

          <View style={styles.texts}>
            <Text style={[styles.sub, { color: plan.accent }]} testID="ceremony-sub">{levelPhase ? levelTexts(plan.levelUp).phaseSub : sub}</Text>
            <Text style={styles.heading} testID="ceremony-heading">{levelPhase ? levelTexts(plan.levelUp).phaseHeading : heading}</Text>
            {plan.sequence === "first" && showBadge ? (
              <Text style={styles.firstText} testID="ceremony-first-text">
                Das war dein erster Erfolg. Jeder Erfolg bringt Punkte und Erfahrung, hebt dein Level und schmückt dein Profil – alle Ziele und wie du sie schaffst stehen bei deinen Erfolgen.
              </Text>
            ) : null}
            {plan.sequence === "group" && showBadge ? <GroupPedestal plan={plan} reduced={reduced} /> : null}
          </View>

          {showBadge && tiers.length > 0 ? (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent} testID="ceremony-list">
              {tiers.map((tier, i) => <TierRow key={tier.code || i} tier={tier} index={i} active={isStack && i === index} onPick={isStack ? setIndex : undefined} />)}
            </ScrollView>
          ) : null}

          <View style={styles.footer}>
            {isStack && showBadge ? (
              <View style={styles.stackNav} testID="ceremony-stack-nav">
                <Pressable onPress={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} style={[styles.navButton, index === 0 && styles.disabled]} accessibilityLabel="Vorheriger Erfolg" testID="ceremony-prev">
                  <Ionicons name="chevron-back" size={16} color="rgba(255,255,255,0.75)" />
                </Pressable>
                <Text style={styles.stackIndex} testID="ceremony-stack-index">{index + 1} / {tiers.length}</Text>
                <Pressable onPress={() => setIndex((i) => Math.min(tiers.length - 1, i + 1))} disabled={index >= tiers.length - 1} style={[styles.navButton, index >= tiers.length - 1 && styles.disabled]} accessibilityLabel="Nächster Erfolg" testID="ceremony-next">
                  <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.75)" />
                </Pressable>
              </View>
            ) : null}
            {plan.points > 0 && showBadge ? (
              <View style={[styles.pill, { borderColor: `${plan.accent}66`, backgroundColor: `${plan.accent}14` }]} testID="ceremony-points">
                <Ionicons name="trophy" size={13} color={plan.accent} />
                <Text style={[styles.pillText, { color: plan.accent }]}>+{plan.points} Punkte</Text>
              </View>
            ) : null}
            {plan.sequence === "first" ? (
              <Pressable onPress={toAchievements} style={[styles.pill, styles.linkPill]} testID="ceremony-showcase-link" accessibilityRole="button">
                <Text style={[styles.pillText, { color: colors.cyan }]}>Zu deinen Erfolgen</Text>
              </Pressable>
            ) : null}
            {plan.sequence === "legendary" && plan.shareId ? (
              <Pressable onPress={share} style={[styles.pill, styles.sharePill]} testID="ceremony-share" accessibilityRole="button">
                <Ionicons name="share-social" size={13} color="#FFD700" />
                <Text style={[styles.pillText, { color: "#FFD700" }]}>Teilen</Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.88)", alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "100%", maxWidth: 460, backgroundColor: "#101012", borderWidth: 1, borderRadius: radius.lg, overflow: "hidden", shadowOpacity: 0.45, shadowRadius: 30, shadowOffset: { width: 0, height: 0 }, elevation: 14 },
  close: { position: "absolute", top: 12, right: 12, zIndex: 10 },
  mute: { position: "absolute", top: 13, right: 48, zIndex: 10 },
  stage: { height: 210, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  stageLegendary: { marginTop: 34 },
  fanned: { position: "absolute" },
  texts: { paddingHorizontal: 20, paddingBottom: 10, alignItems: "center" },
  sub: { fontSize: 11, fontWeight: "800", letterSpacing: 3.5, textTransform: "uppercase", textAlign: "center" },
  heading: { color: colors.white, fontSize: 24, fontWeight: "900", textTransform: "uppercase", marginTop: 4, textAlign: "center" },
  firstText: { color: "rgba(255,255,255,0.68)", fontSize: 13, textAlign: "center", marginTop: 8, lineHeight: 19 },
  list: { maxHeight: 220, width: "100%" },
  listContent: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  tierRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", borderLeftWidth: 3, backgroundColor: "rgba(255,255,255,0.02)" },
  tierRowActive: { borderColor: "rgba(255,255,255,0.30)", backgroundColor: "rgba(255,255,255,0.05)" },
  tierText: { flex: 1, minWidth: 0 },
  tierLevel: { fontSize: 10, fontWeight: "800", letterSpacing: 1.4, textTransform: "uppercase" },
  tierName: { color: colors.white, fontSize: 15, fontWeight: "700" },
  tierDescription: { color: "rgba(255,255,255,0.5)", fontSize: 12 },
  points: { fontSize: 13, fontWeight: "800" },
  footer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 18 },
  stackNav: { flexDirection: "row", alignItems: "center", gap: 6, marginRight: 4 },
  navButton: { width: 32, height: 32, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.3 },
  stackIndex: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1 },
  pillText: { fontSize: 12, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  linkPill: { borderColor: "rgba(41,182,232,0.5)" },
  sharePill: { borderColor: "rgba(255,215,0,0.6)" },
  banner: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 5, paddingVertical: 10, alignItems: "center", backgroundColor: "#9A140C", shadowColor: "#FF3B30", shadowOpacity: 0.35, shadowRadius: 18, elevation: 8 },
  bannerText: { color: "#FFE8E5", fontWeight: "900", letterSpacing: 5, textTransform: "uppercase" },
  vitrine: { position: "absolute", top: 16, bottom: 16, left: 40, right: 40, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 6, backgroundColor: "rgba(255,255,255,0.05)" },
  pedestal: { height: 70, width: "100%", alignItems: "center", justifyContent: "flex-end", marginTop: 8 },
  pedestalBadges: { flexDirection: "row", gap: 5, marginBottom: 4 },
  pedestalBase: { width: 260, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  levelStage: { alignItems: "center", justifyContent: "center" },
  levelNumberBox: { height: 100, alignItems: "center", justifyContent: "center" },
  levelSplit: { flexDirection: "row" },
  levelNumber: { fontSize: 84, fontWeight: "900", lineHeight: 96 },
  titleBanner: { marginTop: 6, paddingHorizontal: 14, paddingVertical: 4, borderWidth: 1, borderRadius: radius.sm, fontSize: 11, fontWeight: "900", letterSpacing: 3.5, textTransform: "uppercase" },
  stars: { flexDirection: "row", gap: 4, marginTop: 8 },
  // Ein leiser Schimmer wie im Web (Prisma-Verlauf mit 18 % im Bildschirm-Mischmodus) - am Handy ohne Mischmodus etwas zurückgenommen.
  prism: { position: "absolute", top: -200, bottom: -200, width: 420, flexDirection: "row", opacity: 0.11 },
  prismBand: { flex: 1 },
});
