import { Ionicons } from "@expo/vector-icons";
import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { Button } from "../Button";
import { FormInput } from "../FormInput";
import { Body, Heading, Muted } from "../Text";
import { WEBSITE_BASE_URL } from "../../config";
import { formatWhen } from "../../lib/format";
import { checkInWindow, NO_RULES_TEXT, placeLine, rulesSummary, rulesText } from "../../lib/registrationSheet";
import { basisLabel, formatCents, quoteTotal, startFeeSummary } from "../../lib/startFee";
import { useSeasonOverlay } from "../../seasons/anchors";
import { colors, radius } from "../../theme";
import type { Team, Tournament, User } from "../../types";

// Bestätigungs-Blatt der Turnier-Anmeldung (#1904, App-Teil von #1261) - wie im Web (RegistrationSheet.jsx): jede
// Anmeldung auf der Turnierseite geht hierüber, Einzel und Team, mit und ohne Startgeld, mit und ohne Spieler-Kennungen.
// Oben die Zusammenfassung (Start, Check-in, Ort, Startgeld, Regeln in drei Sätzen mit „Alle Regeln“), darunter, was die
// Anmeldung braucht (Team, Kennungen, Kostenübernahme). Erst „Verbindlich anmelden“ meldet an; Abbrechen, Schließen,
// Zurück und ein Tipp daneben melden nicht an. Ein Blatt von unten, der Knopf steht unten fest.

export type RegistrationPayload = {
  player_ids?: Record<string, string>;
  team_id?: string | null;
  // Startgeld (#319): wer anmeldet, übernimmt es - der Server verlangt die Bestätigung.
  accept_costs?: boolean;
  selected_positions?: string[];
};

type Field = NonNullable<NonNullable<Tournament["game"]>["effective_player_id_fields"]>[number];

type Props = {
  busy: boolean;
  error?: string;
  fields: Field[];
  teams: Team[];
  tournament: Tournament & { location?: string | null };
  user?: User | null;
  visible: boolean;
  onClose: () => void;
  onSubmit: (payload: RegistrationPayload) => void;
};

function Fact({ icon, label, testID, children }: { icon: keyof typeof Ionicons.glyphMap; label: string; testID: string; children: string }) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={16} color={colors.cyan} style={styles.factIcon} />
      <View style={styles.flex}>
        <Muted style={styles.factLabel}>{label}</Muted>
        <Body testID={testID}>{children}</Body>
      </View>
    </View>
  );
}

