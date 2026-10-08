import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { useAdventEntry } from "../../advent/entry";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { MediaImage } from "../../components/MediaImage";
import { MemberCardArt } from "../../components/MemberCardArt";
import { Screen } from "../../components/Screen";
import { TabHeader, useTabScrollToTop } from "../../components/TabHeader";
import { Body, Heading, Muted } from "../../components/Text";
import { API_BASE_URL } from "../../config";
import { canAdmit } from "../../lib/admission";
import { api } from "../../lib/api";
import { formatDate } from "../../lib/format";
import {
  areaCard, boardContacts, feeAmount, feeBadge, feesStandLine, memberNews, tileNote,
  type AreaSummary, type BoardContact, type DolibarrView, type FeeBadge, type PublicFees,
} from "../../lib/memberArea";
import { openLink } from "../../lib/openLink";
import { isGuestUser } from "../../live";
import type { AppStackParamList, LooseNavigation } from "../../navigation/types";
import { useLiveRefresh } from "../../realtime/LiveChangesProvider";
import { SeasonShelfSlot } from "../../seasons/SeasonStage";
import { seasonScrollProps } from "../../seasons/sky/scroll";
import { colors } from "../../theme";
import type { NewsPost } from "../../types";

// Der Tab Verein (#1147): alles vom Verein an einem Ort. Mitglieder sehen oben ihre Mitgliedskarte mit „Hallo“, „Mitglied
// seit“ und dem Beitragsstand (#1336), darunter die Kacheln (Karte, Mitgliedschaft, Versammlungen, Helfen, Dokumente,
// Vorteile) mit denselben Zahlen wie im Mitgliederbereich der Website (#1257) und interne News; alle anderen oben „Mitglied werden“ mit drei
// Gründen. Darunter für alle: News, Galerie, Referenzen, Sponsoren, Partner und „Folge uns“. Der Einlass steht oben, nur
// für den Vorstand. Rechnungen liegen im Profil („Nur für dich“), interne Termine im Events-Tab (gold markiert) - jedes
// Thema an genau einem Ort (#1150). Was jemand sehen darf, entscheidet der Server; hier wird nur sortiert und verwiesen.

type Props = NativeStackScreenProps<AppStackParamList, "VereinHub">;

// Wer noch nicht Mitglied ist, landet auf der Beitrittsseite der Website (#340).
export const JOIN_URL = `${API_BASE_URL}/membership/join`;

type Membership = { member_number?: string | null; member_since?: string | null; member_status?: string | null; membership_type?: string | null } | null;
// „Gerade in Steam“ (#584): nur Mitglieder mit verknüpftem Konto und Opt-in, nur der aktuelle Stand.
type SteamPlayer = { user_id: string; username?: string | null; display_name?: string | null; avatar_url?: string | null; state: "playing" | "online"; state_text: string; game?: string | null };
type SteamPresence = { available: boolean; stale?: boolean; online_count: number; players: SteamPlayer[]; me?: { linked?: boolean; opted_in?: boolean } };
// Discord-Server des Vereins (#626): alle eingeschalteten, „Du bist dabei“ nur mit verknüpftem Discord.
type DiscordServer = { available: boolean; guild_id: string; name?: string | null; icon_url?: string | null; member_count?: number | null; invite_url?: string | null; main?: boolean; member?: boolean | null };
type DiscordServers = { linked?: boolean; servers?: DiscordServer[] };
// „Discord jetzt“ (#581): aus dem Server-Widget nur Zahlen - online und je belegtem Sprachkanal, nie Namen.
type DiscordVoice = { available: boolean; online?: number; in_voice?: number; voice?: { name: string; count: number }[]; invite?: string | null };
type SocialLink = { platform?: string; label?: string; url?: string; enabled?: boolean };

export function discordServerLine(server: DiscordServer): string {
  const count = Number(server.member_count) || 0;
  const members = count <= 0 ? "" : count === 1 ? "1 Mitglied" : `${count} Mitglieder`;
  return [server.main ? "Hauptserver" : "", members].filter(Boolean).join(" · ");
}

