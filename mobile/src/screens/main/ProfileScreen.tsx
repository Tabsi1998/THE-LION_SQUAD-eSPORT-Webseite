import { Ionicons } from "@expo/vector-icons";
import { NavigationContext, NavigationRouteContext } from "@react-navigation/native";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { AchievementsTab } from "../../achievements/profile/AchievementsTab";
import type { AchievementsMe } from "../../achievements/profile/model";
import { AwardCard } from "../../components/AwardCard";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { HonoursCard } from "../../components/Honours";
import { EmptyState } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { HeaderButton, TabHeader, useTabScrollToTop } from "../../components/TabHeader";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { onAchievementUnlocked } from "../../lib/achievements";
import { api } from "../../lib/api";
import { sortAwards, type Award } from "../../lib/awards";
import { formatDate } from "../../lib/format";
import { formatMoney } from "../../lib/memberArea";
import { documentsLine, type MemberDocument, type OwnDocuments } from "../../lib/memberDocuments";
import { missingLabels } from "../../lib/profileCompleteness";
import { isGuestUser } from "../../live";
import { navigateToUrl, openSignIn, openTab, targetFromUrl } from "../../navigation/rootNavigation";
import type { LooseNavigation, ProfileTabKey } from "../../navigation/types";
import { colors } from "../../theme";
import type { PersonalReferenceData, PersonalReferenceItem, PrizePickup, Team } from "../../types";
import { prizeCounts } from "./MyPrizesScreen";
import { ProfileView, type PublicProfilePayload } from "./PublicProfileScreen";
import { SettingsGroups } from "./SettingsScreen";
import { profileStyles, ReferenceCard, Stat, WEB_BASE_URL, type ModerationStanding } from "./profile/parts";

// Das eigene Profil (#1149): derselbe Aufbau wie das, was andere sehen (Kopf mit Level und Zahlenleiste, Reiter Übersicht,
// Erfolge, Auszeichnungen, Referenzen, Teams, für Mitglieder Ehrungen). Was nur dich angeht, steht im Kasten „Nur für
// dich“: Rechnungen, deine Unterlagen aus der Vereinsakte (#1255), Gewinne zum Abholen, was im Profil noch fehlt. Der
// Schalter „So sehen dich andere“ blendet ihn aus.
// Oben rechts das Zahnrad zu den Einstellungen (#1146). Gäste sehen den Weg zum Konto und darunter Darstellung und
// „Über die App“.

const EMPTY_REFERENCES: PersonalReferenceData = { items: [], stats: { total: 0, tournaments: 0, fastlaps: 0, wins: 0, podiums: 0 } };
type InvoiceSummary = { open_count?: number; open_total?: number; overdue_count?: number } | null;

export function ProfileScreen() {
  const { user } = useAuth();
  return isGuestUser(user) ? <GuestProfile /> : <OwnProfile />;
}

