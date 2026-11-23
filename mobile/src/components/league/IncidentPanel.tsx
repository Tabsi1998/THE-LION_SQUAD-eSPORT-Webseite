import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { api } from "../../lib/api";
import {
  KIND_HELP, PAUSE_BETWEEN, PAUSE_BETWEEN_HELP, PAUSE_BETWEEN_LABEL, PROPOSAL_HELP, STATE_LABELS, clock, clockOffset, emptyIncidentForm, holdNotice,
  incidentPayload, incidentProblem, mapStateNotes, positionLabel, quotaHint, quotaText, remainingMs, remainingShare, remainingText, scoreText,
  settleSentence, showsProposal, sortedIncidents, stateSentence, type Incident, type IncidentForm, type IncidentInfo, type MapStateRow,
} from "../../lib/leagueIncidents";
import type { LeagueBlock, LeaguePerson } from "../../lib/leagueGames";
import { colors, radius, roles } from "../../theme";
import { Button } from "../Button";
import { Card } from "../Card";
import { ProofListCard } from "../results/ProofListCard";
import { Body, Heading, Muted } from "../Text";

// Vorfälle im Spiel (D.5, #1619; App #2173) wie frontend/src/components/tls/league/IncidentPanel.jsx: jede Karte mit dem einen Satz,
// wer dran ist, dem Countdown der Antwortzeit und den Nachweisen. „Vorfall melden“ fragt Schritt für Schritt: welche Map, was ist
// passiert, wie stand es, was schlagt ihr vor. Melden, Antworten und Zurückziehen dürfen Captain und Vertreter (der Server sagt es mit
// `can_report`, `can_answer`, `can_withdraw`). Entscheiden, Feststellen und Schließen der Liga-Leitung bleiben im Web.

export type IncidentLeague = LeagueBlock & { incident_info?: IncidentInfo | null; incidents?: Incident[] | null; map_state?: MapStateRow[] | null };
type Run = (task: () => Promise<string | void>, fallback: string) => Promise<void> | void;

/** Öffentlich (auch für Gäste): nur, dass eine Map in Klärung ist oder nicht zählt - nie der Vorfall selbst. */
export function MapStateNotes({ league }: { league: IncidentLeague | null | undefined }) {
  const notes = mapStateNotes(league);
  if (!notes.length) return null;
  return (
    <View style={styles.wrap} testID="map-state-notes" accessibilityLabel="Stand der Maps">
      {notes.map((note) => (
        <View key={`${note.kind}-${note.position}`} style={[styles.note, note.kind === "clarification" ? styles.noteWarn : null]} testID={`map-state-${note.position}`}>
          {note.kind === "clarification" ? <Ionicons name="scale-outline" size={14} color={roles.warn} /> : null}
          <Muted style={styles.noteText}>{note.text}</Muted>
        </View>
      ))}
    </View>
  );
}

/** Der Countdown der Antwortzeit: Zahl im Sekundentakt, der Balken springt mit - ohne Gleiten. */
function AnswerCountdown({ incident, offset, onDone }: { incident: Incident; offset: number; onDone: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const left = remainingMs(incident.answer_deadline, now, offset);
  useEffect(() => {
    if (left > 0 || fired.current) return;
    fired.current = true;
    onDone();
  }, [left, onDone]);
  return (
    <View style={styles.stackSmall} accessibilityRole="timer" testID={`incident-countdown-${incident.id}`}>
      <View style={styles.rowBetween}>
        <Muted>Antwortzeit bis {clock(incident.answer_deadline)}</Muted>
        <Body style={styles.countdown} testID={`incident-countdown-text-${incident.id}`}>{left > 0 ? remainingText(left) : "vorbei"}</Body>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.bar, { width: `${Math.round(remainingShare(incident, now, offset) * 100)}%` }]} />
      </View>
    </View>
  );
}

