import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, TextInput, View, type LayoutChangeEvent } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { Card } from "../../../components/Card";
import { Glow, Press, useReduceMotion } from "../../../components/motion";
import { Body, Muted } from "../../../components/Text";
import {
  CUSTOM_LEVEL, MODE_LABELS, MODE_ORDER, NOTIFICATION_TOPICS, levelOf, levelPatch, modePatch, normalizeClockInput, quietHoursProblem,
  quietSummary, shiftClock, topicModes, type NotificationServerInfo, type NotificationTopic, type Prefs, type QuietHours, type TopicMode,
} from "../../../lib/notificationLevels";
import { colors, radius } from "../../../theme";
import { MatrixToggle, notificationChannels, notificationPreferenceKey, profileStyles, Toggle } from "./parts";

// Benachrichtigungen in Stufen, Themen und Ruhezeit (#2444) - Aufbau und Wörter wie der Reiter im Web (NotificationsTab, #1204/#1206):
// oben drei Stufen zum Antippen, darunter je Thema Push, „Nur App“ oder „Aus“. Eine Stufe setzt alle Themen; eigene Änderungen
// zeigen „Eigene Auswahl“. Darunter die Ruhezeit und, eingeklappt, „Weitere Wege“: E-Mail, Discord (nur verknüpft), die Kanäle
// ganz aus und der Newsletter. Was eine Stufe setzt, sagt der Server - hier werden nur die Schalter dazu gerechnet.
// Bewegung (Reanimated, nur transform und opacity): die Markierung gleitet zur gewählten Stufe bzw. Stellung, Knöpfe geben beim
// Drücken nach, umgestellte Themen leuchten gestaffelt kurz auf, Ruhezeit und „Weitere Wege“ blenden ein, Mond und Pfeil drehen
// sich. Mit „Bewegung reduzieren“ springt alles an seinen Platz; die Farben wechseln trotzdem.

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const LEVEL_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = { all: "notifications", important: "notifications-outline", few: "notifications-off-outline" };
const LEVEL_HINTS: Record<string, string> = { all: "Jedes Thema per Push", important: "Das Wichtige per Push", few: "Nur Spiele und Rechnungen" };
const LEVEL_GAP = 8;
const LIT_STAGGER_MS = 35;
const QUIET_STEP_MINUTES = 15;
// Unter „Weitere Wege“: E-Mail und Discord je Thema, die übrigen Kanäle nur als Hauptschalter.
const MORE_COLUMNS = ["email", "discord"];

export type NotificationLevelsProps = {
  info: NotificationServerInfo;
  prefs: Prefs;
  newsletter: boolean;
  quiet: QuietHours;
  channelEnabled: (key: string) => boolean;
  topicEnabled: (channel: string, topic: string) => boolean;
  onPrefs: (patch: Prefs) => void;
  onNewsletter: (value: boolean) => void;
  onQuiet: (next: QuietHours) => void;
};

