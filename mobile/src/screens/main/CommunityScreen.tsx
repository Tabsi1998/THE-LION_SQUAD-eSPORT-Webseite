import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { Card } from "../../components/Card";
import { FriendsCard } from "../../components/FriendsCard";
import { EmptyState, SkeletonList } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { TabHeader, useTabScrollToTop } from "../../components/TabHeader";
import { Body, Heading, Muted } from "../../components/Text";
import { useChats } from "../../chats/ChatsContext";
import { api } from "../../lib/api";
import { badgeText } from "../../lib/chats";
import { isGuestUser } from "../../live";
import type { AppStackParamList, CommunitySection } from "../../navigation/types";
import { colors } from "../../theme";
import { ChatsSection } from "./community/ChatsSection";
import { TeamsSection } from "./TeamsScreen";

// Der Tab Community (#1143): Chats, Teams (Einladungen, Meine, Entdecken), Spieler und Freunde, Bestenlisten
// (Jahreswertung, Erfolge). Oben dieselbe Kopfzeile wie in jedem Tab (#1145); was man öffnet, legt sich über den Tab.

type Props = NativeStackScreenProps<AppStackParamList, "CommunityHub">;

export const COMMUNITY_SECTIONS: Array<{ key: CommunitySection; label: string }> = [
  { key: "chats", label: "Chats" },
  { key: "teams", label: "Teams" },
  { key: "players", label: "Spieler" },
  { key: "leaderboards", label: "Bestenlisten" },
];

export function CommunityScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const guest = isGuestUser(user);
  // Gäste haben keine Chats: sie landen bei den Teams.
  const [section, setSection] = useState<CommunitySection>(route.params?.section || (guest ? "teams" : "chats"));
  useEffect(() => {
    if (route.params?.section) setSection(route.params.section);
  }, [route.params?.section]);
  // Anmelden und Abmelden lassen die Tabs geladen (Gast zuerst, #918): wechselt der Stand, gilt der Standard neu -
  // sonst stünde ein frisch angemeldetes Mitglied mit ungelesenen Chats weiter bei den Teams aus der Gast-Zeit.
  const wasGuest = useRef(guest);
  useEffect(() => {
    if (wasGuest.current === guest) return;
    wasGuest.current = guest;
    setSection(guest ? "teams" : "chats");
  }, [guest]);
  const { list } = useChats();
  const items = COMMUNITY_SECTIONS.map((item) => (item.key === "chats" && list.unread_total ? { ...item, label: `Chats ${badgeText(list.unread_total)}` } : item));
  const nav = navigation as unknown as { navigate: (screen: never, params?: never) => void };

  return (
    <Screen padded={false}>
      <View style={styles.head}>
        <TabHeader title="Community" testID="community-header" />
        <SegmentedTabs items={items} value={section} onChange={setSection} />
      </View>
      <View style={styles.body} testID={`community-section-${section}`}>
        {section === "chats" ? <ChatsSection navigation={nav} guest={guest} /> : null}
        {section === "teams" ? <TeamsSection navigation={nav} /> : null}
        {section === "players" ? <PlayersSection navigation={nav} guest={guest} /> : null}
        {section === "leaderboards" ? <LeaderboardsSection navigation={nav} /> : null}
      </View>
    </Screen>
  );
}

type Navigation = { navigate: (screen: never, params?: never) => void };
type PublicPlayer = { id: string; username?: string; display_name?: string; name?: string; avatar_url?: string | null; favorite_games?: string[]; games?: string[]; achievement_level?: { title?: string; level?: number } };