function OptionRow({ checked, label, help, onPress, testID }: { checked: boolean; label: string; help?: string; onPress: () => void; testID: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked }} style={[styles.option, checked && styles.optionActive]} testID={testID}>
      <Ionicons name={checked ? "radio-button-on" : "radio-button-off"} size={18} color={checked ? colors.cyan : colors.muted} />
      <View style={styles.flex}>
        <Body style={styles.strong}>{label}</Body>
        {help ? <Muted>{help}</Muted> : null}
      </View>
    </Pressable>
  );
}

function NumberField({ label, value, onChange, testID }: { label: string; value: string; onChange: (value: string) => void; testID: string }) {
  return (
    <View style={styles.flex}>
      <Muted numberOfLines={1}>{label}</Muted>
      <TextInput value={value} onChangeText={onChange} keyboardType="number-pad" inputMode="numeric" style={styles.input} accessibilityLabel={label} testID={testID} />
    </View>
  );
}

function AnswerActions({ incident, matchId, busy, run, onChanged }: { incident: Incident; matchId: string; busy: boolean; run: Run; onChanged: () => Promise<void> }) {
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const send = (accept: boolean) => run(async () => {
    await api.post(`/matches/${matchId}/incidents/${incident.id}/answer`, { accept, note: accept ? null : note.trim() || null });
    await onChanged();
    return accept ? "Zugestimmt – so geht es weiter." : "Abgelehnt – die Liga-Leitung entscheidet.";
  }, "Die Antwort ließ sich nicht speichern.");
  if (declining) {
    return (
      <View style={[styles.box, styles.boxWarn]} testID={`incident-answer-${incident.id}`}>
        <Muted>Warum lehnt ihr ab? (freiwillig, die Liga-Leitung liest es)</Muted>
        <TextInput value={note} onChangeText={setNote} maxLength={500} multiline style={[styles.input, styles.inputMulti]} testID={`incident-answer-${incident.id}-note`} />
        <Muted>Mit der Ablehnung ist die Map in Klärung: Die Liga-Leitung entscheidet, bis dahin gilt kein Ergebnis.</Muted>
        <Button label="Ablehnen und zur Liga-Leitung" variant="secondary" arrow={false} onPress={() => { void send(false); }} disabled={busy} testID={`incident-answer-${incident.id}-decline-confirm`} />
        <Button label="Zurück" variant="quiet" arrow={false} onPress={() => setDeclining(false)} disabled={busy} />
      </View>
    );
  }
  return (
    <View style={styles.row} testID={`incident-answer-${incident.id}`}>
      <View style={styles.flex}><Button label="Zustimmen" arrow={false} onPress={() => { void send(true); }} disabled={busy} testID={`incident-answer-${incident.id}-accept`} /></View>
      <View style={styles.flex}><Button label="Ablehnen" variant="secondary" arrow={false} onPress={() => setDeclining(true)} disabled={busy} testID={`incident-answer-${incident.id}-decline`} /></View>
    </View>
  );
}

