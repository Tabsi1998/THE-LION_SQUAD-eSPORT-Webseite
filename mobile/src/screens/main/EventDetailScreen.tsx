import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import { formatDateTime, formatStatus } from "../../lib/format";
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
    spots_left?: number | null;
    max_participants?: number | null;
  };
  registrations?: Array<{ id: string; display_name?: string; status?: string; companion_count?: number }>;
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

  const paragraphs = useMemo(() => splitText(event?.program || event?.description || ""), [event]);
  const registrationOpen = event?.has_registration && event.public_phase?.state === "registration_open";
  const registered = event?.own_registration && !["cancelled", "no_show"].includes(String(event.own_registration.status || ""));

  const register = useCallback(async () => {
    if (!event || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/events/${event.slug || event.id}/registrations`, { companion_count: 0 });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Event-Anmeldung konnte nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  }, [busy, event, load]);

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
        <LoadingState label="Event wird geladen ..." />
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
          <Muted>{event.public_phase?.label || formatStatus(event.status)} · {formatDateTime(event.start_date || event.date)}</Muted>
          <Title>{event.title || event.name || "Event"}</Title>
          <View style={styles.metaRow}>
            <Pill label={event.event_type || event.type || "Event"} />
            {[event.location, event.city].filter(Boolean).join(", ") ? <Pill label={[event.location, event.city].filter(Boolean).join(", ")} tone="gold" /> : null}
            {event.has_registration ? <Pill label={registered ? "Angemeldet" : "Anmeldung"} /> : null}
          </View>
        </View>

        {error ? <Muted style={styles.error}>{error}</Muted> : null}

        {event.has_registration ? (
          <Card style={styles.card}>
            <Heading>Anmeldung</Heading>
            <Muted>
              {event.registration_summary?.registered_count || 0} angemeldet
              {event.registration_summary?.max_participants ? ` · ${event.registration_summary.max_participants} Plaetze` : ""}
              {event.registration_summary?.spots_left != null ? ` · ${event.registration_summary.spots_left} frei` : ""}
            </Muted>
            {registered ? <Muted style={styles.success}>Status: {formatStatus(event.own_registration?.status)}</Muted> : null}
            {guest ? (
              <Muted>Zum Anmelden bitte mit deinem Account einloggen.</Muted>
            ) : registered ? (
              <Button label={busy ? "Wird abgemeldet ..." : "Vom Event abmelden"} variant="secondary" onPress={unregister} disabled={busy} />
            ) : registrationOpen ? (
              <Button label={busy ? "Wird angemeldet ..." : "Zum Event anmelden"} onPress={register} disabled={busy} />
            ) : (
              <Muted>Anmeldung ist aktuell nicht offen.</Muted>
            )}
          </Card>
        ) : null}

        <Card style={styles.card}>
          <Heading>Infos</Heading>
          {paragraphs.length ? paragraphs.map((paragraph, index) => <Body key={`${index}-${paragraph.slice(0, 10)}`}>{paragraph}</Body>) : <Muted>Keine weiteren Event-Infos hinterlegt.</Muted>}
        </Card>

        {event.tournaments?.length ? (
          <Card style={styles.card}>
            <Heading>Verknuepfte Turniere</Heading>
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
              <View key={post.id} style={styles.linkRow}>
                <View style={styles.flex}>
                  <Body style={styles.strong}>{post.title}</Body>
                  <Muted>{formatDateTime(post.published_at || post.created_at)}</Muted>
                </View>
              </View>
            ))}
          </Card>
        ) : null}

        {event.sponsors?.length ? (
          <Card style={styles.card}>
            <Heading>Sponsoren</Heading>
            <View style={styles.logoGrid}>
              {event.sponsors.map((sponsor) => (
                <View key={sponsor.id} style={styles.logoItem}>
                  <MediaImage uri={sponsor.logo_url} resizeMode="contain" style={styles.logo} fallback={<Body style={styles.logoText}>{sponsor.name.slice(0, 2).toUpperCase()}</Body>} />
                  <Muted numberOfLines={2}>{sponsor.name}</Muted>
                </View>
              ))}
            </View>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function splitText(value: string) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\n{2,}|\r\n{2,}/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 24);
}

function Pill({ label, tone = "cyan" }: { label: string; tone?: "cyan" | "gold" }) {
  return (
    <View style={[styles.pill, tone === "gold" && styles.pillGold]}>
      <Muted style={[styles.pillText, tone === "gold" && styles.pillGoldText]}>{label}</Muted>
    </View>
  );
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
});
