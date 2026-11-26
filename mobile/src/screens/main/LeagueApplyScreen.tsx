import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, findNodeHandle, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ErrorState, SkeletonList } from "../../components/ListState";
import { selectFeedback, switchFeedback } from "../../components/motion";
import { Screen } from "../../components/Screen";
import { SignInRequired } from "../../components/SignInRequired";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import {
  APPLY_STEPS, APPLY_TITLES, applyApiPath, canGoOn, dayText, isSelectable, platformLines, platformShort, submittedText,
  type ApplySquad, type ApplyView,
} from "../../lib/leagueApply";
import { teamStateLabel } from "../../lib/leagueTeam";
import { openLink } from "../../lib/openLink";
import { isGuestUser } from "../../live";
import type { AppStackParamList } from "../../navigation/types";
import { colors, radius, roles, surfaces } from "../../theme";

// Mit Co-Team anmelden in der App (#2542, docs/LIGA.md „B.4 Selbstanmeldung“, Web: pages/public/LeagueApplyPage.jsx unter
// /liga/<liga>/<season>/anmelden): vier Schritte, ohne Vorwissen bedienbar - Co-Team wählen, Prüfung im Klartext, Regeln und Datenschutz
// zustimmen, einreichen. Anmelden dürfen Captain und Vertreter (`can_apply`). Geprüft wird beim Einreichen noch einmal auf dem Server;
// lehnt er ab (neue Fassung, Kader, Plätze), lädt der Stand neu und die Zustimmung gilt erst wieder nach dem Lesen der neuen Fassung.

type Props = NativeStackScreenProps<AppStackParamList, "LeagueApply">;

const SWITCH_COLORS = { trackColor: { false: "rgba(255,255,255,0.16)", true: "rgba(41,182,232,0.45)" } };