export function NotificationLevels({ info, prefs, newsletter, quiet, channelEnabled, topicEnabled, onPrefs, onNewsletter, onQuiet }: NotificationLevelsProps) {
  const topics = info.topics;
  const level = levelOf(info.levels, prefs, topics, newsletter);
  const modes = topicModes(prefs, topics, newsletter);
  const current = info.levels.find((item) => item.key === level);
  // Je Thema die Runde, in der eine Stufe es zuletzt umgestellt hat - daran leuchtet es (einmal je Runde).
  const [lit, setLit] = useState<{ round: number; at: Record<string, number>; order: Record<string, number> }>({ round: 0, at: {}, order: {} });

  const pickLevel = (key: string) => {
    const next = info.levels.find((item) => item.key === key);
    if (!next) return;
    const changed = topics.filter((topic) => (next.modes || {})[topic.k] !== modes[topic.k]).map((topic) => topic.k);
    onPrefs(levelPatch(next));
    if (changed.length) {
      setLit((value) => {
        const round = value.round + 1;
        const at = { ...value.at };
        const order: Record<string, number> = {};
        changed.forEach((topic, index) => { at[topic] = round; order[topic] = index; });
        return { round, at, order };
      });
    }
  };
  const pickMode = (topic: NotificationTopic, mode: TopicMode) => {
    if (modes[topic.k] === mode) return;
    onPrefs(modePatch(topic.k, mode));
  };

  return (
    <View style={styles.wrap} testID="notification-levels-view">
      <Muted>Wähle, wie viel bei dir ankommt. Konto- und Sicherheitsmails bleiben immer aktiv.</Muted>

      <Card style={styles.card} testID="notification-levels">
        <View style={styles.titleRow}>
          <Body style={styles.cardTitle} accessibilityRole="header">Stufe</Body>
          {level === CUSTOM_LEVEL ? <Reveal key="custom" style={styles.chip} testID="notification-level-custom"><Muted style={styles.chipText}>Eigene Auswahl</Muted></Reveal> : null}
        </View>
        <Segments
          count={info.levels.length}
          index={info.levels.findIndex((item) => item.key === level)}
          gap={LEVEL_GAP}
          label="Stufe"
          thumbStyle={styles.levelGlide}
          rowStyle={styles.levelRow}
        >
          {info.levels.map((item) => {
            const checked = item.key === level;
            return (
              <Press
                key={item.key}
                scale={0.97}
                haptic
                onPress={() => pickLevel(item.key)}
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                accessibilityLabel={`${item.label}: ${LEVEL_HINTS[item.key] || item.description || ""}`}
                style={[styles.levelCard, checked && styles.levelCardChecked]}
                testID={`notification-level-${item.key}`}
              >
                <LevelIcon name={LEVEL_ICONS[item.key] || "notifications-outline"} checked={checked} />
                <Body style={[styles.levelLabel, checked && styles.levelLabelChecked]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{item.label}</Body>
                <Muted style={styles.levelHint} numberOfLines={2}>{LEVEL_HINTS[item.key] || ""}</Muted>
              </Press>
            );
          })}
        </Segments>
        <Muted style={styles.levelDescription} testID="notification-level-description">
          {level === CUSTOM_LEVEL ? "Du hast einzelne Themen selbst gestellt. Tippe eine Stufe an, dann setzt sie alle Themen neu." : current?.description || ""}
        </Muted>
      </Card>

      <Card style={styles.card}>
        <Body style={styles.cardTitle} accessibilityRole="header">Themen</Body>
        <Muted style={styles.small}>Push heißt: aufs Handy in der LionsAPP und in den Browser, wenn du ihn angemeldet hast. „Nur App“ legt es still in die Glocke.</Muted>
        {!channelEnabled("push") ? (
          <View style={styles.warning} testID="notification-push-off">
            <Muted style={styles.warningText}>Push aufs Handy ist bei dir ganz aus – die Themen kommen nur in die Glocke.</Muted>
            <Press onPress={() => onPrefs({ push: true })} accessibilityRole="button" style={styles.warningButton} testID="notification-push-on">
              <Body style={styles.warningButtonText}>Push einschalten</Body>
            </Press>
          </View>
        ) : null}
        {topics.map((topic) => (
          <View key={topic.k} style={styles.topic} testID={`notification-topic-${topic.k}`}>
            <Glow trigger={lit.at[topic.k]} delay={(lit.order[topic.k] || 0) * LIT_STAGGER_MS} />
            <Body style={profileStyles.strong} nativeID={`notification-topic-${topic.k}-label`}>{topic.l}</Body>
            <Muted style={styles.small}>{topic.d}</Muted>
            <Segments count={MODE_ORDER.length} index={MODE_ORDER.indexOf(modes[topic.k])} label={topic.l} thumbStyle={styles.segThumb} rowStyle={styles.seg}>
              {MODE_ORDER.map((option) => {
                const checked = modes[topic.k] === option;
                return (
                  <Press
                    key={option}
                    scale={0.95}
                    onPress={() => pickMode(topic, option)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked }}
                    accessibilityLabel={`${topic.l}: ${MODE_LABELS[option]}`}
                    style={styles.segOption}
                    testID={`notification-topic-${topic.k}-${option}`}
                  >
                    <Muted style={[styles.segText, checked && styles.segTextChecked]} numberOfLines={1}>{MODE_LABELS[option]}</Muted>
                  </Press>
                );
              })}
            </Segments>
          </View>
        ))}
      </Card>

      <QuietHoursCard quiet={quiet} exceptions={info.exceptions} onQuiet={onQuiet} />

      <MoreWays info={info} newsletter={newsletter} channelEnabled={channelEnabled} topicEnabled={topicEnabled} onPrefs={onPrefs} onNewsletter={onNewsletter} />
    </View>
  );
}

