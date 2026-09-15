import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Card } from "../../components/Card";
import { ContentCard } from "../../components/ContentCard";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../lib/api";
import { formatDate, formatMembershipStatus, formatMembershipType, formatRole, placeParts } from "../../lib/format";
import { groupSponsorsByTier } from "../../lib/sponsors";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { Reference, ReferenceSummary } from "../../types";

type Props = NativeStackScreenProps<MoreStackParamList, "InfoCenter">;
type SectionKey = NonNullable<NonNullable<MoreStackParamList["InfoCenter"]>["section"]>;

const sections: Array<{ key: SectionKey; label: string }> = [
  { key: "sponsors", label: "Sponsoren" },
  { key: "partners", label: "Partner" },
  { key: "events", label: "Events" },
  { key: "benefits", label: "Vorteile" },
  { key: "references", label: "Referenzen" },
  { key: "profiles", label: "Profile" },
];

// Ein Satz je Bereich für Mitglieder - vorher stand hier ein Entwicklersatz
// über "native App-Module" (#246).
const SECTION_INTRO: Record<SectionKey, string> = {
  sponsors: "Die Unternehmen, die den Verein unterstützen.",
  partners: "Vereine und Projekte, mit denen wir zusammenarbeiten.",
  events: "Kommende Termine des Vereins.",
  benefits: "Was dir die Mitgliedschaft bringt.",
  references: "Externe Turniere und Ligen, bei denen THE LION SQUAD angetreten ist.",
  profiles: "Öffentliche Spielerprofile der Community.",
};

// Aus "Mehr" kommt man mit einem Bereich; dann ist das hier dessen Seite -
// mit eigenem Titel und ohne die Verschiebeleiste des Infocenters (#243).
const SECTION_GROUP: Record<SectionKey, string> = {
  sponsors: "Verein",
  partners: "Verein",
  events: "Verein",
  benefits: "Verein",
  references: "Verein",
  profiles: "Gaming",
};

const REFERENCE_STATUS: Record<string, string> = {
  active: "Laufend",
  planned: "Geplant",
  completed: "Abgeschlossen",
  archived: "Archiviert",
};

