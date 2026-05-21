import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, ErrorState, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { StatusBadge } from "../../components/StatusBadge";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatDateTime } from "../../lib/format";
import { getRegistrationState, hasOnlineRegistration } from "../../lib/registration";
import { colors } from "../../theme";
import type { F1Challenge, F1LeaderboardEntry, F1LeaderboardPayload, PublicUser } from "../../types";

type Props = { route: { params: { id: string } } };

export function FastLapDetailScreen({ route }: Props) {
  const { user } = useAuth();
  const [challenge, setChallenge] = useState<F1Challenge | null>(null);
  const [leaderboard, setLeaderboard] = useState<F1LeaderboardPayload | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [managerUsers, setManagerUsers] = useState<PublicUser[]>([]);
  const [managerSearch, setManagerSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [timeInput, setTimeInput] = useState("");
  const [penaltyInput, setPenaltyInput] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [scoreScope, setScoreScope] = useState<"official" | "club_reference">("official");
  const [invalidLap, setInvalidLap] = useState(false);
  const [savingTime, setSavingTime] = useState(false);

  const tracks = challenge?.tracks || [];
  const activeTrackId = selectedTrackId || tracks[0]?.id || null;
  const activeTrack = tracks.find((track) => track.id === activeTrackId) || leaderboard?.track || tracks[0] || null;

  const load = useCallback(async (trackId?: string | null) => {
    setError("");
    try {
      const challengeResult = await api.get<F1Challenge>(`/f1/challenges/${route.params.id}`);
      const nextChallenge = challengeResult.data;
      const nextTrackId = trackId || nextChallenge.tracks?.[0]?.id || null;
      setChallenge(nextChallenge);
      setSelectedTrackId(nextTrackId);

      const leaderboardResult = await api.get<F1LeaderboardPayload>(`/f1/challenges/${nextChallenge.slug || nextChallenge.id}/leaderboard`, {
        params: nextTrackId ? { track_id: nextTrackId } : undefined,
      });
      setLeaderboard(leaderboardResult.data);
      if (nextChallenge.can_manage_times) {
        const usersResult = await api.get<PublicUser[]>(`/f1/challenges/${nextChallenge.id}/assignable-users`).catch(() => ({ data: [] as PublicUser[] }));
        setManagerUsers(Array.isArray(usersResult.data) ? usersResult.data : []);
      } else {
        setManagerUsers([]);
      }
    } catch (err) {
      setError(errorMessage(err, "Fast-Lap Zeiten konnten nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [route.params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const best = useMemo(() => leaderboard?.entries?.[0], [leaderboard]);
  const registration = useMemo(() => getRegistrationState(challenge, "Einreichung"), [challenge]);
  const showRegistrationInfo = hasOnlineRegistration(challenge) || challenge?.block_club_member_results || challenge?.allow_club_reference_times !== false;
  const participantCount = challenge?.participant_count || leaderboard?.entries.length || 0;
  const selectedUser = managerUsers.find((item) => item.id === selectedUserId);
  const forceReference = Boolean(challenge?.block_club_member_results && selectedUser?.is_club_member);
  const filteredManagerUsers = useMemo(() => {
    const q = managerSearch.trim().toLowerCase();
    const source = q
      ? managerUsers.filter((item) => `${item.display_name || ""} ${item.username || ""}`.toLowerCase().includes(q))
      : managerUsers;
    return source.slice(0, 8);
  }, [managerSearch, managerUsers]);

  const submitManagedTime = useCallback(async () => {
    if (!challenge?.can_manage_times || !activeTrackId || !selectedUserId || savingTime) return;
    const timeMs = parseLapTime(timeInput);
    const penalty = Number(String(penaltyInput || "0").replace(",", ".")) || 0;
    const note = adminNote.trim();
    if (!timeMs) {
      Alert.alert("Zeit fehlt", "Bitte eine Zeit im Format m:ss.SSS oder Millisekunden eintragen.");
      return;
    }
    if ((penalty > 0 || invalidLap) && note.length < 5) {
      Alert.alert("Begruendung fehlt", "Bei Strafzeit oder Disqualifikation braucht es eine kurze Begruendung.");
      return;
    }
    setSavingTime(true);
    setError("");
    try {
      await api.post(`/f1/challenges/${challenge.id}/times`, {
        user_id: selectedUserId,
        track_id: activeTrackId,
        time_ms: timeMs,
        penalty_seconds: penalty,
        proof_url: proofUrl.trim() || null,
        admin_note: note || null,
        is_invalid: invalidLap,
        score_scope: forceReference ? "club_reference" : scoreScope,
      });
      setTimeInput("");
      setPenaltyInput("");
      setProofUrl("");
      setAdminNote("");
      setInvalidLap(false);
      await load(activeTrackId);
    } catch (err) {
      setError(errorMessage(err, "Zeit konnte nicht gespeichert werden."));
    } finally {
      setSavingTime(false);
    }
  }, [activeTrackId, adminNote, challenge, forceReference, invalidLap, load, penaltyInput, proofUrl, savingTime, scoreScope, selectedUserId, timeInput]);

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={4} />
      </Screen>
    );
  }

  if (!challenge) {
    return (
      <Screen>
        <ErrorState title="Challenge nicht gefunden" detail={error || "Diese Challenge ist nicht sichtbar oder wurde entfernt."} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(activeTrackId); }} tintColor={colors.cyan} />}
      >
        <View style={styles.heroWrap}>
          <MediaImage
            uri={challenge.banner_url}
            style={styles.hero}
            fallback={<Ionicons name="speedometer-outline" color={colors.gold} size={42} />}
          />
          <View style={styles.heroShade} />
          <View style={styles.heroContent}>
            <View style={styles.heroMark}>
              <Ionicons name="speedometer-outline" color={colors.black} size={22} />
            </View>
            <View style={styles.heroText}>
              <StatusBadge phase={challenge.public_phase} status={challenge.status} />
              <Title>{challenge.title}</Title>
              <Muted>{formatDate(challenge.start_date)}</Muted>
            </View>
          </View>
        </View>

        <View style={styles.header}>
          {challenge.description ? <Body>{stripText(challenge.description)}</Body> : <Muted>Keine Beschreibung hinterlegt.</Muted>}
          <View style={styles.metaRow}>
            {challenge.vehicle ? <Pill label={challenge.vehicle} /> : null}
            {challenge.platform ? <Pill label={challenge.platform} /> : null}
            {challenge.weather ? <Pill label={challenge.weather} /> : null}
            <Pill label={`${participantCount} Fahrer`} tone="gold" />
          </View>
          <View style={styles.statGrid}>
            <Stat icon="map-outline" label="Strecken" value={tracks.length || challenge.track_count || 0} />
            <Stat icon="people-outline" label="Fahrer" value={participantCount} tone="gold" />
            <Stat icon="timer-outline" label="Zeiten" value={leaderboard?.entries.length || 0} />
          </View>
        </View>

        {showRegistrationInfo ? (
          <Card style={styles.infoCard}>
            <Heading>Einreichung</Heading>
            {hasOnlineRegistration(challenge) ? (
              <>
                <Muted>{registration.label}</Muted>
                {challenge.registration_open_from || challenge.registration_open_until ? (
                  <Muted>
                    {challenge.registration_open_from ? `Öffnet: ${formatDateTime(challenge.registration_open_from)}` : ""}
                    {challenge.registration_open_from && challenge.registration_open_until ? " · " : ""}
                    {challenge.registration_open_until ? `Endet: ${formatDateTime(challenge.registration_open_until)}` : ""}
                  </Muted>
                ) : null}
              </>
            ) : (
              <Muted>Zeiten werden aktuell durch Admins oder Moderatoren eingetragen.</Muted>
            )}
            {challenge.block_club_member_results ? (
              <Muted style={styles.warning}>
                {user?.is_club_member
                  ? "Als Vereinsmitglied wirst du in dieser Challenge als Referenzzeit außer Wertung geführt."
                  : "Diese Challenge ist für externe Fahrer gewertet. Vereinsmitglieder erscheinen als Referenzzeiten außer Wertung."}
              </Muted>
            ) : challenge.allow_club_reference_times !== false ? (
              <Muted>Vereins-Referenzzeiten sind separat möglich und zählen nicht zur offiziellen Rangliste.</Muted>
            ) : null}
            {challenge.show_club_reference_times === false ? <Muted>Referenzzeiten sind aktuell nur intern sichtbar.</Muted> : null}
          </Card>
        ) : null}

        <View style={styles.section}>
          <Heading>Strecken</Heading>
          {tracks.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
              {tracks.map((track) => (
                <Pressable
                  key={track.id}
                  onPress={() => load(track.id)}
                  style={({ pressed }) => [styles.tab, activeTrackId === track.id && styles.tabActive, pressed && styles.pressed]}
                >
                  <Muted style={[styles.tabText, activeTrackId === track.id && styles.tabTextActive]}>{track.name || "Strecke"}</Muted>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Muted>Keine Strecken hinterlegt.</Muted>
          )}
        </View>

        {activeTrack ? (
          <Card style={styles.trackCard}>
            <MediaImage
              uri={activeTrack.image_url || challenge.banner_url}
              style={styles.trackImage}
              fallback={<Ionicons name="map-outline" color={colors.gold} size={30} />}
            />
            <View style={styles.trackBody}>
              <View style={styles.trackTitleRow}>
                <View style={styles.trackIcon}>
                  <Ionicons name="map-outline" color={colors.black} size={18} />
                </View>
                <View style={styles.trackTitle}>
                  <Muted>Aktuelle Strecke</Muted>
                  <Heading>{activeTrack.name || "Strecke"}</Heading>
                </View>
              </View>
              <View style={styles.metaRow}>
                {activeTrack.country ? <Pill label={activeTrack.country} /> : null}
                {challenge.vehicle ? <Pill label={challenge.vehicle} /> : null}
                {challenge.weather ? <Pill label={challenge.weather} tone="gold" /> : null}
              </View>
            </View>
          </Card>
        ) : null}

        {challenge.can_manage_times ? (
          <Card style={styles.managerCard}>
            <Heading>Zeit eintragen</Heading>
            <Muted>Fuer Admins und Fast-Lap-Team. Zeiten werden fuer die aktuell gewaehlte Strecke gespeichert.</Muted>
            <TextInput
              value={managerSearch}
              onChangeText={setManagerSearch}
              placeholder="Fahrer suchen ..."
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <View style={styles.userGrid}>
              {filteredManagerUsers.map((candidate) => (
                <Pressable
                  key={candidate.id}
                  onPress={() => {
                    setSelectedUserId(candidate.id);
                    if (challenge.block_club_member_results && candidate.is_club_member) setScoreScope("club_reference");
                  }}
                  style={[styles.userChoice, selectedUserId === candidate.id && styles.userChoiceActive]}
                >
                  <Body style={styles.strong}>{candidate.display_name || candidate.username || "Fahrer"}</Body>
                  {candidate.username ? <Muted>@{candidate.username}</Muted> : null}
                </Pressable>
              ))}
            </View>
            <View style={styles.inputGrid}>
              <TextInput value={timeInput} onChangeText={setTimeInput} placeholder="Zeit z.B. 1:24.587" placeholderTextColor={colors.muted} style={styles.input} keyboardType="numbers-and-punctuation" />
              <TextInput value={penaltyInput} onChangeText={setPenaltyInput} placeholder="Strafe Sekunden" placeholderTextColor={colors.muted} style={styles.input} keyboardType="numeric" />
            </View>
            <TextInput value={proofUrl} onChangeText={setProofUrl} placeholder="Proof URL optional" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="none" />
            <TextInput value={adminNote} onChangeText={setAdminNote} placeholder={invalidLap || Number(penaltyInput) > 0 ? "Begruendung Pflicht" : "Notiz optional"} placeholderTextColor={colors.muted} style={[styles.input, styles.noteInput]} multiline />
            <View style={styles.metaRow}>
              <TogglePill label="Offizielle Wertung" active={!forceReference && scoreScope === "official"} disabled={forceReference} onPress={() => setScoreScope("official")} />
              <TogglePill label="Vereins-Referenz" active={forceReference || scoreScope === "club_reference"} onPress={() => setScoreScope("club_reference")} />
              <TogglePill label="Disqualifiziert" active={invalidLap} tone="danger" onPress={() => setInvalidLap((current) => !current)} />
            </View>
            {forceReference ? <Muted style={styles.warning}>Vereinsmitglied: laut Challenge-Regel nur als Referenzzeit.</Muted> : null}
            <Pressable disabled={savingTime || !selectedUserId || !timeInput.trim()} onPress={submitManagedTime} style={[styles.saveButton, (savingTime || !selectedUserId || !timeInput.trim()) && styles.disabled]}>
              <Body style={styles.saveButtonText}>{savingTime ? "Speichert ..." : "Zeit speichern"}</Body>
            </Pressable>
          </Card>
        ) : null}

        {best ? (
          <Card style={styles.bestCard}>
            <View style={styles.bestIcon}>
              <Ionicons name="trophy-outline" color={colors.gold} size={22} />
            </View>
            <View style={styles.bestText}>
              <Muted>Bestzeit</Muted>
              <Body style={styles.bestTime}>{best.time_str || "-"}</Body>
              <Body style={styles.strong}>{best.display_name || best.username || "Fahrer"}</Body>
              <Muted>{best.attempts || 0} Versuche · {best.gap_str || "Führung"}</Muted>
            </View>
          </Card>
        ) : null}

        <View style={styles.section}>
          <Heading>Leaderboard</Heading>
          {error ? <Muted style={styles.error}>{error}</Muted> : null}
          {leaderboard?.entries?.length ? (
            leaderboard.entries.map((entry) => <EntryRow key={`${entry.user_id}-${entry.rank}`} entry={entry} />)
          ) : (
            <EmptyState title="Noch keine Zeiten" detail="Sobald Zeiten eingetragen sind, stehen sie hier pro Strecke." />
          )}
        </View>

        {leaderboard?.club_reference_entries?.length ? (
          <View style={styles.section}>
            <Heading>Vereins-Referenzzeiten</Heading>
            {leaderboard.club_reference_entries.map((entry) => <EntryRow key={`ref-${entry.user_id}-${entry.rank}`} entry={entry} reference />)}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function EntryRow({ entry, reference = false }: { entry: F1LeaderboardEntry; reference?: boolean }) {
  return (
    <Card style={[styles.entry, reference && styles.referenceEntry]}>
      <View style={styles.rankBox}>
        {Number(entry.rank || 0) <= 3 && entry.rank ? (
          <Ionicons name="medal-outline" color={colors.gold} size={20} />
        ) : null}
        <Body style={[styles.rank, Number(entry.rank || 0) <= 3 && entry.rank ? styles.gold : null]}>{entry.rank ? `#${entry.rank}` : "-"}</Body>
      </View>
      <View style={styles.entryText}>
        <Body style={styles.strong}>{entry.display_name || entry.username || "Fahrer"}</Body>
        <Muted>{entry.attempts || 0} Versuche{entry.penalty_seconds ? ` · +${entry.penalty_seconds}s Penalty` : ""}</Muted>
      </View>
      <View style={styles.timeBox}>
        <Body style={styles.time}>{entry.time_str || "-"}</Body>
        <Muted>{entry.gap_str || ""}</Muted>
      </View>
    </Card>
  );
}

function Pill({ label, tone = "cyan" }: { label: string; tone?: "cyan" | "gold" }) {
  return (
    <View style={[styles.pill, tone === "gold" && styles.pillGold]}>
      <Muted style={[styles.pillText, tone === "gold" && styles.pillGoldText]}>{label}</Muted>
    </View>
  );
}

function TogglePill({ label, active, onPress, disabled = false, tone = "cyan" }: { label: string; active: boolean; onPress: () => void; disabled?: boolean; tone?: "cyan" | "danger" }) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.togglePill, active && styles.togglePillActive, active && tone === "danger" && styles.togglePillDanger, disabled && styles.disabled]}
    >
      <Muted style={[styles.togglePillText, active && styles.togglePillTextActive]}>{label}</Muted>
    </Pressable>
  );
}

function Stat({ icon, label, value, tone = "cyan" }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: number; tone?: "cyan" | "gold" }) {
  return (
    <Card style={styles.stat}>
      <Ionicons name={icon} color={tone === "gold" ? colors.gold : colors.cyan} size={18} />
      <Body style={[styles.statValue, tone === "gold" && styles.gold]}>{value}</Body>
      <Muted>{label}</Muted>
    </Card>
  );
}

function stripText(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseLapTime(value: string) {
  const cleaned = value.trim().replace(",", ".");
  if (!cleaned) return null;
  if (/^\d+$/.test(cleaned)) return Number(cleaned);
  const match = cleaned.match(/^(?:(\d+):)?(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const minutes = Number(match[1] || 0);
  const seconds = Number(match[2] || 0);
  const millis = Number((match[3] || "0").padEnd(3, "0"));
  if (seconds >= 60) return null;
  return minutes * 60000 + seconds * 1000 + millis;
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 28,
  },
  heroWrap: {
    minHeight: 250,
  },
  hero: {
    borderWidth: 0,
    height: 250,
    width: "100%",
  },
  heroShade: {
    backgroundColor: "rgba(0,0,0,0.45)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  heroContent: {
    alignItems: "flex-end",
    bottom: 18,
    flexDirection: "row",
    gap: 12,
    left: 18,
    position: "absolute",
    right: 18,
  },
  heroMark: {
    alignItems: "center",
    backgroundColor: colors.gold,
    borderRadius: 10,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  heroText: {
    flex: 1,
    gap: 3,
  },
  header: {
    gap: 10,
    paddingHorizontal: 18,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statGrid: {
    flexDirection: "row",
    gap: 10,
  },
  stat: {
    flex: 1,
    gap: 3,
    minHeight: 88,
  },
  statValue: {
    color: colors.cyan,
    fontSize: 20,
    fontWeight: "900",
  },
  section: {
    gap: 10,
    paddingHorizontal: 18,
  },
  tabs: {
    gap: 8,
    paddingRight: 18,
  },
  tab: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: "rgba(240, 180, 41, 0.15)",
    borderColor: "rgba(240, 180, 41, 0.38)",
  },
  tabText: {
    fontWeight: "900",
  },
  tabTextActive: {
    color: colors.gold,
  },
  trackCard: {
    gap: 0,
    marginHorizontal: 18,
    overflow: "hidden",
    padding: 0,
  },
  trackImage: {
    borderWidth: 0,
    height: 154,
    width: "100%",
  },
  trackBody: {
    gap: 10,
    padding: 14,
  },
  trackTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  trackIcon: {
    alignItems: "center",
    backgroundColor: colors.gold,
    borderRadius: 9,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  trackTitle: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  bestCard: {
    alignItems: "center",
    borderColor: "rgba(255,215,0,0.35)",
    flexDirection: "row",
    gap: 12,
    marginHorizontal: 18,
  },
  bestIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255,215,0,0.12)",
    borderColor: "rgba(255,215,0,0.32)",
    borderRadius: 10,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  bestText: {
    flex: 1,
    gap: 3,
  },
  infoCard: {
    gap: 8,
    marginHorizontal: 18,
  },
  input: {
    backgroundColor: colors.black,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.white,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputGrid: {
    gap: 10,
  },
  managerCard: {
    gap: 10,
    marginHorizontal: 18,
  },
  warning: {
    color: colors.gold,
    fontWeight: "800",
  },
  bestTime: {
    color: colors.gold,
    fontSize: 30,
    fontWeight: "900",
  },
  entry: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  referenceEntry: {
    borderColor: "rgba(240, 180, 41, 0.34)",
  },
  rankBox: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    width: 52,
  },
  rank: {
    color: colors.cyan,
    fontSize: 18,
    fontWeight: "900",
  },
  entryText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  timeBox: {
    alignItems: "flex-end",
    minWidth: 82,
  },
  time: {
    fontWeight: "900",
  },
  strong: {
    fontWeight: "900",
  },
  gold: {
    color: colors.gold,
  },
  pill: {
    backgroundColor: "rgba(41, 182, 232, 0.12)",
    borderColor: "rgba(41, 182, 232, 0.28)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillGold: {
    backgroundColor: "rgba(240, 180, 41, 0.12)",
    borderColor: "rgba(240, 180, 41, 0.32)",
  },
  pillText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "900",
  },
  pillGoldText: {
    color: colors.gold,
  },
  noteInput: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: colors.cyan,
    borderRadius: 8,
    minHeight: 46,
    justifyContent: "center",
  },
  saveButtonText: {
    color: colors.black,
    fontWeight: "900",
  },
  togglePill: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  togglePillActive: {
    backgroundColor: "rgba(41,182,232,0.16)",
    borderColor: "rgba(41,182,232,0.42)",
  },
  togglePillDanger: {
    backgroundColor: "rgba(255,59,48,0.16)",
    borderColor: "rgba(255,59,48,0.42)",
  },
  togglePillText: {
    fontWeight: "900",
  },
  togglePillTextActive: {
    color: colors.white,
  },
  userChoice: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  userChoiceActive: {
    backgroundColor: "rgba(41,182,232,0.14)",
    borderColor: "rgba(41,182,232,0.4)",
  },
  userGrid: {
    gap: 8,
  },
  disabled: {
    opacity: 0.5,
  },
  error: {
    color: colors.live,
  },
  pressed: {
    opacity: 0.72,
  },
});
