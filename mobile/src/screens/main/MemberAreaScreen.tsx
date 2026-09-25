import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Card } from "../../components/Card";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../lib/api";
import { formatDate, formatDateTime } from "../../lib/format";
import { boardContacts, memberEvents, memberNews, type BoardContact } from "../../lib/memberArea";
import type { MemberDocument } from "../../lib/memberDocuments";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { ClubEvent, NewsPost } from "../../types";

// Der Mitgliederbereich in der App (#340): dieselben Inhalte wie lionsquad.at/members, nur
// gestapelt. Was jemand sehen darf, entscheidet der Server (Events, News und Dokumente kommen
// bereits gefiltert); hier wird nur sortiert und verwiesen.

type Props = NativeStackScreenProps<MoreStackParamList, "MemberArea">;

type Membership = { member_number?: string | null; member_since?: string | null; member_status?: string | null } | null;
// „Gerade in Steam“ (#584): nur Mitglieder mit verknüpftem Konto und Opt-in, nur der aktuelle Stand.
type SteamPlayer = { user_id: string; username?: string | null; display_name?: string | null; avatar_url?: string | null; state: "playing" | "online"; state_text: string; game?: string | null };
type SteamPresence = { available: boolean; stale?: boolean; online_count: number; players: SteamPlayer[]; me?: { linked?: boolean; opted_in?: boolean } };

export function steamSummary(presence: SteamPresence | null): string {
  if (!presence) return "";
  if (presence.stale) return "Stand veraltet – Steam wurde länger nicht abgefragt.";
  const count = presence.online_count || 0;
  if (!count) return "Gerade niemand in Steam.";
  return count === 1 ? "Ein Mitglied gerade in Steam" : `${count} Mitglieder gerade in Steam`;
}