export function discordSummary(discord: DiscordVoice | null): string {
  if (!discord?.available) return "";
  const online = Number(discord.online) || 0;
  const voice = Number(discord.in_voice) || 0;
  return voice > 0 ? `${online} online · ${voice} im Voice` : `${online} online`;
}

export function steamSummary(presence: SteamPresence | null): string {
  if (!presence) return "";
  if (presence.stale) return "Stand veraltet – Steam wurde länger nicht abgefragt.";
  const count = presence.online_count || 0;
  if (!count) return "Gerade niemand in Steam.";
  return count === 1 ? "Ein Mitglied gerade in Steam" : `${count} Mitglieder gerade in Steam`;
}

// Dieselben Plattform-Schlüssel wie im Web (frontend/src/lib/socialIcons.js).
const SOCIAL_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  discord: "logo-discord",
  whatsapp: "logo-whatsapp",
  telegram: "paper-plane-outline",
  facebook: "logo-facebook",
  instagram: "logo-instagram",
  threads: "at-outline",
  tiktok: "logo-tiktok",
  youtube: "logo-youtube",
  twitch: "logo-twitch",
  kick: "videocam-outline",
  twitter: "logo-twitter",
  x: "logo-twitter",
  bluesky: "cloud-outline",
  mastodon: "logo-mastodon",
  linkedin: "logo-linkedin",
  reddit: "logo-reddit",
  steam: "logo-steam",
  github: "logo-github",
  snapchat: "logo-snapchat",
  pinterest: "logo-pinterest",
  vimeo: "logo-vimeo",
  spotify: "musical-notes-outline",
  email: "mail-outline",
  website: "globe-outline",
};

export function socialIcon(platform?: string | null): keyof typeof Ionicons.glyphMap {
  return SOCIAL_ICONS[String(platform || "").toLowerCase()] || "link-outline";
}

type ClubRow = { key: string; title: string; icon: keyof typeof Ionicons.glyphMap; screen: "NewsList" | "Gallery" | "InfoCenter" | "AdventCalendar"; params?: { section: "references" | "sponsors" | "partners" } };

/** „Vom Verein“ - für alle gleich; der Adventkalender steht nur da, solange er läuft. */
export function clubRows(advent: boolean): ClubRow[] {
  return [
    ...(advent ? [{ key: "advent", title: "Adventkalender", icon: "calendar-outline" as const, screen: "AdventCalendar" as const }] : []),
    { key: "news", title: "News", icon: "newspaper-outline", screen: "NewsList" },
    { key: "gallery", title: "Galerie", icon: "images-outline", screen: "Gallery" },
    { key: "references", title: "Referenzen", icon: "medal-outline", screen: "InfoCenter", params: { section: "references" } },
    { key: "sponsors", title: "Sponsoren", icon: "ribbon-outline", screen: "InfoCenter", params: { section: "sponsors" } },
    { key: "partners", title: "Partner", icon: "link-outline", screen: "InfoCenter", params: { section: "partners" } },
  ];
}

/** Die drei Gründe für „Mitglied werden“ (Muster zu Idee 20). */
export const JOIN_REASONS: Array<{ icon: keyof typeof Ionicons.glyphMap; title: string; detail: string }> = [
  { icon: "qr-code-outline", title: "Mitgliedskarte", detail: "Vorteile bei unseren Partnern" },
  { icon: "people-outline", title: "Mitreden", detail: "Versammlungen und Abstimmungen" },
  { icon: "calendar-outline", title: "Interne Events", detail: "Vereinsabende, Trainings" },
];