function IncidentCard({ league, info, incident, matchId, busy, run, onChanged, offset }: {
  league: IncidentLeague; info: IncidentInfo; incident: Incident; matchId: string; busy: boolean; run: Run; onChanged: () => Promise<void>; offset: number;
}) {
  const sides = league.sides || [];
  const reporter = incident.reported_by || {};
  const other = sides.find((side) => side.registration_id !== reporter.registration_id);
  const sentence = stateSentence(incident, { otherName: other?.name, ownSide: Boolean(league.own_registration_id), mode: info.clarification_mode });
  const stand = scoreText(incident.score, sides);
  const waiting = incident.state === "proposed" && !incident.expired;
  const [proofsOpen, setProofsOpen] = useState(Boolean(incident.open));
  const sideLabels = Object.fromEntries(sides.map((side) => [side.registration_id, side.name || ""]));
  const withdraw = () => run(async () => {
    await api.post(`/matches/${matchId}/incidents/${incident.id}/withdraw`);
    await onChanged();
    return "Vorfall zurückgezogen.";
  }, "Zurückziehen hat nicht geklappt.");
  const leadOnly = incident.can_decide || incident.can_settle || incident.can_close;
  return (
    <View style={[styles.incident, incident.state === "in_review" ? styles.incidentReview : incident.state === "agreed" ? styles.incidentAgreed : null]} testID={`incident-${incident.id}`}>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Body style={styles.title}>{positionLabel(league, incident.position)} · {incident.between_maps ? PAUSE_BETWEEN_LABEL : incident.kind_label}</Body>
          <Muted>Gemeldet von {reporter.name || "einer Seite"}{reporter.own ? " (ihr)" : ""} um {clock(incident.at)}</Muted>
        </View>
        <View style={[styles.badge, incident.state === "in_review" ? styles.noteWarn : null]} testID={`incident-state-${incident.id}`}>
          <Muted style={styles.badgeText}>{STATE_LABELS[String(incident.state)] || incident.state}</Muted>
        </View>
      </View>
      {sentence ? <Body testID={`incident-sentence-${incident.id}`}>{sentence}</Body> : null}
      {incident.between_maps ? null : (
        <View style={styles.stackSmall}>
          {showsProposal(incident) ? <Muted testID={`incident-proposal-${incident.id}`}>Vorschlag: <Muted style={styles.strongMuted}>{incident.proposal_label}</Muted></Muted> : null}
          {stand ? <Muted>Stand beim Vorfall: <Muted style={styles.strongMuted}>{stand}{incident.round != null ? ` · Runde ${incident.round}` : ""}</Muted></Muted> : null}
          {incident.players?.length ? <Muted>Betroffen: {incident.players.map((person) => person.name).join(", ")}</Muted> : null}
          {incident.counts_quota && reporter.registration_id ? (
            <Muted testID={`incident-quota-${incident.id}`}>Kontingent {reporter.name}: {quotaText(info, reporter.registration_id, incident.position)}</Muted>
          ) : null}
        </View>
      )}
      {incident.note ? <View style={styles.quote}><Body>{incident.note}</Body></View> : null}
      {incident.answer?.note ? <Muted>Antwort von {incident.answer.name || "der Gegenseite"}: {incident.answer.note}</Muted> : null}
      {waiting ? <AnswerCountdown incident={incident} offset={offset} onDone={() => { void onChanged(); }} /> : null}
      {incident.can_answer ? <AnswerActions incident={incident} matchId={matchId} busy={busy} run={run} onChanged={onChanged} /> : null}
      {incident.can_withdraw ? <Button label="Zurückziehen" variant="quiet" arrow={false} onPress={() => { void withdraw(); }} disabled={busy} testID={`incident-withdraw-${incident.id}`} /> : null}
      {incident.decision ? (
        <View style={[styles.box, styles.boxInfo]} testID={`incident-decided-${incident.id}`}>
          <Body>Begründung: {incident.decision.reason}</Body>
          <Muted testID={`incident-settled-${incident.id}`}>{settleSentence(incident.decision)}{incident.decision.settle_reason ? ` ${incident.decision.settle_reason}` : ""}</Muted>
        </View>
      ) : null}
      {incident.close_note ? <Muted testID={`incident-close-note-${incident.id}`}>Begründung der Liga-Leitung: {incident.close_note}</Muted> : null}
      {incident.voided ? (
        <Muted testID={`incident-voided-${incident.id}`}>Die erste Austragung{scoreText(incident.voided.score, sides) ? ` (Stand ${scoreText(incident.voided.score, sides)})` : ""} zählt nicht – die Map wird nur einmal gewertet.</Muted>
      ) : null}
      {incident.procedure ? <Muted style={styles.cyan} testID={`incident-procedure-${incident.id}`}>Dazu läuft ein Verfahren.</Muted> : null}
      {leadOnly ? <Muted style={styles.cyan} testID={`incident-lead-web-${incident.id}`}>Entscheiden, die Serie feststellen und schließen geht für die Liga-Leitung auf der Matchseite im Web.</Muted> : null}
      {incident.between_maps ? null : (
        <View style={styles.proofs}>
          <Pressable onPress={() => setProofsOpen((current) => !current)} accessibilityRole="button" accessibilityState={{ expanded: proofsOpen }} style={styles.rowBetween}
            testID={`incident-proofs-${incident.id}`}>
            <Muted style={styles.eyebrow}>Nachweise (Screenshot, Clip)</Muted>
            <Ionicons name={proofsOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.muted} />
          </Pressable>
          {proofsOpen ? (
            <>
              <ProofListCard matchId={matchId} kind="incident" refId={incident.id} title="Zum Vorfall" sideLabels={sideLabels} testID={`incident-proof-${incident.id}`} />
              {incident.kind === "moss_crash" ? <ProofListCard matchId={matchId} kind="moss" refId={incident.id} title="MOSS-Nachweis zum Absturz" sideLabels={sideLabels} testID={`incident-moss-${incident.id}`} /> : null}
            </>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** „Vorfall melden“ - vier Fragen nacheinander, jede mit einem Satz dazu. Nur für Captain und Vertreter (`can_report`). */
function ReportForm({ league, info, matchId, busy, run, onChanged, onClose }: {
  league: IncidentLeague; info: IncidentInfo; matchId: string; busy: boolean; run: Run; onChanged: () => Promise<void>; onClose: () => void;
}) {
  const [form, setForm] = useState<IncidentForm>(() => emptyIncidentForm(info));
  const [problem, setProblem] = useState("");
  const set = <K extends keyof IncidentForm>(key: K, value: IncidentForm[K]) => { setProblem(""); setForm((current) => ({ ...current, [key]: value })); };
  const sides = league.sides || [];
  const ownId = league.own_registration_id || null;
  const between = form.kind === PAUSE_BETWEEN;
  const roster: LeaguePerson[] = league.roster || [];
  const other = sides.find((side) => side.registration_id !== ownId);
  const bestOf = Number(league.best_of || 1);
  const quota = form.position ? quotaHint(info, ownId, Number(form.position), form.kind) : "";
  const submit = () => {
    const missing = incidentProblem(form, sides);
    setProblem(missing);
    if (missing) return;
    void run(async () => {
      await api.post(`/matches/${matchId}/incidents`, incidentPayload(form, sides));
      onClose();
      await onChanged();
      return between ? "Pause festgehalten." : `Gemeldet – ${other?.name || "die Gegenseite"} hat ${info.answer_minutes} Minuten zum Antworten.`;
    }, "Der Vorfall ließ sich nicht melden.");
  };
  return (
    <View style={[styles.box, styles.boxForm]} testID="incident-form">
      <Muted style={styles.eyebrow}>1 · Um welche Map geht es?</Muted>
      <View style={styles.wrap}>
        {Array.from({ length: bestOf }, (_, index) => index + 1).map((position) => {
          const active = Number(form.position) === position;
          return (
            <Pressable key={position} onPress={() => set("position", position)} accessibilityRole="radio" accessibilityState={{ checked: active }}
              style={[styles.chip, active && styles.optionActive]} testID={`incident-form-position-${position}`}>
              <Body style={active ? styles.strong : undefined}>{positionLabel(league, position)}</Body>
            </Pressable>
          );
        })}
      </View>
      <Muted style={styles.eyebrow}>2 · Was ist passiert?</Muted>
      {(info.kinds || []).map((kind) => (
        <OptionRow key={kind.key} checked={form.kind === kind.key} label={kind.label} help={KIND_HELP[kind.key]} onPress={() => set("kind", kind.key)} testID={`incident-form-kind-${kind.key}`} />
      ))}
      <OptionRow checked={between} label={PAUSE_BETWEEN_LABEL} help={PAUSE_BETWEEN_HELP} onPress={() => set("kind", PAUSE_BETWEEN)} testID="incident-form-kind-pause-between" />
      {between ? (
        <View style={styles.stackSmall}>
          <NumberField label="3 · Wie lange war die Pause? (Minuten)" value={form.minutes} onChange={(value) => set("minutes", value)} testID="incident-form-minutes" />
          <Muted>Üblich sind {info.break_minutes} Minuten nach Map {info.break_after}. Gemeint ist die Pause nach der oben gewählten Map.</Muted>
        </View>
      ) : form.kind ? (
        <>
          <Muted style={styles.eyebrow}>3 · Wie stand es? (freiwillig)</Muted>
          <Muted>Der letzte Stand, den ihr belegen könnt – Runden oder Punkte. Beide Felder oder keines.</Muted>
          <View style={styles.row}>
            {sides.map((side) => (
              <NumberField key={side.registration_id} label={side.name || "Seite"} value={form.scores[side.registration_id] ?? ""}
                onChange={(value) => set("scores", { ...form.scores, [side.registration_id]: value })} testID={`incident-form-score-${side.registration_id}`} />
            ))}
            <NumberField label="Runde" value={form.round} onChange={(value) => set("round", value)} testID="incident-form-round" />
          </View>
          {roster.length ? (
            <>
              <Muted>Wer war betroffen? (freiwillig)</Muted>
              <View style={styles.wrap}>
                {roster.map((person) => {
                  const active = form.players.includes(person.id);
                  return (
                    <Pressable key={person.id} onPress={() => set("players", active ? form.players.filter((id) => id !== person.id) : [...form.players, person.id])}
                      accessibilityRole="checkbox" accessibilityState={{ checked: active }} style={[styles.chip, active && styles.optionActive]} testID={`incident-form-player-${person.id}`}>
                      <Body style={active ? styles.strong : undefined}>{person.name}</Body>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}
          <Muted style={styles.eyebrow}>4 · Was schlagt ihr vor?</Muted>
          {(info.proposals || []).map((proposal) => (
            <OptionRow key={proposal.key} checked={form.proposal === proposal.key} label={proposal.label} help={PROPOSAL_HELP[proposal.key]} onPress={() => set("proposal", proposal.key)}
              testID={`incident-form-proposal-${proposal.key}`} />
          ))}
        </>
      ) : null}
      {form.kind ? (
        <View style={styles.stackSmall}>
          <Muted style={styles.eyebrow}>{between ? "4" : "5"} · Beschreibung {form.kind === "other" ? "(Pflicht)" : "(freiwillig)"}</Muted>
          <TextInput value={form.note} onChangeText={(value) => set("note", value)} maxLength={500} multiline style={[styles.input, styles.inputMulti]}
            placeholder={between ? "z. B. beide Teams wollten 10 Minuten Pause" : "Was ist passiert, Ursache soweit bekannt"} placeholderTextColor={colors.muted} testID="incident-form-note" />
        </View>
      ) : null}
      {quota ? <Muted style={styles.quota} testID="incident-form-quota">{quota}</Muted> : null}
      {form.kind && !between ? (
        <Muted testID="incident-form-next">Nach dem Absenden hat {other?.name || "die Gegenseite"} {info.answer_minutes} Minuten zum Antworten. Nachweise (Screenshot, Clip) hängt ihr gleich danach am Vorfall an.</Muted>
      ) : null}
      {problem ? <Muted style={styles.warn} accessibilityRole="alert" testID="incident-form-problem">{problem}</Muted> : null}
      <Button label={between ? "Pause festhalten" : "Vorfall melden"} arrow={false} onPress={submit} disabled={busy} testID="incident-form-submit" />
      <Button label="Abbrechen" variant="quiet" arrow={false} onPress={onClose} disabled={busy} testID="incident-form-cancel" />
    </View>
  );
}

export function IncidentPanel({ league, matchId, busy, run, onChanged }: { league: IncidentLeague; matchId: string; busy: boolean; run: Run; onChanged: () => Promise<void> }) {
  const info = league.incident_info;
  const [formOpen, setFormOpen] = useState(false);
  const offset = clockOffset(info?.server_time);
  if (!info) return null;
  const incidents = sortedIncidents(league.incidents);
  // Melden als Liga-Leitung (aufnehmen) bleibt im Web - in der App melden Captain und Vertreter ihrer Seite.
  const canReport = Boolean(info.can_report && !info.as_lead);
  if (!incidents.length && !canReport) return null;
  const notice = holdNotice(info);
  return (
    <Card style={styles.card} testID="incident-panel">
      <Muted style={styles.eyebrowCyan}>Vorfälle · Regelwerk § 9</Muted>
      <Heading>Vorfälle im Spiel</Heading>
      <Muted>Verbindungsabbruch, Rehost oder Pause: Eine Seite meldet mit Vorschlag, die andere antwortet. Ohne Einigung entscheidet die Liga-Leitung.</Muted>
      {canReport && !formOpen ? (
        <Button label="Vorfall melden" variant="secondary" icon="warning-outline" arrow={false} onPress={() => setFormOpen(true)} disabled={busy} testID="incident-open-form" />
      ) : null}
      {notice ? (
        <View style={[styles.box, styles.boxHonor]} testID="incident-hold">
          <Body>{notice}</Body>
        </View>
      ) : null}
      {formOpen ? <ReportForm league={league} info={info} matchId={matchId} busy={busy} run={run} onChanged={onChanged} onClose={() => setFormOpen(false)} /> : null}
      {incidents.length ? (
        <View style={styles.stack} testID="incident-list">
          {incidents.map((incident) => (
            <IncidentCard key={incident.id} league={league} info={info} incident={incident} matchId={matchId} busy={busy} run={run} onChanged={onChanged} offset={offset} />
          ))}
        </View>
      ) : <Muted testID="incident-empty">Bisher kein Vorfall gemeldet.</Muted>}
    </Card>
  );
}

const styles = StyleSheet.create({
  badge: { borderColor: "rgba(255,255,255,0.15)", borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  bar: { backgroundColor: roles.honor, borderRadius: 3, height: 6 },
  barTrack: { backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 3, height: 6, overflow: "hidden" },
  box: { borderRadius: radius.lg, borderWidth: 1, gap: 8, padding: 12 },
  boxForm: { backgroundColor: colors.black, borderColor: "rgba(41,182,232,0.35)" },
  boxHonor: { backgroundColor: "rgba(255,215,0,0.06)", borderColor: "rgba(255,215,0,0.4)" },
  boxInfo: { backgroundColor: "rgba(41,182,232,0.06)", borderColor: "rgba(41,182,232,0.3)" },
  boxWarn: { backgroundColor: "rgba(255,159,67,0.06)", borderColor: "rgba(255,159,67,0.4)" },
  card: { gap: 10 },
  chip: { borderColor: "rgba(255,255,255,0.15)", borderRadius: radius.lg, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: 12, paddingVertical: 8 },
  countdown: { fontSize: 20, fontVariant: ["tabular-nums"], fontWeight: "900" },
  cyan: { color: colors.cyan, fontWeight: "800" },
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
  eyebrowCyan: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  flex: { flex: 1, minWidth: 0 },
  incident: { backgroundColor: colors.black, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: 8, padding: 12 },
  incidentAgreed: { borderColor: "rgba(31,208,142,0.4)" },
  incidentReview: { borderColor: "rgba(255,159,67,0.55)" },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, color: colors.white, marginTop: 4, minHeight: 44, paddingHorizontal: 12 },
  inputMulti: { minHeight: 80, paddingTop: 10, textAlignVertical: "top" },
  note: { alignItems: "center", borderColor: "rgba(255,255,255,0.15)", borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: 6, paddingHorizontal: 10, paddingVertical: 4 },
  noteText: { color: colors.white, fontWeight: "800" },
  noteWarn: { backgroundColor: "rgba(255,159,67,0.1)", borderColor: "rgba(255,159,67,0.55)" },
  option: { alignItems: "flex-start", borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: 8, minHeight: 44, padding: 10 },
  optionActive: { backgroundColor: "rgba(41,182,232,0.1)", borderColor: "rgba(41,182,232,0.6)" },
  proofs: { borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: 8, padding: 10 },
  quota: { backgroundColor: "rgba(255,215,0,0.06)", borderColor: "rgba(255,215,0,0.3)", borderRadius: radius.lg, borderWidth: 1, padding: 10 },
  quote: { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, padding: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rowBetween: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between", minHeight: 32 },
  stack: { gap: 10 },
  stackSmall: { gap: 4 },
  strong: { fontWeight: "900" },
  strongMuted: { color: colors.white, fontWeight: "800" },
  title: { fontWeight: "900", textTransform: "uppercase" },
  warn: { color: roles.warn, fontWeight: "800" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