export function RegistrationSheet({ busy, error, fields, teams, tournament, user, visible, onClose, onSubmit }: Props) {
  useSeasonOverlay("registration-modal", visible);
  // Ohne SafeAreaProvider (Tests, Vorschau) gilt kein Rand.
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  const isTeamTournament = (tournament.team_mode || "solo") !== "solo";
  const sourceSlug = tournament.game?.identity_game_slug || tournament.game?.slug || "";
  const gameSlug = tournament.game?.slug || "";
  const initialIds = useMemo(() => ({
    ...((sourceSlug && user?.game_ids?.[sourceSlug]) || {}),
    ...((gameSlug && user?.game_ids?.[gameSlug]) || {}),
  }), [gameSlug, sourceSlug, user?.game_ids]);
  const [playerIds, setPlayerIds] = useState<Record<string, string>>(initialIds);
  const [teamId, setTeamId] = useState(teams[0]?.id || "");
  const [rulesOpen, setRulesOpen] = useState(false);
  // Startgeld (#319): Summe vor dem Absenden, wählbare Positionen, Kostenübernahme als Pflicht.
  const offer = tournament.offer || null;
  const [acceptCosts, setAcceptCosts] = useState(false);
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const seats = isTeamTournament ? Math.max(1, Number(tournament.team_size) || 1) : 1;
  const total = offer ? quoteTotal(offer, seats, selectedPositions) : 0;
  const currency = offer?.currency || "EUR";
  // Doppeltipp-Schutz: der Ref sperrt sofort, `busy` kommt erst mit dem nächsten Zeichnen.
  const sent = useRef(false);

  useEffect(() => {
    if (!visible) return;
    sent.current = false;
    setPlayerIds(initialIds);
    setTeamId(teams[0]?.id || "");
    setAcceptCosts(false);
    setSelectedPositions([]);
    setRulesOpen(false);
  }, [initialIds, teams, visible]);

  useEffect(() => {
    if (!busy) sent.current = false;
  }, [busy]);

  const missingRequired = fields.some((field) => field.required !== false && !String(playerIds[field.key] || "").trim());
  const canSubmit = !busy && (!isTeamTournament || Boolean(teamId)) && !missingRequired && (!offer || acceptCosts);
  const submit = () => {
    if (!canSubmit || sent.current) return;
    sent.current = true;
    onSubmit({ team_id: isTeamTournament ? teamId : null, player_ids: playerIds, accept_costs: acceptCosts, selected_positions: selectedPositions });
  };

  const gameName = tournament.game?.display_name || tournament.game?.name || "Dieses Spiel";
  const lead = isTeamTournament
    ? "Wähle das Team aus, das du als Leader oder Co-Leader anmelden möchtest."
    : fields.length
      ? `${gameName} benötigt Spieler-IDs${sourceSlug && sourceSlug !== gameSlug ? ` aus ${tournament.game?.identity_game_name || "dem Hauptspiel"}` : ""}.`
      : `Du meldest dich als ${user?.display_name || user?.username || "du"} an.`;
  const checkIn = checkInWindow(tournament);
  const allRules = rulesText(tournament.rules).trim();
  const rules = rulesSummary(tournament.rules);
  const fee = offer?.enabled ? startFeeSummary(offer, tournament.team_mode || "solo", Number(tournament.team_size) || 1) : "";
  const submitLabel = busy ? "Sendet ..." : offer && total > 0 ? `Verbindlich anmelden · ${formatCents(total, currency)}` : "Verbindlich anmelden";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Schließen" testID="register-sheet-backdrop" />
        <View style={styles.sheet} testID="register-sheet" accessibilityViewIsModal>
          <View style={styles.grip} />
          <View style={styles.head}>
            <View style={styles.flex}>
              <Muted style={styles.eyebrow}>{isTeamTournament ? "TEAM-ANMELDUNG" : "ANMELDUNG"}</Muted>
              <Heading accessibilityRole="header">{tournament.title}</Heading>
              <Muted>{lead}</Muted>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Schließen" hitSlop={12} style={styles.close} testID="register-sheet-close">
              <Ionicons name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.summary} testID="register-sheet-summary">
              <Fact icon="calendar-outline" label="Start" testID="register-sheet-start">{formatWhen(tournament.start_date, { fallback: "Termin folgt" })}</Fact>
              {checkIn ? <Fact icon="time-outline" label="Check-in" testID="register-sheet-checkin">{checkIn}</Fact> : null}
              <Fact icon="location-outline" label="Ort" testID="register-sheet-place">{placeLine(tournament)}</Fact>
              {fee ? <Fact icon="receipt-outline" label="Startgeld" testID="register-sheet-fee">{fee}</Fact> : null}
            </View>

            <View testID="register-sheet-rules" style={styles.rules}>
              <Muted style={styles.factLabel}>Regeln kurz</Muted>
              <Body>{rules || NO_RULES_TEXT}</Body>
              {allRules ? (
                <>
                  <Pressable
                    onPress={() => setRulesOpen((open) => !open)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: rulesOpen }}
                    hitSlop={10}
                    style={styles.rulesToggle}
                    testID="register-sheet-rules-all"
                  >
                    <Muted style={styles.rulesToggleText}>{rulesOpen ? "Regeln ausblenden" : "Alle Regeln"}</Muted>
                    <Ionicons name={rulesOpen ? "chevron-up" : "chevron-down"} size={14} color={colors.cyan} />
                  </Pressable>
                  {rulesOpen ? (
                    <View style={styles.rulesFull} testID="register-sheet-rules-full">
                      {allRules.split("\n").map((line) => line.replace(/^[-#*\s]+/, "").trim()).filter(Boolean).map((line, index) => (
                        <Body key={`${index}-${line}`}>{line}</Body>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>

            {isTeamTournament ? (
              <View style={styles.formGroup}>
                <Muted style={styles.formLabel}>Team *</Muted>
                {teams.length ? teams.map((team) => (
                  <Pressable
                    key={team.id}
                    onPress={() => setTeamId(team.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: teamId === team.id }}
                    style={[styles.teamChoice, teamId === team.id && styles.teamChoiceActive]}
                  >
                    <View style={styles.flex}>
                      <Body style={styles.strong}>{team.tag ? `[${team.tag}] ${team.name}` : team.name}</Body>
                      <Muted>{team.my_role === "co_leader" ? "Co-Leader" : team.my_role === "leader" ? "Leader" : team.can_manage ? "Verwaltbar" : "Team"}</Muted>
                    </View>
                    <View style={[styles.radio, teamId === team.id && styles.radioActive]} />
                  </Pressable>
                )) : (
                  <Muted style={styles.errorText}>Du bist aktuell bei keinem Team als Leader oder Co-Leader eingetragen.</Muted>
                )}
              </View>
            ) : null}

            {fields.length ? (
              <View style={styles.formGroup}>
                {fields.map((field) => (
                  <FormInput
                    key={field.key}
                    label={`${field.label || field.key}${field.required === false ? "" : " *"}`}
                    value={playerIds[field.key] || ""}
                    placeholder={field.help_text || field.label || field.key}
                    onChangeText={(value) => setPlayerIds((current) => ({ ...current, [field.key]: value }))}
                  />
                ))}
              </View>
            ) : null}

            {offer ? (
              <View style={[styles.formGroup, styles.feeBox]} testID="tournament-register-costs">
                <Muted style={styles.feeLabel}>Startgeld</Muted>
                {offer.positions.filter((position) => position.optional).map((position) => {
                  const chosen = selectedPositions.includes(position.key);
                  return (
                    <Pressable
                      key={position.key}
                      onPress={() => setSelectedPositions((current) => (chosen ? current.filter((key) => key !== position.key) : [...current, position.key]))}
                      style={styles.checkRow}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: chosen }}
                      testID={`tournament-offer-option-${position.key}`}
                    >
                      <View style={[styles.checkbox, chosen && styles.checkboxActive]} />
                      <Body style={styles.flex}>{position.label} <Muted>{formatCents(position.amount_cents, currency)} {basisLabel(position.basis)}</Muted></Body>
                    </Pressable>
                  );
                })}
                {total > 0 ? (
                  <View style={styles.feeTotalRow}>
                    <Muted>{isTeamTournament ? `Summe für ein Team mit ${seats} Spielern` : "Summe"}</Muted>
                    <Body style={styles.strong} testID="tournament-quote">{formatCents(total, currency)}</Body>
                  </View>
                ) : null}
                {isTeamTournament && offer.positions.some((position) => position.basis === "per_person") ? (
                  <Muted>Gezählt wird der Roster bei der Freigabe – fehlen noch Spieler, gilt die Teamgröße.</Muted>
                ) : null}
                <Pressable
                  onPress={() => setAcceptCosts((current) => !current)}
                  style={styles.checkRow}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: acceptCosts }}
                  testID="tournament-accept-costs"
                >
                  <View style={[styles.checkbox, acceptCosts && styles.checkboxActive]} />
                  <View style={styles.flex}>
                    <Body>{isTeamTournament ? "Ich übernehme das Startgeld für das Team (Rechnung an mich)." : "Ich übernehme das Startgeld (Rechnung an mich)."}</Body>
                    <Muted>Bezahlt wird erst mit der verbindlichen Teilnahme; die Rechnung kommt in dein Konto unter „Meine Rechnungen“.</Muted>
                  </View>
                </Pressable>
              </View>
            ) : null}

            {missingRequired ? <Muted style={styles.errorText}>Bitte alle Pflicht-IDs ausfüllen.</Muted> : null}
            {error ? <Muted style={styles.errorText} testID="register-sheet-error">{error}</Muted> : null}
          </ScrollView>

          {/* Fester Fuß: „Verbindlich anmelden“ bleibt unten stehen, auch wenn der Inhalt scrollt. */}
          <View style={[styles.footer, { paddingBottom: Math.max(16, bottomInset + 8) }]}>
            <Muted style={styles.consent} testID="register-sheet-consent">
              Mit der Anmeldung akzeptierst du die Turnierregeln und den{" "}
              <Muted style={styles.link} onPress={() => void Linking.openURL(`${WEBSITE_BASE_URL}/privacy`)} accessibilityRole="link">Datenschutz</Muted>.
            </Muted>
            <Button label={submitLabel} onPress={submit} disabled={!canSubmit} busy={busy} testID="tournament-register-submit" />
            <Button label="Abbrechen" variant="secondary" onPress={onClose} disabled={busy} testID="register-sheet-cancel" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: "rgba(0,0,0,0.75)", flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.black,
    borderColor: colors.border,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderWidth: 1,
    maxHeight: "92%",
  },
  grip: { alignSelf: "center", backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 2, height: 4, marginTop: 8, width: 40 },
  head: { borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: "row", gap: 12, paddingBottom: 14, paddingHorizontal: 18, paddingTop: 10 },
  eyebrow: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  close: { alignItems: "center", height: 48, justifyContent: "center", marginRight: -10, marginTop: -6, width: 48 },
  content: { gap: 16, padding: 18 },
  summary: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: 12, padding: 14 },
  fact: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  factIcon: { marginTop: 2 },
  factLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 1.5, textTransform: "uppercase" },
  rules: { gap: 4 },
  rulesToggle: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 4, minHeight: 32 },
  rulesToggleText: { color: colors.cyan, fontSize: 12, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  rulesFull: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: 6, padding: 14 },
  flex: { flex: 1, gap: 2, minWidth: 0 },
  strong: { fontWeight: "900" },
  formGroup: { gap: 10 },
  formLabel: { color: colors.cyan, fontWeight: "900", textTransform: "uppercase" },
  teamChoice: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 48,
    padding: 11,
  },
  teamChoiceActive: { backgroundColor: "rgba(41,182,232,0.13)", borderColor: "rgba(41,182,232,0.5)" },
  radio: { borderColor: colors.border, borderRadius: 8, borderWidth: 2, height: 16, width: 16 },
  radioActive: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  feeBox: {
    backgroundColor: "rgba(255,215,0,0.06)",
    borderColor: "rgba(255,215,0,0.35)",
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 6,
    padding: 11,
  },
  feeLabel: { color: colors.gold, fontSize: 11, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase" },
  feeTotalRow: { alignItems: "baseline", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  checkRow: { alignItems: "flex-start", flexDirection: "row", gap: 10, minHeight: 48, paddingVertical: 6 },
  checkbox: { borderColor: colors.border, borderRadius: radius.lg, borderWidth: 2, height: 18, marginTop: 2, width: 18 },
  checkboxActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  errorText: { color: colors.live, fontWeight: "800" },
  footer: { backgroundColor: colors.black, borderTopColor: colors.border, borderTopWidth: 1, gap: 10, paddingHorizontal: 18, paddingTop: 12 },
  consent: { fontSize: 12 },
  link: { fontSize: 12, textDecorationLine: "underline" },
});
