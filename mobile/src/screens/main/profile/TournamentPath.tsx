import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Button } from "../../../components/Button";
import { Card } from "../../../components/Card";
import { Body, Heading, Muted } from "../../../components/Text";
import { api } from "../../../lib/api";
import { formatDate } from "../../../lib/format";
import { shareResultImage, shareResultLink, type ResultShareOptions } from "../../../lib/resultShare";
import { colors } from "../../../theme";
import type { PersonalReferenceItem } from "../../../types";
import { ReferenceCard } from "./parts";

// Profil (#1193) - wie im Web: „Dein Weg“ je Turnier in den Referenzen (aufklappen) und die Bilanz gegen Gegner als
// Karte in der Übersicht. Farben wie im Turnierbaum (#1340): Siege hell mit Zahl in Cyan, Niederlagen grau - kein Grün
// und Rot. Im eigenen Profil steht alles; für andere nur Öffentliches, private Gegner ohne Namen bzw. gar nicht.

export type PathStep = { kind: "duel" | "heat" | "table" | string; label: string; result: string; outcome?: string | null; opponent?: string | null };
export type TournamentPathData = {
  steps: PathStep[];
  final?: { rank?: number | null; participant_count?: number | null };
  team_name?: string | null;
  date?: string | null;
  share?: ResultShareOptions | null;
};
export type RecordRow = { key: string; kind: "user" | "team"; name: string; tag?: string | null; username?: string | null; team_id?: string | null; wins: number; losses: number; draws?: number; games?: number };

function viewParams(publicView: boolean) {
  return publicView ? { params: { view_as: "public" } } : undefined;
}

export function stepLine(step: PathStep): string {
  if (step.kind === "duel" && step.opponent === "Freilos") return `${step.result || "weiter"} · Freilos`;
  return step.kind === "duel" && step.opponent ? `${step.result} gegen ${step.opponent}` : step.result || "";
}

export function finalLine(path: TournamentPathData): string {
  const final = path.final || {};
  return final.rank ? `${final.rank}. Platz${final.participant_count ? ` von ${final.participant_count}` : ""}` : "Teilgenommen";
}

export function recordLabel(row: RecordRow): string {
  const parts = [`${row.wins} ${row.wins === 1 ? "Sieg" : "Siege"}`];
  if (row.draws) parts.push(`${row.draws} Unentschieden`);
  parts.push(`${row.losses} ${row.losses === 1 ? "Niederlage" : "Niederlagen"}`);
  return `gegen ${row.name}: ${parts.join(", ")}`;
}

function PathView({ path, testID }: { path: TournamentPathData; testID: string }) {
  return (
    <View style={styles.path} testID={testID}>
      {path.steps.map((step, index) => {
        const win = step.outcome === "win";
        const loss = step.outcome === "loss";
        return (
          <View key={`${step.label}-${index}`} style={styles.step} testID="tournament-path-step">
            <View style={[styles.dot, win ? styles.dotWin : loss ? styles.dotLoss : styles.dotNeutral]} />
            <View style={styles.stepText}>
              <Body style={styles.stepLabel}>{step.label}</Body>
              <Muted><Muted style={win ? styles.win : loss ? styles.loss : styles.neutral}>{step.kind === "duel" && step.opponent === "Freilos" ? `${step.result || "weiter"} · Freilos` : step.result}</Muted>{step.kind === "duel" && step.opponent && step.opponent !== "Freilos" ? ` gegen ${step.opponent}` : ""}</Muted>
            </View>
          </View>
        );
      })}
      <View style={styles.step} testID="tournament-path-final">
        <View style={[styles.dot, styles.dotFinal]} />
        <View style={styles.stepText}>
          <Body style={styles.stepLabel}>{finalLine(path)}</Body>
          <Muted>{[path.team_name, path.date ? formatDate(path.date) : null].filter(Boolean).join(" · ")}</Muted>
        </View>
      </View>
    </View>
  );
}

