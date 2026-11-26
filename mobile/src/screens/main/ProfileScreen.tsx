import { Ionicons } from "@expo/vector-icons";
import { NavigationContext, NavigationRouteContext } from "@react-navigation/native";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { AchievementsTab } from "../../achievements/profile/AchievementsTab";
import type { AchievementsMe } from "../../achievements/profile/model";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { HonoursCard } from "../../components/Honours";
import { EmptyState, ErrorState, PartialLoadNotice, loadProblem, type LoadProblem } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Muted, Title } from "../../components/Text";
import { onAchievementUnlocked } from "../../lib/achievements";
import { api, errorMessage } from "../../lib/api";
import { TrophyCabinet } from "../../components/league/TrophyCabinet";
import { emblemsFrom, type TrophyAward } from "../../lib/trophies";
import { formatDate } from "../../lib/format";
import { formatMoney } from "../../lib/memberArea";
import { documentsLine, type MemberDocument, type OwnDocuments } from "../../lib/memberDocuments";
import { missingLabels } from "../../lib/profileCompleteness";
import { isGuestUser } from "../../live";
import { navigateToUrl, openSignIn, openTab, targetFromUrl } from "../../navigation/rootNavigation";
import { BEREICH } from "../../lib/meinBereich";
import type { LooseNavigation, ProfileTabKey } from "../../navigation/types";
import { colors, radius } from "../../theme";
import type { PersonalReferenceData, PersonalReferenceItem, PrizePickup, Team } from "../../types";
import { prizeCounts } from "./MyPrizesScreen";
import { ProfileView, type PublicProfilePayload } from "./PublicProfileScreen";
import { profileStyles, WEB_BASE_URL, type ModerationStanding } from "./profile/parts";
import { ProfileReferences } from "./profile/ProfileReferences";
import { LeagueSanctionsList } from "../../components/league/LeagueSanctionsList";
import { useMemberPlacements } from "../../lib/memberPlacements";
import { requestMoment } from "../../lib/leagueMoments";

// Das eigene Profil (#1149): derselbe Aufbau wie das, was andere sehen (Kopf mit Level und Zahlenleiste, Reiter Übersicht,
// Erfolge, Auszeichnungen, Referenzen, Teams, für Mitglieder Ehrungen). Was nur dich angeht, steht im Kasten „Nur für
// dich“: Rechnungen, deine Unterlagen aus der Vereinsakte (#1255), Gewinne zum Abholen, was im Profil noch fehlt. Der
// Schalter „So sehen dich andere“ blendet ihn aus.
// Seit Mein Bereich (#2059) eine Seite über dem Tab („Mein Profil“): aus Mein Bereich → Profil, dem Kopf der Übersicht und
// /u/me. Die Einstellungen (früher das Zahnrad, #1146) wohnen in den Gruppen von Mein Bereich.

const EMPTY_REFERENCES: PersonalReferenceData = { items: [], stats: { total: 0, tournaments: 0, fastlaps: 0, wins: 0, podiums: 0 } };
type InvoiceSummary = { open_count?: number; open_total?: number; overdue_count?: number } | null;

export function ProfileScreen() {
  const { user } = useAuth();
  return isGuestUser(user) ? <GuestProfile /> : <OwnProfile />;
}

/** Ein Gast kommt über einen Link (/u/me) hierher - dann der Weg zum Konto, kein leeres Profil. */
function GuestProfile() {
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.guestWrap} testID="profile-guest">
          <View style={styles.guestIcon}><Ionicons name="person-circle-outline" color={colors.cyan} size={56} /></View>
          <Title style={styles.guestTitle}>Dein Profil</Title>
          <Body style={styles.guestText}>Mit einem Konto stehen hier dein Profil, deine Erfolge, Gewinne und Teams – dasselbe Konto wie auf der Website.</Body>
          <Button label="Anmelden" onPress={() => openSignIn("Login")} testID="profile-guest-login" />
          <Button label="Konto erstellen" variant="secondary" onPress={() => openSignIn("Register")} testID="profile-guest-register" />
        </View>
      </ScrollView>
    </Screen>
  );
}