export function MemberAreaScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [membership, setMembership] = useState<Membership>(null);
  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [news, setNews] = useState<NewsPost[]>([]);
  const [docs, setDocs] = useState<MemberDocument[]>([]);
  const [benefits, setBenefits] = useState<any[]>([]);
  const [contacts, setContacts] = useState<BoardContact[]>([]);
  const [discordUrl, setDiscordUrl] = useState("");
  const [steam, setSteam] = useState<SteamPresence | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [my, liveEvents, liveNews, liveDocs, liveBenefits, board, settings, presence] = await Promise.allSettled([
      api.get<{ membership?: Membership }>("/membership/me"),
      api.get<ClubEvent[]>("/events", { params: { upcoming: true, compact: true, limit: 48 } }),
      api.get<NewsPost[]>("/news"),
      api.get<MemberDocument[]>("/documents"),
      api.get<any[]>("/membership/benefits"),
      api.get<any[]>("/board", { params: { active_only: true } }),
      api.get<{ discord_invite_url?: string }>("/settings/public"),
      api.get<SteamPresence>("/membership/steam-presence"),
    ]);
    if (my.status === "fulfilled") setMembership(my.value.data?.membership || null);
    if (liveEvents.status === "fulfilled") setEvents(memberEvents(Array.isArray(liveEvents.value.data) ? liveEvents.value.data : []));
    if (liveNews.status === "fulfilled") setNews(memberNews(Array.isArray(liveNews.value.data) ? liveNews.value.data : []));
    if (liveDocs.status === "fulfilled") setDocs(Array.isArray(liveDocs.value.data) ? liveDocs.value.data : []);
    if (liveBenefits.status === "fulfilled") setBenefits(Array.isArray(liveBenefits.value.data) ? liveBenefits.value.data : []);
    if (board.status === "fulfilled") setContacts(boardContacts(Array.isArray(board.value.data) ? board.value.data : []));
    if (settings.status === "fulfilled") setDiscordUrl(String(settings.value.data?.discord_invite_url || ""));
    if (presence.status === "fulfilled") setSteam(presence.value.data?.available ? presence.value.data : null);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, ["membership", "documents", "news", "events", "board", "settings"], { fallbackMs: 60000 });

  const openEvent = (event: ClubEvent) => navigation.getParent()?.navigate("Tournaments", { screen: "EventDetail", params: { id: event.slug || event.id } });
  const nothingYet = !loading && !events.length && !docs.length && !benefits.length && !news.length;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
      >
        <Card style={styles.hero} testID="member-area-hero">
          <View style={styles.heroRow}>
            <View style={styles.crown}><Ionicons name="ribbon-outline" color={colors.gold} size={26} /></View>
            <View style={styles.heroText}>
              <Muted style={styles.eyebrow}>Mitgliederbereich</Muted>
              <Title style={styles.heroTitle}>Willkommen, {user?.display_name || user?.username}</Title>
              <Muted>
                {[membership?.member_number ? `Nr. ${membership.member_number}` : "", membership?.member_since ? `Mitglied seit ${formatDate(membership.member_since)}` : ""].filter(Boolean).join(" · ") || "Aktives Mitglied"}
              </Muted>
            </View>
          </View>
        </Card>

        <View style={styles.tiles}>
          <Tile icon="card-outline" label="Mitgliedschaft" onPress={() => navigation.navigate("MyMembership")} testID="member-area-membership" />
          <Tile icon="qr-code-outline" label="Mitgliedskarte" onPress={() => navigation.navigate("MemberCard")} testID="member-area-card" />
          <Tile icon="document-text-outline" label={docs.length ? `Dokumente (${docs.length})` : "Dokumente"} onPress={() => navigation.navigate("MemberDocuments")} testID="member-area-documents" />
          <Tile icon="people-outline" label="Versammlungen" onPress={() => navigation.navigate("MemberMeetings")} testID="member-area-meetings" />
          <Tile icon="hand-left-outline" label="Helfen" onPress={() => navigation.navigate("MemberHelperShifts")} testID="member-area-helping" />
          <Tile icon="gift-outline" label="Vorteile" onPress={() => navigation.navigate("InfoCenter", { section: "benefits" })} testID="member-area-benefits" />
          <Tile icon="images-outline" label="Galerie" onPress={() => navigation.navigate("Gallery")} testID="member-area-gallery" />
        </View>

        {loading ? <SkeletonList count={3} hasImage={false} /> : null}

        {nothingYet ? (
          <EmptyState icon="notifications-outline" tone="gold" title="Noch nichts Neues" detail="Sobald der Verein etwas freischaltet, steht es hier: interne Events, Dokumente, Vorteile, interne News." />
        ) : null}

        {events.length ? (
          <Section title="Interne Events" testID="member-area-events">
            {events.slice(0, 3).map((event) => (
              <Pressable key={event.id} onPress={() => openEvent(event)} accessibilityRole="button" style={({ pressed }) => [styles.line, pressed && styles.pressed]}>
                <Muted style={styles.lineDate}>{event.start_date ? formatDateTime(event.start_date) : "Termin folgt"}</Muted>
                <Body style={styles.lineTitle}>{event.title || event.name}</Body>
                {event.location ? <Muted>{event.location}</Muted> : null}
              </Pressable>
            ))}
          </Section>
        ) : null}

        {news.length ? (
          <Section title="Interne News" testID="member-area-news">
            {news.map((post) => (
              <Pressable key={post.id} onPress={() => navigation.navigate("NewsDetail", { id: post.slug || post.id })} accessibilityRole="button" style={({ pressed }) => [styles.line, pressed && styles.pressed]}>
                <Muted style={styles.lineDate}>{formatDate(post.published_at || post.created_at)}</Muted>
                <Body style={styles.lineTitle}>{post.title}</Body>
              </Pressable>
            ))}
          </Section>
        ) : null}

        {steam ? (
          <Section title="Gerade in Steam" testID="member-area-steam">
            <Muted testID="member-area-steam-summary">{steamSummary(steam)}</Muted>
            {steam.players.map((player) => (
              <Pressable
                key={player.user_id}
                disabled={!player.username}
                onPress={() => player.username && navigation.navigate("PublicProfile", { username: player.username })}
                accessibilityRole="button"
                style={({ pressed }) => [styles.contact, pressed && styles.pressed]}
                testID={`member-area-steam-${player.user_id}`}
              >
                <MediaImage uri={player.avatar_url || undefined} style={styles.avatar} fallback={<Ionicons name="logo-steam" color={colors.muted} size={18} />} />
                <View style={styles.contactText}>
                  <Body style={styles.lineTitle}>{player.display_name || player.username}</Body>
                  <Muted>{player.state_text}</Muted>
                </View>
              </Pressable>
            ))}
            {steam.me && steam.me.linked && !steam.me.opted_in ? <Muted>Auch dabei sein: auf lionsquad.at unter Profil → Socials „Meinen Steam-Status im Mitgliederbereich zeigen“ einschalten.</Muted> : null}
          </Section>
        ) : null}

        {benefits.length ? (
          <Section title="Mitgliedervorteile" testID="member-area-benefit-list" more={() => navigation.navigate("InfoCenter", { section: "benefits" })}>
            {benefits.slice(0, 3).map((benefit) => (
              <View key={benefit.id || benefit.title} style={styles.line}>
                <Body style={styles.lineTitle}>{benefit.title}</Body>
                {benefit.description ? <Muted numberOfLines={2}>{benefit.description}</Muted> : null}
              </View>
            ))}
          </Section>
        ) : null}

        {contacts.length ? (
          <Section title="Ansprechpartner" testID="member-area-board">
            {contacts.map((contact) => (
              <Pressable
                key={contact.id}
                disabled={!contact.username}
                onPress={() => contact.username && navigation.navigate("PublicProfile", { username: contact.username })}
                accessibilityRole="button"
                style={({ pressed }) => [styles.contact, pressed && styles.pressed]}
              >
                <MediaImage uri={contact.avatar} style={styles.avatar} fallback={<Ionicons name="person-outline" color={colors.muted} size={18} />} />
                <View style={styles.contactText}>
                  <Body style={styles.lineTitle}>{contact.name}</Body>
                  <Muted>{contact.title}</Muted>
                </View>
                {contact.username ? <Ionicons name="chevron-forward" color={colors.muted} size={16} /> : null}
              </Pressable>
            ))}
          </Section>
        ) : null}

        {discordUrl ? (
          <Pressable onPress={() => { Linking.openURL(discordUrl).catch(() => {}); }} accessibilityRole="link" testID="member-area-discord" style={({ pressed }) => [styles.discord, pressed && styles.pressed]}>
            <Ionicons name="logo-discord" color="#5865F2" size={22} />
            <Body style={styles.discordText}>Zum Vereins-Discord</Body>
            <Ionicons name="open-outline" color={colors.muted} size={16} />
          </Pressable>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Tile({ icon, label, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={testID} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      <Ionicons name={icon} color={colors.gold} size={22} />
      <Body style={styles.tileLabel} numberOfLines={1}>{label}</Body>
    </Pressable>
  );
}

function Section({ title, children, more, testID }: { title: string; children: React.ReactNode; more?: () => void; testID?: string }) {
  return (
    <View style={styles.section} testID={testID}>
      <View style={styles.sectionHead}>
        <Heading>{title}</Heading>
        {more ? (
          <Pressable onPress={more} accessibilityRole="button" hitSlop={8}>
            <Muted style={styles.more}>Alle</Muted>
          </Pressable>
        ) : null}
      </View>
      <Card style={styles.sectionCard}>{children}</Card>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    padding: 18,
    paddingBottom: 32,
  },
  hero: {
    backgroundColor: "rgba(255, 215, 0, 0.06)",
    borderColor: "rgba(255, 215, 0, 0.4)",
  },
  heroRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
  },
  crown: {
    alignItems: "center",
    backgroundColor: "rgba(255, 215, 0, 0.16)",
    borderColor: "rgba(255, 215, 0, 0.5)",
    borderRadius: 8,
    borderWidth: 1,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  heroText: {
    flex: 1,
    gap: 2,
  },
  heroTitle: {
    fontSize: 22,
  },
  eyebrow: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  tile: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    gap: 6,
    paddingVertical: 14,
  },
  tileLabel: {
    fontWeight: "900",
  },
  section: {
    gap: 10,
  },
  sectionHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionCard: {
    gap: 12,
  },
  more: {
    color: colors.gold,
    fontWeight: "900",
  },
  line: {
    borderLeftColor: "rgba(255, 215, 0, 0.5)",
    borderLeftWidth: 2,
    gap: 2,
    paddingLeft: 10,
  },
  lineDate: {
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  lineTitle: {
    fontWeight: "900",
  },
  contact: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  contactText: {
    flex: 1,
    gap: 1,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: colors.black,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  discord: {
    alignItems: "center",
    backgroundColor: "rgba(88, 101, 242, 0.1)",
    borderColor: "rgba(88, 101, 242, 0.4)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  discordText: {
    flex: 1,
    fontWeight: "900",
  },
  pressed: {
    opacity: 0.72,
  },
});