/** Eine Referenz mit „Weg“ zum Aufklappen - der Weg lädt erst beim ersten Aufklappen. */
export function ReferenceWithPath({ item, username, own = false, publicView = false, onOpen }: {
  item: PersonalReferenceItem; username?: string | null; own?: boolean; publicView?: boolean; onOpen?: (item: PersonalReferenceItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [path, setPath] = useState<TournamentPathData | null>(null);
  const [message, setMessage] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const canExpand = (item.kind || "tournament") === "tournament" && Boolean(item.target_id) && Boolean(username);

  const toggle = () => {
    setOpen((value) => !value);
    if (state !== "idle" || !username || !item.target_id) return;
    setState("loading");
    api.get<TournamentPathData>(`/profile/${encodeURIComponent(username)}/tournaments/${encodeURIComponent(item.target_id)}/path`, viewParams(publicView))
      .then(({ data }) => { if (alive.current) { setPath(data); setState("ready"); } })
      .catch(() => { if (alive.current) setState("error"); });
  };
  const share = async (task: () => Promise<"shared" | "failed">) => {
    setMessage("");
    if ((await task()) === "failed" && alive.current) setMessage("Teilen ging gerade nicht – versuch es gleich noch einmal.");
  };

  return (
    <View>
      <ReferenceCard item={item} onOpen={onOpen} />
      {canExpand ? (
        <Pressable onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
          testID={`reference-path-toggle-${item.id}`}>
          <Muted style={styles.toggleText}>{open ? "Weg ausblenden" : own ? "Dein Weg" : "Weg ansehen"}</Muted>
        </Pressable>
      ) : null}
      {open ? (
        <View style={styles.box} testID={`tournament-path-${item.id}`}>
          {state === "loading" ? <Muted>Lade den Weg …</Muted> : null}
          {state === "error" ? <Muted>Für dieses Turnier gibt es keinen Weg zum Anzeigen.</Muted> : null}
          {state === "ready" && path ? (
            <>
              {!path.steps.length ? <Muted>Keine gewerteten Spiele – nur der Endplatz.</Muted> : null}
              <PathView path={path} testID={`tournament-path-steps-${item.id}`} />
              {own && path.share?.shareable ? (
                <View style={styles.shareRow}>
                  <View style={styles.flex}><Button label="Bild teilen" onPress={() => share(() => shareResultImage(path.share as ResultShareOptions))} testID={`reference-share-image-${item.id}`} /></View>
                  <View style={styles.flex}><Button label="Link teilen" variant="secondary" onPress={() => share(() => shareResultLink(path.share as ResultShareOptions))} testID={`reference-share-link-${item.id}`} /></View>
                </View>
              ) : null}
              {message ? <Muted style={styles.error}>{message}</Muted> : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** „Bilanz gegen“ - die fünf häufigsten Gegner. Ohne Gegner mit mindestens zwei Spielen steht hier nichts. */
export function RecordCard({ username, publicView = false, onOpenUser, onOpenTeam }: {
  username?: string | null; publicView?: boolean; onOpenUser?: (username: string) => void; onOpenTeam?: (id: string) => void;
}) {
  const [rows, setRows] = useState<RecordRow[]>([]);
  useEffect(() => {
    if (!username) return undefined;
    let active = true;
    api.get<{ opponents?: RecordRow[] }>(`/profile/${encodeURIComponent(username)}/record`, viewParams(publicView))
      .then(({ data }) => { if (active) setRows(Array.isArray(data?.opponents) ? data.opponents : []); })
      .catch(() => { if (active) setRows([]); });
    return () => { active = false; };
  }, [username, publicView]);
  if (!rows.length) return null;
  return (
    <Card style={styles.card} testID="profile-record">
      <Heading>Bilanz gegen</Heading>
      {rows.map((row) => {
        const games = Math.max(1, row.games || row.wins + row.losses + (row.draws || 0));
        const target = row.kind === "team" ? row.team_id : row.username;
        const open = target ? () => (row.kind === "team" ? onOpenTeam?.(target) : onOpenUser?.(target)) : undefined;
        return (
          <Pressable key={row.key} onPress={open} disabled={!open} accessibilityRole={open ? "button" : undefined} accessibilityLabel={recordLabel(row)}
            style={({ pressed }) => [styles.recordRow, pressed && open ? styles.pressed : null]} testID={`profile-record-${row.key}`}>
            <View style={[styles.avatar, row.kind === "team" && styles.avatarTeam]}>
              <Muted style={styles.avatarText}>{String(row.tag || row.name || "?").slice(0, 2).toUpperCase()}</Muted>
            </View>
            <View style={styles.flex}>
              <Body style={styles.recordName} numberOfLines={1}>{row.name}</Body>
              <View style={styles.bar}>
                <View style={[styles.barWins, { width: `${(row.wins / games) * 100}%` }]} />
                <View style={[styles.barDraws, { width: `${((row.draws || 0) / games) * 100}%` }]} />
              </View>
            </View>
            <Body style={styles.score}><Body style={styles.win}>{String(row.wins)}</Body><Body style={styles.loss}>{` : ${row.losses}`}</Body></Body>
          </Pressable>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  toggle: { alignSelf: "flex-start", paddingVertical: 6, paddingHorizontal: 2 },
  toggleText: { color: colors.cyan, fontWeight: "800", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  pressed: { opacity: 0.7 },
  box: { marginLeft: 6, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: colors.border, gap: 8, paddingBottom: 8 },
  path: { gap: 10 },
  step: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, marginTop: 4, backgroundColor: colors.black },
  dotWin: { borderColor: colors.cyan },
  dotLoss: { borderColor: "rgba(255,255,255,0.3)" },
  dotNeutral: { borderColor: "rgba(255,255,255,0.7)" },
  dotFinal: { borderColor: "rgba(255,255,255,0.8)", backgroundColor: "rgba(255,255,255,0.8)" },
  stepText: { flex: 1, gap: 2 },
  stepLabel: { fontWeight: "800" },
  win: { color: colors.cyan, fontWeight: "800" },
  loss: { color: "rgba(255,255,255,0.45)", fontWeight: "800" },
  neutral: { color: colors.white, fontWeight: "800" },
  shareRow: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
  error: { color: colors.live },
  card: { gap: 12 },
  recordRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center" },
  avatarTeam: { borderRadius: 6 },
  avatarText: { fontWeight: "800", fontSize: 11 },
  recordName: { fontWeight: "700" },
  bar: { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.15)", marginTop: 5 },
  barWins: { backgroundColor: "rgba(255,255,255,0.9)" },
  barDraws: { backgroundColor: "rgba(255,255,255,0.4)" },
  score: { fontWeight: "900", fontVariant: ["tabular-nums"] },
});