/**
 * Eine Reihe gleich breiter Felder mit einer Markierung, die zum gewählten gleitet (Stufen, Stellungen). Die Breite kommt aus
 * `onLayout`; bewegt wird nur `translateX` (und `opacity`, wenn nichts gewählt ist - „Eigene Auswahl“).
 */
function Segments({ count, index, gap = 0, label, rowStyle, thumbStyle, children }: {
  count: number; index: number; gap?: number; label: string; rowStyle: object; thumbStyle: object; children: React.ReactNode;
}) {
  const reduce = useReduceMotion();
  const [width, setWidth] = useState(0);
  const x = useSharedValue(0);
  const shown = useSharedValue(0);
  const placed = useRef(false);
  const cell = count > 0 && width > 0 ? (width - gap * (count - 1)) / count : 0;
  useEffect(() => {
    if (!cell) return;
    const target = Math.max(index, 0) * (cell + gap);
    const visible = index >= 0 ? 1 : 0;
    // Das erste Setzen nach dem Messen springt; danach gleitet die Markierung (ohne „Bewegung reduzieren“).
    if (reduce || !placed.current) {
      x.set(target);
      shown.set(visible);
      placed.current = true;
      return;
    }
    x.set(withTiming(target, { duration: 220, easing: EASE_OUT }));
    shown.set(withTiming(visible, { duration: 160, easing: EASE_OUT }));
  }, [cell, gap, index, reduce, shown, x]);
  const animated = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ translateX: x.get() }] }));
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  return (
    <View style={rowStyle} onLayout={onLayout} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {cell ? <Animated.View pointerEvents="none" style={[thumbStyle, { width: cell }, animated]} /> : null}
      {children}
    </View>
  );
}

/** Das Glocken-Zeichen einer Stufe: gewählt in Cyan und einen Hauch angehoben. */
function LevelIcon({ name, checked }: { name: keyof typeof Ionicons.glyphMap; checked: boolean }) {
  const reduce = useReduceMotion();
  const lift = useSharedValue(checked ? 1 : 0);
  useEffect(() => {
    lift.set(reduce ? (checked ? 1 : 0) : withTiming(checked ? 1 : 0, { duration: 280, easing: EASE_OUT }));
  }, [checked, lift, reduce]);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateY: reduce ? 0 : -2 * lift.get() }] }));
  return (
    <Animated.View style={animated}>
      <Ionicons name={name} size={20} color={checked ? colors.cyan : "rgba(255,255,255,0.45)"} />
    </Animated.View>
  );
}

/** Blendet beim Erscheinen ein und rückt 4 Punkte nach oben - mit „Bewegung reduzieren“ sofort da. */
function Reveal({ children, style, testID, delay = 40 }: { children: React.ReactNode; style?: object; testID?: string; delay?: number }) {
  const reduce = useReduceMotion();
  const value = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) value.set(withDelay(delay, withTiming(1, { duration: 260, easing: EASE_OUT })));
  }, [delay, reduce, value]);
  const animated = useAnimatedStyle(() => ({ opacity: value.get(), transform: [{ translateY: (1 - value.get()) * -4 }] }));
  return <Animated.View style={[style, animated]} testID={testID}>{children}</Animated.View>;
}

