import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Card } from "../../components/Card";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../lib/api";
import type { MoreStackParamList } from "../../navigation/types";
import { colors } from "../../theme";

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

export function InfoCenterScreen({ route }: Props) {
  const { user } = useAuth();
  const [section, setSection] = useState<SectionKey>(route.params?.section || "sponsors");
  const [sponsors, setSponsors] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [benefits, setBenefits] = useState<any[]>([]);
  const [references, setReferences] = useState<any[]>([]);
  const active = useMemo(() => sections.find((item) => item.key === section) || sections[0], [section]);

  const loadLive = useCallback(async () => {
    const [liveSponsors, liveEvents, liveProfiles, liveMembers, liveBenefits, liveAchievements] = await Promise.all([
      api.get<any[]>("/sponsors").catch(() => ({ data: [] })),
      api.get<any[]>("/events").catch(() => ({ data: [] })),
      api.get<any[]>("/users/public-list").catch(() => ({ data: [] })),
      api.get<any[]>("/membership/public").catch(() => ({ data: [] })),
      api.get<any[]>("/membership/benefits").catch(() => ({ data: [] })),
      api.get<any[]>("/achievements/groups").catch(() => ({ data: [] })),
    ]);
    setSponsors(Array.isArray(liveSponsors.data) ? liveSponsors.data : []);
    setEvents(Array.isArray(liveEvents.data) ? liveEvents.data : []);
    setProfiles(Array.isArray(liveProfiles.data) ? liveProfiles.data : []);
    setMembers(Array.isArray(liveMembers.data) ? liveMembers.data : []);
    setBenefits(Array.isArray(liveBenefits.data) ? liveBenefits.data : []);
    setReferences(
      Array.isArray(liveAchievements.data) && liveAchievements.data.length
        ? liveAchievements.data.slice(0, 8).map((group) => ({
            id: group.id || group.code,
            placement: group.name,
            game: group.category || "Achievement",
            title: group.description || `${group.tier_count || group.tiers?.length || 0} Stufen hinterlegt`,
            mode: "Live-Katalog",
            date: "Live",
          }))
        : []
    );
  }, [user]);

  useEffect(() => {
    loadLive();
  }, [loadLive]);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Muted>Info Center</Muted>
          <Title>{active.label}</Title>
          <Muted>Sponsoren, Verein, Events, Referenzen und Profile als native App-Module.</Muted>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {sections.map((item) => (
            <Pressable key={item.key} onPress={() => setSection(item.key)} style={[styles.tab, section === item.key && styles.tabActive]}>
              <Muted style={[styles.tabText, section === item.key && styles.tabTextActive]}>{item.label}</Muted>
            </Pressable>
          ))}
        </ScrollView>

        {section === "sponsors" ? <Sponsors items={sponsors} /> : null}
        {section === "partners" ? <Partners items={members} /> : null}
        {section === "events" ? <Events items={events} /> : null}
        {section === "benefits" ? <Benefits isMember={Boolean(user?.is_club_member)} items={benefits} /> : null}
        {section === "references" ? <References items={references} /> : null}
        {section === "profiles" ? <Profiles items={profiles} /> : null}
      </ScrollView>
    </Screen>
  );
}

function Sponsors({ items }: { items: any[] }) {
  return (
    <>
      {items.map((sponsor) => (
        <Card key={sponsor.id} style={styles.card}>
          <View style={styles.cardTop}>
            <Heading>{sponsor.name}</Heading>
            <Badge label={sponsor.tier} />
          </View>
          <Muted>{sponsor.description || sponsor.effective_status || "Aktiver Unterstützer"}</Muted>
          {sponsor.url || sponsor.link ? <Muted style={styles.link}>{sponsor.url || sponsor.link}</Muted> : null}
        </Card>
      ))}
    </>
  );
}

