import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { AddToCalendarButton } from "../../components/AddToCalendarButton";
import { challengeIsOver } from "../../lib/afterEnd";
import { Card } from "../../components/Card";
import { EmptyState, ErrorState, PartialLoadNotice, SkeletonList, loadProblem, type LoadProblem } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { StatusBadge } from "../../components/StatusBadge";
import { FitTitle } from "../../components/FitTitle";
import { Body, Heading, Muted } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatDateTime } from "../../lib/format";
import { getRegistrationState, hasOnlineRegistration } from "../../lib/registration";
import { colors, radius } from "../../theme";
import type { F1Challenge, F1LeaderboardEntry, F1LeaderboardPayload } from "../../types";
import { attemptsText, entryKey } from "../../lib/fastLapAttempts";
import { parseLapTime, plausibilityText, showLapTime } from "../../lib/laptime";
import { Button } from "../../components/Button";
import { useShareHeader } from "../../components/HeaderActions";
import { sharePage } from "../../lib/share";
import { idSegment } from "../../lib/apiIds";
import { useKeyedLoad } from "../../lib/useKeyedLoad";
import { FriendsAtEventCard } from "../../components/FriendsAtEventCard";
import { isGuestUser } from "../../live";

type Props = {
  route: { params: { id: string } };
  navigation?: {
    setOptions?: (options: { headerRight?: () => React.ReactNode }) => void;
    navigate?: (screen: "PublicProfile", params: { username: string }) => void;
  };
};

type FastLapPage = { challenge: F1Challenge; trackId: string | null; leaderboard: F1LeaderboardPayload | null };
// Treffer der Personensuche (#1584): Kennung, Name, Bild, eine Zeile Zusammenhang - keine Kontoliste mehr.
type DriverHit = { id: string; name: string; avatar_url?: string | null; context?: string; is_club_member?: boolean };
// Nach „Ergebnisse veröffentlicht“ (#1584) ändert nur die Turnierleitung Zeiten - mit Begründung, auf der Website.
const LOCKED_STATUSES = new Set(["results_published", "archived"]);
const SEARCH_DELAY_MS = 250;