function GuestProfile() {
  const scrollRef = useRef<ScrollView>(null);
  useTabScrollToTop(scrollRef);
  return (
    <Screen padded={false}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        <TabHeader title="Profil" testID="profile-header" />
        <View style={styles.guestWrap} testID="profile-guest">
          <View style={styles.guestIcon}><Ionicons name="person-circle-outline" color={colors.cyan} size={56} /></View>
          <Title style={styles.guestTitle}>Dein Profil</Title>
          <Body style={styles.guestText}>Mit einem Konto stehen hier dein Profil, deine Erfolge, Gewinne und Teams – dasselbe Konto wie auf der Website.</Body>
          <Button label="Anmelden" onPress={() => openSignIn("Login")} testID="profile-guest-login" />
          <Button label="Konto erstellen" variant="secondary" onPress={() => openSignIn("Register")} testID="profile-guest-register" />
        </View>
        {/* Einstellungen für Gäste (#1146): unter dem Anmelde-Hinweis nur Darstellung und „Über die App“. */}
        <SettingsGroups />
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
  // Auszeichnungen (#230): eigene Banner und Trophäen, eine davon als Profilbanner - der Server prüft, dass sie die eigene ist.
  const [awards, setAwards] = useState<{ awards: Award[]; featured_award_id?: string | null }>({ awards: [] });
  const [prizes, setPrizes] = useState<PrizePickup[]>([]);
  const [standing, setStanding] = useState<ModerationStanding | null>(null);
  const [completeness, setCompleteness] = useState<{ score?: number; missing?: string[] }>({});
  const [invoices, setInvoices] = useState<{ summary: InvoiceSummary; currency?: string }>({ summary: null });
  const [ownDocuments, setOwnDocuments] = useState<MemberDocument[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [message, setMessage] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  useTabScrollToTop(scrollRef);

  const load = useCallback(async () => {
    const [achievementResult, completenessResult, referenceResult, awardResult, prizeResult, standingResult, invoiceResult, teamResult, documentResult] = await Promise.all([
      api.get<AchievementsMe>("/achievements/me").catch(() => ({ data: { groups: [], awards: [] } as AchievementsMe })),
      api.get<{ score?: number; missing?: string[] }>("/users/me/profile-completeness").catch(() => ({ data: {} })),
      api.get<PersonalReferenceData>("/mobile/profile/references").catch(() => ({ data: EMPTY_REFERENCES })),
      api.get<{ awards: Award[]; featured_award_id?: string | null }>("/me/awards").catch(() => ({ data: { awards: [] } })),
      api.get<PrizePickup[]>("/prizes/me").catch(() => ({ data: [] as PrizePickup[] })),
      api.get<ModerationStanding>("/moderation/me/standing").catch(() => ({ data: null })),
      api.get<{ summary?: InvoiceSummary; currency?: string }>("/account/invoices").catch(() => ({ data: { summary: null } as { summary?: InvoiceSummary; currency?: string } })),
      api.get<Team[]>("/teams/my").catch(() => ({ data: [] as Team[] })),
      api.get<OwnDocuments>("/account/documents").catch(() => ({ data: null as OwnDocuments | null })),
    ]);
    setAchievements(achievementResult.data || { groups: [], awards: [] });
    setCompleteness(completenessResult.data || {});
    setReferences(referenceResult.data || EMPTY_REFERENCES);
    setAwards(awardResult.data || { awards: [] });
    setPrizes(Array.isArray(prizeResult.data) ? prizeResult.data : []);
    setStanding((standingResult.data as ModerationStanding | null) || null);
    setInvoices({ summary: invoiceResult.data?.summary || null, currency: invoiceResult.data?.currency });
    setTeams(Array.isArray(teamResult.data) ? teamResult.data : []);
    // Die Zeile „Deine Unterlagen“ steht nur da, wenn die Vereinsakte eigene Schreiben liefert.
    setOwnDocuments(documentResult.data?.available && Array.isArray(documentResult.data.documents) ? documentResult.data.documents : []);
  }, []);

  useEffect(() => { void load(); }, [load]);
  // Ein neuer Erfolg oder ein neues Level (die Benachrichtigung startet die Zeremonie): den Erfolge-Stand nachladen.
  useEffect(() => onAchievementUnlocked(() => {
    api.get<AchievementsMe>("/achievements/me").then(({ data }) => { if (data) setAchievements(data); }).catch(() => {});
  }), []);

  const refresh = useCallback(async () => {
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

  const featureAward = useCallback(async (id: string | null) => {
    try {
      if (id) await api.post(`/me/awards/${id}/feature`);
      else await api.delete("/me/awards/feature");
      const { data } = await api.get<{ awards: Award[]; featured_award_id?: string | null }>("/me/awards");
      setAwards(data);
    } catch {
      // bleibt, wie es war
    }
  }, []);

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

  const privateBox = (
    <Card style={styles.privateBox} testID="profile-private-box">
      <Muted style={styles.privateTitle}>Nur für dich</Muted>
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
        onOpenPrivacy={() => go("Settings")}
        canOpenLink={(link) => link.startsWith("/profile") || Boolean(targetFromUrl(link))}
        onOpenLink={(link) => (link.startsWith("/profile") ? go("ProfileEdit") : navigateToUrl(link))}
      />
    </>
  );

  const ownAwards = awards.awards.length ? (
    <View style={styles.list} testID="profile-awards">
      <Muted>Gewinnerbanner und Trophäen aus Turnieren des Vereins. Eine davon kannst du als Profilbanner wählen.</Muted>
      {sortAwards(awards.awards).map((award) => (
        <AwardCard
          key={award.id}
          award={award}
          featured={awards.featured_award_id === award.id}
          onPress={() => { const target = award.tournament?.slug || award.tournament?.id; if (target) go("TournamentDetail", { id: target }); }}
          action={
            <Pressable onPress={() => { void featureAward(awards.featured_award_id === award.id ? null : award.id); }} accessibilityRole="button" testID={`award-feature-${award.id}`} style={profileStyles.awardAction}>
              <Muted style={profileStyles.awardActionText}>{awards.featured_award_id === award.id ? "Profilbanner ✓" : "Als Profilbanner"}</Muted>
            </Pressable>
          }
        />
      ))}
    </View>
  ) : (
    <EmptyState icon="medal-outline" title="Noch keine Auszeichnungen" detail="Sie entstehen, wenn ein Turnier seine Ergebnisse veröffentlicht – Platz 1 bis 3 als Trophäe, alle anderen als Teilnahme-Banner." />
  );

  const ownReferences = (
    <View style={styles.list}>
      <Card style={profileStyles.card}>
        <Heading>Meine Referenzen</Heading>
        <Muted>Persönliche Turnier- und Fast-Lap-Historie aus deinem Konto.</Muted>
        <View style={profileStyles.statGrid}>
          <Stat label="Gesamt" value={String(references.stats.total)} />
          <Stat label="Podien" value={String(references.stats.podiums)} tone="gold" />
          <Stat label="Siege" value={String(references.stats.wins)} />
        </View>
      </Card>
      {references.items.length ? references.items.map((item) => <ReferenceCard key={item.id} item={item} onOpen={openReference} />) : (
        <EmptyState icon="ribbon-outline" title="Noch keine Referenzen" detail="Sobald du Turniere spielst oder Fast-Lap-Zeiten eingetragen werden, erscheint deine Historie hier." />
      )}
    </View>
  );

  // Eigene Teams im eigenen Profil (#1149) - auch die, die andere nicht sehen. Verwalten, beitreten und entdecken: Community.
  const ownTeams = (
    <View style={styles.list} testID="profile-own-teams">
      {teams.map((team) => (
        <Pressable key={team.id} onPress={() => go("TeamDetail", { id: team.id })} accessibilityRole="button" style={({ pressed }) => [styles.teamRow, pressed && styles.pressed]} testID={`profile-team-${team.id}`}>
          <MediaImage uri={team.logo_url} style={styles.teamLogo} fallback={<Body style={styles.teamInitials}>{(team.tag || team.name || "?").slice(0, 2).toUpperCase()}</Body>} />
          <View style={styles.flex}>
            <Body style={profileStyles.strong} numberOfLines={1}>{team.name}</Body>
            <Muted>{team.tag ? `[${team.tag}]` : "Team"}</Muted>
          </View>
          <Ionicons name="chevron-forward" color={colors.muted} size={16} />
        </Pressable>
      ))}
      {!teams.length ? <EmptyState icon="people-outline" title="Noch kein Team" detail="Einladungen, eigene Teams und Teams zum Entdecken stehen unter Community → Teams." /> : null}
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

  const header = (
    <TabHeader
      title="Profil"
      testID="profile-header"
      extra={<HeaderButton icon="settings-outline" label="Einstellungen" onPress={() => go("Settings")} testID="profile-settings" />}
    />
  );

  return (
    <ProfileView
      username={user?.username || ""}
      navigation={{ navigate: (screen, params) => go(screen as string, params as object | undefined) }}
      header={header}
      scrollRef={scrollRef}
      own={{
        privateBox,
        achievements: ownAchievements,
        awards: ownAwards,
        references: ownReferences,
        teams: ownTeams,
        honours: <HonoursCard />,
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
    borderRadius: 8,
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
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 12,
  },
  teamLogo: {
    alignItems: "center",
    backgroundColor: "rgba(41,182,232,0.14)",
    borderRadius: 8,
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
