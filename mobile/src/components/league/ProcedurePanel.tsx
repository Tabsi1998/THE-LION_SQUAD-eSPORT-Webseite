import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { api, errorMessage } from "../../lib/api";
import { formatWhen } from "../../lib/format";
import { useSingleFlight } from "../../lib/useSingleFlight";
import {
  AGAINST_LABELS, KIND_HINTS, PROCEDURE_STATE_LABELS, claimedText, decisionText, incidentLabel, procedurePayload, remainingText,
  type Procedure, type ProcedureForm, type ProcedureGuide, type ProcedurePayload,
} from "../../lib/leagueProcedures";
import { colors, radius, roles } from "../../theme";
import { Button } from "../Button";
import { ProofListCard } from "../results/ProofListCard";
import { Body, Muted } from "../Text";

// Verfahren der Liga (E.2, #1619; App #2173) wie im Web (ProblemReportForm mit `guide`, DisputeCard: ProcedureCard, AppealForm):
// geführt einreichen (Art, Grund mit Pflichtangaben, danach Nachweise), die eigenen Verfahren ergänzen oder zurückziehen, als
// Gegenseite Stellung nehmen, Einspruch einlegen. Rechte kommen vom Server (`can_dispute`, `procedure_form.open`, `can_amend`,
// `can_state`, `can_withdraw`, `can_appeal`). Schritte der Liga-Leitung (übernehmen, verlängern, MOSS anfordern, entscheiden) bleiben
// im Web, ebenso die MOSS-Datei (ZIP).

const MIN_TEXT = 10;

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Deadline({ label, until, now, testID }: { label: string; until?: string | null; now: number; testID: string }) {
  if (!until) return null;
  const left = remainingText(until, now);
  return <Muted testID={testID}>{label} {formatWhen(until)}{left ? ` (${left})` : ""}</Muted>;
}

function Chip({ active, label, onPress, testID }: { active: boolean; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive]} testID={testID}>
      <Body style={[styles.chipText, active && styles.chipTextActive]}>{label}</Body>
    </Pressable>
  );
}