/** Dreht ein Zeichen zwischen zwei Lagen (Pfeil von „Weitere Wege“, Mond der Ruhezeit). */
function Turn({ on, degrees, children }: { on: boolean; degrees: number; children: React.ReactNode }) {
  const reduce = useReduceMotion();
  const turn = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    turn.set(reduce ? (on ? 1 : 0) : withTiming(on ? 1 : 0, { duration: 240, easing: EASE_OUT }));
  }, [on, reduce, turn]);
  const animated = useAnimatedStyle(() => ({ transform: [{ rotate: `${reduce ? 0 : degrees * turn.get()}deg` }] }));
  return <Animated.View style={animated}>{children}</Animated.View>;
}

// ---------------------------------------------------------------- Ruhezeit

function QuietHoursCard({ quiet, exceptions, onQuiet }: { quiet: QuietHours; exceptions: string[]; onQuiet: (next: QuietHours) => void }) {
  // Entwurf der beiden Felder: Ungültiges bleibt hier stehen und wird nicht gespeichert (wie im Web).
  const [draft, setDraft] = useState({ start: quiet.start, end: quiet.end });
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    setDraft({ start: quiet.start, end: quiet.end });
  }, [quiet.start, quiet.end]);
  const problem = quietHoursProblem({ start: normalizeClockInput(draft.start), end: normalizeClockInput(draft.end) });
  const commit = (next: { start: string; end: string }) => {
    setDraft(next);
    const clean = { start: normalizeClockInput(next.start), end: normalizeClockInput(next.end) };
    if (!quietHoursProblem(clean)) onQuiet({ ...quiet, ...clean });
  };
  const step = (field: "start" | "end", minutes: number) => {
    setTouched(true);
    const base = normalizeClockInput(draft[field]);
    commit({ ...draft, [field]: shiftClock(base, minutes, quiet[field]) });
  };
  const showProblem = problem && (touched || problem.startsWith("Zwischen"));
  return (
    <Card style={styles.card} testID="notification-quiet">
      <View style={styles.quietHead}>
        <Turn on={quiet.enabled} degrees={-12}>
          <Ionicons name={quiet.enabled ? "moon" : "moon-outline"} size={20} color={quiet.enabled ? colors.gold : "rgba(255,255,255,0.45)"} />
        </Turn>
        <View style={styles.flex}>
          <Body style={styles.cardTitle} accessibilityRole="header">Ruhezeit</Body>
          <Muted style={styles.small}>Kein Push, keine Browser-Meldung und keine Discord-Nachricht – alles wartet in der Glocke. Danach kommt eine Sammelmeldung, wenn etwas kam.</Muted>
        </View>
        <Switch
          value={quiet.enabled}
          onValueChange={(enabled) => onQuiet({ ...quiet, enabled })}
          accessibilityLabel="Ruhezeit"
          testID="notification-quiet-toggle"
          trackColor={{ false: "rgba(255,255,255,0.16)", true: "rgba(41,182,232,0.45)" }}
          thumbColor={quiet.enabled ? colors.cyan : colors.muted}
        />
      </View>
      {quiet.enabled ? (
        <Reveal style={styles.quietBody} testID="notification-quiet-body">
          <View style={styles.clockRow}>
            <ClockField label="Von" value={draft.start} invalid={Boolean(showProblem)} onChange={(text) => commit({ ...draft, start: text })} onStep={(minutes) => step("start", minutes)} onBlur={() => setTouched(true)} testID="notification-quiet-start" />
            <ClockField label="Bis" value={draft.end} invalid={Boolean(showProblem)} onChange={(text) => commit({ ...draft, end: text })} onStep={(minutes) => step("end", minutes)} onBlur={() => setTouched(true)} testID="notification-quiet-end" />
          </View>
          {showProblem ? (
            <Muted style={styles.error} accessibilityRole="alert" testID="notification-quiet-error">{problem}</Muted>
          ) : problem ? null : (
            <Body style={styles.summary} testID="notification-quiet-summary">{quietSummary({ ...quiet, start: normalizeClockInput(draft.start), end: normalizeClockInput(draft.end) })}</Body>
          )}
          <Muted style={styles.overline}>Kommt trotzdem sofort</Muted>
          <View style={styles.exceptions} testID="notification-quiet-exceptions">
            {exceptions.map((text) => (
              <View key={text} style={styles.bulletRow}>
                <Muted style={styles.bullet}>•</Muted>
                <Muted style={[styles.small, styles.flex]}>{text}</Muted>
              </View>
            ))}
          </View>
          <Muted style={styles.small}>E-Mails kommen wie bisher.</Muted>
        </Reveal>
      ) : null}
    </Card>
  );
}

