import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted } from "../../components/Text";
import { api, errorMessage } from "../../lib/api";
import { formatDate } from "../../lib/format";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

// Versammlungen und Abstimmungen (#327): dieselben Daten wie auf lionsquad.at/members/meetings - alles aus
// der Vereinsakte (Vereine 1.4). Zu-/Absage, Anträge und Stimmen gehen durch den Server an das Modul; eine
// Stimme wird vorher bestätigt und lässt sich danach nicht ändern.

export type MeetingMotion = { external_id: string; title: string; text: string; received_at?: string; late: boolean; status: string; status_label: string };
export type Meeting = {
  id: number; kind: string; kind_label: string; title: string; day: string; time: string; timezone: string; format: string; format_label: string;
  place: string; access: string; status: string; status_label: string; agenda: string[]; voting: boolean; response: string; response_label: string;
  responded_at: string; motion_deadline: string; motions: MeetingMotion[]; upcoming: boolean; can_respond: boolean; can_motion: boolean; motion_late: boolean;
};
export type BallotRight = { right_id: number; for: "self" | "proxy"; name: string; state: string; reason: string; reason_text: string; option: string; option_label: string; can_use: boolean };
export type BallotResult = { outcome: string; outcome_label: string; passed: boolean; valid: number; abstain: number; counts: { code: string; label: string; count: number }[]; winner: string; winner_label: string };
export type Ballot = {
  id: number; meeting_id: number; meeting: string; day: string; item: number; kind: string; kind_label: string; question: string; status: string; status_label: string;
  closes: string; timezone: string; options: { code: string; label: string }[]; rights: BallotRight[]; can_vote: boolean; result: BallotResult | null;
};
export type MeetingsView = {
  available: boolean; reason?: string | null; text?: string; meetings: Meeting[]; ballots: Ballot[];
  meetings_reason?: string | null; meetings_text?: string; ballots_reason?: string | null; ballots_text?: string;
};

export type ConfirmVote = (title: string, message: string) => Promise<boolean>;

export const defaultConfirmVote: ConfirmVote = (title, message) => new Promise((resolve) => {
  Alert.alert(title, message, [
    { text: "Abbrechen", style: "cancel", onPress: () => resolve(false) },
    { text: "Abstimmen", onPress: () => resolve(true) },
  ], { cancelable: false, onDismiss: () => resolve(false) });
});

export function meetingWhen(meeting: Meeting): string {
  return [formatDate(meeting.day), meeting.time ? `${meeting.time} Uhr` : ""].filter(Boolean).join(" · ");
}

const RESPONSES: [string, string][] = [["yes", "Ich komme"], ["maybe", "Vielleicht"], ["no", "Ich komme nicht"]];

type Props = NativeStackScreenProps<MoreStackParamList, "MemberMeetings"> & { confirmVote?: ConfirmVote };

