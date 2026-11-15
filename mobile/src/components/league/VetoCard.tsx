import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../../lib/api";
import { remainingText } from "../../lib/leagueCheckin";
import { playMoment } from "../../lib/tournamentHaptics";
import {
  actionWord, boardGroups, cardLabel, countdownAnnouncement, freshCards, historyLine, isUrgent, ownTurnQuestion, plannedRoleLabel,
  readyText, secondsLeft, stepLabel, timelineLabel, timelineRows, vetoClockOffset, vetoDeadline, vetoHeadline, vetoRingShare, vetoText,
  vetoVisible, type BoardCard, type VetoBlock, type VetoGroup,
} from "../../lib/leagueVeto";
import { colors, radius, roles, surfaces } from "../../theme";
import { Button } from "../Button";
import { MediaImage } from "../MediaImage";
import { Glow, Press, StaggerIn } from "../motion";
import { Body, Muted } from "../Text";
import { CountdownRing } from "./CountdownRing";

// Map-Veto in der App (#2173, Web: components/tls/league/VetoPanel.jsx und VetoLive.jsx, docs/LIGA.md D.3/D.4): wer am Zug ist, der
// Countdown nach der Serverzeit, der Ablauf als Leiste, das Brett aus Map-Karten (eigene Seite am Zug: antippen sperrt bzw. wählt),
// „Bereit zum Veto“ nach einer nachgetragenen Vorgabe der Woche und am Ende die Spielreihenfolge. `readOnly`: dieselbe Ansicht für
// Zuschauer. Eingriffe der Liga-Leitung (Pause, Schritt zurück, Neustart, Notfall-Start) gibt es im Web.
// Detail-Runde: Karten bauen sich gestaffelt auf, eine Wahl und jede Aktion der Gegenseite leuchten einmal auf, der Modus am Zug
// leuchtet beim neuen Schritt auf, die eigene Wahl gibt beim Antippen nach (mit leichter Vibration); kommt der eigene Zug, vibriert es
// einmal. Bewegt werden nur Deckkraft und Größe; mit „Bewegung reduzieren“ steht alles sofort da.

export const SIDE_COLORS = { a: roles.brand, b: "#FF7020", system: roles.honor } as const;
const PRESET_COLOR = roles.ok;

export type VetoRun = (task: () => Promise<string | void>, fallback: string) => Promise<void>;

/** Für den Vorleser ansagen - scheitert es (kein Vorleser, Test), passiert nichts. */
function announce(text: string) {
  if (!text) return;
  try {
    AccessibilityInfo.announceForAccessibility?.(text);
  } catch {
    // ohne Ansage weiter
  }
}