export function VereinScreen({ navigation }: Props) {
  const { user } = useAuth();
  const signedIn = Boolean(user && !isGuestUser(user));
  const member = Boolean(signedIn && user?.is_club_member);
  const advent = Boolean(useAdventEntry());
  const [membership, setMembership] = useState<Membership>(null);
  const [erp, setErp] = useState<DolibarrView>(null);
  // Was offen ist (#1257): dieselbe Antwort wie für die Sprungleiste im Mitgliederbereich der Website.
  const [summary, setSummary] = useState<AreaSummary>(null);
  const [news, setNews] = useState<NewsPost[]>([]);
  // Beitrag offen (#1251): für alle, die noch nicht Mitglied sind - dieselben Beträge wie auf der Website.
  const [fees, setFees] = useState<PublicFees>(null);
  const [contacts, setContacts] = useState<BoardContact[]>([]);
  const [discordUrl, setDiscordUrl] = useState("");
  const [socials, setSocials] = useState<SocialLink[]>([]);
  const [steam, setSteam] = useState<SteamPresence | null>(null);
  const [discordServers, setDiscordServers] = useState<DiscordServers | null>(null);
  const [discordVoice, setDiscordVoice] = useState<DiscordVoice | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  useTabScrollToTop(scrollRef);

  const load = useCallback(async () => {
    const settings = api.get<{ discord_invite_url?: string; social_links?: SocialLink[] }>("/settings/public");
    if (!member) {
      const [result, feeResult] = await Promise.all([settings.catch(() => null), api.get<PublicFees>("/membership/fees").catch(() => null)]);
      setSocials(socialList(result?.data?.social_links));
      setFees(feeResult?.data && typeof feeResult.data === "object" ? feeResult.data : null);
      setRefreshing(false);
      return;
    }
    const [my, liveNews, area, board, settingsResult, presence, servers, voice] = await Promise.allSettled([
      api.get<{ membership?: Membership; dolibarr?: DolibarrView }>("/membership/me"),
      api.get<NewsPost[]>("/news"),
      api.get<AreaSummary>("/membership/area-summary"),
      api.get<unknown[]>("/board", { params: { active_only: true } }),
      settings,
      api.get<SteamPresence>("/membership/steam-presence"),
      api.get<DiscordServers>("/membership/discord-servers"),
      api.get<DiscordVoice>("/membership/discord-voice"),
    ]);
    if (my.status === "fulfilled") {
      setMembership(my.value.data?.membership || null);
      setErp(my.value.data?.dolibarr || null);
    }
    if (liveNews.status === "fulfilled") setNews(memberNews(Array.isArray(liveNews.value.data) ? liveNews.value.data : []));
    if (area.status === "fulfilled") setSummary(area.value.data && typeof area.value.data === "object" && !Array.isArray(area.value.data) ? area.value.data : null);
    if (board.status === "fulfilled") setContacts(boardContacts(Array.isArray(board.value.data) ? (board.value.data as never[]) : []));
    if (settingsResult.status === "fulfilled") {
      setDiscordUrl(String(settingsResult.value.data?.discord_invite_url || ""));
      setSocials(socialList(settingsResult.value.data?.social_links));
    }
    if (presence.status === "fulfilled") setSteam(presence.value.data?.available ? presence.value.data : null);
    if (servers.status === "fulfilled") setDiscordServers(servers.value.data || null);
    if (voice.status === "fulfilled") setDiscordVoice(voice.value.data?.available ? voice.value.data : null);
    setRefreshing(false);
  }, [member]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(load, ["membership", "documents", "news", "board", "settings"], { fallbackMs: 60000 });

  const open = (screen: keyof AppStackParamList, params?: object) => (navigation as unknown as LooseNavigation).navigate(screen, params);
  const serverList = (discordServers?.servers || []).filter((server) => server.available);
  const card = areaCard(user, membership, erp);
  const badge = feeBadge(erp);

  return (
    <Screen padded={false}>
      <ScrollView
        ref={scrollRef}
        {...seasonScrollProps("VereinHub")}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={member ? colors.gold : colors.cyan} />}
      >
        <TabHeader title="Verein" testID="verein-header">
          {/* Nikolaus (#736): der Stiefel steht rechts auf der Kante der ersten Karte - seit #1143 im Tab Verein. */}
          <SeasonShelfSlot />
        </TabHeader>

        {/* Einlass (#845, Entscheidung B): der Vorstand scannt am Eingang - nur mit dem Bereich „Verein“. */}
        {user && canAdmit(user) ? (
          <Pressable onPress={() => open("Admission")} accessibilityRole="button" testID="verein-admission" style={({ pressed }) => [styles.admission, pressed && styles.pressed]}>
            <View style={styles.admissionIcon}><Ionicons name="qr-code-outline" color={colors.cyan} size={22} /></View>
            <View style={styles.flex}>
              <Body style={styles.strong}>Einlass</Body>
              <Muted>Mitgliedskarte scannen – Anwesenheit bei der Generalversammlung</Muted>
            </View>
            <Ionicons name="chevron-forward" color={colors.cyan} size={16} />
          </Pressable>
        ) : null}

        {member ? (
          <Card style={styles.memberCard} perch="verein-member" testID="verein-member-area">
            {/* Dieselbe Karte wie im Web (#1335, #1336): ein Tipp öffnet sie mit Prüfcode. */}
            {card ? (
              <Pressable onPress={() => open("MemberCard")} accessibilityRole="button" accessibilityHint="Öffnet die Mitgliedskarte mit Prüfcode" testID="verein-member-card" style={({ pressed }) => [pressed && styles.pressed]}>
                <MemberCardArt name={card.name} number={card.number} since={card.since} typeLabel={card.typeLabel} validUntil={card.validUntil} testID="verein-member-card-art" />
              </Pressable>
            ) : null}
            <View style={styles.greeting}>
              <Muted style={styles.memberEyebrow}>Mitgliederbereich</Muted>
              <Heading testID="verein-member-greeting">Hallo, {user?.display_name || user?.username}</Heading>
              {membership?.member_since ? <Muted testID="verein-member-since">Mitglied seit {formatDate(membership.member_since)}</Muted> : null}
              {badge ? <FeeBadgeView badge={badge} /> : null}
            </View>
            <View style={styles.tiles}>
              <Tile icon="qr-code-outline" label="Karte" onPress={() => open("MemberCard")} testID="member-area-card" />
              <Tile icon="card-outline" label="Mitgliedschaft" onPress={() => open("MyMembership")} testID="member-area-membership" />
              <Tile icon="people-outline" label="Versammlungen" note={tileNote("meetings", summary)} onPress={() => open("MemberMeetings")} testID="member-area-meetings" />
              <Tile icon="hand-left-outline" label="Helfen" note={tileNote("helping", summary)} onPress={() => open("MemberHelperShifts")} testID="member-area-helping" />
              <Tile icon="document-text-outline" label="Dokumente" note={tileNote("documents", summary)} onPress={() => open("MemberDocuments")} testID="member-area-documents" />
              <Tile icon="gift-outline" label="Vorteile" onPress={() => open("InfoCenter", { section: "benefits" })} testID="member-area-benefits" />
            </View>
            {news.length ? (
              <View style={styles.memberNews} testID="member-area-news">
                <Muted style={styles.memberEyebrow}>Interne News</Muted>
                {news.map((post) => (
                  <Pressable key={post.id} onPress={() => open("NewsDetail", { id: post.slug || post.id })} accessibilityRole="button" style={({ pressed }) => [styles.newsRow, pressed && styles.pressed]}>
                    <Ionicons name="newspaper-outline" color={colors.gold} size={16} />
                    <View style={styles.flex}>
                      <Body style={styles.strong} numberOfLines={1}>{post.title}</Body>
                      <Muted>{formatDate(post.published_at || post.created_at)}</Muted>
                    </View>
                    <Ionicons name="chevron-forward" color={colors.gold} size={14} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Card>
        ) : (
          <Card style={styles.joinCard} perch="verein-join" testID="verein-join">
            <Muted style={styles.joinEyebrow}>Mitglied werden</Muted>
            <Heading>Mehr vom Verein</Heading>
            {JOIN_REASONS.map((reason) => (
              <View key={reason.title} style={styles.reason}>
                <View style={styles.reasonIcon}><Ionicons name={reason.icon} color={colors.cyan} size={18} /></View>
                <View style={styles.flex}>
                  <Body style={styles.strong}>{reason.title}</Body>
                  <Muted>{reason.detail}</Muted>
                </View>
              </View>
            ))}
            {fees?.available && fees.fees?.length ? (
              <View style={styles.fees} testID="verein-join-fees">
                <Muted style={styles.joinEyebrow}>Beitrag</Muted>
                {fees.fees.map((fee) => (
                  <View key={String(fee.id)} style={styles.feeRow} testID={`verein-join-fee-${fee.id}`}>
                    <View style={styles.flex}>
                      <Body style={styles.strong}>{fee.label}</Body>
                      {fee.description ? <Muted>{fee.description}</Muted> : null}
                    </View>
                    <Body style={styles.strong}>{feeAmount(fee)}</Body>
                  </View>
                ))}
                {feesStandLine(fees) ? <Muted testID="verein-join-fees-stand">{feesStandLine(fees)}</Muted> : null}
              </View>
            ) : null}
            <Button label="Antrag stellen" onPress={() => { openLink(JOIN_URL); }} testID="verein-join-apply" />
          </Card>
        )}

        {member && discordVoice ? (
          <Section title="Discord jetzt" testID="member-area-discord-now">
            <Muted testID="member-area-discord-summary">{discordSummary(discordVoice)}</Muted>
            {(discordVoice.voice || []).map((channel) => (
              <View key={channel.name} style={styles.voiceRow} testID={`member-area-discord-voice-${channel.name}`}>
                <Ionicons name="volume-high" color="#5865F2" size={16} />
                <Body style={styles.flex} numberOfLines={1}>{channel.name}</Body>
                <Body style={styles.strong}>{channel.count}</Body>
              </View>
            ))}
            {!(discordVoice.voice || []).length ? <Muted>Gerade ist niemand in einem Sprachkanal.</Muted> : null}
            {discordVoice.invite || discordUrl ? (
              <Pressable onPress={() => openLink(String(discordVoice.invite || discordUrl))} accessibilityRole="link" testID="member-area-discord-open">
                <Body style={styles.discordLink}>Discord öffnen →</Body>
              </Pressable>
            ) : null}
          </Section>
        ) : null}

        {member && steam ? (
          <Section title="Gerade in Steam" testID="member-area-steam">
            <Muted testID="member-area-steam-summary">{steamSummary(steam)}</Muted>
            {steam.players.map((player) => (
              <Pressable key={player.user_id} disabled={!player.username} onPress={() => player.username && open("PublicProfile", { username: player.username })} accessibilityRole="button" style={({ pressed }) => [styles.contact, pressed && styles.pressed]} testID={`member-area-steam-${player.user_id}`}>
                <MediaImage uri={player.avatar_url || undefined} style={styles.avatar} fallback={<Ionicons name="logo-steam" color={colors.muted} size={18} />} />
                <View style={styles.flex}>
                  <Body style={styles.strong}>{player.display_name || player.username}</Body>
                  <Muted>{player.state_text}</Muted>
                </View>
              </Pressable>
            ))}
            {steam.me && steam.me.linked && !steam.me.opted_in ? <Muted>Auch dabei sein: auf lionsquad.at unter Profil → Socials „Meinen Steam-Status im Mitgliederbereich zeigen“ einschalten.</Muted> : null}
          </Section>
        ) : null}

        {member && contacts.length ? (
          <Section title="Ansprechpartner" testID="member-area-board">
            {contacts.map((contact) => (
              <Pressable key={contact.id} disabled={!contact.username} onPress={() => contact.username && open("PublicProfile", { username: contact.username })} accessibilityRole="button" style={({ pressed }) => [styles.contact, pressed && styles.pressed]}>
                <MediaImage uri={contact.avatar} style={styles.avatar} fallback={<Ionicons name="person-outline" color={colors.muted} size={18} />} />
                {/* Wie im Web (#1332): Rolle, Name, darunter der Spielername. */}
                <View style={styles.flex}>
                  <Muted style={styles.contactRole}>{contact.title}</Muted>
                  <Body style={styles.strong}>{contact.name}</Body>
                  {contact.gamertag ? <Muted testID={`member-area-contact-${contact.id}-gamertag`}>{contact.gamertag}</Muted> : null}
                </View>
                {contact.username ? <Ionicons name="chevron-forward" color={colors.muted} size={16} /> : null}
              </Pressable>
            ))}
          </Section>
        ) : null}

        {member && serverList.length ? (
          <Section title="Discord-Server" testID="member-area-discord-servers">
            {serverList.map((server) => (
              <View key={server.guild_id} style={styles.contact} testID={`member-area-discord-server-${server.guild_id}`}>
                <MediaImage uri={server.icon_url || undefined} style={styles.serverIcon} fallback={<Ionicons name="logo-discord" color="#5865F2" size={18} />} />
                <View style={styles.flex}>
                  <Body style={styles.strong} numberOfLines={1}>{server.name}</Body>
                  {discordServerLine(server) ? <Muted>{discordServerLine(server)}</Muted> : null}
                </View>
                {server.member === true ? (
                  <View style={styles.joined} testID={`member-area-discord-server-${server.guild_id}-joined`}>
                    <Ionicons name="checkmark-circle" color={colors.success} size={16} />
                    <Muted style={styles.joinedText}>Du bist dabei</Muted>
                  </View>
                ) : server.invite_url ? (
                  <Pressable onPress={() => openLink(String(server.invite_url))} accessibilityRole="link" hitSlop={6} testID={`member-area-discord-server-${server.guild_id}-join`} style={({ pressed }) => [styles.join, pressed && styles.pressed]}>
                    <Body style={styles.joinText}>Beitreten</Body>
                  </Pressable>
                ) : null}
              </View>
            ))}
            {discordServers?.linked === false ? <Muted testID="member-area-discord-link-hint">Discord auf lionsquad.at unter Profil → Socials verknüpfen, dann steht hier, wo du schon dabei bist.</Muted> : null}
          </Section>
        ) : null}

        {member && discordUrl && !serverList.length ? (
          <Pressable onPress={() => { openLink(discordUrl); }} accessibilityRole="link" testID="member-area-discord" style={({ pressed }) => [styles.discord, pressed && styles.pressed]}>
            <Ionicons name="logo-discord" color="#5865F2" size={22} />
            <Body style={[styles.flex, styles.strong]}>Zum Vereins-Discord</Body>
            <Ionicons name="open-outline" color={colors.muted} size={16} />
          </Pressable>
        ) : null}

        <View style={styles.group}>
          <Muted style={styles.groupTitle}>Vom Verein</Muted>
          <Card style={styles.list} perch="verein-club">
            {clubRows(advent).map((row, index) => (
              <Pressable key={row.key} onPress={() => open(row.screen, row.params)} accessibilityRole="button" style={({ pressed }) => [styles.row, index > 0 && styles.rowBorder, pressed && styles.pressed]} testID={`verein-row-${row.key}`}>
                <Ionicons name={row.icon} color={colors.cyan} size={20} />
                <Body style={[styles.flex, styles.strong]}>{row.title}</Body>
                <Ionicons name="chevron-forward" color={colors.muted} size={16} />
              </Pressable>
            ))}
          </Card>
        </View>

        {socials.length ? (
          <View style={styles.group} testID="verein-socials">
            <Muted style={styles.groupTitle}>Folge uns</Muted>
            <View style={styles.socialRow}>
              {socials.map((link) => (
                <Pressable key={`${link.platform}-${link.url}`} accessibilityRole="link" accessibilityLabel={link.label || link.platform || "Link"} onPress={() => { openLink(String(link.url)); }} style={({ pressed }) => [styles.social, pressed && styles.pressed]} testID={`social-${String(link.platform || "link").toLowerCase()}`}>
                  <Ionicons name={socialIcon(link.platform)} color={colors.white} size={22} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function socialList(value?: SocialLink[] | null): SocialLink[] {
  return (Array.isArray(value) ? value : []).filter((link) => link?.enabled !== false && link?.url);
}

function Tile({ icon, label, onPress, testID, note = "" }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; testID?: string; note?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={note ? `${label}, ${note}` : label} testID={testID} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      <Ionicons name={icon} color={colors.gold} size={22} />
      <Body style={styles.tileLabel} numberOfLines={1}>{label}</Body>
      {note ? <Muted style={styles.tileNote} testID={testID ? `${testID}-note` : undefined}>{note}</Muted> : null}
    </Pressable>
  );
}

const FEE_TONES: Record<FeeBadge["tone"], { color: string; border: string; background: string; icon: keyof typeof Ionicons.glyphMap }> = {
  ok: { color: colors.success, border: "rgba(0, 255, 136, 0.4)", background: "rgba(0, 255, 136, 0.1)", icon: "checkmark-circle-outline" },
  warn: { color: "#FF8A80", border: "rgba(255, 59, 48, 0.5)", background: "rgba(255, 59, 48, 0.1)", icon: "alert-circle-outline" },
  plain: { color: colors.muted, border: colors.border, background: "rgba(255, 255, 255, 0.05)", icon: "remove-circle-outline" },
};

/** Das Schild „Beitrag bezahlt“ / „Beitrag offen“ (#1336) - dieselben Daten wie „Meine Mitgliedschaft“. */
function FeeBadgeView({ badge }: { badge: FeeBadge }) {
  const tone = FEE_TONES[badge.tone];
  return (
    <View style={[styles.feeBadge, { borderColor: tone.border, backgroundColor: tone.background }]} testID="verein-member-fee">
      <Ionicons name={tone.icon} color={tone.color} size={14} />
      <Muted style={[styles.feeText, { color: tone.color }]}>{badge.text}</Muted>
    </View>
  );
}

function Section({ title, children, testID }: { title: string; children: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.group} testID={testID}>
      <Muted style={styles.groupTitle}>{title}</Muted>
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
  flex: {
    flex: 1,
    gap: 2,
  },
  strong: {
    fontWeight: "800",
  },
  admission: {
    alignItems: "center",
    backgroundColor: "rgba(41, 182, 232, 0.07)",
    borderColor: "rgba(41, 182, 232, 0.35)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  admissionIcon: {
    alignItems: "center",
    backgroundColor: "rgba(41, 182, 232, 0.14)",
    borderRadius: 8,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  memberCard: {
    backgroundColor: "rgba(255, 215, 0, 0.06)",
    borderColor: "rgba(255, 215, 0, 0.45)",
    gap: 12,
  },
  greeting: {
    gap: 4,
  },
  feeBadge: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 4,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  feeText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  memberEyebrow: {
    color: colors.gold,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tile: {
    alignItems: "center",
    backgroundColor: "rgba(255, 215, 0, 0.05)",
    borderColor: "rgba(255, 215, 0, 0.3)",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: "30%",
    flexGrow: 1,
    gap: 6,
    minHeight: 76,
    justifyContent: "center",
    paddingVertical: 12,
  },
  tileLabel: {
    fontSize: 13,
    fontWeight: "800",
  },
  tileNote: {
    color: colors.cyan,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  memberNews: {
    borderTopColor: "rgba(255, 215, 0, 0.25)",
    borderTopWidth: 1,
    gap: 6,
    paddingTop: 10,
  },
  newsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
  },
  joinCard: {
    backgroundColor: "rgba(41, 182, 232, 0.05)",
    borderColor: "rgba(41, 182, 232, 0.4)",
    gap: 12,
  },
  joinEyebrow: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  fees: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 8,
    paddingTop: 10,
  },
  feeRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
  },
  contactRole: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  reason: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingTop: 10,
  },
  reasonIcon: {
    alignItems: "center",
    backgroundColor: "rgba(41, 182, 232, 0.12)",
    borderRadius: 8,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  group: {
    gap: 8,
  },
  groupTitle: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  list: {
    gap: 0,
    padding: 0,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowBorder: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  sectionCard: {
    gap: 12,
  },
  voiceRow: {
    alignItems: "center",
    borderLeftColor: "rgba(88, 101, 242, 0.5)",
    borderLeftWidth: 2,
    flexDirection: "row",
    gap: 8,
    paddingLeft: 10,
    paddingVertical: 4,
  },
  discordLink: {
    // Helleres Discord-Blau: das kräftige #5865F2 hätte auf der dunklen Karte zu wenig Kontrast für kleine Schrift.
    color: "#B8C0FF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  contact: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
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
  serverIcon: {
    alignItems: "center",
    backgroundColor: "rgba(88, 101, 242, 0.12)",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    overflow: "hidden",
    width: 40,
  },
  joined: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  joinedText: {
    color: colors.success,
    fontWeight: "900",
  },
  join: {
    backgroundColor: "#5865F2",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  joinText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
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
  socialRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  social: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  pressed: {
    opacity: 0.72,
  },
});
