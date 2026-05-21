import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { FormInput } from "../../components/FormInput";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { RichText } from "../../components/RichText";
import { Screen } from "../../components/Screen";
import { StatusBadge } from "../../components/StatusBadge";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import type { ContentTarget } from "../../lib/contentLinks";
import { formatDateTime, formatStatus } from "../../lib/format";
import { getRegistrationState } from "../../lib/registration";
import { isGuestUser } from "../../live";
import type { TournamentStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { ClubEvent, F1Challenge, NewsPost, Tournament } from "../../types";

type Props = NativeStackScreenProps<TournamentStackParamList, "EventDetail">;

type EventDetail = ClubEvent & {
  description?: string | null;
  program?: string | null;
  registration_summary?: {
    registered_count?: number;
    waitlist_count?: number;
    checked_in_count?: number;
    companion_count?: number;
    reserved_seats?: number;
    spots_left?: number | null;
    max_participants?: number | null;
  };
  registrations?: Array<{ id: string; display_name?: string; status?: string; companion_count?: number; seat_count?: number }>;
  tournaments?: Tournament[];
  f1_challenges?: F1Challenge[];
  news?: NewsPost[];
  sponsors?: Array<{ id: string; name: string; tier?: string; logo_url?: string | null; url?: string | null; link?: string | null }>;
  albums?: Array<{ id: string; title?: string; cover_url?: string | null; image_url?: string | null }>;
};

export function EventDetailScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [companionCount, setCompanionCount] = useState("0");
  const [note, setNote] = useState("");
  const guest = isGuestUser(user);

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<EventDetail>(`/events/${route.params.id}`);
      setEvent(data || null);
    } catch (err) {
      setError(errorMessage(err, "Event konnte nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [route.params.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setCompanionCount("0");
    setNote("");
  }, [event?.id]);

  const hasRegistration = Boolean(event?.has_registration || event?.registration_url);
  const registration = useMemo(() => getRegistrationState(event, "Anmeldung"), [event]);
  const registered = event?.own_registration && !["cancelled", "no_show"].includes(String(event.own_registration.status || ""));
  const maxCompanions = event?.allow_companions ? Number(event.max_companions_per_registration || 0) : 0;
  const companionNumber = clampNumber(companionCount, 0, maxCompanions);

  const openContentTarget = useCallback((target: ContentTarget) => {
    if (target.type === "event") {
      navigation.navigate("EventDetail", { id: target.id });
      return;
    }
    if (target.type === "tournament") {
      navigation.navigate("TournamentDetail", { id: target.id });
      return;
    }
    if (target.type === "fastlap") {
      navigation.navigate("FastLapDetail", { id: target.id });
      return;
    }
    if (target.type === "news") {
      navigation.getParent()?.navigate("More", { screen: "NewsDetail", params: { id: target.id } });
      return;
    }
    if (target.type === "team") {
      navigation.getParent()?.navigate("Teams", { screen: "TeamDetail", params: { id: target.id } });
      return;
    }
    navigation.getParent()?.navigate("More", { screen: "PublicProfile", params: { username: target.id } });
  }, [navigation]);

  const register = useCallback(async () => {
    if (!event || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/events/${event.id}/registrations`, { companion_count: companionNumber, note: note.trim() || null });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Event-Anmeldung konnte nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  }, [busy, companionNumber, event, load, note]);

  const openExternalRegistration = useCallback(async () => {
    if (!event?.registration_url) return;
    try {
      await Linking.openURL(event.registration_url);
    } catch {
      setError("Externer Anmeldelink konnte nicht geöffnet werden.");
    }
  }, [event?.registration_url]);

  const unregister = useCallback(async () => {
    if (!event || busy) return;
    Alert.alert("Event abmelden?", "Deine Event-Anmeldung wird storniert.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Abmelden",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          setError("");
          try {
            await api.delete(`/events/${event.slug || event.id}/registrations/me`);
            await load();
          } catch (err) {
            setError(errorMessage(err, "Event-Abmeldung konnte nicht gespeichert werden."));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [busy, event, load]);

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={4} />
      </Screen>
    );
  }

  if (!event) {
    return (
      <Screen>
        <EmptyState title="Event nicht gefunden" detail={error || "Dieses Event ist nicht sichtbar oder wurde entfernt."} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}
      >
        <MediaImage
          uri={event.banner_url}
          style={styles.heroImage}
          fallback={<Ionicons name="calendar-outline" color={colors.cyan} size={42} />}
        />

        <View style={styles.header}>
          <View style={styles.headerMeta}>
            <StatusBadge phase={event.public_phase} status={event.status} />
            <Muted>{formatDateTime(event.start_date || event.date)}</Muted>
          </View>
          <Title>{event.title || event.name || "Event"}</Title>
          <View style={styles.metaRow}>
            <Pill label={event.event_type || event.type || "Event"} />
            {[event.location, event.city].filter(Boolean).join(", ") ? <Pill label={[event.location, event.city].filter(Boolean).join(", ")} tone="gold" /> : null}
            {event.has_registration ? <Pill label={registered ? "Angemeldet" : "Anmeldung"} /> : null}
          </View>
        </View>

        {error ? <Muted style={styles.error}>{error}</Muted> : null}

        {hasRegistration ? (
          <Card style={styles.card}>
            <Heading>{event.registration_url ? "Registrierung" : "Anmeldung"}</Heading>
            <Muted>
              {event.registration_summary?.reserved_seats || event.registration_summary?.registered_count || 0} reserviert
              {event.registration_summary?.registered_count != null ? ` · ${event.registration_summary.registered_count} Anmeldungen` : ""}
              {event.registration_summary?.companion_count ? ` · ${event.registration_summary.companion_count} Begleitp.` : ""}
              {event.registration_summary?.max_participants ? ` · ${event.registration_summary.max_participants} Plätze` : ""}
              {event.registration_summary?.spots_left != null ? ` · ${event.registration_summary.spots_left} frei` : ""}
            </Muted>
            <Muted>{registration.label}</Muted>
            {event.registration_opens_at || event.registration_closes_at ? (
              <Muted>
                {event.registration_opens_at ? `Öffnet: ${formatDateTime(event.registration_opens_at)}` : ""}
                {event.registration_opens_at && event.registration_closes_at ? " · " : ""}
                {event.registration_closes_at ? `Schließt: ${formatDateTime(event.registration_closes_at)}` : ""}
              </Muted>
            ) : null}
            {event.registration_url ? (
              <Button label="Extern anmelden" onPress={openExternalRegistration} />
            ) : registered ? (
              <>
                <Muted style={styles.success}>
                  {formatStatus(event.own_registration?.status)}
                  {event.own_registration?.seat_count ? ` · ${event.own_registration.seat_count} Platz/Plätze` : ""}
                  {event.own_registration?.companion_count ? ` · ${event.own_registration.companion_count} Begleitp.` : ""}
                </Muted>
                <Button label={busy ? "Wird abgemeldet ..." : "Vom Event abmelden"} variant="secondary" onPress={unregister} disabled={busy} />
              </>
            ) : guest ? (
              <Muted>Zum Anmelden bitte mit deinem Account einloggen.</Muted>
            ) : registration.canRegister && event.has_registration ? (
              <>
                {event.allow_companions ? (
                  <>
                    <FormInput
                      label="Begleitpersonen"
                      value={companionCount}
                      keyboardType="number-pad"
                      onChangeText={(value) => setCompanionCount(String(clampNumber(value, 0, maxCompanions)))}
                    />
                    <Muted>Maximal {maxCompanions} Begleitperson(en) pro Anmeldung.</Muted>
                  </>
                ) : null}
                <FormInput
                  label="Hinweis optional"
                  value={note}
                  multiline
                  numberOfLines={3}
                  maxLength={500}
                  style={styles.noteInput}
                  onChangeText={setNote}
                  placeholder="z.B. komme etwas später"
                />
                <Button label={busy ? "Wird angemeldet ..." : "Zum Event anmelden"} onPress={register} disabled={busy} />
              </>
            ) : (
              <Muted>Anmeldung ist aktuell nicht offen.</Muted>
            )}
          </Card>
        ) : null}

        <Card style={styles.card}>
          <Heading>Infos</Heading>
          {event.program || event.description ? <RichText text={event.program || event.description} embeds={event.content_embeds} onOpenContent={openContentTarget} /> : <Muted>Keine weiteren Event-Infos hinterlegt.</Muted>}
        </Card>

        {event.tournaments?.length ? (
          <Card style={styles.card}>
            <Heading>Verknüpfte Turniere</Heading>
            {event.tournaments.map((tournament) => (
              <Pressable key={tournament.id} onPress={() => navigation.navigate("TournamentDetail", { id: tournament.slug || tournament.id })} style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
                <View style={styles.flex}>
                  <Body style={styles.strong}>{tournament.title}</Body>
                  <Muted>{formatDateTime(tournament.start_date)} · {tournament.public_phase?.label || formatStatus(tournament.status)}</Muted>
                </View>
                <Ionicons name="chevron-forward" color={colors.muted} size={18} />
              </Pressable>
            ))}
          </Card>
        ) : null}

        {event.f1_challenges?.length ? (
          <Card style={styles.card}>
            <Heading>Fast-Lap Challenges</Heading>
            {event.f1_challenges.map((challenge) => (
              <Pressable key={challenge.id} onPress={() => navigation.navigate("FastLapDetail", { id: challenge.slug || challenge.id })} style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
                <View style={styles.flex}>
                  <Body style={styles.strong}>{challenge.title}</Body>
                  <Muted>{formatDateTime(challenge.start_date)} · {challenge.public_phase?.label || formatStatus(challenge.status)}</Muted>
                </View>
                <Ionicons name="chevron-forward" color={colors.muted} size={18} />
              </Pressable>
            ))}
          </Card>
        ) : null}

        {event.news?.length ? (
          <Card style={styles.card}>
            <Heading>News zum Event</Heading>
            {event.news.map((post) => (
              <Pressable key={post.id} onPress={() => navigation.getParent()?.navigate("More", { screen: "NewsDetail", params: { id: post.slug || post.id } })} style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
                <View style={styles.flex}>
                  <Body style={styles.strong}>{post.title}</Body>
                  <Muted>{formatDateTime(post.published_at || post.created_at)}</Muted>
                </View>
                <Ionicons name="chevron-forward" color={colors.muted} size={18} />
              </Pressable>
            ))}
          </Card>
        ) : null}

        {event.albums?.length ? (
          <Card style={styles.card}>
            <Heading>Galerie</Heading>
            <View style={styles.albumGrid}>
              {event.albums.map((album) => (
                <View key={album.id} style={styles.albumItem}>
                  <MediaImage uri={album.cover_url || album.image_url} style={styles.albumImage} fallback={<Ionicons name="images-outline" color={colors.cyan} size={24} />} />
                  <Muted numberOfLines={2}>{album.title || "Album"}</Muted>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {event.sponsors?.length ? (
          <Card style={styles.card}>
            <Heading>Sponsoren</Heading>
            <View style={styles.logoGrid}>
              {event.sponsors.map((sponsor) => (
                <Pressable key={sponsor.id} onPress={() => openSponsor(sponsor)} style={({ pressed }) => [styles.logoItem, pressed && styles.pressed]}>
                  <MediaImage uri={sponsor.logo_url} resizeMode="contain" style={styles.logo} fallback={<Body style={styles.logoText}>{sponsor.name.slice(0, 2).toUpperCase()}</Body>} />
                  <Muted numberOfLines={2}>{sponsor.name}</Muted>
                </Pressable>
              ))}
            </View>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Pill({ label, tone = "cyan" }: { label: string; tone?: "cyan" | "gold" }) {
  return (
    <View style={[styles.pill, tone === "gold" && styles.pillGold]}>
      <Muted style={[styles.pillText, tone === "gold" && styles.pillGoldText]}>{label}</Muted>
    </View>
  );
}

function clampNumber(value: string, min: number, max: number) {
  const parsed = Number.parseInt(value || "0", 10);
  if (Number.isNaN(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function openSponsor(sponsor: { url?: string | null; link?: string | null }) {
  const raw = String(sponsor.url || sponsor.link || "").trim();
  if (!raw) return;
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  Linking.openURL(url).catch(() => {});
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 30,
  },
  heroImage: {
    borderWidth: 0,
    height: 220,
    width: "100%",
  },
  header: {
    gap: 10,
    paddingHorizontal: 18,
  },
  headerMeta: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  card: {
    gap: 12,
    marginHorizontal: 18,
  },
  pill: {
    backgroundColor: "rgba(41, 182, 232, 0.12)",
    borderColor: "rgba(41, 182, 232, 0.3)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillGold: {
    backgroundColor: "rgba(240, 180, 41, 0.12)",
    borderColor: "rgba(240, 180, 41, 0.34)",
  },
  pillText: {
    color: colors.cyan,
    fontSize: 12,
    fontWeight: "900",
  },
  pillGoldText: {
    color: colors.gold,
  },
  linkRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 10,
  },
  flex: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  strong: {
    fontWeight: "900",
  },
  success: {
    color: colors.success,
    fontWeight: "900",
  },
  error: {
    color: colors.live,
    marginHorizontal: 18,
  },
  pressed: {
    opacity: 0.72,
  },
  logoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  logoItem: {
    alignItems: "center",
    gap: 6,
    width: 96,
  },
  logo: {
    borderRadius: 8,
    height: 58,
    width: 90,
  },
  logoText: {
    color: colors.cyan,
    fontWeight: "900",
  },
  albumGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  albumItem: {
    gap: 6,
    width: 132,
  },
  albumImage: {
    borderRadius: 8,
    height: 84,
    width: 132,
  },
  noteInput: {
    minHeight: 92,
    textAlignVertical: "top",
  },
});