/** Eine Uhrzeit: tippen oder mit − und + in Viertelstunden (über Mitternacht weiter), Wiener Zeit. */
function ClockField({ label, value, invalid, onChange, onStep, onBlur, testID }: {
  label: string; value: string; invalid: boolean; onChange: (text: string) => void; onStep: (minutes: number) => void; onBlur: () => void; testID: string;
}) {
  return (
    <View style={styles.clock}>
      <Muted style={styles.overline}>{label}</Muted>
      <View style={styles.clockControls}>
        <Press onPress={() => onStep(-QUIET_STEP_MINUTES)} accessibilityRole="button" accessibilityLabel={`${label}: 15 Minuten früher`} style={styles.stepButton} testID={`${testID}-earlier`}>
          <Ionicons name="remove" size={18} color={colors.cyan} />
        </Press>
        <TextInput
          value={value}
          onChangeText={onChange}
          onBlur={onBlur}
          accessibilityLabel={`Ruhezeit ${label}`}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          placeholder="22:00"
          placeholderTextColor={colors.muted}
          style={[styles.clockInput, invalid && styles.clockInputInvalid]}
          testID={testID}
        />
        <Press onPress={() => onStep(QUIET_STEP_MINUTES)} accessibilityRole="button" accessibilityLabel={`${label}: 15 Minuten später`} style={styles.stepButton} testID={`${testID}-later`}>
          <Ionicons name="add" size={18} color={colors.cyan} />
        </Press>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- Weitere Wege

function MoreWays({ info, newsletter, channelEnabled, topicEnabled, onPrefs, onNewsletter }: {
  info: NotificationServerInfo; newsletter: boolean; channelEnabled: (key: string) => boolean; topicEnabled: (channel: string, topic: string) => boolean;
  onPrefs: (patch: Prefs) => void; onNewsletter: (value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const discord = info.discord;
  const channels = notificationChannels.filter((channel) => channel.key !== "discord" || Boolean(discord?.linked));
  const columns = channels.filter((channel) => MORE_COLUMNS.includes(channel.key));
  return (
    <Card style={[styles.card, styles.moreCard]}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.moreToggle, pressed && styles.pressed]}
        testID="notification-more-ways"
      >
        <View style={styles.flex}>
          <Body style={styles.cardTitle}>Weitere Wege</Body>
          <Muted style={styles.small}>E-Mail, Discord und Kanäle ganz abschalten.</Muted>
        </View>
        <Turn on={open} degrees={180}>
          <Ionicons name="chevron-down" size={20} color={open ? colors.cyan : "rgba(255,255,255,0.55)"} />
        </Turn>
      </Pressable>
      {open ? (
        <Reveal style={styles.morePanel} testID="notification-more-panel">
          {channels.map((channel, index) => (
            <Toggle key={channel.key} first={index === 0} label={channel.label} detail={channel.detail} value={channelEnabled(channel.key)} onValueChange={(value) => onPrefs({ [channel.key]: value })} testID={`notification-channel-${channel.key}`} />
          ))}
          {discord && !discord.linked ? <Muted style={styles.small} testID="notification-discord-unlinked">Discord als Weg: erst auf der Website unter Socials „Mit Discord verknüpfen“ – dann kommen Benachrichtigungen auf Wunsch als Direktnachricht vom Vereins-Bot.</Muted> : null}
          {discord?.linked && discord.hint ? <Muted style={profileStyles.warningText}>{discord.hint}</Muted> : null}
          {NOTIFICATION_TOPICS.map((topic) => {
            const shown = columns.filter((channel) => !topic.channels || topic.channels.includes(channel.key));
            return (
              <View key={topic.k} style={profileStyles.notificationTopic} testID={`notification-more-${topic.k}`}>
                <Body style={profileStyles.strong}>{topic.l}</Body>
                {topic.requiresNewsletter && !newsletter ? <Muted style={profileStyles.warningText}>Per E-Mail nur mit Newsletter-Zustimmung (unten).</Muted> : null}
                {shown.length ? (
                  <View style={profileStyles.notificationMatrix}>
                    {shown.map((channel) => {
                      const key = notificationPreferenceKey(channel.key, topic.k);
                      const enabled = channelEnabled(channel.key);
                      const disabled = !enabled || (channel.key === "email" && Boolean(topic.requiresNewsletter) && !newsletter);
                      return <MatrixToggle key={key} label={channel.label} value={enabled && topicEnabled(channel.key, topic.k)} disabled={disabled} onValueChange={(value) => onPrefs({ [key]: value })} />;
                    })}
                  </View>
                ) : <Muted style={styles.small}>Hier kein weiterer Weg.</Muted>}
              </View>
            );
          })}
          <Toggle label="Newsletter" detail="Ich willige separat ein, Newsletter, Event-Hinweise und Vereinsnews per E-Mail zu erhalten. Jederzeit widerrufbar." value={newsletter} onValueChange={onNewsletter} testID="notification-newsletter" />
        </Reveal>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 12,
  },
  card: {
    gap: 10,
  },
  flex: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  cardTitle: {
    fontWeight: "900",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  chip: {
    borderColor: "rgba(255,255,255,0.28)",
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  small: {
    fontSize: 12,
  },
  levelRow: {
    flexDirection: "row",
    gap: LEVEL_GAP,
  },
  levelGlide: {
    backgroundColor: "rgba(41,182,232,0.12)",
    borderColor: "rgba(41,182,232,0.6)",
    borderRadius: radius.sm,
    borderWidth: 1,
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
  },
  levelCard: {
    alignItems: "flex-start",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minHeight: 88,
    padding: 10,
  },
  levelCardChecked: {
    borderColor: "transparent",
  },
  levelLabel: {
    color: "rgba(255,255,255,0.75)",
    fontWeight: "900",
    textTransform: "uppercase",
  },
  levelLabelChecked: {
    color: colors.white,
  },
  levelHint: {
    fontSize: 11,
  },
  levelDescription: {
    fontSize: 12,
    minHeight: 32,
  },
  warning: {
    borderColor: "rgba(255,159,10,0.45)",
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: 8,
    padding: 10,
  },
  warningText: {
    color: "#FF9F0A",
  },
  warningButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: "rgba(255,159,10,0.45)",
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 14,
  },
  warningButtonText: {
    color: "#FF9F0A",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  topic: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 6,
    paddingTop: 12,
  },
  seg: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: 4,
  },
  segThumb: {
    backgroundColor: "rgba(41,182,232,0.18)",
    borderColor: "rgba(41,182,232,0.6)",
    borderRadius: radius.sm,
    borderWidth: 1,
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
  },
  segOption: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 6,
  },
  segText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  segTextChecked: {
    color: colors.white,
  },
  quietHead: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
  },
  quietBody: {
    gap: 10,
  },
  clockRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  clock: {
    flexGrow: 1,
    gap: 4,
    minWidth: 150,
  },
  clockControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  stepButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  clockInput: {
    backgroundColor: "#050505",
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.white,
    flex: 1,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
    minHeight: 48,
    minWidth: 64,
    paddingHorizontal: 8,
    textAlign: "center",
  },
  clockInputInvalid: {
    borderColor: colors.live,
  },
  error: {
    color: colors.live,
  },
  summary: {
    color: "rgba(255,255,255,0.75)",
  },
  overline: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  exceptions: {
    gap: 4,
  },
  bulletRow: {
    flexDirection: "row",
    gap: 6,
  },
  bullet: {
    fontSize: 12,
  },
  moreCard: {
    gap: 0,
  },
  moreToggle: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 48,
  },
  morePanel: {
    gap: 10,
    paddingTop: 10,
  },
  pressed: {
    opacity: 0.72,
  },
});
