import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { FormInput } from "../../components/FormInput";
import { EmptyState, LoadingState } from "../../components/ListState";
import { RichText } from "../../components/RichText";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatDateTime, formatStatus } from "../../lib/format";
import type { TournamentStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { ChatMessage, Tournament } from "../../types";

type Props = NativeStackScreenProps<TournamentStackParamList, "MatchDetail">;

type MatchParticipant = {
  display_name?: string | null;
  registration_id?: string | null;
  slot?: number | string | null;
  status?: string | null;
  team?: { name?: string; tag?: string; logo_url?: string | null } | null;
  user?: { id?: string; username?: string; display_name?: string | null; avatar_url?: string | null } | null;
};

type ScheduleProposal = {
  id: string;
  actor?: { username?: string; display_name?: string | null } | null;
  note?: string | null;
  scheduled_at?: string | null;
  status?: string | null;
};

type MatchPage = {
  acting_registration_id?: string | null;
  can_act?: boolean;
  can_dispute?: boolean;
  can_forfeit?: boolean;
  can_report_score?: boolean;
  can_submit_result?: boolean;
  collection?: "matches" | "matches_v2" | string;
  match?: any;
  matchday_label?: string;
  participants?: MatchParticipant[];
  schedule_proposals?: ScheduleProposal[];
  stage?: { name?: string; title?: string; stage_type?: string; match_type?: string; settings?: Record<string, unknown> } | null;
  tournament?: Tournament | null;
};

type V2ResultRow = {
  forfeit: boolean;
  rank: string;
  registration_id: string;
  score: string;
};

const scheduleLabels: Record<string, string> = {
  accepted: "Termin bestaetigt",
  countered: "Gegenvorschlag",
  declined: "Abgelehnt",
  escalated: "Turnierleitung noetig",
  proposed: "Vorschlag offen",
};

export function MatchDetailScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const [page, setPage] = useState<MatchPage | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposalAt, setProposalAt] = useState("");
  const [proposalNote, setProposalNote] = useState("");
  const [counterAt, setCounterAt] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [message, setMessage] = useState("");
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [resultNote, setResultNote] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [forfeitReason, setForfeitReason] = useState("");
  const [forfeitWinnerId, setForfeitWinnerId] = useState("");
  const [v2Rows, setV2Rows] = useState<V2ResultRow[]>([]);

  const load = useCallback(async () => {
    setError("");
    try {
      const [pageResult, chatResult] = await Promise.all([
        api.get<MatchPage>(`/matches/${route.params.id}/page`),
        api.get<ChatMessage[]>(`/matches/${route.params.id}/chat`).catch(() => ({ data: [] as ChatMessage[] })),
      ]);
      const nextPage = pageResult.data || null;
      const match = nextPage?.match || {};
      setPage(nextPage);
      setChat(Array.isArray(chatResult.data) ? chatResult.data : []);
      setProposalAt((current) => current || formatDateInput(match.scheduled_at));
      setScoreA((current) => current || String(match.score_a ?? 0));
      setScoreB((current) => current || String(match.score_b ?? 0));
      setForfeitWinnerId((current) => current || firstRegistrationId(nextPage?.participants));
      setV2Rows((current) => current.length ? current : buildV2Rows(nextPage));
    } catch (err) {
      setError(errorMessage(err, "Match konnte nicht geladen werden."));
      setPage(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [route.params.id]);

  useEffect(() => {
    setProposalAt("");
    setProposalNote("");
    setCounterAt("");
    setDecisionNote("");
    setMessage("");
    setScoreA("");
    setScoreB("");
    setProofUrl("");
    setResultNote("");
    setDisputeReason("");
    setForfeitReason("");
    setForfeitWinnerId("");
    setV2Rows([]);
  }, [route.params.id]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const match = page?.match || {};
  const participants = page?.participants || [];
  const pendingProposals = (page?.schedule_proposals || []).filter((proposal) => proposal.status === "pending");
  const isV2 = page?.collection === "matches_v2" || Boolean(match.slots?.length);
  const duelParticipants = participants.slice(0, 2);
  const canUseChat = Boolean(page?.can_act);
  const canSubmitLegacyResult = Boolean(!isV2 && duelParticipants.length >= 2 && (page?.can_report_score || page?.can_submit_result));
  const canSubmitV2Result = Boolean(isV2 && page?.can_submit_result && v2Rows.length);
  const scheduleStatus = match.schedule_status || match.status;

  const propose = useCallback(async () => {
    const scheduledAt = parseDateInput(proposalAt);
    if (!scheduledAt || busy) {
      setError("Bitte Datum und Uhrzeit im Format JJJJ-MM-TT HH:mm eingeben.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.post(`/matches/${route.params.id}/schedule-proposals`, { scheduled_at: scheduledAt, note: proposalNote.trim() || null });
      setProposalNote("");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Terminvorschlag konnte nicht gesendet werden."));
    } finally {
      setBusy(false);
    }
  }, [busy, load, proposalAt, proposalNote, route.params.id]);

  const decide = useCallback(async (proposal: ScheduleProposal, action: "accept" | "counter" | "decline") => {
    if (busy) return;
    const payload: { action: string; note?: string | null; scheduled_at?: string } = { action, note: decisionNote.trim() || null };
    if (action === "counter") {
      const scheduledAt = parseDateInput(counterAt);
      if (!scheduledAt) {
        setError("Bitte fuer den Gegenvorschlag Datum und Uhrzeit eingeben.");
        return;
      }
      payload.scheduled_at = scheduledAt;
    }
    setBusy(true);
    setError("");
    try {
      await api.post(`/matches/${route.params.id}/schedule-proposals/${proposal.id}/decision`, payload);
      setCounterAt("");
      setDecisionNote("");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Antwort konnte nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  }, [busy, counterAt, decisionNote, load, route.params.id]);

  const sendMessage = useCallback(async () => {
    const text = message.trim();
    if (!text || busy || !canUseChat) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post<ChatMessage>(`/matches/${route.params.id}/chat`, { message: text });
      setChat((items) => [...items, data]);
      setMessage("");
    } catch (err) {
      setError(errorMessage(err, "Nachricht konnte nicht gesendet werden."));
    } finally {
      setBusy(false);
    }
  }, [busy, canUseChat, message, route.params.id]);

  const submitLegacyResult = useCallback(async () => {
    if (!canSubmitLegacyResult || busy) return;
    const a = Math.max(0, Number.parseInt(scoreA || "0", 10) || 0);
    const b = Math.max(0, Number.parseInt(scoreB || "0", 10) || 0);
    const winnerId = a > b ? duelParticipants[0]?.registration_id : b > a ? duelParticipants[1]?.registration_id : null;
    setBusy(true);
    setError("");
    try {
      if (page?.can_submit_result && !page.can_report_score) {
        await api.patch(`/matches/${route.params.id}`, {
          score_a: a,
          score_b: b,
          status: winnerId ? "completed" : "waiting_result",
          winner_id: winnerId,
        });
      } else {
        await api.post(`/matches/${route.params.id}/report`, {
          score_a: a,
          score_b: b,
          screenshot_url: proofUrl.trim() || null,
          note: resultNote.trim() || null,
        });
      }
      await load();
    } catch (err) {
      setError(errorMessage(err, "Ergebnis konnte nicht gemeldet werden."));
    } finally {
      setBusy(false);
    }
  }, [busy, canSubmitLegacyResult, duelParticipants, load, page?.can_report_score, page?.can_submit_result, proofUrl, resultNote, route.params.id, scoreA, scoreB]);

  const submitV2Result = useCallback(async () => {
    if (!canSubmitV2Result || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/matches/${route.params.id}/result`, {
        proof_url: proofUrl.trim() || null,
        note: resultNote.trim() || null,
        results: v2Rows.map((row) => ({
          forfeit: row.forfeit,
          rank: Math.max(1, Number.parseInt(row.rank || "0", 10) || 1),
          registration_id: row.registration_id,
          score: numberOrNull(row.score),
        })),
      });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Heat-Ergebnis konnte nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  }, [busy, canSubmitV2Result, load, proofUrl, resultNote, route.params.id, v2Rows]);

  const submitDispute = useCallback(async () => {
    const reason = disputeReason.trim();
    if (!reason || busy || !page?.can_dispute) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/matches/${route.params.id}/dispute`, { reason });
      setDisputeReason("");
      await load();
    } catch (err) {
      setError(errorMessage(err, "Dispute konnte nicht gemeldet werden."));
    } finally {
      setBusy(false);
    }
  }, [busy, disputeReason, load, page?.can_dispute, route.params.id]);

  const submitForfeit = useCallback(async () => {
    const note = forfeitReason.trim();
    if (!note || !forfeitWinnerId || busy || !page?.can_forfeit) return;
    Alert.alert("Forfeit speichern?", "Diese Staff-Aktion wertet das Match als Forfeit.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Speichern",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          setError("");
          try {
            await api.post(`/matches/${route.params.id}/forfeit`, { winner_id: forfeitWinnerId, note });
            setForfeitReason("");
            await load();
          } catch (err) {
            setError(errorMessage(err, "Forfeit konnte nicht gespeichert werden."));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [busy, forfeitReason, forfeitWinnerId, load, page?.can_forfeit, route.params.id]);

  if (loading) {
    return (
      <Screen>
        <LoadingState label="Match wird geladen ..." />
      </Screen>
    );
  }

  if (!page) {
    return (
      <Screen>
        <EmptyState title="Match nicht gefunden" detail={error || "Dieses Match ist nicht sichtbar oder wurde entfernt."} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}
      >
        <View style={styles.header}>
          <Muted>{page.matchday_label || match.round_name || "Match"}</Muted>
          <Title>{match.match_key ? `Match ${match.match_key}` : matchLabel(participants)}</Title>
          {page.tournament ? (
            <Pressable onPress={() => navigation.navigate("TournamentDetail", { id: page.tournament?.slug || page.tournament?.id || match.tournament_id })} hitSlop={10}>
              <Muted style={styles.link}>{page.tournament.title}</Muted>
            </Pressable>
          ) : null}
          <View style={styles.pillRow}>
            <Pill label={scheduleLabels[String(scheduleStatus)] || formatStatus(scheduleStatus)} accent="gold" />
            <Pill label={formatDateTime(match.scheduled_at)} />
            {stationLabel(match) ? <Pill label={`Station ${stationLabel(match)}`} accent="cyan" /> : null}
            {match.duration_minutes ? <Pill label={`${match.duration_minutes} Min.`} /> : null}
          </View>
        </View>

        {error ? <Muted style={styles.error}>{error}</Muted> : null}

        <Card style={styles.card}>
          <Heading>Teilnehmer</Heading>
          {participants.length ? participants.map((participant) => (
            <View key={`${participant.slot}-${participant.registration_id || participant.display_name}`} style={styles.participantRow}>
              <View style={styles.slot}>
                <Body style={styles.slotText}>{participant.slot || "-"}</Body>
              </View>
              <View style={styles.flex}>
                <Body style={styles.strong}>{participant.display_name || "Offen"}</Body>
                {participant.team ? <Muted>{participant.team.tag ? `[${participant.team.tag}] ` : ""}{participant.team.name}</Muted> : null}
                {participant.status ? <Muted>{formatStatus(participant.status)}</Muted> : null}
              </View>
            </View>
          )) : <Muted>Noch keine Teilnehmer zugewiesen.</Muted>}
        </Card>

        <Card style={styles.card}>
          <Heading>Terminabstimmung</Heading>
          <Muted>{formatDateTime(match.scheduled_at)}{stationLabel(match) ? ` · Station ${stationLabel(match)}` : ""}</Muted>
          {page.can_act ? (
            <>
              <FormInput label="Vorschlag" value={proposalAt} onChangeText={setProposalAt} placeholder="2026-05-19 20:00" />
              <FormInput label="Notiz optional" value={proposalNote} onChangeText={setProposalNote} placeholder="z.B. nach 20:00 Uhr moeglich" />
              <Button label={busy ? "Sendet ..." : "Termin vorschlagen"} onPress={propose} disabled={busy} />
            </>
          ) : (
            <Muted>Termine koennen Teilnehmer, Team-Captains oder Turnierleitung vorschlagen.</Muted>
          )}
          {pendingProposals.length ? (
            <View style={styles.stack}>
              {pendingProposals.map((proposal) => (
                <View key={proposal.id} style={styles.proposal}>
                  <Body style={styles.strong}>{formatDateTime(proposal.scheduled_at)}</Body>
                  <Muted>{proposal.actor?.display_name || proposal.actor?.username || "Teilnehmer"}{proposal.note ? ` · ${proposal.note}` : ""}</Muted>
                  {page.can_act ? (
                    <>
                      <View style={styles.buttonRow}>
                        <Button label="Annehmen" onPress={() => decide(proposal, "accept")} disabled={busy} />
                        <Button label="Ablehnen" variant="secondary" onPress={() => decide(proposal, "decline")} disabled={busy} />
                      </View>
                      <FormInput label="Gegenvorschlag" value={counterAt} onChangeText={setCounterAt} placeholder="2026-05-19 21:00" />
                      <FormInput label="Antwort optional" value={decisionNote} onChangeText={setDecisionNote} placeholder="Grund oder Hinweis" />
                      <Button label="Gegenvorschlag senden" variant="secondary" onPress={() => decide(proposal, "counter")} disabled={busy} />
                    </>
                  ) : null}
                </View>
              ))}
            </View>
          ) : (
            <Muted>Kein offener Terminvorschlag.</Muted>
          )}
        </Card>

        {(canSubmitLegacyResult || canSubmitV2Result || page.can_dispute || page.can_forfeit) ? (
          <Card style={styles.card}>
            <Heading>Match-Aktionen</Heading>
            {canSubmitLegacyResult ? (
              <>
                <View style={styles.scoreRow}>
                  <FormInput label={duelParticipants[0]?.display_name || "Spieler A"} value={scoreA} keyboardType="number-pad" onChangeText={setScoreA} />
                  <FormInput label={duelParticipants[1]?.display_name || "Spieler B"} value={scoreB} keyboardType="number-pad" onChangeText={setScoreB} />
                </View>
                <FormInput label="Nachweis-Link optional" value={proofUrl} onChangeText={setProofUrl} placeholder="https://..." />
                <FormInput label="Notiz optional" value={resultNote} onChangeText={setResultNote} placeholder="Kommentar zum Ergebnis" />
                <Button label={busy ? "Speichert ..." : page.can_submit_result && !page.can_report_score ? "Ergebnis speichern" : "Ergebnis melden"} onPress={submitLegacyResult} disabled={busy} />
              </>
            ) : null}
            {canSubmitV2Result ? (
              <>
                <Muted>Heat-Ergebnis nach Rang und Score erfassen.</Muted>
                {v2Rows.map((row, index) => (
                  <View key={row.registration_id} style={styles.v2Row}>
                    <View style={styles.flex}>
                      <Body style={styles.strong}>{participantNameByRegistration(participants, row.registration_id)}</Body>
                    </View>
                    <FormInput label="Rang" value={row.rank} keyboardType="number-pad" onChangeText={(value) => updateV2Row(setV2Rows, index, { rank: value })} style={styles.smallInput} />
                    <FormInput label="Score" value={row.score} keyboardType="numeric" onChangeText={(value) => updateV2Row(setV2Rows, index, { score: value })} style={styles.smallInput} />
                  </View>
                ))}
                <FormInput label="Nachweis-Link optional" value={proofUrl} onChangeText={setProofUrl} placeholder="https://..." />
                <FormInput label="Notiz optional" value={resultNote} onChangeText={setResultNote} placeholder="Kommentar zum Heat" />
                <Button label={busy ? "Speichert ..." : "Heat-Ergebnis speichern"} onPress={submitV2Result} disabled={busy} />
              </>
            ) : null}
            {page.can_dispute ? (
              <>
                <FormInput label="Dispute-Grund" value={disputeReason} onChangeText={setDisputeReason} placeholder="Was stimmt nicht?" />
                <Button label="Dispute melden" variant="secondary" onPress={submitDispute} disabled={busy || !disputeReason.trim()} />
              </>
            ) : null}
            {page.can_forfeit && duelParticipants.length >= 2 ? (
              <>
                <Muted style={styles.warning}>Staff-Aktion: Forfeit setzt einen Gewinner und wertet den Gegner als Forfeit.</Muted>
                <View style={styles.buttonRow}>
                  {duelParticipants.map((participant) => (
                    <Pressable
                      key={participant.registration_id}
                      onPress={() => setForfeitWinnerId(participant.registration_id || "")}
                      style={[styles.choice, forfeitWinnerId === participant.registration_id && styles.choiceActive]}
                    >
                      <Muted style={forfeitWinnerId === participant.registration_id && styles.choiceTextActive}>{participant.display_name || "Teilnehmer"}</Muted>
                    </Pressable>
                  ))}
                </View>
                <FormInput label="Forfeit-Begruendung" value={forfeitReason} onChangeText={setForfeitReason} placeholder="Mindestens 5 Zeichen" />
                <Button label="Forfeit speichern" variant="danger" onPress={submitForfeit} disabled={busy || forfeitReason.trim().length < 5 || !forfeitWinnerId} />
              </>
            ) : null}
          </Card>
        ) : null}

        <Card style={styles.card}>
          <Heading>Matchchat</Heading>
          {chat.length ? chat.map((item) => <ChatBubble key={item.id} message={item} own={item.user_id === user?.id} />) : <Muted>Noch keine Nachrichten.</Muted>}
          {canUseChat ? (
            <View style={styles.chatComposer}>
              <FormInput label="Nachricht" value={message} onChangeText={setMessage} placeholder="Nachricht schreiben ..." style={styles.chatInput} />
              <Button label="Senden" onPress={sendMessage} disabled={busy || !message.trim()} />
            </View>
          ) : (
            <Muted>Schreiben koennen Teilnehmer, Team-Captains oder Turnierleitung.</Muted>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function ChatBubble({ message, own }: { message: ChatMessage; own: boolean }) {
  const author = message.author || message.sender;
  return (
    <View style={[styles.chatBubble, own && styles.chatBubbleOwn]}>
      <View style={styles.chatHead}>
        <Body style={styles.chatAuthor}>{own ? "Du" : author?.display_name || author?.username || "Spieler"}</Body>
        {message.created_at ? <Muted>{formatDate(message.created_at)}</Muted> : null}
      </View>
      <RichText text={message.message} compact />
    </View>
  );
}

function Pill({ label, accent }: { label: string; accent?: "cyan" | "gold" }) {
  return (
    <View style={[styles.pill, accent === "cyan" && styles.pillCyan, accent === "gold" && styles.pillGold]}>
      <Muted style={[styles.pillText, accent === "cyan" && styles.textCyan, accent === "gold" && styles.textGold]}>{label}</Muted>
    </View>
  );
}

function buildV2Rows(page?: MatchPage | null): V2ResultRow[] {
  const match = page?.match || {};
  const byRegistration = new Map((match.results || []).map((result: any) => [result.registration_id, result]));
  return (page?.participants || [])
    .filter((participant) => participant.registration_id)
    .map((participant, index) => {
      const existing: any = byRegistration.get(participant.registration_id || "");
      return {
        forfeit: Boolean(existing?.forfeit),
        rank: String(existing?.rank || index + 1),
        registration_id: participant.registration_id || "",
        score: existing?.score != null ? String(existing.score) : existing?.points != null ? String(existing.points) : "",
      };
    });
}

function firstRegistrationId(participants?: MatchParticipant[]) {
  return (participants || []).find((participant) => participant.registration_id)?.registration_id || "";
}

function formatDateInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateInput(value: string) {
  const cleaned = value.trim().replace("T", " ");
  if (!cleaned) return null;
  const isoLike = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  const deLike = cleaned.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!isoLike && !deLike) {
    const parsed = new Date(cleaned).getTime();
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  const [, first, second, third, hour, minute] = isoLike || deLike || [];
  const year = isoLike ? first : third;
  const month = isoLike ? second : second;
  const day = isoLike ? third : first;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stationLabel(match: any) {
  return match?.station_label || match?.station_name || match?.station?.name || match?.station_id || "";
}

function matchLabel(participants: MatchParticipant[]) {
  const names = participants.map((participant) => participant.display_name).filter(Boolean);
  return names.length ? names.join(" vs. ") : "Match";
}

function participantNameByRegistration(participants: MatchParticipant[], registrationId: string) {
  return participants.find((participant) => participant.registration_id === registrationId)?.display_name || "Teilnehmer";
}

function numberOrNull(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isNaN(parsed) ? null : parsed;
}

function updateV2Row(setRows: React.Dispatch<React.SetStateAction<V2ResultRow[]>>, index: number, patch: Partial<V2ResultRow>) {
  setRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
}

const styles = StyleSheet.create({
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  card: {
    gap: 12,
  },
  chatAuthor: {
    color: colors.cyan,
    fontWeight: "900",
  },
  chatBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.black,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: "92%",
    padding: 10,
  },
  chatBubbleOwn: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(41,182,232,0.14)",
    borderColor: "rgba(41,182,232,0.35)",
  },
  chatComposer: {
    gap: 10,
  },
  chatHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  chatInput: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  choice: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  choiceActive: {
    backgroundColor: "rgba(240,180,41,0.16)",
    borderColor: "rgba(240,180,41,0.45)",
  },
  choiceTextActive: {
    color: colors.gold,
    fontWeight: "900",
  },
  content: {
    gap: 16,
    padding: 18,
    paddingBottom: 32,
  },
  error: {
    color: colors.live,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  header: {
    gap: 9,
  },
  link: {
    color: colors.cyan,
    fontWeight: "900",
  },
  participantRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingTop: 10,
  },
  pill: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  pillCyan: {
    backgroundColor: "rgba(41,182,232,0.14)",
    borderColor: "rgba(41,182,232,0.32)",
  },
  pillGold: {
    backgroundColor: "rgba(240,180,41,0.13)",
    borderColor: "rgba(240,180,41,0.36)",
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "800",
  },
  proposal: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    gap: 10,
    padding: 10,
  },
  scoreRow: {
    gap: 10,
  },
  slot: {
    alignItems: "center",
    backgroundColor: "rgba(41,182,232,0.12)",
    borderColor: "rgba(41,182,232,0.3)",
    borderRadius: 7,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  slotText: {
    color: colors.cyan,
    fontWeight: "900",
  },
  smallInput: {
    minWidth: 72,
  },
  stack: {
    gap: 10,
  },
  strong: {
    fontWeight: "900",
  },
  textCyan: {
    color: colors.cyan,
  },
  textGold: {
    color: colors.gold,
  },
  v2Row: {
    alignItems: "flex-end",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  warning: {
    color: colors.gold,
    fontWeight: "800",
  },
});