function Partners({ items }: { items: any[] }) {
  return (
    <>
      {items.map((partner, index) => (
        <Card key={partner.id || partner.username || index} style={styles.card}>
          <View style={styles.cardTop}>
            <Heading>{partner.name || partner.display_name || partner.username}</Heading>
            <Badge label={partner.kind || partner.internal_role || "Mitglied"} />
          </View>
          <Muted>{partner.description || `${partner.country || "Community"} · ${(partner.favorite_games || []).join(", ") || "THE LION SQUAD"}`}</Muted>
        </Card>
      ))}
    </>
  );
}

function Events({ items }: { items: any[] }) {
  return (
    <>
      {items.map((event) => (
        <Card key={event.id} style={styles.card}>
          <View style={styles.cardTop}>
            <Heading>{event.title || event.name}</Heading>
            <Badge label={event.public_phase?.label || event.status} />
          </View>
          <Muted>{event.type || event.event_type || "Event"} · {event.date || event.start_date}</Muted>
          <Body style={styles.strong}>{[event.location, event.city, event.country].filter(Boolean).join(", ") || "Ort offen"}</Body>
        </Card>
      ))}
    </>
  );
}

function Benefits({ isMember, items }: { isMember: boolean; items: any[] }) {
  return (
    <>
      {!isMember ? (
        <Card style={styles.card}>
          <Heading>Mitgliedschaft erforderlich</Heading>
          <Muted>Diese Vorteile werden freigeschaltet, wenn der Account als Vereinsmitglied markiert ist.</Muted>
        </Card>
      ) : null}
      {items.map((benefit) => (
        <Card key={benefit.id || benefit.title} style={[styles.card, !isMember && (benefit.memberOnly || benefit.member_only) && styles.locked]}>
          <View style={styles.cardTop}>
            <Heading>{benefit.title}</Heading>
            <Badge label={benefit.category || benefit.kind || "Member"} />
          </View>
          <Muted>{benefit.description}</Muted>
          <Muted style={isMember ? styles.memberOk : styles.memberLocked}>{isMember ? "Freigeschaltet" : "Gesperrt"}</Muted>
        </Card>
      ))}
    </>
  );
}

function References({ items }: { items: any[] }) {
  return (
    <>
      {items.map((reference) => (
        <Card key={reference.id} style={styles.card}>
          <View style={styles.cardTop}>
            <Heading>{reference.placement}</Heading>
            <Badge label={reference.game} />
          </View>
          <Body style={styles.strong}>{reference.title}</Body>
          <Muted>{reference.mode} · {reference.date}</Muted>
        </Card>
      ))}
    </>
  );
}

function Profiles({ items }: { items: any[] }) {
  return (
    <>
      {items.map((profile) => (
        <Card key={profile.id} style={styles.card}>
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Body style={styles.avatarText}>{(profile.name || profile.display_name || profile.username || "?").slice(0, 1).toUpperCase()}</Body>
            </View>
            <View style={styles.profileText}>
              <Heading>{profile.name || profile.display_name || profile.username}</Heading>
              <Muted>@{profile.username} · {profile.role || profile.user_type || profile.achievement_level?.title || "Community"}</Muted>
            </View>
          </View>
          <View style={styles.wrap}>
            {(profile.games || profile.favorite_games || []).map((game: string) => <Badge key={game} label={game} />)}
          </View>
          <Muted>{profile.achievements_count ?? profile.achievements?.length ?? 0} Achievements hinterlegt</Muted>
        </Card>
      ))}
    </>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <Muted style={styles.badgeText}>{label}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 30,
  },
  header: {
    gap: 6,
  },
  tabs: {
    gap: 8,
    paddingRight: 18,
  },
  tab: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: "rgba(41, 182, 232, 0.16)",
    borderColor: "rgba(41, 182, 232, 0.42)",
  },
  tabText: {
    fontWeight: "900",
  },
  tabTextActive: {
    color: colors.cyan,
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
  strong: {
    fontWeight: "900",
  },
  locked: {
    opacity: 0.56,
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
});