function Stepper({ step }: { step: number }) {
  return (
    <View style={styles.steps} accessible accessibilityLabel={`Schritt ${step + 1} von ${APPLY_STEPS.length}: ${APPLY_STEPS[step]}`} testID="apply-steps">
      {APPLY_STEPS.map((label, index) => {
        const done = index < step;
        const now = index === step;
        return (
          <View key={label} style={styles.stepItem}>
            <View style={[styles.stepMark, done && styles.stepDone, now && styles.stepNow]}>
              {done ? <Ionicons name="checkmark" size={14} color={colors.black} /> : <Text style={[styles.stepNumber, now && styles.stepNumberNow]}>{index + 1}</Text>}
            </View>
            <Text style={[styles.stepLabel, now && styles.stepLabelNow]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function SquadChoice({ rows, chosen, onChoose }: { rows: ApplySquad[]; chosen: string; onChoose: (id: string) => void }) {
  return (
    <View style={styles.list} accessibilityRole="radiogroup" accessibilityLabel="Co-Team wählen">
      {rows.map((row) => {
        const free = isSelectable(row);
        const checked = chosen === row.squad_id;
        return (
          <Pressable key={row.squad_id} onPress={() => { if (free && !checked) { selectFeedback(); onChoose(row.squad_id); } }} disabled={!free}
            accessibilityRole="radio" accessibilityState={{ checked, disabled: !free }} accessibilityLabel={`${row.display_name}, ${row.member_count ?? 0} Spieler im Kader`}
            style={[styles.choice, checked && styles.choiceOn, !free && styles.choiceOff]} testID={`apply-squad-${row.squad_id}`}>
            <Ionicons name={checked ? "radio-button-on" : "radio-button-off"} size={20} color={checked ? colors.cyan : colors.muted} />
            <View style={styles.choiceText}>
              <Body style={styles.strong}>{row.display_name}</Body>
              <Muted style={styles.small}>{row.member_count ?? 0} Spieler im Kader</Muted>
            </View>
            {free ? null : <Text style={styles.badge} testID={`apply-squad-${row.squad_id}-state`}>{teamStateLabel(row.state, row.application)}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

function PlatformNote({ view }: { view: ApplyView }) {
  const lines = platformLines(view.platform);
  const own = (view.platform?.divisions || []).filter((division) => division.differs);
  if (!lines.length && !own.length) return null;
  return (
    <View style={styles.box} testID="apply-platform">
      <Body style={styles.strong}>Plattform in dieser Season</Body>
      {lines.map((line) => <Muted key={line}>{line}</Muted>)}
      {own.length ? (
        <Muted style={styles.small}>Abweichend: {own.map((division) => `${division.label}: ${platformShort(division)}`).join(" · ")}. In welche Liga das Co-Team kommt, entscheidet die Liga-Leitung.</Muted>
      ) : null}
    </View>
  );
}

function CheckStep({ row, view, onTeam }: { row: ApplySquad; view: ApplyView; onTeam: (teamId: string) => void }) {
  const problems = [...(view.season_problems || []), ...(row.problems || [])];
  const warnings = row.warnings || [];
  const open = Boolean(warnings.length || row.shortfall);
  return (
    <View style={styles.list}>
      <PlatformNote view={view} />
      {problems.length ? (
        <View style={[styles.box, styles.warnBox]} testID="apply-problems">
          <Body style={[styles.strong, { color: roles.warn }]}>So geht die Anmeldung noch nicht:</Body>
          {problems.map((text) => (
            <View key={text} style={styles.line}>
              <Ionicons name="alert-circle-outline" size={16} color={roles.warn} />
              <Body style={styles.flex}>{text}</Body>
            </View>
          ))}
          {row.team_id ? <Button compact variant="secondary" label="Kader und Rollen ändern" onPress={() => onTeam(String(row.team_id))} testID="apply-team-link" /> : null}
        </View>
      ) : (
        <View style={[styles.box, styles.okBox, styles.line]} testID="apply-check-ok">
          <Ionicons name="checkmark-circle" size={18} color={roles.ok} />
          <Body style={styles.flex}>{open ? `${row.display_name} kann angemeldet werden.` : `${row.display_name} erfüllt die Vorgaben dieser Season.`}</Body>
        </View>
      )}
      {open ? (
        // Offene Punkte (#2313): fehlende Angaben halten die Anmeldung nicht auf - gesperrt wird erst beim Check-in und bei der Aufstellung.
        <View style={[styles.box, styles.infoBox]} testID="apply-warnings">
          <Body style={styles.strong}>Die Anmeldung geht trotzdem. Bis zum ersten Spiel noch nachtragen:</Body>
          {row.shortfall ? <Body testID="apply-shortfall">{row.shortfall}</Body> : null}
          {warnings.map((text) => <Muted key={text}>{text}</Muted>)}
          <Muted style={styles.small}>Wer etwas offen hat, kann nicht einchecken und nicht aufgestellt werden. Jeder trägt es im eigenen Profil nach. Wir erinnern die Spieler und dich jetzt und noch einmal vor dem ersten Spiel.</Muted>
        </View>
      ) : null}
    </View>
  );
}

function ConsentRow({ label, value, onChange, testID }: { label: string; value: boolean; onChange: (value: boolean) => void; testID: string }) {
  return (
    <View style={styles.consent}>
      <Body style={styles.flex}>{label}</Body>
      {/* Unter iOS klickt der Schalter selbst - switchFeedback gibt dort keine zweite Vibration dazu. */}
      <Switch value={value} onValueChange={(next) => { switchFeedback(); onChange(next); }} accessibilityLabel={label} {...SWITCH_COLORS} thumbColor={value ? colors.cyan : colors.muted} testID={testID} />
    </View>
  );
}

function ConsentStep({ view, acceptRules, acceptPrivacy, onRules, onPrivacy }: { view: ApplyView; acceptRules: boolean; acceptPrivacy: boolean; onRules: (value: boolean) => void; onPrivacy: (value: boolean) => void }) {
  const rules = view.rules || {};
  return (
    <View style={styles.list}>
      <View style={styles.box}>
        <Body style={styles.strong}>{rules.title}</Body>
        <Muted testID="apply-rules-version">{[rules.label, rules.valid_from ? `gültig ab ${dayText(rules.valid_from)}` : ""].filter(Boolean).join(" · ")}</Muted>
        <View style={styles.row}>
          {rules.url ? <Button compact variant="quiet" icon="open-outline" arrow={false} label="Regeln lesen" onPress={() => { openLink(rules.url); }} testID="apply-rules-link" /> : null}
          {rules.pdf_url ? <Button compact variant="quiet" icon="document-text-outline" arrow={false} label="PDF" accessibilityLabel="Regeln als PDF" onPress={() => { openLink(rules.pdf_url); }} testID="apply-rules-pdf" /> : null}
        </View>
        <ConsentRow label="Ich habe die Regeln gelesen und stimme für mein Co-Team zu." value={acceptRules} onChange={onRules} testID="apply-accept-rules" />
      </View>
      <View style={styles.box}>
        <Body style={styles.strong}>Datenschutz</Body>
        {view.privacy?.text ? <Muted testID="apply-privacy-text">{view.privacy.text}</Muted> : null}
        {view.privacy?.url ? <Button compact variant="quiet" icon="open-outline" arrow={false} label="Datenschutzerklärung" onPress={() => { openLink(view.privacy?.url); }} testID="apply-privacy-link" /> : null}
        <ConsentRow label="Ich habe den Hinweis gelesen und stimme zu." value={acceptPrivacy} onChange={onPrivacy} testID="apply-accept-privacy" />
      </View>
    </View>
  );
}

function Summary({ row, view }: { row: ApplySquad; view: ApplyView }) {
  return (
    <View style={styles.list} testID="apply-summary">
      <View style={styles.box}>
        <Muted style={styles.label}>Co-Team</Muted>
        <Body style={styles.strong}>{row.display_name}</Body>
        <Muted style={styles.label}>Regeln</Muted>
        <Body>{view.rules?.label}, zugestimmt</Body>
        <Muted style={styles.label}>Datenschutz</Muted>
        <Body>zugestimmt</Body>
      </View>
      {view.application?.auto_accept ? (
        <Muted testID="apply-summary-auto">Ist ein Startplatz frei, seid ihr mit dem Einreichen angemeldet. Sind alle vergeben oder wartet schon jemand, kommt ihr auf die Warteliste. Liga und Staffel teilt die Liga-Leitung zu, gibt es nur eine Staffel, steht ihr gleich darin. Zurückziehen geht dann bis zum Check-in, solange noch kein Spielplan steht. Du bekommst eine Nachricht.</Muted>
      ) : (
        <Muted>Einreichen heißt noch nicht, dass ihr dabei seid: Die Liga-Leitung prüft die Anmeldung, nimmt sie an oder lehnt sie ab und teilt Liga und Staffel zu. Du bekommst eine Nachricht.</Muted>
      )}
    </View>
  );
}

export function LeagueApplyScreen({ navigation, route }: Props) {
  const { league, season } = route.params;
  const { user } = useAuth();
  // Gäste kommen über einen Link hierher: erst anmelden - danach liegt dieser Screen wieder oben (wie ProtectedRoute im Web).
  const guest = !user || isGuestUser(user);
  const userId = guest ? "" : String(user?.id || "");
  const [view, setView] = useState<ApplyView | null>(null);
  const [missing, setMissing] = useState(false);
  const [step, setStep] = useState(0);
  const [chosen, setChosen] = useState("");
  const [acceptRules, setAcceptRules] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [busy, setBusy] = useState(false);
  // Zweimal schnell tippen schickt genau einen Antrag - der Zustand kommt erst mit dem nächsten Zeichnen, die Sperre sofort.
  const sending = useRef(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const heading = useRef<Text>(null);
  const path = applyApiPath(league, season);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const { data } = await api.get<ApplyView>(path);
      setView(data || {});
      setMissing(false);
      const free = (data?.squads || []).filter((row) => isSelectable(row));
      if (free.length === 1) setChosen((current) => current || free[0].squad_id);
    } catch {
      setMissing(true);
    }
  }, [path, userId]);
  useEffect(() => { void load(); }, [load]);

  const goTo = (next: number) => {
    setStep(next);
    // Wer mit Vorlesehilfe arbeitet, landet beim neuen Schritt.
    requestAnimationFrame(() => {
      try {
        const node = heading.current ? findNodeHandle(heading.current) : null;
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
      } catch {
        // ohne Vorlesehilfe nichts zu tun
      }
    });
  };

  const submit = async () => {
    if (!view || busy || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post<{ status?: string }>(`/leagues/${encodeURIComponent(league)}/${encodeURIComponent(season)}/applications`, {
        squad_id: chosen, rule_version_id: view.rules?.version_id, accept_rules: acceptRules, accept_privacy: acceptPrivacy,
      });
      setDone(submittedText(data?.status));
    } catch (failure) {
      setError(errorMessage(failure, "Die Anmeldung hat nicht geklappt."));
      // Der Stand kann sich geändert haben: frisch laden, die Zustimmung gilt nur der Fassung, die sie gesehen hat.
      setAcceptRules(false);
      setAcceptPrivacy(false);
      await load();
      goTo(2);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const back = <Button variant="secondary" label="Zurück" arrow={false} onPress={() => navigation.goBack()} testID="apply-leave" />;

  if (guest) {
    return (
      <Screen>
        <SignInRequired text="Anmelden dürfen Captain und Vertreter eines Co-Teams. Melde dich an - danach geht es hier weiter." testID="apply-sign-in" />
      </Screen>
    );
  }
  if (missing) {
    return (
      <Screen>
        <ErrorState title="Liga nicht gefunden" detail="Diese Season gibt es nicht oder sie ist (noch) nicht sichtbar." onRetry={() => { void load(); }} testID="apply-missing" />
      </Screen>
    );
  }
  if (!view) {
    return (
      <Screen>
        <SkeletonList count={3} hasImage={false} />
      </Screen>
    );
  }
  const shell = (children: React.ReactNode) => (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="apply">{children}</ScrollView>
    </Screen>
  );
  if (done) {
    return shell(
      <Card style={styles.card} testID="apply-done">
        <Ionicons name="checkmark-circle" size={28} color={roles.ok} />
        <Title accessibilityRole="header">{done}</Title>
        <Muted>Den Stand siehst du unter Teams bei deinem Co-Team.</Muted>
        <Button label="Fertig" arrow={false} onPress={() => navigation.goBack()} testID="apply-done-back" />
      </Card>,
    );
  }
  if (view.application?.state !== "open") {
    return shell(
      <Card style={styles.card} testID="apply-closed">
        <Title accessibilityRole="header">Anmeldung nicht offen</Title>
        <Body>{view.season_problems?.[0] || "Für diese Season gibt es keine Selbstanmeldung."}</Body>
        {back}
      </Card>,
    );
  }
  const rows = (view.squads || []).filter((row) => row.can_apply);
  if (!rows.length) {
    return shell(
      <Card style={styles.card} testID="apply-none">
        <Title accessibilityRole="header">Mit Co-Team anmelden</Title>
        <Body>{view.hint || "Anmelden dürfen Captain und Vertreter eines Co-Teams für dieses Spiel. Du bist bei keinem eingetragen."}</Body>
        {back}
      </Card>,
    );
  }
  const row = rows.find((item) => item.squad_id === chosen) || null;
  const ready = canGoOn(step, row, view, acceptRules, acceptPrivacy);

  return shell(
    <>
      <Title accessibilityRole="header">Mit Co-Team anmelden</Title>
      <Stepper step={step} />
      <Card style={styles.card}>
        <Heading ref={heading} accessibilityRole="header" testID="apply-step-title">{APPLY_TITLES[step]}</Heading>
        {error ? <Body style={{ color: roles.live }} accessibilityLiveRegion="polite" testID="apply-error">{error}</Body> : null}
        {step === 0 ? <SquadChoice rows={rows} chosen={chosen} onChoose={setChosen} /> : null}
        {step === 1 && row ? <CheckStep row={row} view={view} onTeam={(id) => navigation.navigate("TeamDetail", { id })} /> : null}
        {step === 2 ? <ConsentStep view={view} acceptRules={acceptRules} acceptPrivacy={acceptPrivacy} onRules={setAcceptRules} onPrivacy={setAcceptPrivacy} /> : null}
        {step === 3 && row ? <Summary row={row} view={view} /> : null}
      </Card>
      <View style={styles.actions}>
        {step === 0
          ? <Button variant="quiet" label="Abbrechen" arrow={false} onPress={() => navigation.goBack()} testID="apply-cancel" />
          : <Button variant="quiet" icon="arrow-back" arrow={false} label="Zurück" onPress={() => goTo(step - 1)} testID="apply-back" />}
        {step < 3
          ? <Button label="Weiter" disabled={!ready} onPress={() => goTo(step + 1)} testID="apply-next" />
          : <Button label={busy ? "Reiche ein ..." : "Anmeldung einreichen"} busy={busy} disabled={busy} onPress={() => { void submit(); }} testID="apply-submit" />}
      </View>
    </>,
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, padding: 16, paddingBottom: 32 },
  card: { gap: 12 },
  steps: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stepItem: { alignItems: "center", flexDirection: "row", gap: 6 },
  stepMark: { alignItems: "center", borderColor: "rgba(255,255,255,0.25)", borderRadius: 12, borderWidth: 1, height: 24, justifyContent: "center", width: 24 },
  stepDone: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  stepNow: { borderColor: colors.cyan },
  stepNumber: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "800" },
  stepNumberNow: { color: colors.cyan },
  stepLabel: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "700" },
  stepLabelNow: { color: colors.white },
  list: { gap: 10 },
  choice: { alignItems: "flex-start", backgroundColor: surfaces.base, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, flexDirection: "row", gap: 12, minHeight: 56, padding: 12 },
  choiceOn: { backgroundColor: "rgba(41,182,232,0.1)", borderColor: "rgba(41,182,232,0.7)" },
  choiceOff: { opacity: 0.7 },
  choiceText: { flex: 1, minWidth: 0 },
  badge: { borderColor: roles.quiet, borderRadius: radius.sm, borderWidth: 1, color: roles.quiet, fontSize: 11, fontWeight: "900", paddingHorizontal: 7, paddingVertical: 3 },
  strong: { fontWeight: "800" },
  small: { fontSize: 12 },
  label: { fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase" },
  box: { backgroundColor: surfaces.base, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, gap: 6, padding: 12 },
  warnBox: { borderColor: "rgba(255,159,67,0.4)" },
  okBox: { borderColor: "rgba(31,208,142,0.4)" },
  infoBox: { borderColor: "rgba(41,182,232,0.3)" },
  line: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  consent: { alignItems: "center", flexDirection: "row", gap: 12, minHeight: 44 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between" },
});
