import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, LoadingState } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { Body, Heading, Muted, Title } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import { formatDate, formatStatus } from "../../lib/format";
import type { TeamStackParamList } from "../../navigation/types";
import { colors } from "../../theme";
import type { Team, TeamSquad, User } from "../../types";

type Props = NativeStackScreenProps<TeamStackParamList, "TeamDetail">;
type Candidate = { id: string; username?: string; display_name?: string; avatar_url?: string | null; has_pending_invite?: boolean };
type TeamMember = NonNullable<Team["members"]>[number];
type TeamForm = {
  name: string;
  tag: string;
  description: string;
  logo_url: string;
  banner_url: string;
  discord_link: string;
};
type SquadForm = {
  id?: string;
  name: string;
  description: string;
  game_id: string;
  status: string;
  member_ids: string[];
};

const emptySquad: SquadForm = { name: "", description: "", game_id: "", status: "active", member_ids: [] };

export function TeamDetailScreen({ navigation, route }: Props) {
  const { user } = useAuth();
  const [team, setTeam] = useState<Team | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [teamForm, setTeamForm] = useState<TeamForm>({ name: "", tag: "", description: "", logo_url: "", banner_url: "", discord_link: "" });
  const [squadForm, setSquadForm] = useState<SquadForm | null>(null);
  const [inviteQuery, setInviteQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  const load = useCallback(async () => {
    setError("");
    try {
      const { data } = await api.get<Team>(`/teams/${route.params.id}`);
      const squads = await api.get<TeamSquad[]>(`/teams/${route.params.id}/squads`).catch(() => ({ data: [] as TeamSquad[] }));
      const nextTeam = { ...data, squads: Array.isArray(squads.data) ? squads.data : [] };
      setTeam(nextTeam);
      setTeamForm({
        name: nextTeam.name || "",
        tag: nextTeam.tag || "",
        description: nextTeam.description || "",
        logo_url: nextTeam.logo_url || "",
        banner_url: nextTeam.banner_url || "",
        discord_link: nextTeam.discord_link || "",
      });
    } catch (err) {
      setError(errorMessage(err, "Teamdetail konnte nicht geladen werden."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [route.params.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const needle = inviteQuery.trim();
    if (!team?.can_manage || needle.length < 2) {
      setCandidates([]);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get<Candidate[]>(`/teams/${team.id}/invite-candidates?q=${encodeURIComponent(needle)}`);
        setCandidates(Array.isArray(data) ? data : []);
      } catch {
        setCandidates([]);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [inviteQuery, team?.can_manage, team?.id]);

  const isMember = Boolean(user && team && (team.is_member || team.member_ids?.includes(user.id)));
  const canManage = Boolean(user && team && (team.can_manage || team.leader_id === user.id || team.co_leader_ids?.includes(user.id) || isAdmin(user)));
  const isLeader = Boolean(user && team?.leader_id === user.id);
  const members = team?.members || [];
  const squads = team?.squads || [];

  const stats = useMemo(() => ({
    members: team?.member_count ?? team?.member_ids?.length ?? members.length,
    squads: team?.squad_count ?? squads.length,
    role: isLeader ? "Leader" : canManage ? "Co-Leader" : isMember ? "Mitglied" : "Besucher",
  }), [canManage, isLeader, isMember, members.length, squads.length, team?.member_count, team?.member_ids?.length, team?.squad_count]);

  const openProfile = useCallback((username?: string | null) => {
    if (!username) return;
    navigation.getParent()?.navigate("More", { screen: "PublicProfile", params: { username } });
  }, [navigation]);

  const showActionResult = useCallback(async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await action();
      setMessage(success);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Aktion konnte nicht abgeschlossen werden."));
    } finally {
      setBusy(false);
    }
  }, [load]);

  const join = useCallback(() => {
    if (!team || !joinCode.trim()) return;
    showActionResult(async () => {
      await api.post(`/teams/${team.id}/join`, { join_code: joinCode.trim() });
      setJoinCode("");
    }, "Du bist dem Team beigetreten.");
  }, [joinCode, showActionResult, team]);

  const leave = useCallback(() => {
    if (!team) return;
    Alert.alert("Team verlassen?", "Du wirst aus diesem Team entfernt.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Verlassen", style: "destructive", onPress: () => showActionResult(() => api.post(`/teams/${team.id}/leave`), "Team verlassen.") },
    ]);
  }, [showActionResult, team]);

  const saveTeam = useCallback(() => {
    if (!team || !canManage) return;
    showActionResult(async () => {
      await api.patch(`/teams/${team.id}`, {
        name: teamForm.name.trim(),
        tag: teamForm.tag.trim().toUpperCase(),
        description: teamForm.description.trim() || null,
        logo_url: teamForm.logo_url.trim() || null,
        banner_url: teamForm.banner_url.trim() || null,
        discord_link: teamForm.discord_link.trim() || null,
      });
      setEditOpen(false);
    }, "Team gespeichert.");
  }, [canManage, showActionResult, team, teamForm]);

  const invite = useCallback((candidate: Candidate) => {
    if (!team || !candidate.id) return;
    showActionResult(async () => {
      await api.post(`/teams/${team.id}/invites`, { user_id: candidate.id });
      setCandidates((items) => items.map((item) => item.id === candidate.id ? { ...item, has_pending_invite: true } : item));
    }, `${candidate.display_name || candidate.username || "Nutzer"} eingeladen.`);
  }, [showActionResult, team]);

  const setRole = useCallback((member: TeamMember, role: "member" | "co_leader") => {
    if (!team) return;
    showActionResult(() => api.post(`/teams/${team.id}/members/${member.id}/role`, { role }), role === "co_leader" ? "Co-Leader gesetzt." : "Rolle zurueckgesetzt.");
  }, [showActionResult, team]);

  const transferLeader = useCallback((member: TeamMember) => {
    if (!team) return;
    Alert.alert("Leadership uebertragen?", `${member.display_name || member.username || "Dieses Mitglied"} wird neuer Team-Leader.`, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Uebertragen", onPress: () => showActionResult(() => api.post(`/teams/${team.id}/transfer-leader`, { new_leader_id: member.id }), "Leadership uebertragen.") },
    ]);
  }, [showActionResult, team]);

  const kickMember = useCallback((member: TeamMember) => {
    if (!team) return;
    Alert.alert("Mitglied entfernen?", `${member.display_name || member.username || "Dieses Mitglied"} aus dem Team entfernen?`, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Entfernen", style: "destructive", onPress: () => showActionResult(() => api.delete(`/teams/${team.id}/members/${member.id}`), "Mitglied entfernt.") },
    ]);
  }, [showActionResult, team]);

  const startSquadEdit = useCallback((squad?: TeamSquad) => {
    setSquadForm(squad ? {
      id: squad.id,
      name: squad.name || "",
      description: squad.description || "",
      game_id: squad.game_id || squad.game || "",
      status: squad.status || "active",
      member_ids: squad.member_ids || squad.members?.map((member) => member.id).filter(Boolean) || [],
    } : { ...emptySquad });
  }, []);

  const saveSquad = useCallback(() => {
    if (!team || !squadForm || !canManage) return;
    const payload = {
      name: squadForm.name.trim(),
      description: squadForm.description.trim() || null,
      game_id: squadForm.game_id.trim() || null,
      status: squadForm.status === "archived" ? "archived" : "active",
      member_ids: squadForm.member_ids,
    };
    showActionResult(async () => {
      if (squadForm.id) await api.patch(`/teams/${team.id}/squads/${squadForm.id}`, payload);
      else await api.post(`/teams/${team.id}/squads`, payload);
      setSquadForm(null);
    }, "Squad gespeichert.");
  }, [canManage, showActionResult, squadForm, team]);

  const deleteSquad = useCallback((squad: TeamSquad) => {
    if (!team || !squad.id) return;
    Alert.alert("Squad loeschen?", `"${squad.name}" wird entfernt.`, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Loeschen", style: "destructive", onPress: () => showActionResult(() => api.delete(`/teams/${team.id}/squads/${squad.id}`), "Squad geloescht.") },
    ]);
  }, [showActionResult, team]);

  if (loading) {
    return (
      <Screen>
        <LoadingState label="Team wird geladen ..." />
      </Screen>
    );
  }

  if (!team) {
    return (
      <Screen>
        <EmptyState title="Teamdetail nicht verfuegbar" detail={error || "Das Team konnte nicht geladen werden."} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}
      >
        <View style={styles.hero}>
          <MediaImage
            uri={team.banner_url}
            style={styles.banner}
            fallback={<Ionicons name="people-outline" color={colors.cyan} size={42} />}
          />
          <View style={styles.heroInner}>
            <MediaImage
              uri={team.logo_url}
              style={styles.logo}
              fallback={<Body style={styles.logoText}>{(team.tag || team.name).slice(0, 2).toUpperCase()}</Body>}
            />
            <View style={styles.heroText}>
              <Muted>{team.tag ? `[${team.tag}]` : "Team"}</Muted>
              <Title>{team.name}</Title>
              {team.description ? <Body>{team.description}</Body> : <Muted>Keine Beschreibung hinterlegt.</Muted>}
              <View style={styles.wrap}>
                <Pill label={`${stats.members} Mitglieder`} />
                <Pill label={`${stats.squads} Squads`} tone="gold" />
                <Pill label={stats.role} tone={canManage ? "success" : "cyan"} />
              </View>
            </View>
          </View>
        </View>

        {message ? <Muted style={styles.success}>{message}</Muted> : null}
        {error ? <Muted style={styles.error}>{error}</Muted> : null}

        <Card style={styles.card}>
          <View style={styles.cardTop}>
            <Heading>Teamaktionen</Heading>
            {canManage ? <Pill label="Verwaltung aktiv" tone="success" /> : isMember ? <Pill label="Mitglied" /> : null}
          </View>
          <View style={styles.actionGrid}>
            <Button label="Team-Chat oeffnen" onPress={() => navigation.navigate("TeamChat", { id: team.id, title: `${team.tag || team.name} Chat` })} />
            {team.discord_link ? <Button label="Discord oeffnen" variant="secondary" onPress={() => Linking.openURL(normalizeLink(team.discord_link)).catch(() => setError("Discord-Link konnte nicht geoeffnet werden."))} /> : null}
            {canManage ? <Button label={editOpen ? "Bearbeitung schliessen" : "Team bearbeiten"} variant="secondary" onPress={() => setEditOpen((open) => !open)} /> : null}
            {isMember && !isLeader ? <Button label="Team verlassen" variant="danger" disabled={busy} onPress={leave} /> : null}
          </View>
        </Card>

        {editOpen && canManage ? (
          <Card style={styles.card}>
            <Heading>Basisdaten bearbeiten</Heading>
            <Field label="Name" value={teamForm.name} onChangeText={(value) => setTeamForm((current) => ({ ...current, name: value }))} />
            <Field label="Tag" value={teamForm.tag} onChangeText={(value) => setTeamForm((current) => ({ ...current, tag: value.toUpperCase().slice(0, 8) }))} />
            <Field label="Beschreibung" value={teamForm.description} multiline onChangeText={(value) => setTeamForm((current) => ({ ...current, description: value }))} />
            <Field label="Logo URL" value={teamForm.logo_url} onChangeText={(value) => setTeamForm((current) => ({ ...current, logo_url: value }))} />
            <Field label="Banner URL" value={teamForm.banner_url} onChangeText={(value) => setTeamForm((current) => ({ ...current, banner_url: value }))} />
            <Field label="Discord-Link" value={teamForm.discord_link} onChangeText={(value) => setTeamForm((current) => ({ ...current, discord_link: value }))} />
            <Button label={busy ? "Speichert ..." : "Team speichern"} disabled={busy || !teamForm.name.trim() || !teamForm.tag.trim()} onPress={saveTeam} />
          </Card>
        ) : null}

        {canManage && team.join_code ? (
          <Card style={[styles.card, styles.manageCard]}>
            <Heading>Join-Code</Heading>
            <Muted>Mit diesem Code koennen Spieler dem Team direkt beitreten.</Muted>
            <Body style={styles.joinCode}>{team.join_code}</Body>
          </Card>
        ) : null}

        {!isMember && user ? (
          <Card style={styles.card}>
            <Heading>Team beitreten</Heading>
            <Muted>Wenn du einen Join-Code vom Team erhalten hast, kannst du hier direkt beitreten.</Muted>
            <Field label="Join-Code" value={joinCode} onChangeText={setJoinCode} />
            <Button label="Beitreten" disabled={busy || !joinCode.trim()} onPress={join} />
          </Card>
        ) : null}

        <Card style={styles.card}>
          <View style={styles.cardTop}>
            <Heading>Mitglieder</Heading>
            <Pill label={`${members.length || stats.members}`} />
          </View>
          {members.length ? members.map((member) => (
            <MemberRow
              key={member.id}
              busy={busy}
              canManage={canManage}
              isLeader={isLeader}
              member={member}
              onKick={kickMember}
              onOpenProfile={openProfile}
              onRole={setRole}
              onTransfer={transferLeader}
              team={team}
              user={user}
            />
          )) : <Muted>Mitglieder werden angezeigt, sobald das Team sie freigibt.</Muted>}
        </Card>

        <Card style={styles.card}>
          <View style={styles.cardTop}>
            <Heading>Squads</Heading>
            {canManage ? <Pressable onPress={() => startSquadEdit()} style={({ pressed }) => [styles.smallAction, pressed && styles.pressed]}><Muted style={styles.smallActionText}>Neu</Muted></Pressable> : null}
          </View>
          {squadForm ? (
            <View style={styles.squadForm}>
              <Field label="Squad-Name" value={squadForm.name} onChangeText={(value) => setSquadForm((current) => current && { ...current, name: value })} />
              <Field label="Beschreibung" value={squadForm.description} multiline onChangeText={(value) => setSquadForm((current) => current && { ...current, description: value })} />
              <Field label="Spiel / Game-ID" value={squadForm.game_id} onChangeText={(value) => setSquadForm((current) => current && { ...current, game_id: value })} />
              <View style={styles.wrap}>
                <Pressable onPress={() => setSquadForm((current) => current && { ...current, status: "active" })} style={[styles.option, squadForm.status !== "archived" && styles.optionActive]}>
                  <Muted style={squadForm.status !== "archived" && styles.optionTextActive}>Aktiv</Muted>
                </Pressable>
                <Pressable onPress={() => setSquadForm((current) => current && { ...current, status: "archived" })} style={[styles.option, squadForm.status === "archived" && styles.optionActive]}>
                  <Muted style={squadForm.status === "archived" && styles.optionTextActive}>Archiv</Muted>
                </Pressable>
              </View>
              <Muted>Mitglieder</Muted>
              <View style={styles.wrap}>
                {members.map((member) => {
                  const active = squadForm.member_ids.includes(member.id);
                  return (
                    <Pressable key={member.id} onPress={() => setSquadForm((current) => {
                      if (!current) return current;
                      return {
                        ...current,
                        member_ids: active ? current.member_ids.filter((id) => id !== member.id) : [...current.member_ids, member.id],
                      };
                    })} style={[styles.memberChip, active && styles.memberChipActive]}>
                      <Muted style={active && styles.optionTextActive}>{member.display_name || member.username || "Spieler"}</Muted>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.actionGrid}>
                <Button label="Abbrechen" variant="secondary" onPress={() => setSquadForm(null)} />
                <Button label={busy ? "Speichert ..." : "Squad speichern"} disabled={busy || !squadForm.name.trim()} onPress={saveSquad} />
              </View>
            </View>
          ) : null}
          {squads.length ? squads.map((squad) => (
            <SquadRow key={squad.id || squad.name} canManage={canManage} onDelete={deleteSquad} onEdit={startSquadEdit} squad={squad} />
          )) : <Muted>Keine Squads hinterlegt.</Muted>}
        </Card>

        {canManage ? (
          <Card style={styles.card}>
            <Heading>Mitglieder einladen</Heading>
            <Muted>Suche nach Nutzern und sende eine Einladung in deren Benachrichtigungen.</Muted>
            <Field label="Username oder Anzeigename" value={inviteQuery} onChangeText={setInviteQuery} />
            {inviteQuery.trim().length >= 2 && !candidates.length ? <Muted>Keine passenden Nutzer gefunden.</Muted> : null}
            {candidates.map((candidate) => (
              <View key={candidate.id} style={styles.candidateRow}>
                <MediaImage
                  uri={candidate.avatar_url}
                  style={styles.avatar}
                  fallback={<Body style={styles.avatarText}>{(candidate.display_name || candidate.username || "?").slice(0, 1).toUpperCase()}</Body>}
                />
                <View style={styles.rowMain}>
                  <Body style={styles.rowTitle}>{candidate.display_name || candidate.username}</Body>
                  {candidate.username ? <Muted>@{candidate.username}</Muted> : null}
                </View>
                <Pressable disabled={busy || candidate.has_pending_invite} onPress={() => invite(candidate)} style={[styles.smallAction, candidate.has_pending_invite && styles.disabled]}>
                  <Muted style={styles.smallActionText}>{candidate.has_pending_invite ? "Offen" : "Einladen"}</Muted>
                </Pressable>
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function MemberRow({
  busy,
  canManage,
  isLeader,
  member,
  onKick,
  onOpenProfile,
  onRole,
  onTransfer,
  team,
  user,
}: {
  busy: boolean;
  canManage: boolean;
  isLeader: boolean;
  member: TeamMember;
  onKick: (member: TeamMember) => void;
  onOpenProfile: (username?: string | null) => void;
  onRole: (member: TeamMember, role: "member" | "co_leader") => void;
  onTransfer: (member: TeamMember) => void;
  team: Team;
  user: User | null;
}) {
  const role = memberRole(team, member);
  const isSelf = member.id === user?.id;
  const isTeamLeader = role === "leader";
  const canRole = isLeader && !isTeamLeader;
  const canKick = canManage && !isTeamLeader && !isSelf;
  return (
    <View style={styles.memberRow}>
      <MediaImage
        uri={member.avatar_url}
        style={styles.avatar}
        fallback={<Body style={styles.avatarText}>{(member.display_name || member.username || "?").slice(0, 1).toUpperCase()}</Body>}
      />
      <View style={styles.rowMain}>
        <Pressable onPress={() => onOpenProfile(member.username)} style={({ pressed }) => [pressed && styles.pressed]}>
          <Body style={styles.rowTitle}>{member.display_name || member.username || "Spieler"}</Body>
          {member.username ? <Muted>@{member.username}</Muted> : null}
        </Pressable>
        <View style={styles.wrap}>
          <Pill label={roleLabel(role)} tone={role === "leader" ? "gold" : role === "co_leader" ? "success" : "default"} />
          {isSelf ? <Pill label="Du" /> : null}
        </View>
        {canRole || canKick ? (
          <View style={styles.memberActions}>
            {canRole ? (
              <Pressable disabled={busy} onPress={() => onRole(member, role === "co_leader" ? "member" : "co_leader")} style={styles.memberAction}>
                <Muted style={styles.smallActionText}>{role === "co_leader" ? "Mitglied" : "Co-Leader"}</Muted>
              </Pressable>
            ) : null}
            {canRole ? (
              <Pressable disabled={busy} onPress={() => onTransfer(member)} style={styles.memberAction}>
                <Muted style={styles.smallActionText}>Leader</Muted>
              </Pressable>
            ) : null}
            {canKick ? (
              <Pressable disabled={busy} onPress={() => onKick(member)} style={[styles.memberAction, styles.dangerOutline]}>
                <Muted style={styles.dangerText}>Entfernen</Muted>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function SquadRow({ canManage, onDelete, onEdit, squad }: { canManage: boolean; onDelete: (squad: TeamSquad) => void; onEdit: (squad: TeamSquad) => void; squad: TeamSquad }) {
  return (
    <View style={styles.squadRow}>
      <View style={styles.rowMain}>
        <View style={styles.cardTop}>
          <Body style={styles.rowTitle}>{squad.name}</Body>
          <Pill label={formatStatus(squad.status || "active")} tone={squad.status === "archived" ? "default" : "success"} />
        </View>
        {squad.description ? <Muted>{squad.description}</Muted> : null}
        <Muted>{squad.game || squad.game_id || "Kein Spiel gesetzt"}</Muted>
        <View style={styles.wrap}>
          {(squad.members || []).map((member) => <Pill key={member.id} label={member.display_name || member.username || "Spieler"} />)}
          {!squad.members?.length && squad.member_ids?.length ? <Pill label={`${squad.member_ids.length} Mitglieder`} /> : null}
        </View>
      </View>
      {canManage ? (
        <View style={styles.squadActions}>
          <Pressable onPress={() => onEdit(squad)} style={styles.memberAction}><Muted style={styles.smallActionText}>Edit</Muted></Pressable>
          {squad.id ? <Pressable onPress={() => onDelete(squad)} style={[styles.memberAction, styles.dangerOutline]}><Muted style={styles.dangerText}>Del</Muted></Pressable> : null}
        </View>
      ) : null}
    </View>
  );
}

function Field({ label, value, onChangeText, multiline = false }: { label: string; value?: string; onChangeText: (value: string) => void; multiline?: boolean }) {
  return (
    <View style={styles.field}>
      <Muted style={styles.fieldLabel}>{label}</Muted>
      <TextInput
        autoCapitalize="none"
        multiline={multiline}
        onChangeText={onChangeText}
        placeholderTextColor={colors.muted}
        style={[styles.input, multiline && styles.inputMulti]}
        textAlignVertical={multiline ? "top" : "center"}
        value={value || ""}
      />
    </View>
  );
}

function Pill({ label, tone = "default" }: { label: string; tone?: "default" | "cyan" | "gold" | "success" }) {
  return (
    <View style={[styles.pill, tone === "cyan" && styles.pillCyan, tone === "gold" && styles.pillGold, tone === "success" && styles.pillSuccess]}>
      <Muted style={[styles.pillText, tone === "cyan" && styles.textCyan, tone === "gold" && styles.textGold, tone === "success" && styles.textSuccess]}>{label}</Muted>
    </View>
  );
}

function memberRole(team: Team, member: TeamMember) {
  if (team.leader_id === member.id || team.leader?.id === member.id) return "leader";
  if (team.co_leader_ids?.includes(member.id) || member.role === "co_leader") return "co_leader";
  return "member";
}

function roleLabel(role: string) {
  if (role === "leader") return "Leader";
  if (role === "co_leader") return "Co-Leader";
  return "Mitglied";
}

function normalizeLink(url?: string | null) {
  const value = String(url || "").trim();
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function isAdmin(user?: User | null) {
  return ["moderator", "tournament_admin", "club_admin", "superadmin"].includes(String(user?.role || ""));
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 34,
  },
  hero: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  banner: {
    borderWidth: 0,
    height: 150,
    width: "100%",
  },
  heroInner: {
    alignItems: "flex-end",
    backgroundColor: "rgba(10,10,10,0.92)",
    flexDirection: "row",
    gap: 12,
    marginTop: -34,
    padding: 14,
  },
  logo: {
    borderColor: colors.cyan,
    borderRadius: 12,
    borderWidth: 2,
    height: 70,
    width: 70,
  },
  logoText: {
    color: colors.cyan,
    fontSize: 21,
    fontWeight: "900",
  },
  heroText: {
    flex: 1,
    gap: 5,
  },
  card: {
    gap: 12,
  },
  manageCard: {
    borderColor: "rgba(255,215,0,0.3)",
  },
  cardTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  actionGrid: {
    gap: 10,
  },
  field: {
    gap: 7,
  },
  fieldLabel: {
    color: colors.white,
    fontWeight: "800",
  },
  input: {
    backgroundColor: colors.black,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.white,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  inputMulti: {
    minHeight: 92,
  },
  joinCode: {
    backgroundColor: colors.black,
    borderColor: "rgba(255,215,0,0.28)",
    borderRadius: 8,
    borderWidth: 1,
    color: colors.gold,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0,
    padding: 12,
  },
  memberRow: {
    alignItems: "flex-start",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingTop: 12,
  },
  candidateRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 10,
  },
  avatar: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    width: 44,
  },
  avatarText: {
    color: colors.cyan,
    fontWeight: "900",
  },
  rowMain: {
    flex: 1,
    gap: 5,
  },
  rowTitle: {
    fontWeight: "900",
  },
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  memberActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    paddingTop: 2,
  },
  memberAction: {
    backgroundColor: "rgba(41,182,232,0.1)",
    borderColor: "rgba(41,182,232,0.28)",
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  smallAction: {
    backgroundColor: "rgba(41,182,232,0.12)",
    borderColor: "rgba(41,182,232,0.32)",
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  smallActionText: {
    color: colors.cyan,
    fontWeight: "900",
  },
  squadForm: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 10,
  },
  squadRow: {
    alignItems: "flex-start",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 12,
    paddingTop: 12,
  },
  squadActions: {
    gap: 6,
  },
  option: {
    backgroundColor: "rgba(255,255,255,0.045)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  optionActive: {
    backgroundColor: "rgba(41,182,232,0.16)",
    borderColor: "rgba(41,182,232,0.38)",
  },
  optionTextActive: {
    color: colors.cyan,
    fontWeight: "900",
  },
  memberChip: {
    backgroundColor: "rgba(255,255,255,0.045)",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  memberChipActive: {
    backgroundColor: "rgba(41,182,232,0.16)",
    borderColor: "rgba(41,182,232,0.38)",
  },
  pill: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillCyan: {
    backgroundColor: "rgba(41,182,232,0.14)",
    borderColor: "rgba(41,182,232,0.35)",
  },
  pillGold: {
    backgroundColor: "rgba(255,215,0,0.12)",
    borderColor: "rgba(255,215,0,0.32)",
  },
  pillSuccess: {
    backgroundColor: "rgba(0,255,136,0.12)",
    borderColor: "rgba(0,255,136,0.32)",
  },
  pillText: {
    fontSize: 12,
    fontWeight: "900",
  },
  textCyan: {
    color: colors.cyan,
  },
  textGold: {
    color: colors.gold,
  },
  textSuccess: {
    color: colors.success,
  },
  dangerOutline: {
    backgroundColor: "rgba(255,59,48,0.1)",
    borderColor: "rgba(255,59,48,0.3)",
  },
  dangerText: {
    color: colors.live,
    fontWeight: "900",
  },
  success: {
    color: colors.success,
    fontWeight: "800",
  },
  error: {
    color: colors.live,
    fontWeight: "800",
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.72,
  },
});
