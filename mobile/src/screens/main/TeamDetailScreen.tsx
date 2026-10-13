import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ErrorState, SkeletonList, loadProblem, type LoadProblem } from "../../components/ListState";
import { MediaImage } from "../../components/MediaImage";
import { Screen } from "../../components/Screen";
import { TeamSchedule } from "../../components/team/TeamSchedule";
import { TeamHeader, type TeamHeaderData } from "../../components/team/TeamHeader";
import { TeamInviteCard, TeamJoinInvite } from "../../components/team/TeamInvite";
import { TeamDissolve } from "../../components/team/TeamDissolve";
import { Body, Heading, Muted } from "../../components/Text";
import { useAuth } from "../../auth/AuthContext";
import { api, errorMessage } from "../../lib/api";
import { formatStatus } from "../../lib/format";
import { isGuestUser } from "../../live";
import { memberRole as faceRole, ROLE_LABELS, type TeamOverview } from "../../lib/teamPage";
import { AUTO_COLOR, TEAM_COLORS } from "../../lib/teamColors";
import { openSignIn } from "../../navigation/rootNavigation";
import type { TeamStackParamList } from "../../navigation/types";
import { colors, radius } from "../../theme";
import type { Team, TeamSquad, User } from "../../types";
import { ImagePickField } from "../../components/ImagePickField";
import { useShareHeader } from "../../components/HeaderActions";
import { sharePage } from "../../lib/share";
import { WEB_BASE_URL } from "../../lib/siteUrls";

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
  color: string;
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
  // Teilen oben rechts (#1154): die Adresse der Website - in der App öffnet sie diesen Screen, sonst die Website.
  const share = useMemo(() => (team ? () => { void sharePage({ kind: "team", id: String(team.id), title: team.tag ? `${team.name} [${team.tag}]` : team.name, detail: "Team" }); } : null), [team]);
  useShareHeader(navigation, share);
  // Termine und letzte Spiele (#1191) aus den Team-Anmeldungen; Einladungs-Link mit QR-Code für Kapitäne.
  const [overview, setOverview] = useState<TeamOverview | null>(null);
  const inviteToken = route.params.invite || "";
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Was beim Laden schiefging (#1152): ohne Netz, nicht gefunden oder ein Fehler - nie „nichts da“.
  const [problem, setProblem] = useState<LoadProblem | null>(null);
  const [message, setMessage] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  // Oben „Einladen“ und „Bearbeiten“ (#1274); der Link mit QR-Code öffnet sich auf Tippen.
  const [inviteOpen, setInviteOpen] = useState(false);
  const [teamForm, setTeamForm] = useState<TeamForm>({ name: "", tag: "", description: "", logo_url: "", banner_url: "", discord_link: "", color: AUTO_COLOR });
  // Team-Level für die Kopfzeile (#1347): „Level 9“ und die kleine goldene Krone des punktebesten Teams.
  const [level, setLevel] = useState<{ level?: number; crown?: string | null } | null>(null);
  const [squadForm, setSquadForm] = useState<SquadForm | null>(null);
  const [inviteQuery, setInviteQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  const load = useCallback(async () => {
    setProblem(null);
    setError("");
    try {
      const { data } = await api.get<Team>(`/teams/${route.params.id}`);
      const squads = await api.get<TeamSquad[]>(`/teams/${route.params.id}/squads`).catch(() => ({ data: [] as TeamSquad[] }));
      const plan = await api.get<TeamOverview>(`/teams/${route.params.id}/overview`).catch(() => ({ data: null }));
      const levelInfo = await api.get<{ level?: number; crown?: string | null }>(`/teams/${route.params.id}/level`).catch(() => ({ data: null }));
      setLevel(levelInfo.data && typeof levelInfo.data.level === "number" ? levelInfo.data : null);
      const nextTeam = { ...data, squads: Array.isArray(squads.data) ? squads.data : [] };
      setTeam(nextTeam);
      setOverview(plan.data && Array.isArray(plan.data.upcoming) ? plan.data : null);
      setTeamForm({
        name: nextTeam.name || "",
        tag: nextTeam.tag || "",
        description: nextTeam.description || "",
        logo_url: nextTeam.logo_url || "",
        banner_url: nextTeam.banner_url || "",
        discord_link: nextTeam.discord_link || "",
        color: nextTeam.color || AUTO_COLOR,
      });
    } catch (err) {
      setError(errorMessage(err, "Teamdetail konnte nicht geladen werden."));
      setProblem(loadProblem(err));
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
  const leadsTeam = Boolean(user && team && (team.leader_id === user.id || team.co_leader_ids?.includes(user.id)));
  // Was die Person am Team darf, sagt der Server (team_routes.py, #1350, #1479): `can_manage` (bearbeiten, Squads),
  // `can_remove_members` und `can_dissolve` - mit denselben Regeln wie die Aktionen, für Admin-Rollen also nur mit
  // bestätigter Zwei-Faktor-Anmeldung. Kapitän und Co-Kapitän brauchen sie für ihr eigenes Team nicht. Moderatoren
  // moderieren und sehen auf fremden Team-Seiten keine Verwaltungs-Knöpfe.
  const isLeader = Boolean(user && team?.leader_id === user.id);
  const canManage = Boolean(user && team && (team.can_manage || leadsTeam));
  const canRemoveMembers = Boolean(user && team && (team.can_remove_members || leadsTeam));
  const canDissolve = Boolean(user && team && (team.can_dissolve || isLeader));
  // Admin-Rolle, der nur die bestätigte Zwei-Faktor-Anmeldung fehlt: statt der Knöpfe der Weg dorthin.
  const needsSecondFactor = Boolean(user && team && !canManage && team.admin_needs_second_factor);
  const members = team?.members || [];
  const squads = team?.squads || [];

  const stats = useMemo(() => ({
    members: team?.member_count ?? team?.member_ids?.length ?? members.length,
    squads: team?.squad_count ?? squads.length,
    role: isLeader ? "Kapitän" : leadsTeam ? "Co-Kapitän" : isMember ? "Spieler" : canManage ? "Verwaltung" : "Besucher",
  }), [canManage, isLeader, isMember, leadsTeam, members.length, squads.length, team?.member_count, team?.member_ids?.length, team?.squad_count]);

  const openProfile = useCallback((username?: string | null) => {
    if (!username) return;
    navigation.navigate("PublicProfile", { username });
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
        color: teamForm.color || AUTO_COLOR,
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
    showActionResult(() => api.post(`/teams/${team.id}/members/${member.id}/role`, { role }), role === "co_leader" ? "Ist jetzt Co-Kapitän." : "Ist wieder Spieler.");
  }, [showActionResult, team]);

  const transferLeader = useCallback((member: TeamMember) => {
    if (!team) return;
    Alert.alert("Kapitän übergeben?", `${member.display_name || member.username || "Dieses Mitglied"} wird Kapitän. Du bist danach Co-Kapitän.`, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Übergeben", onPress: () => showActionResult(() => api.post(`/teams/${team.id}/transfer-leader`, { new_leader_id: member.id }), "Kapitän übergeben.") },
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

  const saveTeamImage = useCallback(async (key: "logo_url" | "banner_url", url: string) => {
    if (!team) return;
    await api.patch(`/teams/${team.id}`, { [key]: url });
    setTeamForm((current) => ({ ...current, [key]: url }));
    setTeam((current) => (current ? { ...current, [key]: url } : current));
  }, [team]);

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
    Alert.alert("Squad löschen?", `"${squad.name}" wird entfernt.`, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Löschen", style: "destructive", onPress: () => showActionResult(() => api.delete(`/teams/${team.id}/squads/${squad.id}`), "Squad gelöscht.") },
    ]);
  }, [showActionResult, team]);

  if (loading) {
    return (
      <Screen>
        <SkeletonList count={4} hasImage={false} />
      </Screen>
    );
  }

  // Aufgelöst (#1274): zurück dorthin, woher man kam - die Team-Seite gibt es nicht mehr.
  const dissolved = () => {
    setEditOpen(false);
    if (typeof (navigation as { canGoBack?: () => boolean }).canGoBack === "function" && navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("CommunityHub", { section: "teams" });
  };

  const joinedByLink = () => {
    navigation.setParams({ invite: undefined });
    setMessage("Du bist dem Team beigetreten.");
    load();
  };

  if (!team && inviteToken) {
    // Ein privates Team zeigt sich nur mit gültigem Einladungs-Link - dann gleich mit „Beitreten“.
    return (
      <Screen>
        <TeamJoinInvite teamId={route.params.id} token={inviteToken} signedIn={Boolean(user && !isGuestUser(user))} onSignIn={() => openSignIn()} onJoined={joinedByLink} />
      </Screen>
    );
  }

  if (!team) {
    return (
      <Screen>
        <ErrorState title="Teamdetail nicht verfügbar" detail={error || "Das Team konnte nicht geladen werden."} problem={problem} onRetry={() => { void load(); }} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.cyan} />}
      >
        <TeamHeader
          team={team}
          header={(overview?.header || null) as TeamHeaderData | null}
          level={level?.level ?? null}
          crown={level?.crown ?? null}
          userId={user?.id}
          onOpenProfile={openProfile}
          actions={canManage ? (
            <>
              <View style={styles.headerAction}>
                <Button label={inviteOpen ? "Einladen schließen" : "Einladen"} onPress={() => setInviteOpen((open) => !open)} testID="team-invite-open" />
              </View>
              <View style={styles.headerAction}>
                <Button label={editOpen ? "Fertig" : "Bearbeiten"} variant="secondary" onPress={() => setEditOpen((open) => !open)} testID="team-edit-open" />
              </View>
            </>
          ) : null}
        />

        {needsSecondFactor && team ? (
          <Card style={styles.card} testID="team-mfa-hint">
            <Muted>Teams verwalten geht für Admins erst mit bestätigter Zwei-Faktor-Anmeldung. Einrichten kannst du sie auf der Website unter Profil → Sicherheit.</Muted>
            <Button
              compact
              variant="secondary"
              label="2FA einrichten"
              testID="team-mfa-setup"
              onPress={() => { Linking.openURL(mfaSetupUrl(team.id)).catch(() => undefined); }}
            />
          </Card>
        ) : null}

        {message ? <Muted style={styles.success}>{message}</Muted> : null}
        {error ? <Muted style={styles.error}>{error}</Muted> : null}

        {editOpen && canManage ? (
          <Card style={styles.card}>
            <Heading>Basisdaten bearbeiten</Heading>
            <Field label="Name" value={teamForm.name} onChangeText={(value) => setTeamForm((current) => ({ ...current, name: value }))} />
            <Field label="Tag" value={teamForm.tag} onChangeText={(value) => setTeamForm((current) => ({ ...current, tag: value.toUpperCase().slice(0, 8) }))} />
            <Field label="Beschreibung" value={teamForm.description} multiline onChangeText={(value) => setTeamForm((current) => ({ ...current, description: value }))} />
            {/* Logo und Banner vom Handy (#1153) - nur für Kapitän und Co-Kapitän; gespeichert wird sofort. */}
            <ImagePickField label="Logo" shape="square" value={teamForm.logo_url} onUploaded={(url) => saveTeamImage("logo_url", url)} fallback={<Body style={styles.logoInitials}>{(team.tag || team.name).slice(0, 2).toUpperCase()}</Body>} testID="team-logo" />
            <ImagePickField label="Banner" shape="banner" value={teamForm.banner_url} onUploaded={(url) => saveTeamImage("banner_url", url)} testID="team-banner" />
            <Field label="Discord-Link" value={teamForm.discord_link} onChangeText={(value) => setTeamForm((current) => ({ ...current, discord_link: value }))} />
            <ColorPicker value={teamForm.color} onChange={(color) => setTeamForm((current) => ({ ...current, color }))} />
            <Button label={busy ? "Speichert ..." : "Team speichern"} disabled={busy || !teamForm.name.trim() || !teamForm.tag.trim()} onPress={saveTeam} />
            {canDissolve ? <TeamDissolve team={team} onDissolved={dissolved} /> : null}
          </Card>
        ) : null}

        {canManage && inviteOpen ? <TeamInviteCard teamId={team.id} teamName={team.name} joinCode={team.join_code} /> : null}

        {inviteToken && !isMember ? (
          <TeamJoinInvite teamId={team.id} token={inviteToken} signedIn={Boolean(user && !isGuestUser(user))} onSignIn={() => openSignIn()} onJoined={joinedByLink} />
        ) : null}

        <TeamSchedule
          overview={overview}
          onOpenTournament={(id) => navigation.navigate("TournamentDetail", { id })}
          onOpenMatch={(id) => navigation.navigate("MatchDetail", { id })}
        />

        <Card style={styles.card}>
          <View style={styles.cardTop}>
            <Heading>Teamaktionen</Heading>
            {canManage ? <Pill label="Verwaltung aktiv" tone="success" /> : isMember ? <Pill label="Mitglied" /> : null}
          </View>
          <View style={styles.actionGrid}>
            {/* Gast zuerst (#918): Chat und Beitritt brauchen ein Konto - statt eines Fehlers gleich der Weg dorthin. */}
            {isGuestUser(user) ? (
              <>
                <Muted>Team-Chat und Beitritt gibt es mit einem Konto.</Muted>
                <Button label="Anmelden oder registrieren" onPress={() => openSignIn()} testID="team-sign-in" />
              </>
            ) : (
              <Button label="Team-Chat öffnen" onPress={() => navigation.navigate("TeamChat", { id: team.id, title: `${team.tag || team.name} Chat` })} />
            )}
            {team.discord_link ? <Button label="Discord öffnen" variant="secondary" onPress={() => Linking.openURL(normalizeLink(team.discord_link)).catch(() => setError("Discord-Link konnte nicht geöffnet werden."))} /> : null}
            {isMember && !isLeader ? <Button label="Team verlassen" variant="danger" disabled={busy} onPress={leave} /> : null}
          </View>
        </Card>


        {!isMember && user && !isGuestUser(user) ? (
          <Card style={styles.card}>
            <Heading>Team beitreten</Heading>
            <Muted>Wenn du einen Join-Code vom Team erhalten hast, kannst du hier direkt beitreten.</Muted>
            <Field label="Join-Code" value={joinCode} onChangeText={setJoinCode} />
            <Button label="Beitreten" disabled={busy || !joinCode.trim()} onPress={join} />
          </Card>
        ) : null}

        {canManage ? <Card style={styles.card} testID="team-manage-members">
          <View style={styles.cardTop}>
            <Heading>Mitglieder verwalten</Heading>
            <Pill label={`${members.length || stats.members}`} />
          </View>
          {members.length ? members.map((member) => (
            <MemberRow
              key={member.id}
              busy={busy}
              canRemoveMembers={canRemoveMembers}
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
        </Card> : null}

        <Card style={styles.card}>
          <View style={styles.cardTop}>
            <Heading>Squads</Heading>
            {canManage ? <Button compact variant="secondary" icon="add" label="Neu" accessibilityLabel="Neuer Squad" onPress={() => startSquadEdit()} /> : null}
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
                <Button compact variant="secondary" label={candidate.has_pending_invite ? "Offen" : "Einladen"} disabled={busy || Boolean(candidate.has_pending_invite)} onPress={() => invite(candidate)} />
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
  canRemoveMembers,
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
  canRemoveMembers: boolean;
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
  const canKick = canRemoveMembers && !isTeamLeader && !isSelf;
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
          <Pill label={ROLE_LABELS[faceRole(team, member)]} tone={role === "leader" ? "gold" : role === "co_leader" ? "success" : "default"} />
          {isSelf ? <Pill label="Du" /> : null}
        </View>
        {canRole || canKick ? (
          <View style={styles.memberActions}>
            {canRole ? (
              <Button compact variant="secondary" label={role === "co_leader" ? "Spieler" : "Co-Kapitän"} accessibilityLabel={role === "co_leader" ? "Zum Spieler machen" : "Zum Co-Kapitän machen"} disabled={busy} onPress={() => onRole(member, role === "co_leader" ? "member" : "co_leader")} />
            ) : null}
            {canRole ? (
              <Button compact variant="secondary" label="Kapitän" accessibilityLabel="Zum Kapitän machen" disabled={busy} onPress={() => onTransfer(member)} />
            ) : null}
            {canKick ? (
              <Button compact variant="danger" label="Entfernen" accessibilityLabel="Aus dem Team entfernen" disabled={busy} onPress={() => onKick(member)} />
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
          <Button compact variant="quiet" label="Bearbeiten" onPress={() => onEdit(squad)} />
          {squad.id ? <Button compact variant="danger" label="Löschen" accessibilityLabel="Squad löschen" onPress={() => onDelete(squad)} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <View style={styles.field} testID="team-color-picker">
      <Muted style={styles.fieldLabel}>Team-Farbe</Muted>
      <View style={styles.wrap}>
        <Pressable
          onPress={() => onChange(AUTO_COLOR)}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === AUTO_COLOR }}
          style={[styles.option, value === AUTO_COLOR && styles.optionActive]}
          testID="team-color-auto"
        >
          <Muted style={value === AUTO_COLOR && styles.optionTextActive}>Automatisch (Spiel)</Muted>
        </Pressable>
        {TEAM_COLORS.map((color) => (
          <Pressable
            key={color.key}
            onPress={() => onChange(color.key)}
            accessibilityRole="radio"
            accessibilityLabel={color.label}
            accessibilityState={{ selected: value === color.key }}
            style={[styles.swatch, { backgroundColor: color.hex }, value === color.key && styles.swatchActive]}
            testID={`team-color-${color.key}`}
          />
        ))}
      </View>
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

function normalizeLink(url?: string | null) {
  const value = String(url || "").trim();
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/** Zwei-Faktor wohnt auf der Website unter Profil → Sicherheit (wie `mfaSetupPath` im Web); danach zurück zum Team. */
export function mfaSetupUrl(teamId: string) {
  return `${WEB_BASE_URL}/profile?tab=security&mfa=required&next=${encodeURIComponent(`/teams/${teamId}`)}`;
}

const styles = StyleSheet.create({
  logoInitials: {
    color: colors.cyan,
    fontSize: 26,
    fontWeight: "900",
  },
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 34,
  },
  card: {
    gap: 12,
  },
  headerAction: {
    flex: 1,
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
    borderRadius: radius.lg,
    borderWidth: 1,
    color: colors.white,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  inputMulti: {
    minHeight: 92,
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
    borderRadius: radius.lg,
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
  squadForm: {
    borderColor: colors.border,
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
  swatch: {
    borderColor: "transparent",
    borderRadius: radius.lg,
    borderWidth: 2,
    height: 34,
    width: 34,
  },
  swatchActive: {
    borderColor: colors.white,
  },
  memberChip: {
    backgroundColor: "rgba(255,255,255,0.045)",
    borderColor: colors.border,
    borderRadius: radius.lg,
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
    borderRadius: radius.lg,
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
