import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { viennaTime } from "../lib/vienna";
import { AuthorizedImage } from "./AuthorizedImage";
import { Pressable, StyleSheet, View } from "react-native";
import { REPORT_STATE_TEXT, rankingMode, type ReportEntry } from "../lib/matchReport";
import { initialState, inputKind, resultSentence, resultsFor, tapGame, type ResultEntry } from "../lib/resultEntry";
import { colors } from "../theme";
import { Button } from "./Button";
import { FormInput } from "./FormInput";
import { Body, Muted } from "./Text";
import { BestOfInput, OrderInput, ScoreInput, WinnerInput } from "./results/ResultInputs";
import { ProofPhotoPicker, type ProofPhoto } from "./results/ProofPhotoPicker";

// Ergebnis melden (#1132, #1157): wie auf der Website (frontend/src/components/tls/tournament/MatchReportForm.jsx) -
// dieselben großen Knöpfe wie das Ergebnis-Fenster der Turnierleitung: Plus/Minus je Seite, bei Best-of je Spiel den
// Sieger antippen, bei Durchgängen die Zielreihenfolge. Dazu auf Wunsch ein Foto vom Ergebnis (Kamera oder Galerie).
// Vor dem Absenden steht der Satz in Worten. Hat die Gegenseite schon gemeldet, genügt „Ja, stimmt“.

export type ReportState = {
  status?: "open" | "waiting" | "confirm" | "conflict" | "agreed" | string;
  own_summary?: string | null;
  proposal?: ReportEntry[] | null;
  proposal_summary?: string | null;
  // Bestätigen mit einem Tipp (#1159): der Satz aus Sicht dieser Seite, von wem, wann, mit Foto.
  proposal_text?: string | null;
  proposal_by?: string | null;
  proposal_at?: string | null;
  proposal_photo?: { id: string; url: string } | null;
  can_confirm?: boolean;
} | null;

type Side = { registration_id?: string | null; display_name?: string | null };
export type ReportPayload = { results: Array<Record<string, unknown>>; screenshot_url: string | null; note: string | null; photo_id?: string | null };

function fallbackEntry(participants: Side[], match: { id?: string; settings?: Record<string, unknown> | null } | null | undefined, allowsDraw: boolean): ResultEntry {
  const sides = participants.filter((side) => side.registration_id);
  return {
    id: String(match?.id || ""),
    kind: sides.length === 2 ? "duel" : "heat",
    best_of: 1,
    ranking_mode: rankingMode(match),
    allows_draw: allowsDraw,
    participants: sides.map((side) => ({ registration_id: String(side.registration_id), name: side.display_name || "Teilnehmer" })),
    advance: {},
  };
}