function OwnProfile() {
  const navigation = useContext(NavigationContext);
  const route = useContext(NavigationRouteContext);
  const { user, refreshMe } = useAuth();
  const go = useCallback((screen: string, params?: object) => (navigation as unknown as LooseNavigation | undefined)?.navigate(screen, params), [navigation]);
  const [achievements, setAchievements] = useState<AchievementsMe>({ groups: [], awards: [] });
  const [evaluating, setEvaluating] = useState(false);
  const [references, setReferences] = useState<PersonalReferenceData>(EMPTY_REFERENCES);
  // Vereinsplatzierungen (#1945): die Referenzen des Vereins, in deren Aufstellung du stehst - über dein Vereinsprofil.
  const club = useMemberPlacements({ own: true, username: user?.username || "", enabled: Boolean(user?.is_club_member) });
  // Trophäen (#230, #2425): eigene Pokale, Banner und Liga-Belohnungen; eine als Profilbanner, eine als Titel und bis zu drei Embleme
  // neben dem Namen - der Server prüft, dass sie die eigenen sind. `featured_emblem_award_ids` fehlt bei älteren Servern.
  const [awards, setAwards] = useState<MyAwards>({ awards: [] });
  // Erst wenn die eigene Liste da ist, gelten Banner, Titel und Embleme daraus im Kopf - vorher die des Profils.
  const [awardsLoaded, setAwardsLoaded] = useState(false);
  const [awardNote, setAwardNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const choosingRef = useRef(false);
  const [prizes, setPrizes] = useState<PrizePickup[]>([]);
  const [standing, setStanding] = useState<ModerationStanding | null>(null);
  const [completeness, setCompleteness] = useState<{ score?: number; missing?: string[] }>({});
  const [invoices, setInvoices] = useState<{ summary: InvoiceSummary; currency?: string }>({ summary: null });
  const [ownDocuments, setOwnDocuments] = useState<MemberDocument[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState<LoadProblem | null>(null);
  // Welche Listen beim letzten Laden nicht kamen (#1001): dort sagt der Reiter „nicht geladen“ statt „noch keine“.
  const [notLoaded, setNotLoaded] = useState<{ teams?: boolean; references?: boolean; awards?: boolean }>({});
  const scrollRef = useRef<ScrollView>(null);

  const evaluatedRef = useRef(false);
  const load = useCallback(async () => {
    // Erst auswerten, dann die Erfolge laden (#1296): nach dem Anmelden zeigten Kopf und Reiter „Erfolge“ kurz den alten
    // Stand (Level 5 statt 9), weil die Auswertung gleichzeitig lief. Einmal je Öffnen, der Rest lädt daneben.
    const achievementsAfterEvaluation = (async () => {
      if (!evaluatedRef.current) {
        evaluatedRef.current = true;
        await api.post("/achievements/evaluate").catch(() => null);
      }
      return api.get<AchievementsMe>("/achievements/me");
    })();
    // Ein Fehlschlag ist kein „nichts da“ (#1001, #1152): der Bereich behält seinen letzten Stand (null = nicht gekommen),
    // und oben steht „Nicht alles geladen“ mit „Nochmal versuchen“.
    let firstProblem: LoadProblem | null = null;
    const keep = <T,>(promise: Promise<{ data: T }>) => promise.catch((error: unknown) => {
      firstProblem = firstProblem || loadProblem(error);
      return null;
    });
    const [achievementResult, completenessResult, referenceResult, awardResult, prizeResult, standingResult, invoiceResult, teamResult, documentResult] = await Promise.all([
      keep(achievementsAfterEvaluation),
      keep(api.get<{ score?: number; missing?: string[] }>("/users/me/profile-completeness")),
      keep(api.get<PersonalReferenceData>("/mobile/profile/references")),
      keep(api.get<MyAwards>("/me/awards")),
      keep(api.get<PrizePickup[]>("/prizes/me")),
      keep(api.get<ModerationStanding>("/moderation/me/standing")),
      keep(api.get<{ summary?: InvoiceSummary; currency?: string }>("/account/invoices")),
      keep(api.get<Team[]>("/teams/my")),
      keep(api.get<OwnDocuments>("/account/documents")),
    ]);
    if (achievementResult) setAchievements(achievementResult.data || { groups: [], awards: [] });
    if (completenessResult) setCompleteness(completenessResult.data || {});
    if (referenceResult) setReferences(referenceResult.data || EMPTY_REFERENCES);
    if (awardResult) {
      setAwards(awardResult.data || { awards: [] });
      setAwardsLoaded(true);
    }
    if (prizeResult) setPrizes(Array.isArray(prizeResult.data) ? prizeResult.data : []);
    if (standingResult) setStanding((standingResult.data as ModerationStanding | null) || null);
    if (invoiceResult) setInvoices({ summary: invoiceResult.data?.summary || null, currency: invoiceResult.data?.currency });
    if (teamResult) setTeams(Array.isArray(teamResult.data) ? teamResult.data : []);
    // Die Zeile „Deine Unterlagen“ steht nur da, wenn die Vereinsakte eigene Schreiben liefert.
    if (documentResult) setOwnDocuments(documentResult.data?.available && Array.isArray(documentResult.data.documents) ? documentResult.data.documents : []);
    setNotLoaded({ teams: !teamResult, references: !referenceResult, awards: !awardResult });
    setProblem(firstProblem);
  }, []);

  useEffect(() => { void load(); }, [load]);
  // Ein neuer Erfolg oder ein neues Level (die Benachrichtigung startet die Zeremonie): den Erfolge-Stand nachladen.
  useEffect(() => onAchievementUnlocked(() => {
    api.get<AchievementsMe>("/achievements/me").then(({ data }) => { if (data) setAchievements(data); }).catch(() => {});
  }), []);

  // Strafen der Liga (#2173) laden beim Herunterziehen mit - ein eigener Teil der Seite mit eigenem Abruf.
  const [sanctionsRound, setSanctionsRound] = useState(0);
  const refresh = useCallback(async () => {
    setSanctionsRound((round) => round + 1);
    await refreshMe().catch(() => {});
    await load();
  }, [load, refreshMe]);

  const evaluate = useCallback(async () => {
    setMessage("");
    setEvaluating(true);
    try {
      const { data } = await api.post<{ newly_awarded?: number }>("/achievements/evaluate");
      await load();
      setMessage(data.newly_awarded ? `${data.newly_awarded} neue Erfolge freigeschaltet.` : "Erfolge sind aktuell.");
    } catch {
      setMessage("Erfolge konnten nicht aktualisiert werden.");
    } finally {
      setEvaluating(false);
    }
  }, [load]);

  // Eine Wahl nach der anderen (#2425): bis die Antwort und der neue Stand da sind, nimmt kein Knopf einen weiteren Tipp an - sonst
  // rechnete ein schneller zweiter Tipp mit der alten Liste der Embleme. Scheitert sie, bleibt alles, wie es war, und ein Satz sagt es.
  const choose = useCallback(async (action: () => Promise<unknown>, done: string) => {
    if (choosingRef.current) return;
    choosingRef.current = true;
    setChoosing(true);
    setAwardNote(null);
    try {
      await action();
      const { data } = await api.get<MyAwards>("/me/awards");
      setAwards(data || { awards: [] });
      setAwardNote({ ok: true, text: done });
    } catch (error) {
      setAwardNote({ ok: false, text: errorMessage(error, "Das hat nicht geklappt.") });
    } finally {
      choosingRef.current = false;
      setChoosing(false);
    }
  }, []);

  const featureAward = useCallback((id: string | null, slot: "banner" | "title" = "banner") => choose(async () => {
    // Titel neben dem Namen (#2173, F.4): derselbe Weg mit `slot=title`, nur für Belohnungen der Art „Titel“.
    const options = slot === "title" ? { params: { slot } } : undefined;
    if (id) await api.post(`/me/awards/${encodeURIComponent(id)}/feature`, undefined, options);
    else await api.delete("/me/awards/feature", options);
  }, slot === "title" ? (id ? "Als Titel gesetzt." : "Titel entfernt.") : (id ? "Als Profilbanner gesetzt." : "Profilbanner entfernt.")), [choose]);

  // Bis zu drei Embleme neben dem Namen (Nr. 34c, #2425): nur eigene Embleme und Medaillen; der Server prüft Anzahl und Besitz.
  const featureEmblems = useCallback((ids: string[]) => choose(
    () => api.put("/me/awards/emblems", { award_ids: ids }),
    ids.length ? "Embleme gespeichert." : "Embleme entfernt.",
  ), [choose]);

  const openReference = useCallback((item: PersonalReferenceItem) => {
    if (!item.target_id) return;
    if (item.kind === "fastlap") go("FastLapDetail", { id: item.target_id });
    else if (item.kind === "season") go("SeasonPass");
    else go("TournamentDetail", { id: item.target_id });
  }, [go]);

  const prizeStats = useMemo(() => prizeCounts(prizes), [prizes]);
  const missing = missingLabels(completeness.missing);
  const score = Number(completeness.score || 0);
  const requestedTab = (route?.params as { tab?: ProfileTabKey } | undefined)?.tab;
  // Aus der Nachricht zum Saisonende (#2584): gleich nachsehen, ob der Moment noch offen ist - sonst steht er unter „Saisonende“.
  const requestedMoment = (route?.params as { moment?: string } | undefined)?.moment;
  useEffect(() => {
    if (requestedMoment) requestMoment(requestedMoment);
  }, [requestedMoment]);

  const privateBox = (
    // Versteck der Ostereiersuche (#647, „app:Profile“) und Platz für die Saison-Deko - wie die Karten der anderen Seiten.
    <Card style={styles.privateBox} testID="profile-private-box" perch="profile-private">
      <Muted style={styles.privateTitle}>Nur für dich</Muted>
      {problem ? <PartialLoadNotice problem={problem} onRetry={() => { void refresh(); }} testID="profile-partial-load" /> : null}
      <PrivateRow
        icon="receipt-outline"
        title="Rechnungen"
        detail={invoices.summary?.open_count ? `${invoices.summary.open_count} offen · ${formatMoney(invoices.summary.open_total, invoices.currency)}${invoices.summary.overdue_count ? ` · ${invoices.summary.overdue_count} überfällig` : ""}` : "Keine offenen Rechnungen"}
        onPress={() => go("MyInvoices")}
        testID="profile-private-invoices"
      />
      {ownDocuments.length ? (
        <PrivateRow
          icon="document-text-outline"
          title="Deine Unterlagen"
          detail={documentsLine(ownDocuments)}
          onPress={() => go("MyDocuments")}
          testID="profile-private-documents"
        />
      ) : null}
      <PrivateRow
        icon="gift-outline"
        title="Gewinne"
        detail={prizeStats.ready ? `${prizeStats.ready} bereit zum Abholen` : prizeStats.open ? `${prizeStats.open} offen` : "Keine offenen Gewinne"}
        onPress={() => go("MyPrizes")}
        testID="profile-private-prizes"
      />
      <PrivateRow
        icon="person-circle-outline"
        title={score >= 100 ? "Profil vollständig" : `Profil zu ${score} % fertig`}
        detail={missing.length ? `Es fehlt: ${missing.slice(0, 3).join(", ")}` : "Alle wichtigen Felder sind gepflegt."}
        onPress={() => go("ProfileEdit")}
        testID="profile-private-completeness"
      />
      {/* Der eigene Stand bei der Moderation (#416): nur lesen; Einspruch und Verlauf liegen im Web. */}
      {standing && (standing.active || standing.strike_count > 0) ? (
        <PrivateRow
          icon="shield-outline"
          title={standing.active ? standing.active.label : "Moderation"}
          detail={`${standing.strike_count} Treffer in den letzten ${standing.strike_ttl_months} Monaten${standing.active?.chat_blocked_until ? ` · Chat gesperrt bis ${formatDate(standing.active.chat_blocked_until)}` : ""}`}
          onPress={() => { Linking.openURL(`${WEB_BASE_URL}/my/penalties`).catch(() => {}); }}
          tone="danger"
          testID="profile-moderation-web"
        />
      ) : null}
      {/* Strafen der Liga (E.3, #2173): gegen dich oder dein Co-Team, mit Einspruch - wie „Meine Strafen“ im Web. */}
      <LeagueSanctionsList reloadKey={sanctionsRound} />
    </Card>
  );

  const ownAchievements = (
    <>
      {message ? <Muted style={message.includes("konnten") ? profileStyles.error : profileStyles.success}>{message}</Muted> : null}
      {/* Erfolge (E13, #623): derselbe Reiter wie im Web - Level, Prestige, „Als Nächstes“, Angeheftete, Vitrinen, Filter. */}
      <AchievementsTab
        data={achievements}
        onDataChange={setAchievements}
        profileScore={score}
        evaluating={evaluating}
        onEvaluate={evaluate}
        // Erfolge öffentlich oder privat (#619): der Schalter in Mein Bereich → Datenschutz (#2059).
        onOpenPrivacy={() => { navigateToUrl(`${BEREICH}/datenschutz#erfolge-oeffentlich`); }}
        canOpenLink={(link) => link.startsWith("/profile") || Boolean(targetFromUrl(link))}
        onOpenLink={(link) => (link.startsWith("/profile") ? go("ProfileEdit") : navigateToUrl(link))}
      />
    </>
  );

  // Trophäen (#2425, Nr. 59): eine Vitrine mit Filtern statt Gruppen je Season - hier wählst du Profilbanner, Titel und Embleme.
  const trophyList = awards.awards || [];
  const ownAwards = !trophyList.length && notLoaded.awards && problem ? (
    <ErrorState problem={problem} title="Trophäen nicht geladen" onRetry={() => { void refresh(); }} testID="profile-awards-error" />
  ) : (
    <View style={styles.list} testID="profile-awards">
      {awardNote ? <Muted style={awardNote.ok ? profileStyles.success : profileStyles.error} testID="profile-awards-message" accessibilityLiveRegion="polite">{awardNote.text}</Muted> : null}
      <TrophyCabinet
        awards={trophyList}
        testID="profile-trophies"
        owner={{
          featuredId: awards.featured_award_id || null,
          titleId: awards.featured_title_award_id || null,
          emblemIds: emblemsFrom(trophyList, awards.featured_emblem_award_ids).map((award) => award.id),
          onFeature: (id) => { void featureAward(id); },
          onTitle: (id) => { void featureAward(id, "title"); },
          onEmblems: (ids) => { void featureEmblems(ids); },
          busy: choosing,
          emblemHint: "Bis zu drei Embleme oder Medaillen stehen neben deinem Namen.",
        }}
        empty="Noch keine Trophäen – sie entstehen, wenn ein Turnier seine Ergebnisse veröffentlicht oder eine Liga-Staffel abgeschlossen wird."
      />
    </View>
  );

  // Referenzen im neuen Design (#1945): Kopf ohne Nullen, Liga-Weg, Chronik je Jahr - Vereinsplatzierungen und eigene
  // Turniere zusammen; ein Turnier klappt mit seinem Weg auf (#1193, mit „Bild teilen“ #1194).
  const ownReferences = (
    <View style={styles.list}>
      <ProfileReferences
        personal={references.items}
        club={club}
        username={user?.username}
        own
        onOpenSeason={(target) => go("ReferenceSeason", target)}
        onOpenPersonal={openReference}
        empty={notLoaded.references && problem ? (
          <ErrorState problem={problem} title="Referenzen nicht geladen" onRetry={() => { void refresh(); }} testID="profile-references-error" />
        ) : (
          <EmptyState
            icon="ribbon-outline"
            title="Noch keine Referenzen"
            detail="Sobald du Turniere spielst, Fast-Lap-Zeiten eingetragen werden oder du für den Verein antrittst, erscheint deine Historie hier."
            action={{ label: "Turniere entdecken", onPress: () => { openTab("TournamentList", { filter: "tournaments" }); }, testID: "profile-references-discover" }}
            testID="profile-references-empty"
          />
        )}
      />
    </View>
  );

  // Eigene Teams im eigenen Profil (#1149) - auch die, die andere nicht sehen. Verwalten, beitreten und entdecken: Community.
  const ownTeams = (
    <View style={styles.list} testID="profile-own-teams">
      {teams.map((team) => (
        <Pressable key={team.id} onPress={() => go("TeamDetail", { id: team.id })} accessibilityRole="button" style={({ pressed }) => [styles.teamRow, pressed && styles.pressed]} testID={`profile-team-${team.id}`}>
          <MediaImage uri={team.logo_url} style={styles.teamLogo} fallback={<Body style={styles.teamInitials}>{(team.tag || team.name || "?").slice(0, 2).toUpperCase()}</Body>} />
          <View style={styles.flex}>
            <Body style={profileStyles.strong}>{team.name}</Body>
            <Muted>{team.tag ? `[${team.tag}]` : "Team"}</Muted>
          </View>
          <Ionicons name="chevron-forward" color={colors.muted} size={16} />
        </Pressable>
      ))}
      {!teams.length && notLoaded.teams && problem ? <ErrorState problem={problem} title="Teams nicht geladen" onRetry={() => { void refresh(); }} testID="profile-teams-error" /> : null}
      {!teams.length && !(notLoaded.teams && problem) ? <EmptyState icon="people-outline" title="Noch kein Team" detail="Einladungen, eigene Teams und Teams zum Entdecken stehen unter Community → Teams." /> : null}
      <Pressable onPress={() => openTab("CommunityHub", { section: "teams" })} accessibilityRole="button" style={styles.linkRow} testID="profile-teams-community">
        <Body style={styles.linkText}>Teams in Community</Body>
        <Ionicons name="arrow-forward" color={colors.cyan} size={16} />
      </Pressable>
    </View>
  );

  const fallback: PublicProfilePayload = {
    id: user?.id || "",
    username: user?.username || "",
    display_name: user?.display_name,
    avatar_url: (user as any)?.avatar_url,
    banner_url: (user as any)?.banner_url,
    bio: (user as any)?.bio,
    role: user?.role,
    created_at: (user as any)?.created_at,
    is_club_member: Boolean(user?.is_club_member),
    stats: { wins: references.stats.wins, top3: references.stats.podiums, tournaments: references.stats.tournaments, fast_laps: references.stats.fastlaps },
    achievement_level: (achievements as any)?.level || undefined,
  };

  return (
    <ProfileView
      username={user?.username || ""}
      navigation={{ navigate: (screen, params) => go(screen as string, params as object | undefined) }}
      scrollRef={scrollRef}
      own={{
        privateBox,
        achievements: ownAchievements,
        awards: ownAwards,
        references: ownReferences,
        teams: ownTeams,
        honours: <HonoursCard />,
        // Banner, Titel und Embleme im Kopf aus der eigenen Liste - nach einer Wahl gleich der neue Stand, ohne das Profil neu zu laden.
        ...(awardsLoaded ? {
          featuredAward: trophyList.find((award) => award.id === awards.featured_award_id) || null,
          featuredTitle: trophyList.find((award) => award.id === awards.featured_title_award_id) || null,
          featuredEmblems: emblemsFrom(trophyList, awards.featured_emblem_award_ids),
        } : {}),
        fallback,
        refresh,
        initialTab: requestedTab,
      }}
    />
  );
}

function PrivateRow({ icon, title, detail, onPress, tone, testID }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string; onPress: () => void; tone?: "danger"; testID?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.privateRow, pressed && styles.pressed]} testID={testID}>
      <View style={[styles.privateIcon, tone === "danger" && styles.privateIconDanger]}>
        <Ionicons name={icon} color={tone === "danger" ? colors.live : colors.gold} size={18} />
      </View>
      <View style={styles.flex}>
        <Body style={profileStyles.strong}>{title}</Body>
        <Muted numberOfLines={2}>{detail}</Muted>
      </View>
      <Ionicons name="chevron-forward" color={colors.muted} size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
    padding: 18,
    paddingBottom: 36,
  },
  guestWrap: {
    alignItems: "stretch",
    gap: 12,
  },
  guestIcon: {
    alignItems: "center",
  },
  guestTitle: {
    textAlign: "center",
  },
  guestText: {
    textAlign: "center",
  },
  privateBox: {
    backgroundColor: "rgba(255, 215, 0, 0.05)",
    borderColor: "rgba(255, 215, 0, 0.42)",
    gap: 4,
  },
  privateTitle: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  privateRow: {
    alignItems: "center",
    borderTopColor: "rgba(255, 215, 0, 0.18)",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
  },
  privateIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255, 215, 0, 0.12)",
    borderRadius: radius.lg,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  privateIconDanger: {
    backgroundColor: "rgba(255, 59, 48, 0.12)",
  },
  flex: {
    flex: 1,
    gap: 2,
  },
  list: {
    gap: 12,
  },
  teamRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  teamLogo: {
    alignItems: "center",
    backgroundColor: "rgba(41,182,232,0.14)",
    borderRadius: radius.lg,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  teamInitials: {
    color: colors.cyan,
    fontWeight: "900",
  },
  linkRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 40,
  },
  linkText: {
    color: colors.cyan,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.72,
  },
});

type MyAwards = {
  awards: TrophyAward[];
  featured_award_id?: string | null;
  featured_title_award_id?: string | null;
  featured_emblem_award_ids?: string[];
};
