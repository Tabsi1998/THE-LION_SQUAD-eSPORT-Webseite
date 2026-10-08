import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { seasonScrollProps } from "../../seasons/sky/scroll";
import { StatusBadge } from "../../components/StatusBadge";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import type { ContentTarget } from "../../lib/contentLinks";
import { openLink } from "../../lib/openLink";
import { companionChangeHint, eventBasisLabel, eventOfferSummary, formatCents, ownEventPriceLine, quoteTotal } from "../../lib/eventPrice";
import { eventDayItems, scheduleLine } from "../../lib/eventDays";
import { eventIsOver } from "../../lib/afterEnd";
import { formatDateTime, formatEventType, formatStatus, placeParts } from "../../lib/format";
import { HIGHLIGHT_ICONS, eventFacts, stripHeadingEmoji, visibilityChip, whatsOnRows } from "../../lib/eventPage";
import { WEB_BASE_URL } from "../../lib/siteUrls";
import { internalLabel } from "../../lib/memberArea";
import { getRegistrationState } from "../../lib/registration";
import { isGuestUser } from "../../live";
import { openSignIn } from "../../navigation/rootNavigation";
import type { TournamentStackParamList } from "../../navigation/types";
import { colors, kindColors, radius } from "../../theme";
import type { ClubEvent, EventRegistration, F1Challenge, NewsPost, Tournament } from "../../types";

// Einzahl und Mehrzahl (#1223): „1 Platz“, „2 Plätze“, „1 Begleitperson“, „2 Begleitpersonen“.
function placesLabel(count: number): string {
  return `${count} ${count === 1 ? "Platz" : "Plätze"}`;
}

