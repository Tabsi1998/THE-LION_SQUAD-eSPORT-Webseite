import React, { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { api, errorMessage } from "../../lib/api";
import { applicationTone, applicationsForSquads, carryLine, teamStateLabel, type ApplicationTone, type TeamApplication } from "../../lib/leagueTeam";
import { declineText, outlookBadge, outlookLine, rightLine, startRightToast, teamBadge, teamBadgeTone, type StartRightCarry, type StartRightOutlook } from "../../lib/leagueStartRights";
import { openLink } from "../../lib/openLink";
import { colors, radius, roles } from "../../theme";
import { Button } from "../Button";
import { Card } from "../Card";
import { StaggerIn } from "../motion";
import { Body, Heading, Muted } from "../Text";

// Liga-Anmeldung am Team (#2173, Web: components/tls/league/application/SquadApplicationStatus.jsx, docs/LIGA.md B.4 und F.2): je
// Co-Team der Stand der Anmeldung mit Link zur Ligaseite. Aus der Vorgänger-Season übernommen (F.2): Herkunft, Frist und „Abmelden“
// stehen hier, auch solange die Season noch nicht sichtbar ist.
// Startrechte (#1627, F.2a, Web: StartRightBlock.jsx): Führt die Season Startrechte, steht hier der Stand mit Frist statt „Angemeldet“ -
// „Startrecht annehmen“ und „Nachrücken ablehnen“ gehen über denselben Antrag. Ob etwas geht, sagt der Server (`can_accept`,
// `can_decline`); scheitert es (Frist vorbei, schon entschieden), gilt der frische Stand vom Server. Vor der Folge-Season steht je
// Season die Prognose aus der laufenden Tabelle bzw. das bestätigte Startrecht aus dem Endstand (`start_rights[]`), ohne Knopf.

const TONE_COLORS: Record<ApplicationTone, string> = { quiet: roles.quiet, info: roles.brand, ok: roles.ok, warn: roles.warn };

type StartRightApplication = TeamApplication & { carry_over?: StartRightCarry | null };
type Action = "accept" | "decline" | "withdraw";

function StateBadge({ label, tone, testID }: { label: string; tone: ApplicationTone; testID: string }) {
  const color = TONE_COLORS[tone];
  return <Text style={[styles.badge, { borderColor: color, color }]} testID={testID}>{label}</Text>;
}

function Title({ title, url }: { title?: string; url?: string | null }) {
  return (
    <Body style={[styles.title, url ? styles.link : null]} onPress={url ? () => { openLink(url); } : undefined} accessibilityRole={url ? "link" : undefined}>
      {title}
    </Body>
  );
}

function StartRightBlock({ row, busy, onSend }: { row: StartRightApplication; busy: string; onSend: (row: StartRightApplication, action: "accept" | "decline") => void }) {
  const right = row.carry_over?.start_right;
  if (!right) return null;
  const line = rightLine(row.carry_over);
  if (!line && !right.can_accept && !right.can_decline) return null;
  return (
    <View style={styles.block} testID={`squad-start-right-${row.id}`}>
      {line ? <Body style={right.state === "offered" ? styles.open : styles.small} testID={`squad-start-right-line-${row.id}`}>{line}</Body> : null}
      {right.can_accept || right.can_decline ? (
        <View style={styles.actions}>
          {right.can_accept ? (
            <Button compact label={busy === `${row.id}:accept` ? "Sagt zu ..." : "Startrecht annehmen"} busy={busy === `${row.id}:accept`} disabled={Boolean(busy)}
              onPress={() => onSend(row, "accept")} testID={`squad-start-right-accept-${row.id}`} />
          ) : null}
          {right.can_decline ? (
            <Button compact variant="quiet" label={busy === `${row.id}:decline` ? "Lehnt ab ..." : "Nachrücken ablehnen"} busy={busy === `${row.id}:decline`} disabled={Boolean(busy)}
              onPress={() => onSend(row, "decline")} testID={`squad-start-right-decline-${row.id}`} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function LeagueApplicationsCard({ squadIds, enabled = true }: { squadIds: Array<string | null | undefined>; enabled?: boolean }) {
  const [items, setItems] = useState<StartRightApplication[]>([]);
  const [outlook, setOutlook] = useState<StartRightOutlook[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const key = squadIds.filter(Boolean).join(",");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ items?: StartRightApplication[]; start_rights?: StartRightOutlook[] }>("/me/league-applications");
      setItems(Array.isArray(data?.items) ? data.items : []);
      setOutlook(Array.isArray(data?.start_rights) ? data.start_rights : []);
    } catch {
      // Ein Teil der Team-Seite: kommt er nicht, steht er einfach nicht da (wie im Web).
    }
  }, []);

  useEffect(() => {
    if (!enabled || !key) return;
    void load();
  }, [enabled, key, load]);

  const rows = applicationsForSquads(items, squadIds) as StartRightApplication[];
  const ids = new Set(squadIds.filter(Boolean));
  const ahead = outlook.filter((row) => row && ids.has(row.squad_id));
  if (!enabled || (!rows.length && !ahead.length)) return null;

  const run = async (row: StartRightApplication, action: Action) => {
    setBusy(`${row.id}:${action}`);
    setError("");
    setMessage("");
    try {
      if (action === "withdraw") {
        await api.post(`/me/league-applications/${encodeURIComponent(row.id)}/withdraw`, {});
        setMessage("Abgemeldet. Der Platz ist frei.");
      } else {
        await api.post(`/me/league-applications/${encodeURIComponent(row.id)}/start-right`, { action });
        setMessage(startRightToast(action, row.carry_over));
      }
    } catch (err) {
      setError(errorMessage(err, action === "withdraw" ? "Abmelden hat nicht geklappt." : "Das hat nicht geklappt. Der Stand ist neu geladen."));
    } finally {
      // Auch nach einem Fehler: Frist vorbei oder schon entschieden - der Stand vom Server gilt.
      await load();
      setBusy("");
    }
  };

  const withdraw = (row: StartRightApplication) => {
    Alert.alert(
      "Von der Season abmelden?",
      `Ihr spielt dann nicht in ${row.title}. Der Platz geht an die Warteliste oder neue Anmeldungen. Zurück geht es nur über eine neue Anmeldung.`,
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Abmelden", style: "destructive", onPress: () => { void run(row, "withdraw"); } },
      ],
    );
  };

  const sendStartRight = (row: StartRightApplication, action: "accept" | "decline") => {
    if (busy) return;
    if (action === "accept") {
      void run(row, "accept");
      return;
    }
    Alert.alert("Nachrücken ablehnen?", declineText(row.carry_over), [
      { text: "Abbrechen", style: "cancel" },
      { text: "Ablehnen", style: "destructive", onPress: () => { void run(row, "decline"); } },
    ]);
  };

  return (
    <Card style={styles.card} testID="team-league-applications">
      <Heading>Liga-Anmeldungen</Heading>
      {message ? <Muted style={{ color: roles.ok }} accessibilityLiveRegion="polite" testID="team-league-applications-message">{message}</Muted> : null}
      {error ? <Muted style={{ color: roles.live }} accessibilityLiveRegion="polite" testID="team-league-applications-error">{error}</Muted> : null}
      <StaggerIn style={styles.list}>
        {ahead.map((row) => {
          const badge = outlookBadge(row);
          const id = `squad-start-right-outlook-${row.squad_id}-${row.season_id}`;
          return (
            <View key={id} style={styles.row} testID={id}>
              <View style={styles.head}>
                <Title title={row.title} url={row.url} />
                <StateBadge label={badge.label} tone={badge.tone} testID={`${id}-state`} />
              </View>
              <Muted style={styles.small}>{outlookLine(row)}</Muted>
            </View>
          );
        })}
        {rows.map((row) => (
          <View key={row.id} style={styles.row} testID={`squad-application-${row.id}`}>
            <View style={styles.head}>
              <Title title={row.title} url={row.url} />
              <StateBadge label={teamBadge(row) || teamStateLabel(row.status, row)} tone={teamBadgeTone(row) || applicationTone(row.status)} testID={`squad-application-state-${row.id}`} />
            </View>
            {row.carry_over ? <Muted style={styles.small} testID={`squad-application-carry-${row.id}`}>{carryLine(row.carry_over)}</Muted> : null}
            <StartRightBlock row={row} busy={busy} onSend={sendStartRight} />
            {row.staffel ? <Muted style={styles.small}>{row.staffel_left ? `Nicht mehr in ${row.staffel}.` : `Spielt in ${row.staffel}.`}</Muted> : null}
            {row.decision_reason ? <Muted style={styles.small}>Grund: {row.decision_reason}</Muted> : null}
            {row.carry_over && row.can_withdraw ? (
              <Button compact variant="quiet" label={busy === `${row.id}:withdraw` ? "Meldet ab ..." : "Abmelden"} disabled={Boolean(busy)} busy={busy === `${row.id}:withdraw`} onPress={() => withdraw(row)} testID={`squad-application-withdraw-${row.id}`} />
            ) : null}
          </View>
        ))}
      </StaggerIn>
      <Muted style={styles.small}>Mit einem Co-Team anmelden geht auf der Ligaseite im Web – dort stehen auch Regelwerk und Plätze.</Muted>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  list: { gap: 10 },
  row: { borderTopColor: colors.border, borderTopWidth: 1, gap: 4, paddingTop: 10 },
  head: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  title: { flexShrink: 1, fontWeight: "800" },
  link: { color: roles.brand },
  badge: { borderRadius: radius.sm, borderWidth: 1, fontSize: 11, fontWeight: "900", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 3 },
  small: { fontSize: 13 },
  block: { gap: 6, paddingTop: 2 },
  open: { fontSize: 14, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