function useServerOffset(serverNow?: string | null) {
  return useMemo(() => vetoClockOffset(serverNow, Date.now()), [serverNow]);
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** Karten, die seit dem letzten Stand eine Aktion bekommen haben - Zuschauer sehen jede Aktion als neu. */
function useFreshCards(block?: VetoBlock | null) {
  const before = useRef<VetoGroup[] | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const remaining = block?.remaining;
  useEffect(() => {
    const next = remaining || null;
    if (before.current && next) setFresh(freshCards(before.current, next, block?.own_side || null));
    before.current = next;
    // Nur ein neuer Stand des Bretts zählt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);
  return fresh;
}

function VetoCountdown({ block, offset }: { block: VetoBlock; offset: number }) {
  const deadline = vetoDeadline(block, offset);
  const now = useNow(deadline !== null);
  if (deadline === null) return null;
  const seconds = secondsLeft(deadline, now) ?? 0;
  const urgent = isUrgent(seconds);
  return (
    <View testID="veto-countdown">
      <CountdownRing share={vetoRingShare(block, now, offset)} text={seconds > 0 ? remainingText(deadline, now) : "Zeit um"} label="noch" urgent={urgent} testID="veto-countdown-ring" />
      {/* Der Vorleser sagt die Zeit nur bei 30, 10 und 5 Sekunden und beim Ablauf an. */}
      <Text style={styles.srOnly} accessibilityLiveRegion="polite" testID="veto-countdown-announce">{countdownAnnouncement(seconds)}</Text>
    </View>
  );
}

function WeekPresets({ block }: { block: VetoBlock }) {
  if (!block.presets?.length) return null;
  return (
    <View style={[styles.box, styles.presetBox]} testID="veto-presets">
      <View style={styles.inlineRow}>
        <Ionicons name="pin-outline" size={14} color={PRESET_COLOR} />
        <Text style={[styles.eyebrow, { color: PRESET_COLOR }]}>Vorgabe der Woche{block.week ? ` · Spielwoche ${block.week}` : ""}</Text>
      </View>
      <StaggerIn style={styles.stack}>
        {block.presets.map((row) => (
          <View key={row.mode} style={styles.presetRow} testID={`veto-preset-${row.mode}`}>
            <MediaImage uri={row.map_image_url} style={styles.thumb} fallback={<View style={styles.thumbEmpty} />} />
            <View style={styles.flex}>
              <Body style={styles.strong} numberOfLines={1}>{row.map_name}</Body>
              <Muted>{row.mode_label} · Map {row.position}</Muted>
            </View>
            <Glow active tone="ok" delay={200} />
          </View>
        ))}
      </StaggerIn>
      <Muted style={styles.small}>Von der Liga-Leitung festgelegt – nicht sperrbar und nicht wählbar.</Muted>
    </View>
  );
}

function ReadyToStart({ block, matchId, busy, run, onChanged }: { block: VetoBlock; matchId: string; busy: boolean; run: VetoRun; onChanged: () => void | Promise<void> }) {
  const start = block.start;
  if (!start) return null;
  const send = (ready: boolean) => run(async () => {
    const { data } = await api.post<{ started?: boolean }>(`/matches/${matchId}/veto/ready`, { ready });
    await onChanged();
    return data?.started ? "Beide Seiten sind bereit – das Veto läuft." : ready ? "Ihr seid bereit – jetzt fehlt die Gegenseite." : "„Bereit“ zurückgenommen.";
  }, ready ? "„Bereit zum Veto“ hat nicht geklappt." : "Zurücknehmen hat nicht geklappt.");
  return (
    <View style={[styles.box, styles.readyBox]} testID="veto-ready">
      {(start.sides || []).map((side) => (
        <View key={side.registration_id} style={[styles.readySide, side.ready && styles.readySideOn]} testID={`veto-ready-side-${side.registration_id}`}>
          <Body style={[styles.strong, styles.flex]} numberOfLines={2}>{side.name}{side.own ? "  · ihr" : ""}</Body>
          <View style={styles.inlineRow}>
            {side.ready ? <Ionicons name="checkmark" size={14} color={roles.ok} /> : null}
            <Text style={[styles.readyText, side.ready && { color: roles.ok }]}>{side.ready ? "bereit" : "noch nicht bereit"}</Text>
          </View>
          {side.ready ? <Glow trigger={side.ready} tone="ok" /> : null}
        </View>
      ))}
      {start.can_ready ? <Button label="Bereit zum Veto" icon="play" onPress={() => { void send(true); }} disabled={busy} busy={busy} testID="veto-ready-button" /> : null}
      {start.can_withdraw ? <Button label="Doch nicht bereit" variant="quiet" compact onPress={() => { void send(false); }} disabled={busy} testID="veto-ready-withdraw" /> : null}
      <Muted style={styles.small} testID="veto-ready-note">
        {block.blocked ? "Die Vorgabe der Woche fehlt gerade wieder. Sobald die Liga-Leitung sie eingetragen hat und beide Seiten bereit sind, beginnt das Veto von selbst – bis dahin gibt es keine Frist."
          : `Das Veto beginnt, sobald beide Seiten bereit sind. Erst dann läuft die Zeit${block.step_seconds ? ` (${block.step_seconds} Sekunden je Schritt)` : ""} – bis dahin gibt es keine Frist.`}
      </Muted>
    </View>
  );
}

function Timeline({ block }: { block: VetoBlock }) {
  const rows = timelineRows(block);
  const scroll = useRef<ScrollView | null>(null);
  const spots = useRef(new Map<string, number>());
  const currentKey = rows.find((row) => row.state === "current")?.key || null;
  useEffect(() => {
    // Der laufende Schritt rückt in die Leiste - nur die Leiste scrollt.
    const x = currentKey ? spots.current.get(currentKey) : undefined;
    if (x !== undefined) scroll.current?.scrollTo?.({ x: Math.max(0, x - 80), animated: true });
  }, [currentKey]);
  if (!rows.length) return null;
  return (
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeline} testID="veto-timeline" accessibilityLabel="Ablauf des Vetos">
      {rows.map((row) => {
        const color = SIDE_COLORS[row.tone];
        return (
          <View
            key={row.key}
            onLayout={(event) => spots.current.set(row.key, event.nativeEvent.layout.x)}
            style={[styles.step, row.state === "current" && { borderColor: color, backgroundColor: "rgba(255,255,255,0.06)" }, row.state === "open" && styles.stepOpen]}
            accessible
            accessibilityLabel={timelineLabel(row, rows.length)}
            accessibilityState={{ selected: row.state === "current" }}
            testID={`veto-step-${row.index}`}
          >
            <Text style={[styles.stepKind, { color }]}>{row.number}. {row.kindLabel}</Text>
            <Text style={styles.stepWho} numberOfLines={1}>{row.who}</Text>
            <Text style={styles.stepTarget} numberOfLines={1}>{row.state === "done" ? row.map_name : [row.mode_label, row.target].filter(Boolean).join(" · ")}</Text>
            {row.auto ? <Ionicons name="shuffle-outline" size={12} color={roles.quiet} accessibilityLabel="Zufallswahl" /> : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

function MapCard({ card, kind, busy, fresh, onChoose }: { card: BoardCard; kind?: string; busy: boolean; fresh: boolean; onChoose: ((card: BoardCard) => void) | null }) {
  const color = card.status === "decider" ? roles.honor : card.status === "preset" ? PRESET_COLOR : SIDE_COLORS[card.tone];
  const banned = card.status === "banned";
  const chosen = ["picked", "decider", "preset"].includes(String(card.status));
  const body = (
    <>
      <MediaImage uri={card.image_url} style={[styles.mapImage, banned && styles.mapImageBanned]} fallback={<View style={styles.thumbEmpty} />} />
      <View style={styles.mapText}>
        <Body style={[styles.mapName, banned && styles.dim]} numberOfLines={1}>{card.name}</Body>
        <Text style={[styles.mapStatus, chosen && { color }, banned && { color: roles.quiet }]} numberOfLines={2}>{card.statusText}</Text>
        {card.pickable && !card.selectable && card.option?.hint ? <Text style={styles.mapHint} numberOfLines={2}>{card.option.hint}</Text> : null}
      </View>
      {banned ? <Ionicons name="ban-outline" size={16} color={roles.quiet} style={styles.mapIcon} /> : null}
      {chosen && card.position ? <Text style={[styles.mapBadge, { backgroundColor: color }]}>Map {card.position}</Text> : null}
      {fresh ? <Glow active tone={card.status === "preset" ? "ok" : card.status === "decider" ? "honor" : "brand"} color={card.status === "banned" || card.tone === "b" ? color : undefined} peak={0.22} /> : null}
    </>
  );
  const style = [styles.mapCard, chosen && { borderColor: color }, banned && styles.mapBanned, card.selectable && styles.mapSelectable, card.pickable && !card.selectable && styles.mapDisabled];
  if (card.selectable && onChoose) {
    return (
      <Press haptic onPress={() => onChoose(card)} disabled={busy} style={style} accessibilityRole="button" accessibilityLabel={cardLabel(card, kind)} testID={`veto-option-${card.map_id}`}>
        {body}
      </Press>
    );
  }
  return <View style={style} accessible accessibilityLabel={cardLabel(card, kind)} testID={`veto-card-${card.key}`}>{body}</View>;
}

function Board({ block, busy, onChoose, fresh }: { block: VetoBlock; busy: boolean; onChoose: ((card: BoardCard) => void) | null; fresh: Set<string> }) {
  const groups = boardGroups(block);
  if (!groups.length) return null;
  return (
    <View style={styles.stack} testID="veto-board">
      {groups.map((group) => (
        <View key={group.mode} style={[styles.group, group.current && styles.groupCurrent]} testID={`veto-group-${group.mode}`}>
          <Text style={[styles.eyebrow, group.current && { color: roles.brand }]}>{group.label}{group.current ? " · am Zug" : ""}</Text>
          <StaggerIn style={styles.cards}>
            {group.cards.map((card) => <MapCard key={card.key} card={card} kind={block.current?.kind} busy={busy} fresh={fresh.has(card.key)} onChoose={onChoose} />)}
          </StaggerIn>
          {/* Der Modus am Zug leuchtet bei jedem neuen Schritt einmal auf. */}
          {group.current ? <Glow trigger={block.current?.index} tone="brand" peak={0.1} /> : null}
        </View>
      ))}
    </View>
  );
}

function PlannedGames({ block }: { block: VetoBlock }) {
  const games = block.planned_games || [];
  if (!games.length) return null;
  return (
    <StaggerIn style={styles.stack} testID="veto-planned">
      {games.map((game) => (
        <View key={game.position} style={styles.plannedRow} testID={`veto-planned-${game.position}`}>
          <MediaImage uri={game.map_image_url} style={styles.thumb} fallback={<View style={styles.thumbEmpty} />} />
          <View style={styles.flex}>
            <Text style={[styles.eyebrow, { color: roles.ok }]}>Map {game.position}{plannedRoleLabel(game.role) ? ` · ${plannedRoleLabel(game.role)}` : ""}</Text>
            <Body style={styles.strong} numberOfLines={1}>{game.map_name}</Body>
            <Muted>{game.mode_label}</Muted>
          </View>
        </View>
      ))}
    </StaggerIn>
  );
}

export function VetoCard({ block, matchId, busy = false, run, onChanged, readOnly = false }: {
  block?: VetoBlock | null;
  matchId: string;
  busy?: boolean;
  run?: VetoRun;
  onChanged?: () => void | Promise<void>;
  readOnly?: boolean;
}) {
  const offset = useServerOffset(block?.server_now);
  const fresh = useFreshCards(block);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Der eigene Zug kommt (nicht beim Öffnen): einmal kurz vibrieren - im selben Moment leuchtet der Modus am Zug auf.
  const ownTurn = Boolean(block?.own_turn && block?.status === "running" && !readOnly);
  const turnBefore = useRef<boolean | null>(null);
  useEffect(() => {
    const before = turnBefore.current;
    turnBefore.current = ownTurn;
    if (before === false && ownTurn) {
      // iOS liest Live-Regionen nicht vor - darum zusätzlich ansagen, dass ihr jetzt am Zug seid.
      announce(vetoText(block));
      return playMoment("advance");
    }
    return undefined;
    // Nur der Wechsel „am Zug“ zählt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownTurn]);
  // Neuer Schritt (nicht beim Öffnen): der letzte Zug für den Vorleser - auf Android über die Live-Region, auf iOS über die Ansage.
  const steps = block?.history?.length ?? null;
  const stepsBefore = useRef<number | null>(null);
  useEffect(() => {
    const before = stepsBefore.current;
    stepsBefore.current = steps;
    if (before === null || steps === null || steps <= before || ownTurn) return;
    const last = block?.history?.[steps - 1];
    if (last) announce(historyLine(last));
    // Nur die Zahl der Schritte zählt; beim eigenen Zug sagt der Effekt darüber schon an.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);
  if (!block || !vetoVisible(block)) return null;
  const live = block.status === "running" || block.status === "paused";
  const blocked = Boolean(block.status === "waiting" && block.blocked);
  const startReady = Boolean(block.status === "waiting" && block.start);
  const choose = readOnly || !run ? null : (card: BoardCard) => {
    void run(async () => {
        const { data } = await api.post<{ status?: string }>(`/matches/${matchId}/veto/pick`, { map_id: card.map_id, version: block.version });
      await onChanged?.();
      return data?.status === "done" ? "Veto abgeschlossen – die Spielreihenfolge steht." : `${card.name} ${block.current?.kind === "ban" ? "gesperrt" : "gewählt"}.`;
    }, `${actionWord(block.current?.kind)} hat nicht geklappt.`);
  };
  const tone = blocked ? roles.warn : startReady ? roles.brand
    : block.status === "running" ? (block.own_turn ? roles.brand : "rgba(255,215,0,0.4)") : block.status === "paused" ? roles.warn : block.status === "done" ? roles.ok : colors.border;
  const lastStep = block.history?.length ? historyLine(block.history[block.history.length - 1]) : "";
  return (
    <View style={[styles.panel, { borderColor: tone }]} testID="veto-panel" accessibilityLabel={`Map-Veto: ${vetoHeadline(block)}`}>
      <View style={styles.headRow}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>Map-Veto · Regelwerk § 6</Text>
          <Text style={styles.headline} accessibilityRole="header" testID="veto-headline">{vetoHeadline(block)}</Text>
          <Body style={styles.text} testID="veto-text">{vetoText(block)}</Body>
          {block.current ? <Muted style={styles.small} testID="veto-step">{stepLabel(block.current)}</Muted> : null}
          {block.team_a ? (
            <Text style={styles.teams} testID="veto-teams">
              <Text style={{ color: SIDE_COLORS.a }}>Team A</Text>: {block.team_a.name}{block.team_a.via === "draw" ? " (gelost)" : " (Heim)"} · <Text style={{ color: SIDE_COLORS.b }}>Team B</Text>: {block.team_b?.name}
            </Text>
          ) : null}
        </View>
        {live ? <VetoCountdown block={block} offset={offset} /> : null}
      </View>
      {/* Was gerade passiert ist, für den Vorleser - einmal je Schritt. */}
      <Text style={styles.srOnly} accessibilityLiveRegion="polite" testID="veto-announce">{live ? lastStep : ""}</Text>
      {block.status === "paused" && block.paused ? (
        <View style={[styles.box, styles.warnBox]} testID="veto-paused">
          <Body>{block.paused.reason ? `Pausiert – ${block.paused.reason}` : (block.pick_hint || "Das Veto ist pausiert – die Liga-Leitung setzt es fort.")}</Body>
        </View>
      ) : null}
      {blocked ? (
        <View style={[styles.box, styles.warnBox]} testID="veto-blocked">
          <Body>Gewertet wird nichts von selbst. Sind beide Seiten eingecheckt, bekommt die Liga-Leitung einen Hinweis. Sobald die Vorgabe steht, bekommt ihr eine Nachricht – das Veto beginnt, wenn beide Seiten hier „Bereit zum Veto“ getippt haben.</Body>
        </View>
      ) : null}
      {block.status === "done" ? null : <WeekPresets block={block} />}
      {startReady && !readOnly && run && onChanged ? <ReadyToStart block={block} matchId={matchId} busy={busy} run={run} onChanged={onChanged} /> : null}
      {startReady && readOnly ? <Muted>{readyText(block.start)}</Muted> : null}
      {block.status === "skipped" ? <Muted style={styles.small} testID="veto-skipped">Die Maps werden beim Ergebnis eingetragen.</Muted> : null}
      {block.status === "done" ? <PlannedGames block={block} /> : null}
      {live || block.status === "done" ? <Timeline block={block} /> : null}
      {!readOnly && block.can_pick && block.current ? (
        <View style={[styles.box, styles.ownBox]} testID="veto-own">
          <Text style={[styles.eyebrow, { color: roles.brand }]}>{ownTurnQuestion(block.current)}</Text>
          <Muted style={styles.small}>Tippt unten bei {block.current.mode_label} eine Map an – {block.current.kind === "ban" ? "sie ist dann gesperrt" : "sie wird gespielt"}.</Muted>
          {(block.options || []).some((option) => !option.allowed) ? (
            <Muted style={styles.small} testID="veto-options-hint">
              {block.presets?.length ? "Ausgegraute Maps sind gesperrt, schon gewählt, als Vorgabe der Woche fest oder ließen die Serie nicht mehr aufgehen."
                : "Ausgegraute Maps sind gesperrt, schon gewählt oder ließen die Serie nicht mehr aufgehen."}
            </Muted>
          ) : null}
        </View>
      ) : null}
      {live ? <Board block={block} busy={busy} onChoose={choose} fresh={fresh} /> : null}
      {block.status === "running" && !block.can_pick && block.pick_hint ? <Muted style={styles.small} testID="veto-wait">{block.pick_hint} Die Seite aktualisiert sich von selbst.</Muted> : null}
      {!readOnly && block.lead?.can_act ? (
        <Muted style={styles.small} testID="veto-lead-web">Eingriffe der Liga-Leitung (Pausieren, Schritt zurück, Neu starten) gehen auf der Matchseite im Web.</Muted>
      ) : null}
      {!readOnly && block.start?.lead?.can_start ? (
        <Muted style={styles.small} testID="veto-lead-start-web">Notfall-Start durch die Liga-Leitung: auf der Matchseite im Web, mit Grund.</Muted>
      ) : null}
      {block.history?.length ? (
        <View style={styles.stack}>
          <Pressable onPress={() => setHistoryOpen((open) => !open)} accessibilityRole="button" accessibilityState={{ expanded: historyOpen || block.status !== "done" }} style={styles.toggle} testID="veto-history-toggle">
            <Text style={styles.historyToggle}>Verlauf ({block.history.length} {block.history.length === 1 ? "Schritt" : "Schritte"})</Text>
          </Pressable>
          {historyOpen || block.status !== "done" ? (
            <View style={styles.stack} testID="veto-history">
              {block.history.map((row) => <Muted key={row.index} style={styles.small} testID={`veto-history-${row.index}`}>{historyLine(row)}</Muted>)}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: surfaces.base, borderRadius: radius.lg, borderWidth: 1, gap: 12, padding: 14 },
  headRow: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "space-between" },
  flex: { flex: 1, minWidth: 0 },
  eyebrow: { color: roles.brand, fontSize: 11, fontWeight: "900", letterSpacing: 1.6, textTransform: "uppercase" },
  headline: { color: colors.white, fontSize: 20, fontWeight: "900", marginTop: 2, textTransform: "uppercase" },
  text: { color: "rgba(255,255,255,0.8)", marginTop: 4 },
  small: { fontSize: 12 },
  strong: { fontWeight: "900" },
  teams: { color: roles.quiet, fontSize: 12, marginTop: 4 },
  srOnly: { height: 1, opacity: 0, position: "absolute", width: 1 },
  inlineRow: { alignItems: "center", flexDirection: "row", gap: 5 },
  stack: { gap: 8 },
  box: { borderRadius: radius.lg, borderWidth: 1, gap: 8, padding: 12 },
  warnBox: { backgroundColor: "rgba(255,159,67,0.1)", borderColor: "rgba(255,159,67,0.45)" },
  presetBox: { backgroundColor: "rgba(31,208,142,0.05)", borderColor: "rgba(31,208,142,0.4)" },
  readyBox: { backgroundColor: "rgba(41,182,232,0.05)", borderColor: "rgba(41,182,232,0.4)" },
  ownBox: { backgroundColor: "rgba(41,182,232,0.06)", borderColor: "rgba(41,182,232,0.45)" },
  presetRow: { alignItems: "center", flexDirection: "row", gap: 10, overflow: "hidden" },
  thumb: { borderRadius: radius.sm, height: 44, width: 60 },
  thumbEmpty: { backgroundColor: "rgba(255,255,255,0.05)", flex: 1 },
  readySide: { alignItems: "center", borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: 8, overflow: "hidden", padding: 10 },
  readySideOn: { backgroundColor: "rgba(31,208,142,0.1)", borderColor: "rgba(31,208,142,0.5)" },
  readyText: { color: roles.quiet, fontSize: 12, fontWeight: "800" },
  timeline: { gap: 8, paddingVertical: 2 },
  step: { backgroundColor: surfaces.s1, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: 2, minWidth: 96, paddingHorizontal: 9, paddingVertical: 7 },
  stepOpen: { opacity: 0.6 },
  stepKind: { fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  stepWho: { color: colors.white, fontSize: 12, fontWeight: "800", maxWidth: 140 },
  stepTarget: { color: roles.quiet, fontSize: 11, maxWidth: 140 },
  group: { backgroundColor: surfaces.s1, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: 8, overflow: "hidden", padding: 10 },
  groupCurrent: { borderColor: "rgba(41,182,232,0.6)" },
  cards: { gap: 8 },
  mapCard: { alignItems: "center", backgroundColor: surfaces.s2, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 56, overflow: "hidden", padding: 6 },
  mapSelectable: { borderColor: "rgba(41,182,232,0.7)", backgroundColor: "rgba(41,182,232,0.08)" },
  mapDisabled: { opacity: 0.5 },
  mapBanned: { opacity: 0.55 },
  mapImage: { borderRadius: radius.sm, height: 44, width: 64 },
  mapImageBanned: { opacity: 0.4 },
  mapText: { flex: 1, minWidth: 0 },
  mapName: { fontWeight: "900" },
  dim: { color: roles.quiet, textDecorationLine: "line-through" },
  mapStatus: { color: roles.muted, fontSize: 12 },
  mapHint: { color: roles.quiet, fontSize: 11 },
  mapIcon: { marginRight: 4 },
  mapBadge: { borderRadius: radius.sm, color: "#04141B", fontSize: 11, fontWeight: "900", overflow: "hidden", paddingHorizontal: 6, paddingVertical: 3 },
  plannedRow: { alignItems: "center", backgroundColor: "rgba(31,208,142,0.05)", borderColor: "rgba(31,208,142,0.4)", borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: 10, padding: 8 },
  // Tippfläche mindestens 48 Punkte wie jeder Knopf der App (a11y/audit.ts).
  toggle: { alignSelf: "flex-start", justifyContent: "center", minHeight: 48 },
  historyToggle: { color: roles.muted, fontSize: 12, fontWeight: "800" },
});