function companionsLabel(count: number): string {
  return `${count} ${count === 1 ? "Begleitperson" : "Begleitpersonen"}`;
}

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
  const over = event ? eventIsOver(event) : false;
  const rows = useMemo(() => whatsOnRows(event), [event]);
  const facts = useMemo(() => eventFacts(event), [event]);
  const banner = event?.banner || (event?.banner_url ? { url: event.banner_url, kind: "photo" as const } : null);
  // „Anmelden“ im Fakten-Kasten springt zu „Dein Event“.
  const scrollRef = useRef<ScrollView>(null);
  const [yoursY, setYoursY] = useState(0);

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
      navigation.navigate("NewsDetail", { id: target.id });
      return;
    }
    if (target.type === "team") {
      navigation.navigate("TeamDetail", { id: target.id });
      return;
    }
    navigation.navigate("PublicProfile", { username: target.id });
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
        ref={scrollRef}
        {...seasonScrollProps("EventDetail")}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}
      >
        {/* Kopfbild (#1273): ein Foto füllt das Banner, ein Logo steht klein auf einer Fläche in Event-Violett. */}
        {banner?.kind === "logo" ? (
          <View style={styles.logoStage} testID="event-banner-logo">
            <MediaImage uri={banner.url} resizeMode="contain" style={styles.logoStageImage} fallback={<Ionicons name="calendar-outline" color={colors.white} size={42} />} />
          </View>
        ) : (
          <MediaImage
            uri={banner?.url || event.banner_url}
            style={styles.heroImage}
            fallback={<Ionicons name="calendar-outline" color={colors.cyan} size={42} />}
          />
        )}

        <View style={styles.header}>
          <View style={styles.headerMeta}>
            <StatusBadge phase={event.public_phase} status={event.status} />
            <Muted testID="event-when">{scheduleLine(event.schedule) || formatDateTime(event.start_date || event.date)}</Muted>
          </View>
          <Title>{event.title || event.name || "Event"}</Title>
          <View style={styles.metaRow}>
            <Pill label={formatEventType(event.event_type || event.type) || "Event"} />
            {event.visibility && event.visibility !== "public" && !internalLabel(event) ? <Pill label={visibilityChip(event.visibility)} tone="gold" /> : null}
            {internalLabel(event) ? <Pill label={internalLabel(event) === "Vorstand" ? "Vorstand" : "Vereinsintern"} tone="gold" /> : null}
            {placeParts(event.location, event.city).length ? <Pill label={placeParts(event.location, event.city).join(", ")} tone="gold" /> : null}
            {event.has_registration ? <Pill label={registered ? "Angemeldet" : "Anmeldung"} /> : null}
          </View>
        </View>

        {error ? <Muted style={styles.error}>{error}</Muted> : null}

        {/* Fakten-Kasten (#1346): Wann, Wo, Eintritt, Mitbringen - direkt unter dem Titel, wie im Web; darunter „Anmelden“
            bzw. der eigene Stand und „In den Kalender“ (nach dem Ende kein Kalender-Knopf mehr, #1221). */}
        <Card style={styles.card} testID="event-facts">
          {facts.map((row) => (
            <View key={row.key} style={styles.factRow} testID={`event-facts-${row.key}`}>
              <Ionicons name={FACT_ICONS[row.key]} size={18} color={EVENT_VIOLET} />
              <View style={styles.flex}>
                <Muted style={styles.factLabel}>{row.label}</Muted>
                <Body style={[styles.strong, row.free && styles.free]}>{row.title}</Body>
                {row.lines.map((line) => <Muted key={line}>{line}</Muted>)}
                {row.route ? (
                  <Pressable onPress={() => openLink(row.route as string)} accessibilityRole="link" testID="event-facts-route">
                    <Body style={styles.placeLink}>Route planen</Body>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
          {registered ? (
            <Muted style={styles.success} testID="event-facts-own">{event.own_registration?.status === "waitlist" ? "Warteliste" : "Du bist dabei"}</Muted>
          ) : event.has_registration && !event.registration_url && registration.canRegister && !over ? (
            <Button label={guest ? "Anmelden oder registrieren" : "Anmelden"} onPress={() => (guest ? openSignIn() : scrollRef.current?.scrollTo({ y: Math.max(0, yoursY - 12), animated: true }))} testID="event-facts-register" />
          ) : null}
        {/* Nach dem Ende (#1221) kein Kalender-Knopf mehr. */}
          {(event.start_date || event.date) && !eventIsOver(event) ? (
            <AddToCalendarButton items={eventDayItems(event)} item={{
            id: event.id, kind: "event", title: event.title || event.name || "Event", start: (event.start_date || event.date) as string, end: event.end_date,
            location: placeParts(event.location, event.city).join(", ") || null, detail: event.event_type || event.type || null,
            url: event.slug ? `https://lionsquad.at/events/${event.slug}` : null,
          }} />
          ) : null}
        </Card>

        {/* 1. Dein Event: der eigene Stand - oder die Anmeldung, solange sie offen ist. */}
        <View onLayout={(layout) => setYoursY(layout.nativeEvent.layout.y)} testID="event-yours">
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
                <Muted style={styles.success} testID="event-own-seats">
                  {formatStatus(event.own_registration?.status)}
                  {event.own_registration?.seat_count ? ` · ${placesLabel(event.own_registration.seat_count)}` : ""}
                  {event.own_registration?.companion_count ? `, davon ${companionsLabel(event.own_registration.companion_count)}` : ""}
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
                {/* Abmelden nur, solange der Server es erlaubt (#1223) - bis zum Beginn, nicht nach dem Check-in. Ein älterer
                    Server ohne das Feld verhält sich wie bisher. */}
                {event.own_registration?.can_cancel !== false ? (
                  <Button label={busy ? "Wird abgemeldet ..." : "Vom Event abmelden"} variant="secondary" onPress={unregister} disabled={busy} testID="event-unregister" />
                ) : null}
              </>
            ) : guest ? (
              // Gast zuerst (#918): der Weg zum Konto gleich hier - nach der Anmeldung geht es zurück zu diesem Event.
              <>
                <Muted>Teilnehmen kannst du mit einem Konto.</Muted>
                <Button label="Anmelden oder registrieren" variant="secondary" onPress={() => openSignIn()} testID="event-sign-in" />
              </>
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

        </View>

        {/* 2. Was läuft beim Event (#1183): jedes Turnier und jede Fast Lap mit Tag, Uhrzeit, Spielart und eigenem Stand. */}
        {rows.length ? (
          <Card style={styles.card} testID="event-whatson">
            <Heading>Was läuft beim Event</Heading>
            {rows.map((row) => (
              <Pressable
                key={`${row.kind}-${row.id}`}
                onPress={() => navigation.navigate(row.kind === "fastlap" ? "FastLapDetail" : "TournamentDetail", { id: row.key })}
                accessibilityRole="button"
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                testID={`event-row-${row.kind}-${row.id}`}
              >
                <View style={styles.rowWhen}>
                  {row.dayLabel ? <Muted style={styles.rowDay}>{row.dayLabel}</Muted> : null}
                  <Body style={styles.strong}>{row.timeLabel || "–"}</Body>
                </View>
                <View style={styles.flex}>
                  <Body style={styles.strong} numberOfLines={2}>{row.title}</Body>
                  <Muted numberOfLines={1}>{[row.mode, row.detail].filter(Boolean).join(" · ")}</Muted>
                </View>
                {row.mine ? (
                  <Muted style={styles.rowMine} testID="event-row-mine">{row.mine.label}{row.mine.team ? ` · ${row.mine.team}` : ""}</Muted>
                ) : row.action === "register" ? (
                  <Muted style={styles.rowRegister} testID="event-row-register">Anmelden</Muted>
                ) : (
                  <StatusBadge phase={row.phase} status={row.status} />
                )}
              </Pressable>
            ))}
          </Card>
        ) : null}

        {/* 3. Live verfolgen: der Reiter „Live“ der Website, bis die App eigene Live-Ansichten bekommt (Events II). */}
        {rows.length && !over ? (
          <Button label="Live verfolgen" variant="secondary" onPress={() => openLink(`${WEB_BASE_URL}/events/${event.slug || event.id}?tab=live`)} testID="event-live" />
        ) : null}

        {event.albums?.length ? (
          <Card style={styles.card}>
            <Heading>Fotos</Heading>
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
                onPress={() => navigation.navigate("NewsDetail", { id: post.slug || post.id })}
              />
            ))}
          </Card>
        ) : null}

        {/* 6. Infos: Highlights als Kacheln, Beschreibung (ohne Emoji-Zwischentitel), die Tage, Standorte, Programm. */}
        <Card style={styles.card} testID="event-infos">
          <Heading>Infos</Heading>
          {event.highlights?.length ? (
            <View style={styles.highlights} testID="event-highlights">
              {event.highlights.map((highlight) => (
                <View key={`${highlight.icon}-${highlight.text}`} style={styles.highlight} accessibilityLabel={`${HIGHLIGHT_ICONS[highlight.icon] || "Highlight"}: ${highlight.text}`}>
                  <Ionicons name={HIGHLIGHT_IONICONS[highlight.icon] || "star-outline"} size={16} color={EVENT_VIOLET} />
                  <Body style={styles.highlightText}>{highlight.text}</Body>
                </View>
              ))}
            </View>
          ) : null}
          {event.description ? <RichText text={stripHeadingEmoji(event.description)} embeds={event.content_embeds} onOpenContent={openContentTarget} /> : null}
          {!event.description && !event.program && !event.highlights?.length ? <Muted>Keine weiteren Event-Infos hinterlegt.</Muted> : null}
        </Card>
        {event.schedule?.multi_day ? (
          <Card style={styles.card} testID="event-days" perch="event-days">
            <Heading>Die Tage</Heading>
            {event.schedule.now?.text ? <Muted testID="event-days-now">{event.schedule.now.text}</Muted> : null}
            {event.schedule.days.map((day) => (
              <View key={day.index} style={[styles.place, day.state === "running" ? styles.dayRunning : null, day.state === "next" ? styles.dayNext : null, day.state === "past" ? styles.dayPast : null]} testID={`event-day-${day.index}`}>
                <View style={styles.dayHead}>
                  <Muted style={styles.placeIndex}>Tag {day.index}/{event.schedule!.count}</Muted>
                  {day.state === "running" ? <Muted style={[styles.placeIndex, styles.dayTag, styles.dayTagLive]}>Läuft</Muted> : null}
                  {day.state === "next" ? <Muted style={[styles.placeIndex, styles.dayTag]}>Als Nächstes</Muted> : null}
                  {day.state === "past" ? <Muted style={styles.placeIndex}>Vorbei</Muted> : null}
                </View>
                <Body style={styles.placeName}>{day.label} · {day.time_label}{day.ends_next_day ? " (bis in den nächsten Morgen)" : ""}</Body>
                {day.door ? <Muted>Einlass {day.door}</Muted> : null}
                {day.title ? <Body>{day.title}</Body> : null}
                {day.location_name ? <Muted>{day.location_name}</Muted> : null}
              </View>
            ))}
          </Card>
        ) : null}

        {(event.locations?.length || 0) > 1 ? (
          <Card style={styles.card} testID="event-locations" perch="event-locations">
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

        {event.program ? (
          <Card style={styles.card} testID="event-program">
            <Heading>Programm</Heading>
            <RichText text={event.program} embeds={event.content_embeds} onOpenContent={openContentTarget} />
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

// Event-Violett (#1305): die Farbe der Art „Event“ - wie im Web (#9F7AEA).
const EVENT_VIOLET = "#9F7AEA";

const FACT_ICONS: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  when: "calendar-outline", where: "location-outline", entry: "ticket-outline", bring: "bag-handle-outline",
};

// Highlights (#1346): dieselbe feste Liste wie im Web, je ein Symbol.
const HIGHLIGHT_IONICONS: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  gamepad: "game-controller-outline", trophy: "trophy-outline", flag: "flag-outline", monitor: "desktop-outline", vr: "glasses-outline",
  retro: "joystick-outline" as React.ComponentProps<typeof Ionicons>["name"], music: "musical-notes-outline", food: "pizza-outline", drink: "beer-outline",
  wifi: "wifi-outline", gift: "gift-outline", users: "people-outline", camera: "camera-outline", star: "star-outline",
};

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
  openLink(url);
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 30,
  },
  logoStage: {
    alignItems: "center",
    backgroundColor: "#4b3592",
    height: 200,
    justifyContent: "center",
    width: "100%",
  },
  logoStageImage: {
    backgroundColor: "transparent",
    borderWidth: 0,
    height: 90,
    width: "55%",
  },
  factRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
  },
  factLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  free: {
    color: colors.success,
  },
  row: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  rowWhen: {
    alignItems: "center",
    width: 58,
  },
  rowDay: {
    color: EVENT_VIOLET,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  rowMine: {
    color: colors.cyan,
    fontWeight: "800",
    maxWidth: 120,
  },
  rowRegister: {
    color: colors.cyan,
    fontWeight: "900",
  },
  highlights: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  highlight: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  highlightText: {
    fontWeight: "700",
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
  dayHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dayTag: {
    color: kindColors.event,
    fontWeight: "800",
  },
  dayTagLive: {
    color: colors.live,
  },
  dayRunning: {
    borderLeftColor: colors.live,
  },
  dayNext: {
    borderLeftColor: kindColors.event,
  },
  dayPast: {
    opacity: 0.6,
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
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
