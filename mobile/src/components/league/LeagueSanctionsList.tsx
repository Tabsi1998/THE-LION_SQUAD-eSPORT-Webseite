import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { api, errorMessage } from "../../lib/api";
import { useSingleFlight } from "../../lib/useSingleFlight";
import { remainingText } from "../../lib/leagueProcedures";
import { navigateToUrl } from "../../navigation/rootNavigation";
import { viennaDateTime } from "../../lib/vienna";
import { colors, radius, roles } from "../../theme";
import { Button } from "../Button";
import { Body, Muted } from "../Text";

// Strafen der Liga (E.3; App #2173) wie „Meine Strafen“ im Web (LeagueSanctionCard): Art, Regelverstoß, Begründung, Zeitraum, Stand,
// gegen dich oder gegen dein Co-Team - und der Einspruch, einmal je Strafe, nur wenn der Server ihn erlaubt (`can_appeal`). Die Strafe
// gilt bis zur Entscheidung weiter. Andere Strafen (Moderation) stehen wie bisher im Web.

export const SANCTION_STATUS: Record<string, { label: string; tone: "warn" | "live" | "calm" }> = {
  provisional: { label: "Vorläufig", tone: "warn" },
  active: { label: "Gilt", tone: "live" },
  served: { label: "Abgelaufen", tone: "calm" },
  revoked: { label: "Widerrufen", tone: "calm" },
};
export const APPEAL_STATE_LABELS: Record<string, string> = {
  open: "Einspruch offen",
  upheld: "Einspruch abgelehnt, Strafe bleibt",
  granted: "Einspruch stattgegeben, Strafe aufgehoben",
  moot: "Einspruch erledigt, Strafe widerrufen",
};
const APPEAL_MIN = 10;
const WHEN = { dateStyle: "medium", timeStyle: "short" } as const;
const TONE_COLORS = { warn: roles.warn, live: "#FF6B60", calm: colors.muted };

type Sanction = {
  id: string; status?: string; rule_ref?: string | null; reason?: string | null; period?: string | null; points?: number | null;
  revoked_at?: string | null; revoke_reason?: string | null; match_id?: string | null; can_appeal?: boolean; appeal_until?: string | null;
  appeal?: { state?: string; at?: string | null; by_name?: string | null; text?: string | null; note?: string | null } | null;
};
export type PenaltyRow = {
  kind?: string; ref_id: string; label?: string; issued_at?: string | null; context_title?: string | null; context_url?: string | null;
  team_penalty?: boolean; team_name?: string | null; sanction?: Sanction | null;
};

function when(value?: string | null) {
  return value ? viennaDateTime(value, WHEN) : "";
}