/** Spieler und Freunde: oben die eigenen Freunde mit offenen Anfragen, darunter alle öffentlichen Profile mit Suche. */
function PlayersSection({ navigation, guest }: { navigation: Navigation; guest: boolean }) {
  const [players, setPlayers] = useState<PublicPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  useTabScrollToTop(scrollRef);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get<PublicPlayer[]>("/users/public-list");
      setPlayers(Array.isArray(data) ? data : []);
    } catch {
      setPlayers([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const openProfile = (username?: string) => {
    if (username) navigation.navigate("PublicProfile" as never, { username } as never);
  };
  const needle = filter.trim().toLowerCase();
  const shown = useMemo(() => players.filter((player) => !needle || [player.display_name, player.name, player.username].some((value) => String(value || "").toLowerCase().includes(needle))), [needle, players]);
  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.cyan} />}>
      {/* Freunde (#240): offene Anfragen oben, darunter die Liste - seit #1143 hier statt im Profil. */}
      {!guest ? <FriendsCard onOpenProfile={openProfile} /> : null}
      <Heading>Spieler</Heading>
      <View style={styles.filter}>
        <Ionicons name="search-outline" color={colors.muted} size={16} />
        <TextInput value={filter} onChangeText={setFilter} placeholder="Name filtern" placeholderTextColor={colors.muted} style={styles.filterInput} testID="players-filter" />
      </View>
      {loading ? <SkeletonList count={4} hasImage={false} /> : null}
      {!loading && !shown.length ? <EmptyState icon="people-outline" title="Keine Profile" detail="Öffentliche Profile stehen hier, sobald sie sichtbar freigegeben sind." /> : null}
      {shown.map((player) => {
        const name = player.display_name || player.name || player.username || "Spieler";
        const games = player.games || player.favorite_games || [];
        return (
          <Pressable key={player.id} onPress={() => openProfile(player.username)} accessibilityRole="button" style={({ pressed }) => [styles.playerRow, pressed && styles.pressed]} testID={`player-${player.username}`}>
            <MediaImage uri={player.avatar_url} style={styles.playerAvatar} fallback={<Body style={styles.playerInitial}>{name.slice(0, 1).toUpperCase()}</Body>} />
            <View style={styles.playerText}>
              <Body style={styles.strong} numberOfLines={1}>{name}</Body>
              <Muted numberOfLines={1}>{[player.achievement_level?.title, games.slice(0, 2).join(", ")].filter(Boolean).join(" · ") || `@${player.username || ""}`}</Muted>
            </View>
            <Ionicons name="chevron-forward" color={colors.muted} size={16} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

type Standing = { rank: number; display_name?: string; username?: string; points?: number; total_points?: number; season_points?: number };
type Leader = { rank?: number; display_name?: string; username?: string; points?: number; value?: number };

/** Bestenlisten: die Jahreswertung und die Erfolge - je die ersten drei, ein Tipp öffnet die ganze Liste. */
function LeaderboardsSection({ navigation }: { navigation: Navigation }) {
  const [season, setSeason] = useState<{ name?: string; standings: Standing[] } | null>(null);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  useTabScrollToTop(scrollRef);
  const load = useCallback(async () => {
    const [seasonResult, leaderResult] = await Promise.all([
      api.get<{ season?: { name?: string } | null; standings?: Standing[] }>("/seasons/active/featured").catch(() => ({ data: null })),
      api.get<Leader[] | { items?: Leader[] }>("/achievements/leaderboard", { params: { limit: 3, by: "points" } }).catch(() => ({ data: [] as Leader[] })),
    ]);
    const seasonData = seasonResult.data;
    setSeason(seasonData?.season ? { name: seasonData.season.name, standings: Array.isArray(seasonData.standings) ? seasonData.standings : [] } : null);
    const rows = Array.isArray(leaderResult.data) ? leaderResult.data : Array.isArray((leaderResult.data as { items?: Leader[] })?.items) ? (leaderResult.data as { items: Leader[] }).items : [];
    setLeaders(rows);
    setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <ScrollView ref={scrollRef} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.cyan} />}>
      <BoardCard
        icon="trophy-outline"
        title="Jahreswertung"
        detail={season?.name || "Punkte aus Turnieren, Fast Laps und Events über das Jahr."}
        rows={(season?.standings || []).slice(0, 3).map((row) => ({ rank: row.rank, name: row.display_name || row.username || "Spieler", value: `${Number(row.total_points ?? row.season_points ?? row.points ?? 0).toLocaleString("de-DE")} P.` }))}
        onPress={() => navigation.navigate("SeasonPass" as never)}
        testID="board-season"
      />
      <BoardCard
        icon="sparkles-outline"
        title="Erfolge"
        detail="Erfolg der Woche, Ranglisten und alle Erfolge mit Seltenheit."
        rows={leaders.slice(0, 3).map((row, index) => ({ rank: Number(row.rank || index + 1), name: row.display_name || row.username || "Spieler", value: `${Number(row.points ?? row.value ?? 0).toLocaleString("de-DE")} Punkte` }))}
        onPress={() => navigation.navigate("AchievementShowcase" as never)}
        testID="board-achievements"
      />
    </ScrollView>
  );
}

function BoardCard({ icon, title, detail, rows, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string; rows: Array<{ rank: number; name: string; value: string }>; onPress: () => void; testID: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [pressed && styles.pressed]} testID={testID}>
      <Card style={styles.board} perch={testID}>
        <View style={styles.boardHead}>
          <View style={styles.boardIcon}><Ionicons name={icon} color={colors.gold} size={20} /></View>
          <View style={styles.playerText}>
            <Heading>{title}</Heading>
            <Muted>{detail}</Muted>
          </View>
          <Muted style={styles.all}>Alle</Muted>
        </View>
        {rows.map((row) => (
          <View key={`${row.rank}-${row.name}`} style={styles.boardRow}>
            <Body style={[styles.rank, row.rank === 1 && styles.rankGold]}>{row.rank}.</Body>
            <Body style={styles.boardName} numberOfLines={1}>{row.name}</Body>
            <Muted>{row.value}</Muted>
          </View>
        ))}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: {
    gap: 12,
    paddingBottom: 12,
    paddingHorizontal: 18,
    // Wie der Abstand der anderen Tabs (Inhalt mit padding 18): sonst springt der Titel beim Tab-Wechsel um 8 Punkte.
    paddingTop: 18,
    zIndex: 2,
  },
  body: {
    flex: 1,
  },
  content: {
    gap: 12,
    paddingBottom: 28,
    paddingHorizontal: 18,
  },
  filter: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  filterInput: {
    color: colors.white,
    flex: 1,
    fontSize: 15,
  },
  playerRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 58,
    paddingVertical: 8,
  },
  playerAvatar: {
    alignItems: "center",
    backgroundColor: "rgba(41,182,232,0.14)",
    borderRadius: 21,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  playerInitial: {
    color: colors.cyan,
    fontWeight: "900",
  },
  playerText: {
    flex: 1,
    gap: 2,
  },
  strong: {
    fontWeight: "800",
  },
  board: {
    gap: 10,
  },
  boardHead: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  boardIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255,215,0,0.12)",
    borderRadius: 8,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  all: {
    color: colors.cyan,
    fontWeight: "800",
  },
  boardRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 8,
  },
  rank: {
    color: colors.muted,
    fontWeight: "900",
    width: 26,
  },
  rankGold: {
    color: colors.gold,
  },
  boardName: {
    flex: 1,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.72,
  },
});
