import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "../../lib/api";
import {
  STATE_LABELS, clock, countdownLabel, countdownTarget, otherSide, ownSide, remainingText, ringShare, rulesSentences, selectionText,
  showsOwnCheckin, sideStatusText, stateText, type CheckinBlock, type CheckinSide,
} from "../../lib/leagueCheckin";
import { openLink } from "../../lib/openLink";
import { playMoment } from "../../lib/tournamentHaptics";
import { colors, radius, roles, surfaces } from "../../theme";
import { Button } from "../Button";
import { Glow, Press } from "../motion";
import { Body, Muted } from "../Text";
import { CountdownRing } from "./CountdownRing";
import { VetoCard, type VetoRun } from "./VetoCard";

// Liga-Spieltag in der App (#2173, Web: components/tls/league/CheckinPanel.jsx, docs/LIGA.md D.2): geführt wie im Web - Stand und
// Countdown oben, beide Seiten mit Haken, die eigene Seite hakt ihre Anwesenden an und tippt „Einchecken“, danach „Spiel starten“.
// Was gerade nicht geht, steht als Satz da. Das Map-Veto (D.3/D.4) steht im selben Block. Die Leitung trägt im Notfall im Web ein.
// Detail-Runde: der Haken einer Seite leuchtet beim Einchecken einmal auf, der eigene Check-in vibriert einmal (Erfolg), Zeilen geben
// beim Antippen nach; mit „Bewegung reduzieren“ bleibt alles still.

const TONES: Record<string, string> = { ready: roles.ok, veto: roles.ok, running: roles.brand, closed: roles.warn };

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

function Countdown({ block }: { block: CheckinBlock }) {
  const target = countdownTarget(block);
  const now = useNow(target !== null);
  if (target === null) return null;
  const done = target <= now;
  return <CountdownRing share={ringShare(block, now)} text={done ? "jetzt" : remainingText(target, now)} label={done ? "" : countdownLabel(block)} testID="checkin-countdown" />;
}