/** Geführt einreichen (Beanstandung oder Protest - die Art ergibt sich aus dem Stand des Spiels), danach die Nachweise. */
export function ProcedureGuidedForm({ matchId, guide, sides, busy, initialReason, createdId, onSubmit, onDone }: {
  matchId: string;
  guide: ProcedureGuide;
  sides: Array<{ id: string; name: string }>;
  busy: boolean;
  initialReason?: string | null;
  createdId?: string | null;
  onSubmit: (payload: ProcedurePayload) => Promise<boolean>;
  onDone: () => void;
}) {
  const [form, setForm] = useState<ProcedureForm>({ reasonKey: initialReason || "", text: "", notified: null, scores: {}, incidentId: "" });
  const [error, setError] = useState("");
  useEffect(() => { if (initialReason) setForm((current) => ({ ...current, reasonKey: initialReason })); }, [initialReason]);
  const set = <K extends keyof ProcedureForm>(key: K, value: ProcedureForm[K]) => { setError(""); setForm((current) => ({ ...current, [key]: value })); };
  const reason = (guide.reasons || []).find((row) => row.key === form.reasonKey);
  const isResult = form.reasonKey === (guide.result_reason || "wrong_result");
  const left = remainingText(guide.until);

  if (createdId) {
    return (
      <View style={styles.stack} testID="procedure-created">
        <Body><Body style={styles.strong}>{guide.kind_label} eingereicht.</Body> Füge jetzt deine Nachweise hinzu – Bilder oder den Link zu einem Video. Nachreichen geht bis zum Ende der Frist.</Body>
        <ProofListCard matchId={matchId} kind="protest" refId={createdId} title="Nachweise zum Verfahren" testID="procedure-proofs" />
        <Button label="Fertig" arrow={false} onPress={onDone} testID="procedure-done" />
      </View>
    );
  }

  const submit = async () => {
    const built = procedurePayload(form, guide, sides.map((side) => side.id));
    if (built.error !== undefined) {
      setError(built.error);
      return;
    }
    setError("");
    await onSubmit(built.payload);
  };

  return (
    <View style={styles.stack} testID="match-dispute-form">
      <Muted style={styles.eyebrowDanger}>Problem melden</Muted>
      <View style={styles.box} testID="procedure-kind">
        <Muted style={styles.eyebrow}>1 · Art</Muted>
        <Body style={styles.title} testID="procedure-kind-label">{guide.kind_label}</Body>
        <Muted>{KIND_HINTS[String(guide.kind)] || ""}{guide.until ? ` Möglich bis ${formatWhen(guide.until)}${left ? ` (${left})` : ""}.` : ""}</Muted>
      </View>
      <Muted style={styles.eyebrow}>2 · Grund</Muted>
      <View style={styles.wrap}>
        {(guide.reasons || []).map((row) => (
          <Chip key={row.key} active={form.reasonKey === row.key} label={row.label} onPress={() => set("reasonKey", row.key)} testID={`match-dispute-reason-${row.key}`} />
        ))}
      </View>
      {reason ? (
        <View style={styles.stack} testID="procedure-details">
          {sides.length === 2 ? (
            <View style={styles.stackSmall} testID="procedure-claimed">
              <Muted>{isResult ? "Welches Ergebnis stimmt aus eurer Sicht?" : "Abweichendes Ergebnis (nur, wenn es um das Ergebnis geht)"}</Muted>
              <View style={styles.row}>
                {sides.map((side, index) => (
                  <View key={side.id} style={styles.flex}>
                    <Muted numberOfLines={2}>{side.name}</Muted>
                    <TextInput value={form.scores[side.id] ?? ""} onChangeText={(value) => set("scores", { ...form.scores, [side.id]: value })} keyboardType="number-pad" inputMode="numeric"
                      maxLength={3} style={[styles.input, styles.center]} accessibilityLabel={`Maps für ${side.name}`} testID={`procedure-claimed-${index}`} />
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          {reason.ask_notified ? (
            <View style={styles.stackSmall} testID="procedure-notified">
              <Muted>Habt ihr die Gegenseite sofort darauf hingewiesen?</Muted>
              <View style={styles.row}>
                <Chip active={form.notified === true} label="Ja" onPress={() => set("notified", true)} testID="procedure-notified-yes" />
                <Chip active={form.notified === false} label="Nein" onPress={() => set("notified", false)} testID="procedure-notified-no" />
              </View>
              <Muted>Regelwerk § 8.8: Mängel an Ausrüstung, Lobby oder Spielberechtigung sind sofort anzusprechen.</Muted>
            </View>
          ) : null}
          {(guide.incidents || []).length ? (
            <View style={styles.stackSmall}>
              <Muted>Geht es um einen gemeldeten Vorfall? (freiwillig)</Muted>
              <View style={styles.wrap}>
                <Chip active={!form.incidentId} label="Nein, kein Vorfall" onPress={() => set("incidentId", "")} testID="procedure-incident-none" />
                {(guide.incidents || []).map((incident) => (
                  <Chip key={incident.id} active={form.incidentId === incident.id} label={incidentLabel(incident)} onPress={() => set("incidentId", incident.id)} testID={`procedure-incident-${incident.id}`} />
                ))}
              </View>
            </View>
          ) : null}
          <Muted>Begründung</Muted>
          <TextInput value={form.text} onChangeText={(value) => set("text", value)} multiline maxLength={guide.reason_max || 1000} style={[styles.input, styles.inputMulti]}
            placeholder="Was ist passiert, auf welcher Map, in welcher Runde?" placeholderTextColor={colors.muted} testID="match-dispute-input" />
          <Muted style={styles.counter}>{form.text.trim().length} / {guide.reason_max || 1000}</Muted>
        </View>
      ) : <Muted>Tippe an, worum es geht – dann fragen wir nur, was dazu nötig ist.</Muted>}
      <Muted testID="match-dispute-hint">3 · Nachweise fügst du im nächsten Schritt hinzu. Die Gegenseite sieht Grund, Begründung und das abweichende Ergebnis und kann Stellung nehmen.</Muted>
      {error ? <Muted style={styles.error} accessibilityRole="alert" testID="match-dispute-error">{error}</Muted> : null}
      <Button label={`${guide.kind_label || "Verfahren"} einreichen`} variant="danger" arrow={false} onPress={() => { void submit(); }} disabled={busy} testID="match-dispute-btn" />
    </View>
  );
}

/** Einspruch gegen Protestentscheid, Kampflos-Wertung oder Korrektur - einmal, begründet. */
export function AppealForm({ matchId, against, until = null, onChanged, testID = "appeal" }: {
  matchId: string; against: { type: string; ref_id: string }; until?: string | null; onChanged: () => Promise<void> | void; testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const now = useNow(Boolean(until));
  const once = useSingleFlight();
  const send = () => once(async () => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/matches/${matchId}/appeals`, { against_type: against.type, ref_id: against.ref_id, reason: text.trim() });
      setText("");
      setOpen(false);
      await onChanged();
    } catch (failure) {
      setError(errorMessage(failure, "Der Einspruch ließ sich nicht einlegen."));
    } finally {
      setBusy(false);
    }
  });
  return (
    <View style={styles.stackSmall} testID={testID}>
      <Deadline label="Einspruch möglich bis" until={until} now={now} testID={`${testID}-until`} />
      {open ? (
        <>
          <Muted>Einspruch {AGAINST_LABELS[against.type] || ""} – Begründung</Muted>
          <TextInput value={text} onChangeText={setText} multiline maxLength={1000} style={[styles.input, styles.inputMulti]} placeholderTextColor={colors.muted}
            placeholder="Warum ist die Entscheidung aus eurer Sicht falsch? Mindestens zehn Zeichen." testID={`${testID}-input`} />
          <Muted>Einspruch geht nur einmal. Es entscheidet eine andere Person als bei der ersten Entscheidung, ihre Entscheidung ist endgültig. Bis dahin gilt die erste Entscheidung weiter.</Muted>
          <Button label="Einspruch einlegen" arrow={false} onPress={() => { void send(); }} disabled={busy || text.trim().length < MIN_TEXT} testID={`${testID}-send`} />
          <Button label="Abbrechen" variant="quiet" arrow={false} onPress={() => setOpen(false)} disabled={busy} />
        </>
      ) : <Button label="Einspruch einlegen" variant="secondary" arrow={false} onPress={() => setOpen(true)} testID={`${testID}-open`} />}
      {error ? <Muted style={styles.error} accessibilityRole="alert" testID={`${testID}-error`}>{error}</Muted> : null}
    </View>
  );
}

/** Ein Verfahren, wie eine Seite es sieht: Stand, Fristen, Stellungnahme, Entscheid - mit den Schritten, die der Server erlaubt. */
export function ProcedureCard({ matchId, procedure: p, sideNames, onChanged }: {
  matchId: string; procedure: Procedure; sideNames: Record<string, string>; onChanged: () => Promise<void> | void;
}) {
  const open = p.state === "open";
  const now = useNow(open);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statement, setStatement] = useState("");
  const [addition, setAddition] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const base = `/matches/${matchId}/procedures/${p.id}`;
  const once = useSingleFlight();
  const run = (call: () => Promise<unknown>, after?: () => void) => once(async () => {
    setBusy(true);
    setError("");
    try {
      await call();
      after?.();
      await onChanged();
    } catch (failure) {
      setError(errorMessage(failure, "Das hat nicht geklappt. Bitte noch einmal versuchen."));
    } finally {
      setBusy(false);
    }
  });
  const sideName = p.side ? sideNames[p.side] || (p.own ? "Eigene Seite" : "Gegenseite") : "Liga-Leitung";
  const claimed = claimedText(p.claimed, sideNames);
  const outcome = decisionText(p);
  const mossPending = (p.moss_requests || []).some((row) => row.own && ["requested", "missing"].includes(String(row.state)));
  return (
    <View style={[styles.card, open && styles.cardOpen]} testID={`procedure-${p.id}`}>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Muted style={styles.eyebrow}>{sideName}{p.at ? ` · ${formatWhen(p.at)}` : ""}</Muted>
          <Body style={styles.title}>{p.kind_label}</Body>
          <Muted style={styles.strongMuted} testID={`procedure-reason-label-${p.id}`}>{p.kind === "appeal" && p.against ? AGAINST_LABELS[String(p.against.type)] : p.reason_label}</Muted>
        </View>
        <View style={styles.badge}><Muted style={styles.badgeText} testID={`procedure-state-${p.id}`}>{PROCEDURE_STATE_LABELS[String(p.state)] || p.state}</Muted></View>
      </View>
      {p.reason ? <Body testID={`procedure-reason-${p.id}`}>„{p.reason}“</Body> : null}
      {(p.additions || []).map((row) => <Muted key={row.at}>Ergänzung {formatWhen(row.at)}: „{row.text}“</Muted>)}
      {claimed ? <Muted testID={`procedure-claimed-${p.id}`}>Ergebnis aus Sicht der Seite: <Muted style={styles.strongMuted}>{claimed}</Muted></Muted> : null}
      {typeof p.notified_immediately === "boolean" ? <Muted>Gegenseite sofort hingewiesen: <Muted style={styles.strongMuted}>{p.notified_immediately ? "Ja" : "Nein"}</Muted></Muted> : null}
      {open ? (
        <View style={styles.box} testID={`procedure-deadlines-${p.id}`}>
          {p.own ? <Deadline label="Ergänzen und Nachweise bis" until={p.evidence_until} now={now} testID={`procedure-evidence-until-${p.id}`} /> : null}
          {p.statement && !p.statement.text ? <Deadline label="Stellungnahme der Gegenseite bis" until={p.statement.due_at} now={now} testID={`procedure-statement-until-${p.id}`} /> : null}
          <Muted>{p.assignee ? `Übernommen von ${p.assignee.name || "der Liga-Leitung"}${p.assignee.at ? ` am ${formatWhen(p.assignee.at)}` : ""}` : "Noch nicht von der Liga-Leitung übernommen."}</Muted>
        </View>
      ) : null}
      {p.statement ? (
        <View style={styles.box} testID={`procedure-statement-${p.id}`}>
          <Muted style={styles.eyebrow}>Stellungnahme · {(p.statement.side && sideNames[p.statement.side]) || "Gegenseite"}</Muted>
          {p.statement.text ? <Body>„{p.statement.text}“</Body> : <Muted>{p.statement.expired ? "Die Frist ist abgelaufen, ohne dass eine Stellungnahme einging." : "Noch keine Stellungnahme."}</Muted>}
          {p.can_state ? (
            <>
              <TextInput value={statement} onChangeText={setStatement} multiline maxLength={1000} style={[styles.input, styles.inputMulti]} placeholderTextColor={colors.muted}
                placeholder={p.statement.text ? "Stellungnahme ersetzen …" : "Wie seht ihr das? Mindestens zehn Zeichen."} testID={`procedure-statement-input-${p.id}`} />
              <Button label={p.statement.text ? "Stellungnahme ersetzen" : "Stellung nehmen"} arrow={false} disabled={busy || statement.trim().length < MIN_TEXT}
                onPress={() => { void run(() => api.post(`${base}/statement`, { text: statement.trim() }), () => setStatement("")); }} testID={`procedure-statement-send-${p.id}`} />
            </>
          ) : null}
          {p.can_state || p.statement.text ? <ProofListCard matchId={matchId} kind="statement" refId={p.id} title="Nachweise zur Stellungnahme" sideLabels={sideNames} testID={`procedure-statement-proofs-${p.id}`} /> : null}
        </View>
      ) : null}
      {p.own ? <ProofListCard matchId={matchId} kind="protest" refId={p.id} title="Nachweise zum Verfahren" sideLabels={sideNames} testID={`procedure-proofs-${p.id}`} /> : null}
      {mossPending ? <Muted style={styles.warn} testID={`procedure-moss-${p.id}`}>Die Liga-Leitung hat eine MOSS-Datei angefordert. Die ZIP lädst du auf der Matchseite im Web hoch.</Muted> : null}
      {outcome ? (
        <View style={styles.box} testID={`procedure-decision-${p.id}`}>
          <Body style={styles.strong}>{outcome}</Body>
          {p.decision_note ? <Muted>Begründung: {p.decision_note}</Muted> : null}
          {p.can_appeal ? <AppealForm matchId={matchId} against={{ type: "protest_decision", ref_id: p.id }} until={p.appeal_until} onChanged={onChanged} testID={`procedure-appeal-${p.id}`} /> : null}
        </View>
      ) : null}
      {p.can_amend ? (
        <View style={styles.stackSmall} testID={`procedure-amend-${p.id}`}>
          <Muted>Ergänzen (bis zum Ende der Frist)</Muted>
          <TextInput value={addition} onChangeText={setAddition} multiline maxLength={1000} style={[styles.input, styles.inputMulti]} placeholderTextColor={colors.muted}
            placeholder="Was ist dazugekommen? Mindestens zehn Zeichen." testID={`procedure-amend-input-${p.id}`} />
          <Button label="Ergänzung senden" variant="secondary" arrow={false} disabled={busy || addition.trim().length < MIN_TEXT}
            onPress={() => { void run(() => api.patch(base, { addition: addition.trim() }), () => setAddition("")); }} testID={`procedure-amend-send-${p.id}`} />
        </View>
      ) : null}
      {p.can_withdraw ? (
        <Button label={confirmWithdraw ? "Wirklich zurückziehen?" : "Zurückziehen"} variant={confirmWithdraw ? "danger" : "quiet"} arrow={false} disabled={busy}
          onPress={() => { if (confirmWithdraw) void run(() => api.post(`${base}/withdraw`), () => setConfirmWithdraw(false)); else setConfirmWithdraw(true); }} testID={`procedure-withdraw-${p.id}`} />
      ) : null}
      {p.can_lead ? <Muted style={styles.cyan} testID={`procedure-lead-web-${p.id}`}>Übernehmen, Fristen verlängern, MOSS anfordern und entscheiden geht für die Liga-Leitung auf der Matchseite im Web.</Muted> : null}
      {error ? <Muted style={styles.error} accessibilityRole="alert" testID={`procedure-error-${p.id}`}>{error}</Muted> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderColor: "rgba(255,255,255,0.15)", borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  box: { backgroundColor: colors.black, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: 6, padding: 10 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: 8, padding: 12 },
  cardOpen: { borderColor: "rgba(255,215,0,0.4)" },
  center: { textAlign: "center" },
  chip: { borderColor: "rgba(255,255,255,0.1)", borderRadius: 999, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: 14 },
  chipActive: { backgroundColor: "rgba(41,182,232,0.15)", borderColor: "rgba(41,182,232,0.7)" },
  chipText: { color: "rgba(255,255,255,0.7)", fontWeight: "800" },
  chipTextActive: { color: colors.cyan },
  counter: { alignSelf: "flex-end", fontSize: 11 },
  cyan: { color: colors.cyan, fontWeight: "800" },
  error: { color: "#FF6B60", fontWeight: "800" },
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
  eyebrowDanger: { color: "#FF6B60", fontSize: 12, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
  flex: { flex: 1, minWidth: 0 },
  input: { backgroundColor: colors.black, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, color: colors.white, marginTop: 4, minHeight: 44, paddingHorizontal: 12 },
  inputMulti: { minHeight: 96, paddingTop: 10, textAlignVertical: "top" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rowBetween: { alignItems: "flex-start", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  stack: { gap: 10 },
  stackSmall: { gap: 6 },
  strong: { fontWeight: "900" },
  strongMuted: { color: colors.white, fontWeight: "800" },
  title: { fontWeight: "900", textTransform: "uppercase" },
  warn: { color: roles.warn, fontWeight: "800" },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