export function MatchReportCard({ participants, match, entry: serverEntry = null, state, allowsDraw = false, busy = false, readOnly = false, onReport, onWrongResult }: {
  participants: Side[];
  match: { id?: string; settings?: Record<string, unknown> | null } | null | undefined;
  entry?: ResultEntry | null;
  state: ReportState;
  allowsDraw?: boolean;
  busy?: boolean;
  // Team-Mitglieder ohne Leitung sehen die Meldung, bestätigen kann die Teamleitung (#1159).
  readOnly?: boolean;
  onReport: (payload: ReportPayload) => Promise<boolean>;
  // „Stimmt nicht“ öffnet „Problem melden“ mit „Falsches Ergebnis“ (#1158).
  onWrongResult?: () => void;
}) {
  const { accessToken } = useAuth();
  const status = state?.status || "open";
  const entry = useMemo(() => serverEntry || fallbackEntry(participants, match, allowsDraw), [serverEntry, participants, match, allowsDraw]);
  const kind = inputKind(entry, "order");
  const [editing, setEditing] = useState(status === "open");
  const [form, setForm] = useState(() => initialState({ ...entry, result: [] }));
  const [photo, setPhoto] = useState<ProofPhoto>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const outcome = resultsFor(entry, kind, form);
  const sentence = outcome.results ? resultSentence({ ...entry, advance: {} }, outcome.results) : "";

  // Ein neuer Stand vom Server schließt das Formular - außer, es ist noch nichts gemeldet.
  useEffect(() => { setEditing(status === "open"); }, [status]);

  const submit = async () => {
    if (outcome.error !== undefined) {
      setError(outcome.error);
      return;
    }
    if (photo?.status === "uploading") {
      setError("Das Foto wird noch hochgeladen – einen Moment.");
      return;
    }
    setError("");
    const done = await onReport({ results: outcome.results, screenshot_url: null, note: note.trim() || null, photo_id: photo?.status === "ready" ? photo.id : null });
    if (done) {
      setPhoto(null);
      setNote("");
    }
  };

  return (
    <View style={styles.stack} testID="match-report">
      {status !== "open" && status !== "agreed" ? (
        <View style={[styles.state, status === "conflict" ? styles.stateConflict : status === "confirm" ? styles.stateConfirm : styles.stateWaiting]} testID="match-report-state">
          <Body style={styles.strong}>{REPORT_STATE_TEXT[status] || REPORT_STATE_TEXT.waiting}</Body>
          {status === "confirm" && (state?.proposal_text || state?.proposal_summary) ? (
            <Body style={styles.strong} testID="match-report-proposal">{state?.proposal_text || `Die Gegenseite meldet: ${state?.proposal_summary}`}</Body>
          ) : null}
          {status === "confirm" && state?.proposal_by ? <Muted>gemeldet von {state.proposal_by}{state.proposal_at ? ` um ${viennaTime(state.proposal_at, { hour: "2-digit", minute: "2-digit" })}` : ""}</Muted> : null}
          {status === "confirm" && state?.proposal_photo?.url ? (
            <AuthorizedImage url={state.proposal_photo.url} token={accessToken} width={400} style={styles.photo} testID="match-report-proposal-photo" />
          ) : null}
          {status !== "confirm" && state?.own_summary ? <Muted>Deine Meldung: {state.own_summary}</Muted> : null}
          {status === "confirm" && state?.proposal && (readOnly || state.can_confirm === false) ? (
            <Muted testID="match-report-lead-confirms">Bestätigen kann die Teamleitung.</Muted>
          ) : status === "confirm" && state?.proposal ? (
            <View style={styles.row}>
              <View style={styles.flex}>
                <Button label="Stimmt" onPress={() => { void onReport({ results: state.proposal || [], screenshot_url: null, note: null }); }} disabled={busy} testID="match-report-confirm" />
              </View>
              <View style={styles.flex}>
                <Button label="Stimmt nicht" variant="secondary" onPress={() => onWrongResult?.()} disabled={busy} testID="match-report-wrong" />
              </View>
            </View>
          ) : null}
          {(status === "waiting" || status === "conflict") && !editing ? (
            <Pressable onPress={() => setEditing(true)} hitSlop={8} testID="match-report-change">
              <Muted style={styles.link}>Meldung ändern</Muted>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {editing && !readOnly ? (
        <View style={styles.stack} testID="match-report-form">
          {kind === "score" ? <ScoreInput entry={entry} state={form} onChange={setForm} showFlags={false} /> : null}
          {kind === "bestof" ? (
            <BestOfInput entry={entry} state={form} onChange={setForm} showFlags={false} onTap={(index, winner) => setForm((current) => ({ ...current, games: tapGame(current.games, index, winner, { sides: current.sides, bestOf: entry.best_of }) }))} />
          ) : null}
          {kind === "winner" ? <WinnerInput entry={entry} state={form} onChange={setForm} showFlags={false} /> : null}
          {kind === "order" ? <OrderInput entry={entry} state={form} onChange={setForm} showFlags={false} /> : null}
          {entry.id ? <ProofPhotoPicker matchId={entry.id} value={photo} onChange={setPhoto} /> : null}
          <FormInput label="Notiz für die Turnierleitung (freiwillig)" value={note} onChangeText={setNote} testID="match-report-note" />
          <View style={[styles.sentence, !sentence && styles.sentenceEmpty]}>
            <Body style={styles.strong} testID="match-report-sentence">{sentence || outcome.error}</Body>
          </View>
          {error ? <Muted style={styles.error} testID="match-report-error">{error}</Muted> : null}
          <Button label={busy ? "Meldet ..." : "Ergebnis melden"} onPress={() => { void submit(); }} disabled={busy} testID="match-report-submit" />
          <Muted>Meldet die Gegenseite dasselbe, steht das Ergebnis fest. Weicht es ab, entscheidet die Turnierleitung.</Muted>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  photo: { borderRadius: 6, height: 120, width: 160 },
  error: {
    color: colors.live,
    fontWeight: "800",
  },
  link: {
    color: colors.cyan,
    fontWeight: "900",
    textDecorationLine: "underline",
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  sentence: { backgroundColor: "rgba(41,182,232,0.1)", borderColor: "rgba(41,182,232,0.35)", borderRadius: 8, borderWidth: 1, padding: 12 },
  sentenceEmpty: { backgroundColor: "rgba(255,255,255,0.04)", borderColor: colors.border },
  stack: {
    gap: 10,
  },
  state: {
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  stateConfirm: {
    backgroundColor: "rgba(240,180,41,0.12)",
    borderColor: "rgba(240,180,41,0.45)",
  },
  stateConflict: {
    backgroundColor: "rgba(255,59,48,0.12)",
    borderColor: "rgba(255,59,48,0.45)",
  },
  stateWaiting: {
    backgroundColor: "rgba(41,182,232,0.1)",
    borderColor: "rgba(41,182,232,0.35)",
  },
  strong: {
    fontWeight: "900",
  },
});