export function InfoCenterScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const [section, setSection] = useState<SectionKey>(route.params?.section || "sponsors");
  const [sponsors, setSponsors] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [benefits, setBenefits] = useState<any[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [referenceSummary, setReferenceSummary] = useState<ReferenceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const active = useMemo(() => sections.find((item) => item.key === section) || sections[0], [section]);
  const fixedSection = Boolean(route.params?.section);

  useLayoutEffect(() => {
    navigation.setOptions({ title: fixedSection ? active.label : "Info Center" });
  }, [active.label, fixedSection, navigation]);

  const loadLive = useCallback(async () => {
    try {
      const [liveSponsors, livePartners, liveEvents, liveProfiles, liveBenefits, liveReferences] = await Promise.all([
        api.get<any[]>("/sponsors").catch(() => ({ data: [] })),
        api.get<any[]>("/partners").catch(() => ({ data: [] })),
        api.get<any[]>("/events").catch(() => ({ data: [] })),
        api.get<any[]>("/users/public-list").catch(() => ({ data: [] })),
        api.get<any[]>("/membership/benefits").catch(() => ({ data: [] })),
        api.get<Reference[] | { items?: Reference[]; summary?: ReferenceSummary }>("/references").catch(() => ({ data: [] as Reference[] })),
      ]);
      setSponsors(Array.isArray(liveSponsors.data) ? liveSponsors.data : []);
      setPartners(Array.isArray(livePartners.data) ? livePartners.data : []);
      setEvents(Array.isArray(liveEvents.data) ? liveEvents.data : []);
      setProfiles(Array.isArray(liveProfiles.data) ? liveProfiles.data : []);
      setBenefits(Array.isArray(liveBenefits.data) ? liveBenefits.data : []);
      // Der Server liefert { items, summary }; die Liste war leer, solange die
      // App ein Array erwartete (#252). Ein Array bleibt für ältere Server erlaubt.
      const referenceData = liveReferences.data;
      setReferences(Array.isArray(referenceData) ? referenceData : referenceData?.items ?? []);
      setReferenceSummary(Array.isArray(referenceData) ? null : referenceData?.summary ?? null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadLive();
  }, [loadLive]);

  useEffect(() => {
    if (route.params?.section) setSection(route.params.section);
  }, [route.params?.section]);

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadLive(); }} tintColor={colors.cyan} />}
      >
        <View style={styles.header}>
          <Muted style={styles.eyebrow}>{SECTION_GROUP[active.key]}</Muted>
          <Title>{active.label}</Title>
          <Muted>{SECTION_INTRO[active.key]}</Muted>
        </View>

        {fixedSection ? null : <SegmentedTabs items={sections} value={section} onChange={setSection} />}

        {loading ? (
          <SkeletonList count={4} hasImage={false} />
        ) : (
          <>
            {section === "sponsors" ? <Sponsors items={sponsors} /> : null}
            {section === "partners" ? <Partners items={partners} /> : null}
            {section === "events" ? <Events items={events} onOpen={(event) => navigation.getParent()?.navigate("Tournaments", { screen: "EventDetail", params: { id: event.slug || event.id } })} /> : null}
            {section === "benefits" ? <Benefits isMember={Boolean(user?.is_club_member)} membership={user?.membership || null} items={benefits} /> : null}
            {section === "references" ? <References items={references} summary={referenceSummary} /> : null}
            {section === "profiles" ? <Profiles items={profiles} onOpen={(profile) => profile.username ? navigation.navigate("PublicProfile", { username: profile.username }) : undefined} /> : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

// Stufen wie auf der Webseite: Hauptsponsor volle Breite, Bronze zu viert, Logos
// ohne Boxen auf dem dunklen Grund (#244).
function Sponsors({ items }: { items: any[] }) {
  if (!items.length) return <EmptyState title="Keine Sponsoren" detail="Sobald Sponsoren auf der Website gepflegt sind, erscheinen ihre Logos hier." />;
  return (
    <View style={styles.sponsorGroups}>
      {groupSponsorsByTier(items).map(({ tier, items: rows }) => (
        <View key={tier.key} style={styles.sponsorGroup} testID={`sponsor-tier-${tier.key}`}>
          <Muted style={[styles.sponsorTierLabel, { color: tier.color }]}>{tier.label}</Muted>
          <View style={styles.sponsorGrid}>
            {rows.map((sponsor) => {
              const href = normalizeLink(sponsor.url || sponsor.link);
              return (
                <Pressable
                  key={sponsor.id}
                  onPress={href ? () => Linking.openURL(href) : undefined}
                  style={({ pressed }) => [styles.sponsorTile, { flexBasis: `${Math.floor(100 / tier.perRow) - 3}%` }, pressed && styles.pressed]}
                  accessibilityLabel={href ? `${sponsor.name} – Website öffnen` : sponsor.name}
                  accessibilityRole={href ? "link" : "image"}
                >
                  <MediaImage
                    uri={sponsor.logo_url}
                    resizeMode="contain"
                    style={[styles.sponsorLogo, { height: tier.logoHeight }]}
                    fallback={
                      <Body style={styles.sponsorFallback} numberOfLines={2}>
                        {sponsor.name || "?"}
                      </Body>
                    }
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

function Partners({ items }: { items: any[] }) {
  if (!items.length) return <EmptyState title="Keine Partner" detail="Kooperationen und Community-Partner werden hier gesammelt." />;
  return (
    <>
      {items.map((partner, index) => (
        <LinkedCard key={partner.id || partner.username || index} url={partner.url || partner.link}>
          <Card style={styles.card}>
            <View style={styles.logoRow}>
              <MediaImage
                uri={partner.logo_url || partner.avatar_url}
                resizeMode="contain"
                style={styles.logoBox}
                fallback={<Body style={styles.logoFallback}>{(partner.name || partner.display_name || partner.username || "?").slice(0, 2).toUpperCase()}</Body>}
              />
              <View style={styles.logoTextWrap}>
                <View style={styles.cardTop}>
                  <Heading>{partner.name || partner.display_name || partner.username}</Heading>
                  <Badge label={partner.kind || partner.internal_role || "Partner"} />
                </View>
                <Muted>{partner.description || `${partner.country || "Community"} · ${(partner.favorite_games || []).join(", ") || "THE LION SQUAD"}`}</Muted>
                {partner.url || partner.link ? <Muted style={styles.link}>Website öffnen</Muted> : null}
              </View>
            </View>
          </Card>
        </LinkedCard>
      ))}
    </>
  );
}

function Events({ items, onOpen }: { items: any[]; onOpen: (event: any) => void }) {
  if (!items.length) return <EmptyState title="Keine Events" detail="Veröffentlichte Vereins- und Community-Events landen hier." />;
  return (
    <>
      {items.map((event) => (
        <ContentCard
          key={event.id}
          date={event.date || event.start_date}
          description={event.description}
          detail={placeParts(event.location, event.city, event.country).join(", ") || "Ort offen"}
          image={event.banner_url}
          kind="event"
          onPress={() => onOpen(event)}
          phase={event.public_phase}
          status={event.status}
          title={event.title || event.name}
        />
      ))}
    </>
  );
}

function Benefits({ isMember, membership, items }: { isMember: boolean; membership?: Record<string, unknown> | null; items: any[] }) {
  const status = String(membership?.member_status || membership?.status || (isMember ? "active" : "inactive"));
  const type = String(membership?.membership_type || membership?.type || "");
  // "active (ordinary)" stand vorher roh in der Karte (#246).
  const statusLabel = isMember ? formatMembershipStatus(status) : "Gesperrt";
  const typeLabel = formatMembershipType(type);
  return (
    <>
      <Card style={[styles.card, isMember ? styles.memberCard : styles.locked]}>
        <View style={styles.cardTop}>
          <Heading>{isMember ? "Mitgliedschaft aktiv" : "Mitgliedschaft erforderlich"}</Heading>
          <Badge label={statusLabel} />
        </View>
        <Muted>{isMember ? `Die Vorteile sind für dich freigeschaltet${typeLabel ? ` · ${typeLabel}` : ""}.` : "Diese Vorteile gibt es für Vereinsmitglieder."}</Muted>
      </Card>
      {items.map((benefit) => (
        <Card key={benefit.id || benefit.title} style={[styles.card, !isMember && (benefit.memberOnly || benefit.member_only) && styles.locked]}>
          <View style={styles.cardTop}>
            <Heading>{benefit.title}</Heading>
            <Badge label={benefit.category || benefit.kind || "Mitglieder"} />
          </View>
          <Muted>{benefit.description}</Muted>
          <Muted style={isMember ? styles.memberOk : styles.memberLocked}>{isMember ? "Freigeschaltet" : "Gesperrt"}</Muted>
        </Card>
      ))}
      {!items.length ? <EmptyState title="Noch keine Vorteile eingetragen" detail="Sobald der Verein Vorteile eingetragen hat, stehen sie hier." /> : null}
    </>
  );
}

function References({ items, summary }: { items: Reference[]; summary: ReferenceSummary | null }) {
  if (!items.length) return <EmptyState title="Keine Referenzen" detail="Externe Turniere und Ligen, bei denen der Verein angetreten ist, erscheinen hier." />;
  return (
    <>
      {summary ? (
        <View style={styles.summaryRow} testID="reference-summary">
          <SummaryTile label="Teilnahmen" value={summary.total} />
          <SummaryTile label="Podeste" value={summary.podiums} tone="gold" />
          <SummaryTile label="Gold" value={summary.gold} tone="gold" />
          <SummaryTile label="Spiele" value={summary.games} />
        </View>
      ) : null}
      {items.map((reference) => <ReferenceCard key={reference.id} item={reference} />)}
    </>
  );
}

function SummaryTile({ label, value, tone = "cyan" }: { label: string; value: number; tone?: "cyan" | "gold" }) {
  return (
    <View style={styles.summaryTile}>
      <Body style={[styles.summaryValue, tone === "gold" && styles.summaryValueGold]}>{value}</Body>
      <Muted style={styles.summaryLabel} numberOfLines={1}>{label}</Muted>
    </View>
  );
}

// Wie die Karte auf lionsquad.at/references: Platzierung groß, Titel, Spiel,
// Datum, Lineup, Link zum Turnier.
function ReferenceCard({ item }: { item: Reference }) {
  const placement = Number(item.placement);
  const placed = Number.isFinite(placement) && placement > 0;
  const placementText = item.placement_label || (placed ? `${placement}.` : "Teilnahme");
  const game = item.game?.display_name || item.game?.name || item.game_name || "";
  const lineup = (item.lineup_members || []).map((member) => member.display_name).filter(Boolean);
  const meta = [item.organizer, item.team_name, item.start_date ? formatDate(item.start_date) : "", item.location].filter(Boolean).join(" · ");
  const tags = [
    ...(item.reference_meta?.platforms || []).map((platform) => platform.label),
    ...(item.reference_meta?.title_segments || []),
  ].filter(Boolean);
  const link = item.tournament_url || item.source_url || null;
  const status = REFERENCE_STATUS[String(item.status || "completed")] || REFERENCE_STATUS.completed;
  return (
    <LinkedCard url={link}>
      <Card style={styles.card}>
        <View style={styles.refTop}>
          <View style={[styles.refRank, placement === 1 && styles.refRankGold, placement === 2 && styles.refRankSilver, placement === 3 && styles.refRankBronze]}>
            <Body style={[styles.refRankText, !placed && styles.refRankTextSmall]} numberOfLines={1} adjustsFontSizeToFit>{placementText}</Body>
            <Muted style={styles.refRankLabel} numberOfLines={1}>
              {item.teams_count ? `${item.teams_count} Teams` : item.participants_count ? `${item.participants_count} Teilnehmer` : "Platz"}
            </Muted>
          </View>
          <View style={styles.refText}>
            <View style={styles.wrap}>
              <Badge label={status} />
              {game ? <Badge label={game} /> : null}
            </View>
            <Body style={styles.strong}>{item.title || "Referenz"}</Body>
            {meta ? <Muted>{meta}</Muted> : null}
          </View>
        </View>
        {item.description ? <Muted numberOfLines={3}>{item.description}</Muted> : null}
        {tags.length ? <View style={styles.wrap}>{tags.map((tag) => <Badge key={tag} label={tag} />)}</View> : null}
        {lineup.length ? <Muted>Lineup: {lineup.join(", ")}</Muted> : null}
        {link ? <Muted style={styles.link}>Turnier öffnen</Muted> : null}
      </Card>
    </LinkedCard>
  );
}

function Profiles({ items, onOpen }: { items: any[]; onOpen: (profile: any) => void }) {
  if (!items.length) return <EmptyState title="Keine Profile" detail="Öffentliche Profile werden hier angezeigt, sobald sie sichtbar freigegeben sind." />;
  return (
    <>
      {items.map((profile) => (
        <Pressable key={profile.id} onPress={() => onOpen(profile)} style={({ pressed }) => [pressed && styles.pressed]}>
          <Card style={styles.card}>
            <View style={styles.profileRow}>
            <MediaImage
              uri={profile.avatar_url}
              style={styles.avatar}
              fallback={<Body style={styles.avatarText}>{(profile.name || profile.display_name || profile.username || "?").slice(0, 1).toUpperCase()}</Body>}
            />
            <View style={styles.profileText}>
              <Heading>{profile.name || profile.display_name || profile.username}</Heading>
              {/* "community_user" stand vorher roh neben dem Namen (#246). */}
              <Muted>@{profile.username} · {formatRole(profile.user_type || profile.role) || profile.achievement_level?.title || "Community"}</Muted>
            </View>
            <Ionicons name="chevron-forward" color={colors.muted} size={18} />
          </View>
          <View style={styles.wrap}>
            {(profile.games || profile.favorite_games || []).map((game: string) => <Badge key={game} label={game} />)}
          </View>
          {achievementLine(profile) ? <Muted>{achievementLine(profile)}</Muted> : null}
          <Muted style={styles.link}>Profil öffnen</Muted>
          </Card>
        </Pressable>
      ))}
    </>
  );
}

/** "3 Erfolge · 120 Punkte" - bei null Erfolgen nichts, statt "0 Achievements hinterlegt". */
export function achievementLine(profile: { achievements_count?: number | null; achievements?: unknown[] | null; achievement_points?: number | null; points?: number | null }) {
  const count = Number(profile.achievements_count ?? profile.achievements?.length ?? 0);
  if (!count) return "";
  const points = Number(profile.achievement_points ?? profile.points ?? 0);
  return `${count} ${count === 1 ? "Erfolg" : "Erfolge"}${points ? ` · ${points} Punkte` : ""}`;
}

function LinkedCard({ url, children }: { url?: string | null; children: React.ReactNode }) {
  const href = normalizeLink(url);
  if (!href) return <>{children}</>;
  return (
    <Pressable onPress={() => Linking.openURL(href)} style={({ pressed }) => [pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

function normalizeLink(url?: string | null) {
  const value = String(url || "").trim();
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <Muted style={styles.badgeText}>{label}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: "row",
    gap: 8,
  },
  summaryTile: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 10,
  },
  summaryValue: {
    color: colors.cyan,
    fontSize: 20,
    fontWeight: "900",
  },
  summaryValueGold: {
    color: colors.gold,
  },
  summaryLabel: {
    fontSize: 11,
  },
  refTop: {
    flexDirection: "row",
    gap: 12,
  },
  refRank: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 64,
    paddingHorizontal: 6,
    paddingVertical: 8,
    width: 78,
  },
  refRankGold: {
    borderColor: "rgba(255,215,0,0.55)",
  },
  refRankSilver: {
    borderColor: "rgba(192,192,192,0.55)",
  },
  refRankBronze: {
    borderColor: "rgba(205,127,50,0.55)",
  },
  refRankText: {
    color: colors.white,
    fontSize: 22,
    fontWeight: "900",
  },
  refRankTextSmall: {
    fontSize: 13,
  },
  refRankLabel: {
    fontSize: 11,
  },
  refText: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 30,
  },
  header: {
    gap: 6,
  },
  card: {
    gap: 10,
  },
  cardTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  badge: {
    backgroundColor: "rgba(41, 182, 232, 0.12)",
    borderColor: "rgba(41, 182, 232, 0.3)",
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "900",
  },
  link: {
    color: colors.cyan,
    fontWeight: "800",
  },
  logoRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  logoBox: {
    borderRadius: 8,
    height: 58,
    width: 76,
  },
  logoFallback: {
    color: colors.cyan,
    fontWeight: "900",
  },
  logoTextWrap: {
    flex: 1,
    gap: 8,
  },
  strong: {
    fontWeight: "900",
  },
  locked: {
    opacity: 0.56,
  },
  memberCard: {
    borderColor: "rgba(0, 255, 136, 0.32)",
  },
  memberOk: {
    color: colors.success,
    fontWeight: "900",
  },
  memberLocked: {
    color: colors.live,
    fontWeight: "900",
  },
  profileRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  pressed: {
    opacity: 0.72,
  },
  avatarText: {
    fontWeight: "900",
  },
  profileText: {
    flex: 1,
    gap: 2,
  },
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  // Sponsoren-Grid: nur Logos, klickbar
  sponsorGroups: {
    gap: 18,
  },
  sponsorGroup: {
    gap: 8,
  },
  sponsorTierLabel: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  sponsorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  sponsorTile: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: 6,
  },
  sponsorLogo: {
    backgroundColor: "transparent",
    borderWidth: 0,
    width: "100%",
  },
  sponsorFallback: {
    color: colors.white,
    fontWeight: "900",
    textAlign: "center",
  },
  eyebrow: {
    color: colors.cyan,
    fontWeight: "900",
    textTransform: "uppercase",
  },
});
