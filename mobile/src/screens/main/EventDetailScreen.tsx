import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../components/Button";
import { AddToCalendarButton } from "../../components/AddToCalendarButton";
import { Card } from "../../components/Card";
import { ContentCard } from "../../components/ContentCard";
import { FormInput } from "../../components/FormInput";
import { ErrorState, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { RichText } from "../../components/RichText";
import { Screen } from "../../components/Screen";
import { StatusBadge } from "../../components/StatusBadge";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import type { ContentTarget } from "../../lib/contentLinks";
import { companionChangeHint, eventBasisLabel, eventOfferSummary, formatCents, ownEventPriceLine, quoteTotal } from "../../lib/eventPrice";
import { formatDateTime, formatStatus, placeParts } from "../../lib/format";
import { internalLabel } from "../../lib/memberArea";
import { getRegistrationState } from "../../lib/registration";
import { isGuestUser } from "../../live";
import type { TournamentStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { ClubEvent, EventRegistration, F1Challenge, NewsPost, Tournament } from "../../types";

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
  // Kosten (#396): wählbare Positionen und der Kostenhaken - wie beim Startgeld am Turnier.
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const [acceptCosts, setAcceptCosts] = useState(false);
  // Teilnehmer (#397): für die Verwaltung ausklappbar; wer gerade eingecheckt wird.
  const [showParticipants, setShowParticipants] = useState(false);
  const [checkingIn, setCheckingIn] = useState("");
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
    setSelectedPositions([]);
    setAcceptCosts(false);
    setShowParticipants(false);
  }, [event?.id]);

  const hasRegistration = Boolean(event?.has_registration || event?.registration_url);
  const registration = useMemo(() => getRegistrationState(event, "Anmeldung"), [event]);
  const registered = event?.own_registration && !["cancelled", "no_show"].includes(String(event.own_registration.status || ""));
  const maxCompanions = event?.allow_companions ? Number(event.max_companions_per_registration || 0) : 0;
  const companionNumber = clampNumber(companionCount, 0, maxCompanions);
  const offer = event?.offer?.enabled ? event.offer : null;
  const seats = 1 + companionNumber;
  const total = offer ? quoteTotal(offer, seats, selectedPositions) : 0;
  const currency = offer?.currency || "EUR";
  const participants = event?.registrations || [];
  const staffView = event?.participant_view === "staff";

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
      await api.post(`/events/${event.id}/registrations`, { companion_count: companionNumber, note: note.trim() || null, selected_positions: selectedPositions });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Event-Anmeldung konnte nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  }, [busy, companionNumber, event, load, note, selectedPositions]);

  // Einchecken (#397): dieselbe Route wie die Verwaltung im Web; ob der Knopf da ist, sagt der Server.
  const checkIn = useCallback(async (entry: EventRegistration) => {
    if (!event || !entry.id || checkingIn) return;
    setCheckingIn(entry.id);
    setError("");
    try {
      await api.patch(`/events/${event.id}/registrations/${entry.id}`, { status: "checked_in" });
      await load();
    } catch (err) {
      setError(errorMessage(err, "Check-in konnte nicht gespeichert werden."));
    } finally {
      setCheckingIn("");
    }
  }, [checkingIn, event, load]);

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
        <ErrorState title="Event nicht gefunden" detail={error || "Dieses Event ist nicht sichtbar oder wurde entfernt."} />
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
            {internalLabel(event) ? <Pill label={internalLabel(event) === "Vorstand" ? "Vorstand" : "Vereinsintern"} tone="gold" /> : null}
            {placeParts(event.location, event.city).length ? <Pill label={placeParts(event.location, event.city).join(", ")} tone="gold" /> : null}
            {event.has_registration ? <Pill label={registered ? "Angemeldet" : "Anmeldung"} /> : null}
          </View>
        </View>

        {error ? <Muted style={styles.error}>{error}</Muted> : null}

        {event.start_date || event.date ? (
          <AddToCalendarButton item={{
            id: event.id, kind: "event", title: event.title || event.name || "Event", start: (event.start_date || event.date) as string, end: event.end_date,
            location: placeParts(event.location, event.city).join(", ") || null, detail: event.event_type || event.type || null,
            url: event.slug ? `https://lionsquad.at/events/${event.slug}` : null,
          }} />
        ) : null}

        {(event.locations?.length || 0) > 1 ? (
          <Card style={styles.card} testID="event-locations">
            <Heading>Standorte</Heading>
            {event.locations!.map((place, index) => (
              <Pressable key={place.key || index} onPress={() => openMap(place.map_query)} disabled={!place.map_query} accessibilityRole="button" style={styles.place}>
                <Muted style={styles.placeIndex}>Standort {index + 1}</Muted>
                {place.name ? <Body style={styles.placeName}>{place.name}</Body> : null}
                {place.start_date ? <Muted>{formatDateTime(place.start_date)}{place.end_date ? ` – ${formatDateTime(place.end_date)}` : ""}</Muted> : null}
                {place.address_line ? <Muted>{place.address_line}</Muted> : null}
                {place.max_participants != null ? <Muted>{place.max_participants} Plätze</Muted> : null}
                {place.note ? <Muted>{place.note}</Muted> : null}
                {place.map_query ? <Muted style={styles.placeLink}>Karte öffnen</Muted> : null}
              </Pressable>
            ))}
          </Card>
        ) : null}

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
            {offer && !event.registration_url ? (
              <View style={styles.feeBox} testID="event-offer">
                <Muted style={styles.feeLabel}>Kosten</Muted>
                <Body style={styles.strong}>{eventOfferSummary(offer, registered ? Number(event.own_registration?.seat_count || 1) : seats)}</Body>
                {offer.positions.filter((position) => !position.optional).map((position) => (
                  <Muted key={position.key}>
                    {position.label}: {formatCents(position.amount_cents, currency)} {eventBasisLabel(position.basis)}{position.description ? ` – ${position.description}` : ""}
                  </Muted>
                ))}
              </View>
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
                {event.own_registration?.price ? (
                  <View style={styles.feeBox} testID="event-own-price">
                    <Body>{ownEventPriceLine(event.own_registration.price)}</Body>
                    {event.own_registration.status === "waitlist" ? <Muted>Bezahlt wird erst, wenn du nachrückst.</Muted> : null}
                    {event.allow_companions && companionChangeHint(event.own_registration.price) ? <Muted>{companionChangeHint(event.own_registration.price)}</Muted> : null}
                  </View>
                ) : event.own_registration?.status === "waitlist" && offer ? (
                  <Muted>Bezahlt wird erst, wenn du nachrückst – dann gilt der Preis von diesem Tag.</Muted>
                ) : null}
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
                {offer?.positions.some((position) => position.optional) ? (
                  <View style={styles.optionGroup}>
                    <Muted style={styles.feeLabel}>Zusätzlich wählbar</Muted>
                    {offer.positions.filter((position) => position.optional).map((position) => {
                      const chosen = selectedPositions.includes(position.key);
                      return (
                        <Pressable
                          key={position.key}
                          onPress={() => setSelectedPositions((current) => (chosen ? current.filter((key) => key !== position.key) : [...current, position.key]))}
                          style={styles.checkRow}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: chosen }}
                          testID={`event-offer-option-${position.key}`}
                        >
                          <View style={[styles.checkbox, chosen && styles.checkboxActive]} />
                          <Body style={styles.flex}>{position.label} <Muted>{formatCents(position.amount_cents, currency)} {eventBasisLabel(position.basis)}</Muted></Body>
                        </Pressable>
                      );
                    })}
                  </View>
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
                {offer ? (
                  <View style={styles.feeBox}>
                    <View style={styles.feeTotalRow}>
                      <Muted>Summe für {seats} Person{seats === 1 ? "" : "en"}</Muted>
                      <Body style={styles.strong} testID="event-quote">{formatCents(total, currency)}</Body>
                    </View>
                    <Pressable
                      onPress={() => setAcceptCosts((current) => !current)}
                      style={styles.checkRow}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: acceptCosts }}
                      testID="event-accept-costs"
                    >
                      <View style={[styles.checkbox, acceptCosts && styles.checkboxActive]} />
                      <View style={styles.flex}>
                        <Body>Ich übernehme die Kosten (Rechnung an mich).</Body>
                        <Muted>Die Rechnung kommt in dein Konto unter „Meine Rechnungen“. Auf der Warteliste wird noch nichts berechnet.</Muted>
                      </View>
                    </Pressable>
                  </View>
                ) : null}
                <Button
                  label={busy ? "Wird angemeldet ..." : offer && total > 0 ? `Verbindlich anmelden · ${formatCents(total, currency)}` : "Zum Event anmelden"}
                  onPress={register}
                  disabled={busy || Boolean(offer && total > 0 && !acceptCosts)}
                  testID="event-register-submit"
                />
              </>
            ) : (
              <Muted>Anmeldung ist aktuell nicht offen.</Muted>
            )}
          </Card>
        ) : null}

        {participants.length && (staffView || event.participant_view === "public") ? (
          <Card style={styles.card} testID="event-participants">
            {staffView ? (
              <>
                <Pressable
                  onPress={() => setShowParticipants((current) => !current)}
                  style={styles.toggleRow}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showParticipants }}
                  testID="event-participants-toggle"
                >
                  <View style={styles.flex}>
                    <Heading>Teilnehmer ({participants.length})</Heading>
                    <Muted>
                      {event.registration_summary?.registered_count || 0} angemeldet
                      {event.registration_summary?.checked_in_count ? ` · ${event.registration_summary.checked_in_count} eingecheckt` : ""}
                      {event.registration_summary?.waitlist_count ? ` · ${event.registration_summary.waitlist_count} Warteliste` : ""}
                      {event.registration_summary?.companion_count ? ` · ${event.registration_summary.companion_count} Begleitp.` : ""}
                    </Muted>
                  </View>
                  <Ionicons name={showParticipants ? "chevron-up" : "chevron-down"} color={colors.muted} size={18} />
                </Pressable>
                {showParticipants ? participants.map((entry) => (
                  <View key={entry.id} style={styles.participantRow} testID={`event-participant-${entry.id}`}>
                    <View style={styles.participantHead}>
                      <Body style={[styles.strong, styles.flex]}>{entry.display_name || "Teilnehmer"}</Body>
                      <StatusBadge label={formatStatus(entry.status)} status={entry.status} />
                    </View>
                    <Muted>
                      {entry.seat_count || 1} Platz/Plätze
                      {entry.companion_count ? ` · ${entry.companion_count} Begleitp.` : ""}
                      {entry.email ? ` · ${entry.email}` : ""}
                    </Muted>
                    {entry.note ? <Muted>Hinweis: {entry.note}</Muted> : null}
                    {entry.internal_note ? <Muted>Intern: {entry.internal_note}</Muted> : null}
                    {event.can_check_in && entry.status === "registered" && entry.id ? (
                      <Button
                        label={checkingIn === entry.id ? "Wird eingecheckt ..." : "Einchecken"}
                        variant="secondary"
                        onPress={() => checkIn(entry)}
                        disabled={Boolean(checkingIn)}
                        testID={`event-checkin-${entry.id}`}
                      />
                    ) : null}
                  </View>
                )) : null}
              </>
            ) : (
              <>
                <Heading>Angemeldet</Heading>
                {participants.slice(0, 12).map((entry) => (
                  <View key={entry.id} style={styles.participantHead}>
                    <Body style={styles.flex}>{entry.display_name || "Teilnehmer"}</Body>
                    <Muted>{entry.seat_count || 1} Platz/Plätze</Muted>
                  </View>
                ))}
                {participants.length > 12 ? <Muted>und {participants.length - 12} weitere</Muted> : null}
              </>
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
              <ContentCard
                key={tournament.id}
                kind="tournament"
                title={tournament.title}
                image={tournament.banner_url || tournament.game?.cover_url || tournament.game?.logo_url}
                date={tournament.start_date}
                phase={tournament.public_phase}
                status={tournament.status}
                description={tournament.description}
                onPress={() => navigation.navigate("TournamentDetail", { id: tournament.slug || tournament.id })}
              />
            ))}
          </Card>
        ) : null}

        {event.f1_challenges?.length ? (
          <Card style={styles.card}>
            <Heading>Fast-Lap Challenges</Heading>
            {event.f1_challenges.map((challenge) => (
              <ContentCard
                key={challenge.id}
                kind="fastlap"
                title={challenge.title}
                image={challenge.banner_url}
                date={challenge.start_date}
                phase={challenge.public_phase}
                status={challenge.status}
                description={challenge.description}
                onPress={() => navigation.navigate("FastLapDetail", { id: challenge.slug || challenge.id })}
              />
            ))}
          </Card>
        ) : null}

        {event.news?.length ? (
          <Card style={styles.card}>
            <Heading>News zum Event</Heading>
            {event.news.map((post) => (
              <ContentCard
                key={post.id}
                kind="news"
                title={post.title}
                image={post.banner_url}
                date={post.published_at || post.created_at}
                description={post.excerpt || post.summary}
                onPress={() => navigation.getParent()?.navigate("More", { screen: "NewsDetail", params: { id: post.slug || post.id } })}
              />
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

/** Karte im System öffnen - mit der Adresse, nicht mit dem Namen des Orts (#204). */
function openMap(query?: string | null) {
  if (!query) return;
  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`).catch(() => {});
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
  place: {
    borderLeftColor: "rgba(159, 122, 234, 0.6)",
    borderLeftWidth: 2,
    gap: 2,
    paddingLeft: 10,
  },
  placeIndex: {
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  placeName: {
    fontWeight: "900",
  },
  placeLink: {
    color: colors.cyan,
    fontWeight: "800",
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
  feeBox: {
    backgroundColor: "rgba(255, 215, 0, 0.06)",
    borderColor: "rgba(255, 215, 0, 0.35)",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  feeLabel: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  feeTotalRow: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  optionGroup: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  checkRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  checkbox: {
    backgroundColor: colors.black,
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    height: 20,
    width: 20,
  },
  checkboxActive: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  toggleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  participantRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 6,
    paddingTop: 10,
  },
  participantHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
});