export function FastLapDetailScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  // Laden je Kennung (#1000): eine andere Challenge zeigt nie die vorige, verspätete Antworten werden verworfen, ein
  // gescheitertes Nachladen lässt den letzten Stand gekennzeichnet stehen. Die gewählte Strecke gilt nur für diese Kennung.
  const wantedTrack = useRef<{ id: string; track: string | null }>({ id: route.params.id, track: null });
  const fetchChallenge = useCallback(async (id: string): Promise<FastLapPage> => {
    const challengeResult = await api.get<F1Challenge>(`/f1/challenges/${idSegment(id)}`);
    const nextChallenge = challengeResult.data;
    const wanted = wantedTrack.current.id === id ? wantedTrack.current.track : null;
    const trackId = wanted || nextChallenge.tracks?.[0]?.id || null;
    const leaderboardResult = await api.get<F1LeaderboardPayload>(`/f1/challenges/${idSegment(nextChallenge.slug || nextChallenge.id)}/leaderboard`, {
      params: trackId ? { track_id: trackId } : undefined,
    });
    return { challenge: nextChallenge, trackId, leaderboard: leaderboardResult.data };
  }, []);
  const { data: page, loading, error: loadError, problem, stale, reload } = useKeyedLoad(route.params.id, fetchChallenge);
  const challenge = page?.challenge ?? null;
  const leaderboard = page?.leaderboard ?? null;
  const selectedTrackId = page?.trackId ?? null;
  const load = useCallback(async (trackId?: string | null) => {
    wantedTrack.current = { id: route.params.id, track: trackId || null };
    await reload();
  }, [reload, route.params.id]);
  // Teilen oben rechts (#1154): die Adresse der Website - in der App öffnet sie diesen Screen, sonst die Website.
  const share = useMemo(() => (challenge ? () => { void sharePage({ kind: "fastlap", id: String(challenge.slug || challenge.id), title: challenge.title, detail: "Fast Lap", start: challenge.start_date, end: challenge.end_date }); } : null), [challenge]);
  useShareHeader(navigation, share);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [managerSearch, setManagerSearch] = useState("");
  const [driverHits, setDriverHits] = useState<DriverHit[]>([]);
  const [usersProblem, setUsersProblem] = useState<LoadProblem | null>(null);
  const [selectedUser, setSelectedUser] = useState<DriverHit | null>(null);
  const selectedUserId = selectedUser?.id || "";
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

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(activeTrackId);
    setRefreshing(false);
  }, [activeTrackId, load]);

  const best = useMemo(() => leaderboard?.entries?.[0], [leaderboard]);
  const registration = useMemo(() => getRegistrationState(challenge, "Einreichung"), [challenge]);
  const showRegistrationInfo = hasOnlineRegistration(challenge) || challenge?.block_club_member_results || challenge?.allow_club_reference_times !== false;
  const participantCount = challenge?.participant_count || leaderboard?.entries.length || 0;
  const prizes = useMemo(() => formatPrizeItems(challenge?.prize_places, challenge?.prize_pool), [challenge?.prize_places, challenge?.prize_pool]);
  const forceReference = Boolean(challenge?.block_club_member_results && selectedUser?.is_club_member);
  const canEnterTimes = Boolean(challenge?.can_manage_times) && !LOCKED_STATUSES.has(String(challenge?.status || ""));
  const challengeId = challenge?.id || "";

  // Personensuche (#1584): erst ab einem Zeichen, kurz gewartet; scheitert sie, sagt die Karte es.
  useEffect(() => {
    const needle = managerSearch.trim();
    if (!canEnterTimes || !challengeId || !needle) {
      setDriverHits([]);
      setUsersProblem(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.get<DriverHit[]>("/admin/people/search", { params: { purpose: "fastlap", context_id: challengeId, q: needle } })
        .then((result) => {
          if (cancelled) return;
          setDriverHits(Array.isArray(result.data) ? result.data.slice(0, 8) : []);
          setUsersProblem(null);
        })
        .catch((searchError) => {
          if (cancelled) return;
          setDriverHits([]);
          setUsersProblem(loadProblem(searchError));
        });
    }, SEARCH_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [canEnterTimes, challengeId, managerSearch]);

  const saveManagedTime = useCallback(async (timeMs: number, confirmImplausible: boolean) => {
    if (!challenge || !activeTrackId || !selectedUserId) return;
    const penalty = Number(String(penaltyInput || "0").replace(",", ".")) || 0;
    const note = adminNote.trim();
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
        ...(confirmImplausible ? { confirm_implausible: true } : {}),
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
  }, [activeTrackId, adminNote, challenge, forceReference, invalidLap, load, penaltyInput, proofUrl, scoreScope, selectedUserId]);

  const submitManagedTime = useCallback(() => {
    if (!canEnterTimes || !activeTrackId || !selectedUserId || savingTime) return;
    // Ein Parser für Website, App und Server (#1584): „90“ sind 90 Sekunden, Komma geht wie Punkt.
    const timeMs = parseLapTime(timeInput);
    const penalty = Number(String(penaltyInput || "0").replace(",", ".")) || 0;
    if (!timeMs) {
      Alert.alert("Zeit fehlt", "Bitte eine Zeit wie 1:24.587 oder 1:24,587 eintragen.");
      return;
    }
    if ((penalty > 0 || invalidLap) && adminNote.trim().length < 5) {
      Alert.alert("Begründung fehlt", "Bei Strafzeit oder Disqualifikation braucht es eine kurze Begründung.");
      return;
    }
    const question = plausibilityText(timeMs, activeTrack);
    if (question) {
      Alert.alert("Zeit prüfen", question, [
        { text: "Abbrechen", style: "cancel" },
        { text: "Trotzdem speichern", onPress: () => { void saveManagedTime(timeMs, true); } },
      ]);
      return;
    }
    void saveManagedTime(timeMs, false);
  }, [activeTrack, activeTrackId, adminNote, canEnterTimes, invalidLap, penaltyInput, saveManagedTime, savingTime, selectedUserId, timeInput]);

  if (!challenge && loading) {
    return (
      <Screen>
        <SkeletonList count={4} />
      </Screen>
    );
  }

  if (!challenge) {
    return (
      <Screen>
        <ErrorState title="Challenge nicht gefunden" detail={loadError ? errorMessage(loadError, "Fast-Lap Zeiten konnten nicht geladen werden.") : "Diese Challenge ist nicht sichtbar oder wurde entfernt."} problem={problem} onRetry={() => { void load(); }} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); }} tintColor={colors.cyan} />}
      >
        {/* Nachladen gescheitert (#1000): die Zeiten sind ausdrücklich der letzte Stand. */}
        {stale && problem ? <PartialLoadNotice problem={problem} onRetry={() => { void load(activeTrackId); }} testID="fastlap-stale" /> : null}
        <View style={styles.heroWrap}>
          <MediaImage
            uri={activeTrack?.image_url || challenge.banner_url}
            style={styles.hero}
            fallback={<Ionicons name="speedometer-outline" color={colors.gold} size={HERO_ICON_SIZE} />}
          />
          <View style={styles.heroShade} />
          <View style={styles.heroContent} testID="fastlap-hero-content">
            <View style={styles.heroMark}>
              <Ionicons name="speedometer-outline" color={colors.black} size={22} />
            </View>
            <View style={styles.heroText}>
              <StatusBadge phase={challenge.public_phase} status={challenge.status} />
              {/* Umbruch nur zwischen Wörtern (#1867): ohne Silbentrennung; zerreißt Android doch ein Wort, wird die
                  Schrift etwas kleiner, höchstens bis 80 %. */}
              <FitTitle text={challenge.title || ""} minScale={0.8} testID="fastlap-hero-title" />
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
          {/* Nach dem Ende (#1221) kein Kalender-Knopf mehr. */}
          <AddToCalendarButton item={challenge.start_date && !challengeIsOver(challenge) ? {
            id: challenge.id, kind: "fastlap", title: challenge.title, start: challenge.start_date, end: challenge.end_date,
            detail: [challenge.vehicle, challenge.platform].filter(Boolean).join(" · ") || null,
            url: challenge.slug ? `https://lionsquad.at/fastlap/${challenge.slug}` : null,
          } : null} />
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

        {/* Freunde bei der Fast Lap (#1188 Teil 2): „dabei“ heißt hier eine gültige Zeit - eine eigene Anmeldung gibt es nicht. */}
        <FriendsAtEventCard
          path={`/f1/challenges/${challenge.slug || challenge.id}/friends`}
          scope="fastlap"
          signedIn={Boolean(user) && !isGuestUser(user)}
          over={challengeIsOver(challenge)}
          onOpenProfile={navigation?.navigate ? (username) => navigation.navigate?.("PublicProfile", { username }) : undefined}
        />

        {prizes.length ? (
          <Card style={styles.infoCard}>
            <Heading>Preise</Heading>
            {prizes.map((prize) => <PrizeRow key={prize} text={prize} />)}
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

        {challenge.can_manage_times && !canEnterTimes ? (
          <Card style={styles.managerCard} testID="fastlap-locked">
            <Heading>Ergebnisse veröffentlicht</Heading>
            <Muted>Die Zeiten sind gesperrt. Ändern geht nur noch durch die Turnierleitung mit Begründung, in der Verwaltung auf der Website.</Muted>
          </Card>
        ) : null}

        {canEnterTimes ? (
          <Card style={styles.managerCard}>
            <Heading>Zeit eintragen</Heading>
            <Muted>Für Admins und Fast-Lap-Team. Zeiten werden für die aktuell gewählte Strecke gespeichert.</Muted>
            {usersProblem ? <PartialLoadNotice problem={usersProblem} onRetry={() => { void load(activeTrackId); }} testID="fastlap-users-partial" /> : null}
            <TextInput
              value={managerSearch}
              onChangeText={setManagerSearch}
              placeholder="Fahrer suchen ..."
              placeholderTextColor={colors.muted}
              style={styles.input}
              testID="fastlap-driver-search"
            />
            <View style={styles.userGrid}>
              {(selectedUser && !driverHits.some((hit) => hit.id === selectedUser.id) ? [selectedUser, ...driverHits] : driverHits).map((candidate) => (
                <Pressable
                  key={candidate.id}
                  onPress={() => {
                    setSelectedUser(candidate);
                    if (challenge.block_club_member_results && candidate.is_club_member) setScoreScope("club_reference");
                  }}
                  style={[styles.userChoice, selectedUserId === candidate.id && styles.userChoiceActive]}
                >
                  <Body style={styles.strong}>{candidate.name || "Fahrer"}</Body>
                  {candidate.context ? <Muted>{candidate.context}</Muted> : null}
                </Pressable>
              ))}
            </View>
            <View style={styles.inputGrid}>
              <TextInput value={timeInput} onChangeText={setTimeInput} placeholder="Zeit z.B. 1:24,587" placeholderTextColor={colors.muted} style={styles.input} keyboardType="numbers-and-punctuation" testID="fastlap-time-input" />
              <TextInput value={penaltyInput} onChangeText={setPenaltyInput} placeholder="Strafe Sekunden" placeholderTextColor={colors.muted} style={styles.input} keyboardType="numeric" />
            </View>
            <TextInput value={proofUrl} onChangeText={setProofUrl} placeholder="Proof URL optional" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="none" />
            <TextInput value={adminNote} onChangeText={setAdminNote} placeholder={invalidLap || Number(penaltyInput) > 0 ? "Begründung Pflicht" : "Notiz optional"} placeholderTextColor={colors.muted} style={[styles.input, styles.noteInput]} multiline />
            <View style={styles.metaRow}>
              <TogglePill label="Offizielle Wertung" active={!forceReference && scoreScope === "official"} disabled={forceReference} onPress={() => setScoreScope("official")} />
              <TogglePill label="Vereins-Referenz" active={forceReference || scoreScope === "club_reference"} onPress={() => setScoreScope("club_reference")} />
              <TogglePill label="Disqualifiziert" active={invalidLap} tone="danger" onPress={() => setInvalidLap((current) => !current)} />
            </View>
            {forceReference ? <Muted style={styles.warning}>Vereinsmitglied: laut Challenge-Regel nur als Referenzzeit.</Muted> : null}
            <Button label={savingTime ? "Speichert ..." : "Zeit speichern"} arrow={false} disabled={!selectedUserId || !timeInput.trim()} busy={savingTime} onPress={submitManagedTime} />
          </Card>
        ) : null}

        {best ? (
          <Card style={styles.bestCard}>
            <View style={styles.bestIcon}>
              <Ionicons name="trophy-outline" color={colors.gold} size={22} />
            </View>
            <View style={styles.bestText}>
              <Muted>Bestzeit</Muted>
              <Body style={styles.bestTime}>{showLapTime(best.time_str) || "-"}</Body>
              <Body style={styles.strong}>{best.display_name || best.username || "Fahrer"}</Body>
              <Muted>{attemptsText(best.attempts, leaderboard?.max_attempts)} · {showLapTime(best.gap_str) || "Führung"}</Muted>
            </View>
          </Card>
        ) : null}

        <View style={styles.section}>
          <Heading>Leaderboard</Heading>
          {error ? <Muted style={styles.error}>{error}</Muted> : null}
          {leaderboard?.entries?.length ? (
            leaderboard.entries.map((entry) => <EntryRow key={`${entryKey(entry)}-${entry.rank}`} entry={entry} maxAttempts={leaderboard.max_attempts} />)
          ) : (
            <EmptyState title="Noch keine Zeiten" detail="Sobald Zeiten eingetragen sind, stehen sie hier pro Strecke." />
          )}
        </View>

        {leaderboard?.club_reference_entries?.length ? (
          <View style={styles.section}>
            <Heading>Vereins-Referenzzeiten</Heading>
            {leaderboard.club_reference_entries.map((entry) => <EntryRow key={`ref-${entryKey(entry)}-${entry.rank}`} entry={entry} maxAttempts={leaderboard.max_attempts} reference />)}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function EntryRow({ entry, maxAttempts, reference = false }: { entry: F1LeaderboardEntry; maxAttempts?: number | null; reference?: boolean }) {
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
        <Muted>{entry.is_guest ? "Gast · " : ""}{attemptsText(entry.attempts, maxAttempts)}{entry.penalty_seconds ? ` · +${entry.penalty_seconds}s Penalty` : ""}</Muted>
      </View>
      <View style={styles.timeBox}>
        <Body style={styles.time}>{showLapTime(entry.time_str) || "-"}</Body>
        <Muted>{showLapTime(entry.gap_str)}</Muted>
      </View>
    </Card>
  );
}

function PrizeRow({ text }: { text: string }) {
  return (
    <View style={styles.prizeRow}>
      <Ionicons name="trophy-outline" color={colors.gold} size={17} />
      <Body style={styles.prizeText}>{text}</Body>
    </View>
  );
}

function formatPrizeItems(prizePlaces?: F1Challenge["prize_places"], prizePool?: string | null) {
  const rows = (prizePlaces || [])
    .map((place) => {
      const group = prizeGroupLabel(place.group);
      const placeLabel = place.label || (place.place ? `${place.place}. Platz` : "Preis");
      const value = String(place.value || "").trim();
      if (!value) return "";
      return [group, `${placeLabel}: ${value}`].filter(Boolean).join(" - ");
    })
    .filter(Boolean);
  if (prizePool) rows.push(`Preispool: ${prizePool}`);
  return rows;
}

function prizeGroupLabel(group?: string | null) {
  if (!group || group === "overall") return "";
  if (group === "championship") return "Gesamtwertung";
  if (group === "track") return "Pro Strecke";
  if (group === "winner") return "Gewinner-Bracket";
  if (group === "loser") return "Loser-Bracket";
  if (group === "special") return "Sonderpreis";
  return group;
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

const HERO_PAD = 18;
const HERO_ICON_SIZE = 42;

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 28,
  },
  // Kopf (#1868): Bild und Schatten füllen ihn, der Inhalt steht im Fluss am unteren Rand. Darüber bleibt ein freier
  // Streifen, in dem ohne Banner das Tacho-Symbol sitzt - ein langer Titel lässt den Kopf wachsen, statt das Symbol
  // über das Abzeichen zu legen.
  heroWrap: {
    justifyContent: "flex-end",
    minHeight: 250,
  },
  hero: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    borderWidth: 0,
    justifyContent: "flex-start",
    paddingTop: HERO_PAD,
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
    flexDirection: "row",
    gap: 12,
    padding: HERO_PAD,
    paddingTop: HERO_PAD + HERO_ICON_SIZE + 12,
  },
  heroMark: {
    alignItems: "center",
    backgroundColor: colors.gold,
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
  prizeRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 9,
  },
  prizeText: {
    flex: 1,
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
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