function SideCard({ side }: { side: CheckinSide }) {
  return (
    <View style={[styles.side, side.checked_in && styles.sideIn]} testID={`checkin-side-${side.registration_id}`}>
      <View style={styles.sideHead}>
        <View style={styles.flex}>
          <Body style={styles.sideName} numberOfLines={2}>{side.name}{side.own ? <Text style={styles.ownTag}>  ihr</Text> : null}</Body>
          <Muted style={styles.small} testID={`checkin-side-status-${side.registration_id}`}>{sideStatusText(side)}</Muted>
        </View>
        <View style={[styles.tick, side.checked_in && styles.tickIn]}>
          <Ionicons name={side.checked_in ? "checkmark" : "alarm-outline"} size={side.checked_in ? 18 : 15} color={side.checked_in ? roles.ok : roles.quiet} />
          {/* Der Haken leuchtet einmal auf, sobald die Seite eingecheckt ist - nicht beim Öffnen. */}
          <Glow trigger={side.checked_in ? side.at || "in" : null} tone="ok" radius={18} peak={0.35} />
        </View>
      </View>
      {side.present?.length ? (
        <View style={styles.chips} accessibilityLabel={`Anwesend bei ${side.name}`}>
          {side.present.map((person) => <Text key={person.id} style={styles.chip}>{person.name}</Text>)}
        </View>
      ) : null}
      {side.lead_reason ? <Muted style={styles.small}>Grund der Leitung: {side.lead_reason}</Muted> : null}
      {side.consent_open ? (
        <View style={[styles.note, styles.warnNote]} testID={`checkin-consent-${side.registration_id}`}>
          <Body style={styles.small}>Das Regelwerk hat sich geändert – {side.own ? "bitte erst zustimmen" : "diese Seite muss erst zustimmen"}.</Body>
          {side.own && side.rules_url ? <Button compact variant="secondary" label="Zur neuen Fassung" onPress={() => { openLink(side.rules_url); }} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function OwnCheckin({ block, matchId, busy, run, onChanged }: { block: CheckinBlock; matchId: string; busy: boolean; run: VetoRun; onChanged: () => void | Promise<void> }) {
  const own = ownSide(block);
  const [selected, setSelected] = useState<string[]>(() => (own?.present || []).map((person) => person.id));
  if (!own || !showsOwnCheckin(block)) return null;
  const minimum = Number(block.min_present || 1);
  const enough = selected.length >= minimum;
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const submit = () => run(async () => {
    const { data } = await api.post<{ ready?: boolean }>(`/matches/${matchId}/checkin`, { present: selected });
    // Eingecheckt (#1168): einmal Erfolg - im selben Moment steht der Haken bei der eigenen Seite.
    playMoment("checkIn");
    await onChanged();
    return data?.ready ? "Eingecheckt – beide Seiten sind da, ihr könnt starten." : own.checked_in ? "Anwesende aktualisiert." : "Eingecheckt – jetzt fehlt noch die Gegenseite.";
  }, "Einchecken hat nicht geklappt.");
  const hint = block.checkin_hint;
  const consent = own.consent_open;
  const rosterHint = block.roster_hint && block.roster_hint !== hint ? block.roster_hint : null;
  const warn = consent || (hint && hint === block.roster_hint);
  return (
    <View style={[styles.box, styles.ownBox]} testID="checkin-own">
      <Text style={styles.eyebrow}>{own.checked_in ? "Eure Anwesenden" : "Wer ist da?"}</Text>
      <Muted style={styles.small}>Nur Spieler aus eurem Kader, nur wer spielen darf – wer nicht wählbar ist, steht grau mit Grund da.</Muted>
      {/* Geht es gerade nicht, steht der Grund vor der Liste. */}
      {!block.can_checkin && hint ? (
        <View style={[styles.note, warn ? styles.warnNote : styles.quietNote]} testID="checkin-hint">
          <Body style={styles.small}>{hint}</Body>
          {consent && own.rules_url ? <Button compact variant="secondary" label="Zur neuen Fassung" onPress={() => { openLink(own.rules_url); }} testID="checkin-rules-link" /> : null}
        </View>
      ) : null}
      {rosterHint ? <View style={[styles.note, styles.warnNote]} testID="checkin-roster-hint"><Body style={styles.small}>{rosterHint}</Body></View> : null}
      <View style={styles.roster} testID="checkin-roster" accessibilityRole="list">
        {(block.roster || []).map((person) => {
          const checked = selected.includes(person.id);
          const blocked = Boolean(person.blocked);
          return (
            <Press
              key={person.id}
              haptic={!blocked}
              disabled={blocked || !block.can_checkin}
              onPress={() => toggle(person.id)}
              style={[styles.person, checked && styles.personOn, blocked && styles.personBlocked]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked, disabled: blocked || !block.can_checkin }}
              accessibilityLabel={`${person.name}${blocked ? `: ${person.blocked}` : ""}`}
              testID={`checkin-roster-${person.id}`}
            >
              <Ionicons name={checked ? "checkbox" : "square-outline"} size={20} color={blocked ? roles.quiet : checked ? roles.brand : roles.muted} />
              <View style={styles.flex}>
                <Body style={blocked ? styles.blockedName : undefined} numberOfLines={2}>{person.name}</Body>
                {blocked ? <Text style={styles.blockedText} numberOfLines={3}>{person.blocked}</Text> : null}
              </View>
            </Press>
          );
        })}
      </View>
      <Muted style={styles.small} testID="checkin-roster-count">{selectionText(selected.length, minimum)}</Muted>
      {block.can_checkin ? (
        <Button label={own.checked_in ? "Anwesende aktualisieren" : "Einchecken"} icon="clipboard-outline" onPress={() => { void submit(); }} disabled={busy || !enough} busy={busy} testID="checkin-submit" />
      ) : null}
    </View>
  );
}

function StartBlock({ block, matchId, busy, run, onChanged }: { block: CheckinBlock; matchId: string; busy: boolean; run: VetoRun; onChanged: () => void | Promise<void> }) {
  if (block.state !== "ready") return null;
  const start = () => run(async () => {
    await api.post(`/matches/${matchId}/checkin/start`, {});
    playMoment("advance");
    await onChanged();
    return "Gestartet – Map 1 läuft. Viel Erfolg!";
  }, "Starten hat nicht geklappt.");
  return (
    <View style={[styles.box, styles.startBox]} testID="checkin-start">
      {block.can_start ? (
        <>
          <Button label="Spiel starten – Map 1 läuft" icon="play" onPress={() => { void start(); }} disabled={busy} busy={busy} testID="checkin-start-button" />
          <Muted style={styles.small}>Ab jetzt zählt die Spielzeit; der Termin lässt sich nicht mehr verschieben.</Muted>
        </>
      ) : (
        <Body style={styles.small} testID="checkin-start-hint">{block.start_hint || "Starten geht erst, wenn beide Seiten eingecheckt sind."}</Body>
      )}
    </View>
  );
}

export function CheckinCard({ block, matchId, busy, run, onChanged }: { block: CheckinBlock | null | undefined; matchId: string; busy: boolean; run: VetoRun; onChanged: () => void | Promise<void> }) {
  const [rulesOpen, setRulesOpen] = useState(false);
  if (!block) return null;
  const vetoRunning = block.state === "veto";
  const other = otherSide(block);
  const own = ownSide(block);
  const tone = TONES[String(block.state)] || "rgba(41,182,232,0.4)";
  return (
    <View style={[styles.panel, { borderColor: tone }]} testID="checkin-panel">
      <View style={styles.headRow}>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>Check-in · Regelwerk § 8</Text>
          {vetoRunning ? (
            <Body style={styles.small} testID="checkin-slim">
              <Text style={{ color: roles.ok, fontWeight: "900" }}>Beide Seiten eingecheckt</Text>
              {" – "}{(block.sides || []).map((side) => `${side.name} (${Number(side.present_count || 0)} Spieler)`).join(" · ")}.
            </Body>
          ) : (
            <>
              <Text style={styles.headline} accessibilityRole="header" testID="checkin-headline">{STATE_LABELS[String(block.state)] || "Check-in"}</Text>
              <Body style={styles.text} testID="checkin-text">{stateText(block)}</Body>
            </>
          )}
        </View>
        {vetoRunning ? null : <Countdown block={block} />}
      </View>

      {!vetoRunning && block.me?.reason ? (
        <View style={[styles.note, styles.warnNote]} testID="checkin-me">
          <Body style={styles.small}><Text style={styles.strong}>Du kannst so nicht einchecken:</Text> {block.me.reason}</Body>
          {block.me.fix_url ? <Button compact variant="secondary" icon="create-outline" label="Im Profil nachtragen" onPress={() => { openLink(block.me?.fix_url); }} testID="checkin-me-fix" /> : null}
        </View>
      ) : null}

      {vetoRunning ? null : (
        <View style={styles.stack} testID="checkin-sides">
          {(block.sides || []).map((side) => <SideCard key={side.registration_id} side={side} />)}
        </View>
      )}

      {block.proposal ? (
        <View style={[styles.note, styles.warnNote]} testID="checkin-proposal">
          <Body style={styles.small}>
            <Text style={styles.strong}>Check-in abgelaufen</Text> – {block.proposal.missing?.join(" und ") || "eine Seite"} {(block.proposal.missing || []).length > 1 ? "haben" : "hat"} nicht eingecheckt (Fenster bis {clock(block.proposal.due_at)}).
            {" "}Die Liga-Leitung entscheidet: {(block.proposal.missing || []).length > 1 ? "„Beide nicht erschienen“, die Seiten nachtragen oder verlängern" : "kampflos werten, die Seite nachtragen oder verlängern"}. Gewertet wird nichts von selbst.
          </Body>
        </View>
      ) : null}

      <OwnCheckin key={`${block.state}-${own?.updated_at || ""}`} block={block} matchId={matchId} busy={busy} run={run} onChanged={onChanged} />
      <VetoCard block={block.veto} matchId={matchId} busy={busy} run={run} onChanged={onChanged} />
      {vetoRunning ? null : <StartBlock block={block} matchId={matchId} busy={busy} run={run} onChanged={onChanged} />}
      {block.state === "open" && other && !other.checked_in && own?.checked_in ? (
        <Muted style={styles.small} testID="checkin-waiting">Die Seite aktualisiert sich von selbst, sobald {other.name} eingecheckt hat.</Muted>
      ) : null}
      {block.lead?.can_enter ? <Muted style={styles.small} testID="checkin-lead-web">Für eine Seite eintragen (Liga-Leitung): auf der Matchseite im Web, mit Grund.</Muted> : null}

      <Pressable onPress={() => setRulesOpen((open) => !open)} accessibilityRole="button" accessibilityState={{ expanded: rulesOpen }} style={styles.toggle} testID="checkin-rules">
        <Text style={styles.rulesToggle}>So läuft der Check-in in dieser Season {rulesOpen ? "▴" : "▾"}</Text>
      </Pressable>
      {rulesOpen ? (
        <View style={styles.stack}>
          {rulesSentences(block.rules).map((sentence) => <Muted key={sentence} style={styles.small}>• {sentence}</Muted>)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#0F1D23", borderRadius: radius.lg, borderWidth: 1, gap: 12, padding: 14 },
  headRow: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "space-between" },
  flex: { flex: 1, minWidth: 0 },
  eyebrow: { color: roles.brand, fontSize: 11, fontWeight: "900", letterSpacing: 1.6, textTransform: "uppercase" },
  headline: { color: colors.white, fontSize: 22, fontWeight: "900", marginTop: 2, textTransform: "uppercase" },
  text: { color: "rgba(255,255,255,0.8)", marginTop: 4 },
  small: { fontSize: 13 },
  strong: { fontWeight: "900" },
  stack: { gap: 8 },
  side: { backgroundColor: surfaces.base, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: 8, padding: 12 },
  sideIn: { backgroundColor: "rgba(31,208,142,0.05)", borderColor: "rgba(31,208,142,0.5)" },
  sideHead: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  sideName: { fontWeight: "900", textTransform: "uppercase" },
  ownTag: { color: roles.brand, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  tick: { alignItems: "center", borderColor: "rgba(255,255,255,0.15)", borderRadius: 18, borderWidth: 1, height: 36, justifyContent: "center", overflow: "hidden", width: 36 },
  tickIn: { borderColor: roles.ok },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { backgroundColor: "rgba(255,255,255,0.04)", borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, color: "rgba(255,255,255,0.85)", fontSize: 12, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4 },
  note: { borderRadius: radius.lg, borderWidth: 1, gap: 8, padding: 10 },
  warnNote: { backgroundColor: "rgba(255,159,67,0.1)", borderColor: "rgba(255,159,67,0.45)" },
  quietNote: { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border },
  box: { borderRadius: radius.lg, borderWidth: 1, gap: 10, padding: 12 },
  ownBox: { backgroundColor: surfaces.base, borderColor: "rgba(41,182,232,0.3)" },
  startBox: { backgroundColor: "rgba(31,208,142,0.05)", borderColor: "rgba(31,208,142,0.4)" },
  roster: { gap: 6 },
  person: { alignItems: "flex-start", borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: 10, minHeight: 44, paddingHorizontal: 10, paddingVertical: 9 },
  personOn: { backgroundColor: "rgba(41,182,232,0.1)", borderColor: "rgba(41,182,232,0.6)" },
  personBlocked: { borderColor: "rgba(255,255,255,0.05)" },
  blockedName: { color: roles.quiet },
  blockedText: { color: roles.warn, fontSize: 12 },
  // Tippfläche mindestens 48 Punkte wie jeder Knopf der App (a11y/audit.ts) - auch für eine Textzeile.
  toggle: { alignSelf: "flex-start", justifyContent: "center", minHeight: 48 },
  rulesToggle: { color: roles.muted, fontSize: 12, fontWeight: "800" },
});