export function MemberMeetingsScreen({ confirmVote = defaultConfirmVote }: Props) {
  const [view, setView] = useState<MeetingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [motionDrafts, setMotionDrafts] = useState<Record<number, { title: string; text: string }>>({});

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<MeetingsView>("/membership/me/meetings");
      setView(data && typeof data === "object" ? data : null);
    } catch (err) {
      setError(errorMessage(err, "Versammlungen konnten nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const respond = async (meeting: Meeting, response: string) => {
    setBusy(`respond-${meeting.id}`);
    try {
      await api.put(`/membership/me/meetings/${meeting.id}/response`, { response });
      await load();
    } catch (err) {
      Alert.alert("Das hat nicht geklappt", errorMessage(err, "Die Antwort wurde nicht übernommen."));
    } finally {
      setBusy("");
    }
  };

  const submitMotion = async (meeting: Meeting) => {
    const draft = motionDrafts[meeting.id] || { title: "", text: "" };
    setBusy(`motion-${meeting.id}`);
    try {
      await api.post(`/membership/me/meetings/${meeting.id}/motions`, { title: draft.title.trim(), text: draft.text.trim() });
      setMotionDrafts((current) => ({ ...current, [meeting.id]: { title: "", text: "" } }));
      await load();
    } catch (err) {
      Alert.alert("Das hat nicht geklappt", errorMessage(err, "Der Antrag wurde nicht angenommen."));
    } finally {
      setBusy("");
    }
  };

  const vote = async (ballot: Ballot, right: BallotRight, option: { code: string; label: string }) => {
    const ok = await confirmVote("Stimme abgeben?", `„${option.label}“ zu: ${ballot.question}${right.for === "proxy" ? ` – als Vertretung für ${right.name}` : ""}. Eine abgegebene Stimme lässt sich nicht ändern.`);
    if (!ok) return;
    setBusy(`vote-${ballot.id}`);
    try {
      await api.post(`/membership/me/ballots/${ballot.id}/votes`, { right_id: right.right_id, option: option.code });
    } catch (err) {
      Alert.alert("Stimme nicht angenommen", errorMessage(err, "Die Stimme wurde nicht angenommen."));
    } finally {
      setBusy("");
      await load();
    }
  };

  const meetings = view?.meetings ?? [];
  const ballots = view?.ballots ?? [];
  const sortedBallots = [...ballots.filter((b) => b.status === "open" || b.status === "released"), ...ballots.filter((b) => !(b.status === "open" || b.status === "released"))];
  const sortedMeetings = [...meetings.filter((m) => m.upcoming), ...meetings.filter((m) => !m.upcoming)];

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}>
        {loading ? <SkeletonList count={2} hasImage={false} /> : null}
        {error ? <EmptyState icon="alert-circle-outline" tone="gold" title="Nicht geladen" detail={error} /> : null}

        {view && !view.available ? (
          <Card style={styles.card} testID="meetings-unavailable">
            <Heading>Versammlungen</Heading>
            <Muted>{view.text || "Hier gibt es noch nichts."}</Muted>
          </Card>
        ) : null}

        {view?.available ? (
          <>
            <Heading style={styles.sectionTitle}>Abstimmungen</Heading>
            {view.ballots_reason ? <Muted testID="ballots-reason">{view.ballots_text}</Muted> : null}
            {!view.ballots_reason && !ballots.length ? <Muted testID="ballots-empty">Derzeit keine Abstimmung freigegeben.</Muted> : null}
            {sortedBallots.map((ballot) => (
              <Card key={ballot.id} style={[styles.card, ballot.status === "open" && styles.open]} testID={`ballot-${ballot.id}`}>
                <Muted style={styles.eyebrow}>{ballot.kind_label} · {ballot.meeting}{ballot.item ? ` · TOP ${ballot.item}` : ""}</Muted>
                <Heading>{ballot.question}</Heading>
                <Muted testID={`ballot-${ballot.id}-status`}>{ballot.status_label}{ballot.closes ? ` · offen bis ${ballot.closes} Uhr` : ""} · {formatDate(ballot.day)}</Muted>
                {ballot.rights.map((right) => (
                  <View key={`${right.right_id}-${right.for}-${right.name}`} style={styles.right} testID={`ballot-${ballot.id}-right-${right.right_id}`}>
                    <Body>{right.for === "proxy" ? `Vollmacht von ${right.name}` : "Dein Stimmrecht"} <Muted>· {right.reason_text}</Muted></Body>
                    {right.state === "used" ? (
                      <Body style={styles.used} testID={`ballot-${ballot.id}-right-${right.right_id}-used`}>abgestimmt: {right.option_label || right.option}</Body>
                    ) : ballot.status === "open" && right.can_use ? (
                      <View style={styles.options}>
                        {ballot.options.map((option) => (
                          <Pressable
                            key={option.code}
                            onPress={() => vote(ballot, right, option)}
                            disabled={busy === `vote-${ballot.id}`}
                            accessibilityRole="button"
                            testID={`ballot-${ballot.id}-vote-${right.right_id}-${option.code}`}
                            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                          >
                            <Body style={styles.optionText}>{option.label}</Body>
                          </Pressable>
                        ))}
                      </View>
                    ) : (
                      <Muted>{right.state === "none" ? "Mit diesem Stimmrecht kannst du hier nicht abstimmen." : ballot.status === "open" ? "" : "Abstimmen geht nur, solange die Abstimmung offen ist."}</Muted>
                    )}
                  </View>
                ))}
                {!ballot.rights.length ? <Muted>Kein Stimmrecht für dich bei dieser Abstimmung.</Muted> : null}
                {ballot.result ? (
                  <View style={styles.result} testID={`ballot-${ballot.id}-result`}>
                    <Body style={styles.strong}>Ergebnis: {ballot.result.outcome_label}{ballot.result.winner_label ? ` – ${ballot.result.winner_label}` : ""}</Body>
                    <Muted>{ballot.result.counts.map((row) => `${row.label} ${row.count}`).join(" · ")} · gültig {ballot.result.valid}</Muted>
                  </View>
                ) : ballot.status === "closed" || ballot.status === "evaluated" ? (
                  <Muted>Das Ergebnis erscheint, sobald die Versammlungsleitung es bestätigt hat.</Muted>
                ) : null}
              </Card>
            ))}

            <Heading style={styles.sectionTitle}>Versammlungen</Heading>
            {view.meetings_reason ? <Muted testID="meetings-reason">{view.meetings_text}</Muted> : null}
            {!view.meetings_reason && !meetings.length ? <Muted testID="meetings-empty">Keine Einladung – sobald der Verein dich einlädt, steht sie hier.</Muted> : null}
            {sortedMeetings.map((meeting) => {
              const draft = motionDrafts[meeting.id] || { title: "", text: "" };
              return (
                <Card key={meeting.id} style={[styles.card, meeting.upcoming && styles.upcoming]} testID={`meeting-${meeting.id}`}>
                  <Muted style={styles.eyebrow}>{meeting.kind_label}</Muted>
                  <Heading>{meeting.title}</Heading>
                  <Muted testID={`meeting-${meeting.id}-when`}>{meetingWhen(meeting)} · {meeting.format_label}{meeting.place ? ` · ${meeting.place}` : ""} · {meeting.status_label}</Muted>
                  {meeting.access ? (
                    <Pressable onPress={() => Linking.openURL(meeting.access).catch(() => {})} accessibilityRole="link" testID={`meeting-${meeting.id}-access`} style={styles.link}>
                      <Ionicons name="videocam-outline" size={16} color={colors.cyan} />
                      <Body style={styles.linkText}>Online teilnehmen</Body>
                    </Pressable>
                  ) : null}
                  {meeting.agenda.length ? (
                    <View style={styles.agenda} testID={`meeting-${meeting.id}-agenda`}>
                      <Muted style={styles.label}>Tagesordnung</Muted>
                      {meeting.agenda.map((item, index) => <Body key={`${index}-${item}`}>{index + 1}. {item}</Body>)}
                    </View>
                  ) : null}
                  <Muted style={styles.label} testID={`meeting-${meeting.id}-response`}>Deine Antwort: {meeting.response_label}{meeting.voting ? " · stimmberechtigt" : ""}</Muted>
                  {meeting.can_respond ? (
                    <View style={styles.options}>
                      {RESPONSES.map(([code, label]) => (
                        <Pressable
                          key={code}
                          onPress={() => respond(meeting, code)}
                          disabled={busy === `respond-${meeting.id}` || meeting.response === code}
                          accessibilityRole="button"
                          testID={`meeting-${meeting.id}-respond-${code}`}
                          style={({ pressed }) => [styles.option, meeting.response === code && styles.optionActive, pressed && styles.pressed]}
                        >
                          <Body style={[styles.optionText, meeting.response === code && styles.optionActiveText]}>{label}</Body>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                  {meeting.motions.length ? (
                    <View style={styles.motions} testID={`meeting-${meeting.id}-motions`}>
                      <Muted style={styles.label}>Deine Anträge</Muted>
                      {meeting.motions.map((motion) => (
                        <View key={motion.external_id} style={styles.motion}>
                          <Body style={styles.strong}>{motion.title}</Body>
                          <Muted>{motion.status_label}{motion.late ? " · verspätet" : ""}</Muted>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {meeting.can_motion ? (
                    <View style={styles.motionForm} testID={`meeting-${meeting.id}-motion-form`}>
                      <Muted style={styles.label}>
                        {meeting.motion_deadline
                          ? meeting.motion_late
                            ? `Frist ${formatDate(meeting.motion_deadline)} vorbei – ein Antrag gilt als verspätet.`
                            : `Anträge bis ${formatDate(meeting.motion_deadline)} gelten als rechtzeitig.`
                          : "Antrag zur Tagesordnung"}
                      </Muted>
                      <TextInput
                        style={styles.input}
                        placeholder="Titel des Antrags"
                        placeholderTextColor={colors.muted}
                        value={draft.title}
                        maxLength={255}
                        onChangeText={(value) => setMotionDrafts((current) => ({ ...current, [meeting.id]: { ...draft, title: value } }))}
                        testID={`meeting-${meeting.id}-motion-title`}
                      />
                      <TextInput
                        style={[styles.input, styles.multiline]}
                        placeholder="Begründung (optional)"
                        placeholderTextColor={colors.muted}
                        value={draft.text}
                        maxLength={5000}
                        multiline
                        onChangeText={(value) => setMotionDrafts((current) => ({ ...current, [meeting.id]: { ...draft, text: value } }))}
                        testID={`meeting-${meeting.id}-motion-text`}
                      />
                      <Button label={busy === `motion-${meeting.id}` ? "Sende …" : "Antrag einreichen"} onPress={() => submitMotion(meeting)} disabled={busy !== "" || draft.title.trim().length < 3} testID={`meeting-${meeting.id}-motion-submit`} />
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  card: { gap: 8 },
  open: { borderColor: "rgba(41,182,232,0.6)" },
  upcoming: { borderColor: "rgba(255,215,0,0.45)" },
  sectionTitle: { marginTop: 8 },
  eyebrow: { fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: colors.gold },
  label: { fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginTop: 4 },
  agenda: { gap: 2 },
  link: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkText: { color: colors.cyan },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  option: { borderColor: "rgba(255,255,255,0.2)", borderRadius: 6, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  optionActive: { borderColor: colors.gold, backgroundColor: "rgba(255,215,0,0.12)" },
  optionText: { fontSize: 13, fontWeight: "700" },
  optionActiveText: { color: colors.gold },
  pressed: { opacity: 0.7 },
  right: { borderColor: "rgba(255,255,255,0.12)", borderRadius: 6, borderWidth: 1, padding: 10, gap: 4 },
  used: { color: colors.success, fontWeight: "700" },
  result: { borderTopColor: "rgba(255,255,255,0.12)", borderTopWidth: 1, paddingTop: 8, gap: 2 },
  strong: { fontWeight: "700" },
  motions: { gap: 6 },
  motion: { borderColor: "rgba(255,255,255,0.12)", borderRadius: 6, borderWidth: 1, padding: 8 },
  motionForm: { gap: 8 },
  input: { backgroundColor: colors.black, borderColor: "rgba(255,255,255,0.15)", borderRadius: 6, borderWidth: 1, color: colors.white, paddingHorizontal: 12, paddingVertical: 10 },
  multiline: { minHeight: 72, textAlignVertical: "top" },
});