function SanctionCard({ row, onChanged }: { row: PenaltyRow; onChanged: () => void }) {
  const sanction = row.sanction as Sanction;
  const status = SANCTION_STATUS[String(sanction.status)] || SANCTION_STATUS.active;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const once = useSingleFlight();
  const submit = () => once(async () => {
    setSaving(true);
    setError("");
    try {
      await api.post(`/penalties/sanctions/${sanction.id}/appeal`, { text: text.trim() });
      setOpen(false);
      onChanged();
    } catch (failure) {
      setError(errorMessage(failure, "Der Einspruch konnte nicht eingelegt werden."));
    } finally {
      setSaving(false);
    }
  });
  return (
    <View style={styles.card} testID={`penalty-card-${row.ref_id}`}>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Body style={styles.title}>{row.label}</Body>
          <Muted style={styles.eyebrow}>{row.team_penalty ? `Strafe der Liga-Leitung gegen das Co-Team ${row.team_name}` : "Strafe der Liga-Leitung gegen dich"}</Muted>
        </View>
        <View style={[styles.badge, { borderColor: TONE_COLORS[status.tone] }]}>
          <Muted style={[styles.badgeText, { color: TONE_COLORS[status.tone] }]} testID={`sanction-status-${sanction.id}`}>{status.label}</Muted>
        </View>
      </View>
      {row.context_url ? (
        <Pressable onPress={() => navigateToUrl(row.context_url)} accessibilityRole="link" style={styles.link}><Muted style={styles.cyan}>{row.context_title}</Muted></Pressable>
      ) : row.context_title ? <Muted>{row.context_title}</Muted> : null}
      <Muted>Regelverstoß: <Muted style={styles.strong}>{sanction.rule_ref}</Muted></Muted>
      <Muted>Begründung: <Muted style={styles.strong}>{sanction.reason}</Muted></Muted>
      {sanction.period ? <Muted testID={`sanction-period-${sanction.id}`}>{sanction.points ? "Höhe" : "Zeitraum"}: <Muted style={styles.strong}>{sanction.period}</Muted></Muted> : null}
      <Muted>Verhängt {when(row.issued_at)} durch die Liga-Leitung</Muted>
      {sanction.status === "revoked" ? <Muted testID={`sanction-revoked-${sanction.id}`}>Aufgehoben {when(sanction.revoked_at)}: {sanction.revoke_reason}</Muted> : null}
      {sanction.match_id ? (
        <Pressable onPress={() => navigateToUrl(`/matches/${sanction.match_id}`)} accessibilityRole="link" style={styles.link}><Muted style={styles.cyan}>Zum Spiel</Muted></Pressable>
      ) : null}
      {sanction.appeal ? (
        <View style={styles.box} testID={`sanction-appeal-${sanction.id}`}>
          <Muted style={[styles.eyebrow, { color: roles.honor }]}>{APPEAL_STATE_LABELS[String(sanction.appeal.state)] || "Einspruch"}</Muted>
          <Muted>Eingelegt {when(sanction.appeal.at)}{sanction.appeal.by_name ? ` von ${sanction.appeal.by_name}` : ""}</Muted>
          {sanction.appeal.text ? <Body>{sanction.appeal.text}</Body> : null}
          <Muted>{sanction.appeal.state === "open" ? "Eine andere Person der Liga-Leitung entscheidet. Bis dahin gilt die Strafe weiter." : `Begründung der Entscheidung: ${sanction.appeal.note || ""}`}</Muted>
        </View>
      ) : sanction.can_appeal ? (
        <View style={styles.box} testID={`sanction-appeal-box-${sanction.id}`}>
          <Muted testID={`sanction-deadline-${sanction.id}`}>Einspruch möglich bis {when(sanction.appeal_until)} ({remainingText(sanction.appeal_until)}).</Muted>
          {open ? (
            <>
              <TextInput value={text} onChangeText={setText} multiline maxLength={1000} style={styles.input} placeholderTextColor={colors.muted}
                placeholder="Warum ist die Strafe aus deiner Sicht falsch? Mindestens zehn Zeichen." testID={`sanction-appeal-input-${sanction.id}`} />
              <Muted>Einspruch geht nur einmal. Es entscheidet eine andere Person der Liga-Leitung. Bis dahin gilt die Strafe weiter.</Muted>
              <Button label="Einspruch einlegen" arrow={false} onPress={() => { void submit(); }} disabled={saving || text.trim().length < APPEAL_MIN} testID={`sanction-appeal-send-${sanction.id}`} />
              <Button label="Abbrechen" variant="quiet" arrow={false} onPress={() => setOpen(false)} disabled={saving} />
            </>
          ) : <Button label="Einspruch einlegen" variant="secondary" arrow={false} onPress={() => setOpen(true)} testID={`sanction-appeal-open-${sanction.id}`} />}
          {error ? <Muted style={styles.error} accessibilityRole="alert">{error}</Muted> : null}
        </View>
      ) : null}
    </View>
  );
}

/** Die Liga-Strafen aus `/penalties/me` - ohne Treffer oder ohne Antwort steht nichts da (ein Teil der Seite). */
export function LeagueSanctionsList({ enabled = true, reloadKey = 0 }: { enabled?: boolean; reloadKey?: number }) {
  const [rows, setRows] = useState<PenaltyRow[]>([]);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ items?: PenaltyRow[] }>("/penalties/me");
      setRows((Array.isArray(data?.items) ? data.items : []).filter((row) => row.kind === "league_sanction" && row.sanction));
    } catch {
      // Kommt die Liste nicht, steht sie nicht da - der Rest des Profils bleibt.
    }
  }, []);
  // `reloadKey`: Das Profil zählt ihn beim Herunterziehen hoch - dann kommt der Stand frisch.
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load, reloadKey]);
  if (!enabled || !rows.length) return null;
  return (
    <View style={styles.stack} testID="league-sanctions">
      <Muted style={styles.eyebrow}>Strafen der Liga</Muted>
      {rows.map((row) => <SanctionCard key={row.ref_id} row={row} onChanged={() => { void load(); }} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  box: { borderColor: "rgba(255,215,0,0.3)", borderRadius: radius.lg, borderWidth: 1, gap: 6, padding: 10 },
  card: { backgroundColor: colors.black, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: 6, padding: 12 },
  cyan: { color: colors.cyan, fontWeight: "800" },
  error: { color: "#FF6B60", fontWeight: "800" },
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
  flex: { flex: 1, minWidth: 0 },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, color: colors.white, minHeight: 96, paddingHorizontal: 12, paddingTop: 10, textAlignVertical: "top" },
  link: { justifyContent: "center", minHeight: 44 },
  rowBetween: { alignItems: "flex-start", flexDirection: "row", gap: 8, justifyContent: "space-between" },
  stack: { gap: 8, marginTop: 8 },
  strong: { color: colors.white, fontWeight: "800" },
  title: { color: "#FF6B60", fontWeight: "900", textTransform: "uppercase" },
});
