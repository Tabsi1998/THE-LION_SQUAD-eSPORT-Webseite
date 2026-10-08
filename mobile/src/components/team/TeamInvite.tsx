import React, { useCallback, useEffect, useState } from "react";
import { Alert, Share, StyleSheet, View } from "react-native";
import { Button } from "../Button";
import { Card } from "../Card";
import { QrCode } from "../QrCode";
import { Body, Heading, Muted } from "../Text";
import { api, errorMessage } from "../../lib/api";
import { colors } from "../../theme";

// Einladungs-Link (#1191): Kapitäne zeigen den QR-Code oder teilen den Link; wer ihn öffnet, landet im Team und tippt
// nur noch „Beitreten“. Neu erzeugen macht den alten Link ungültig. Der Join-Code bleibt als Rückfall.

type InviteLink = { url: string; token: string; created_at?: string | null };

export function TeamInviteCard({ teamId, teamName, joinCode }: { teamId: string; teamName: string; joinCode?: string | null }) {
  const [link, setLink] = useState<InviteLink | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<InviteLink>(`/teams/${teamId}/invite-link`);
      setLink(data);
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Der Einladungs-Link konnte nicht geladen werden."));
    }
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  const share = useCallback(async () => {
    if (!link?.url) return;
    try {
      await Share.share({ message: `Komm in unser Team ${teamName} bei THE LION SQUAD: ${link.url}`, url: link.url, title: `${teamName} – Einladung` });
    } catch {
      // Abbrechen ist kein Fehler.
    }
  }, [link?.url, teamName]);

  const renew = useCallback(() => {
    Alert.alert("Neuen Link erzeugen?", "Der bisherige Link und sein QR-Code gelten danach nicht mehr. Wer schon im Team ist, bleibt drin.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Neuen Link erzeugen",
        onPress: async () => {
          setBusy(true);
          try {
            const { data } = await api.post<InviteLink>(`/teams/${teamId}/invite-link`);
            setLink(data);
          } catch (err) {
            setError(errorMessage(err, "Neuer Link hat nicht geklappt."));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [teamId]);

  return (
    <Card style={styles.card} testID="team-invite-card">
      <Heading>Ins Team einladen</Heading>
      <View style={styles.row}>
        {link?.url ? <QrCode value={link.url} size={112} label="QR-Code mit dem Einladungs-Link" testID="team-invite-qr" /> : <View style={styles.qrPlaceholder} />}
        <View style={styles.text}>
          <Body style={styles.bold}>QR-Code zeigen oder Link teilen</Body>
          <Muted>Wer ihn öffnet, landet im Team und tippt nur noch „Beitreten“.</Muted>
        </View>
      </View>
      {error ? <Muted style={styles.error}>{error}</Muted> : null}
      <Button label="Link teilen" onPress={share} disabled={!link} testID="team-invite-share" />
      <Button label={busy ? "Erzeuge …" : "Neuen Link erzeugen"} variant="secondary" onPress={renew} disabled={!link || busy} testID="team-invite-renew" />
      {joinCode ? (
        <View style={styles.joinCode} testID="team-join-code">
          <Muted>Rückfall: Join-Code</Muted>
          <Body style={styles.code}>{joinCode}</Body>
        </View>
      ) : null}
    </Card>
  );
}

type InviteCheck = { valid: boolean; already_member: boolean; team?: { name?: string; member_count?: number } | null };

export function TeamJoinInvite({ teamId, token, signedIn, onSignIn, onJoined }: {
  teamId: string;
  token: string;
  signedIn: boolean;
  onSignIn: () => void;
  onJoined: () => void;
}) {
  const [check, setCheck] = useState<InviteCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.get<InviteCheck>(`/teams/${teamId}/invite-link/check`, { params: { token } })
      .then(({ data }) => { if (alive) setCheck(data); })
      .catch(() => { if (alive) setCheck({ valid: false, already_member: false, team: null }); });
    return () => { alive = false; };
  }, [teamId, token, signedIn]);

  if (!check || check.already_member) return null;
  if (!check.valid) {
    return (
      <Card style={styles.card} testID="team-join-invalid">
        <Body style={styles.bold}>Dieser Einladungs-Link gilt nicht mehr</Body>
        <Muted>Frag im Team nach einem neuen Link – oder gib den Join-Code unter „Team beitreten“ ein.</Muted>
      </Card>
    );
  }
  const name = check.team?.name || "dieses Team";
  const join = async () => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/teams/${teamId}/join-link`, { token });
      onJoined();
    } catch (err) {
      setError(errorMessage(err, "Beitreten hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={[styles.card, styles.inviteCard]} testID="team-join-invite">
      <Muted style={styles.kicker}>EINLADUNG</Muted>
      <Heading>Du bist eingeladen: {name}</Heading>
      <Muted>{check.team?.member_count ? `${check.team.member_count} Mitglieder warten schon. ` : ""}Ein Tipp, und du bist dabei.</Muted>
      {error ? <Muted style={styles.error}>{error}</Muted> : null}
      {signedIn ? (
        <Button label={busy ? "Trete bei …" : "Beitreten"} onPress={join} disabled={busy} testID="team-join-invite-submit" />
      ) : (
        <Button label="Anmelden und beitreten" onPress={onSignIn} testID="team-join-invite-login" />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  inviteCard: { borderColor: "rgba(41,182,232,0.4)" },
  row: { alignItems: "center", flexDirection: "row", gap: 12 },
  qrPlaceholder: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 8, height: 112, width: 112 },
  text: { flex: 1, gap: 4 },
  bold: { fontWeight: "900" },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  error: { color: colors.live, fontWeight: "800" },
  joinCode: { borderColor: "rgba(255,215,0,0.28)", borderRadius: 8, borderWidth: 1, gap: 2, padding: 10 },
  code: { color: colors.gold, fontSize: 18, fontWeight: "900" },
});
