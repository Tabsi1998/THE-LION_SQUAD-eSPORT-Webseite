import { Ionicons } from "@expo/vector-icons";
import React, { useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { REPORT_STATE_TEXT } from "../../lib/matchReport";
import { plannedRoleLabel } from "../../lib/leagueVeto";
import {
  blockedPlayers,
  changeGame,
  confirmPayload,
  followLineups,
  gamesProblem,
  isSeries,
  mapsFor,
  modeLabel,
  participantsProblem,
  personIds,
  plannedFor,
  poolModes,
  rememberGames,
  repeatedMap,
  reportPayload,
  scoresTied,
  scoreWinner,
  seriesSentence,
  settleGames,
  startGames,
  toggleLineup,
  withScores,
  type FormGame,
  type LeagueBlock,
  type LeaguePerson,
  type LeagueReportPayload,
  type ServerGame,
} from "../../lib/leagueGames";
import { ruleFor, ruleHint } from "../../lib/leagueResultRules";
import { colors, radius, roles } from "../../theme";
import { Button } from "../Button";
import { FormInput } from "../FormInput";
import { MediaImage } from "../MediaImage";
import { Body, Muted } from "../Text";
import type { ReportState } from "../MatchReportCard";

// Liga-Ergebnis melden (docs/LIGA.md C.3, #1650; App #2173) - wie frontend/src/components/tls/league/LeagueReportForm.jsx: je Map Modus,
// Map aus dem Pool (oder fest aus dem Veto, `planned_games`), Sieger, Punkte und die eigene Aufstellung bzw. die Teilnehmerliste. Die
// nächste Map erscheint, sobald die letzte einen Sieger hat. Die Gegenseite bestätigt mit einem Tipp und stellt dabei ihre Aufstellung
// auf. Melden und Bestätigen dürfen Captain und Vertreter (der Server sagt es mit `can_player_report_result`).

export type LeagueReportSend = LeagueReportPayload & { screenshot_url: null; note: string | null };

const MIN_TOUCH = 44;

/** Spieler-Chips: genau `size` antippen, ohne `size` so viele wie nötig ab `minimum`. Gesperrte stehen grau mit Grund darunter. */
export function LineupChips({ roster = [], value = [], size = 1, minimum = null, onChange, label, testID }: {
  roster?: LeaguePerson[];
  value?: string[];
  size?: number | null;
  minimum?: number | null;
  onChange: (next: string[]) => void;
  label: string;
  testID: string;
}) {
  const open = size == null;
  const full = !open && value.length >= (size || 0);
  const enough = open ? value.length >= (minimum || 1) : value.length === size;
  const blocked = blockedPlayers(roster);
  return (
    <View style={styles.stackSmall} accessibilityLabel={label} testID={testID}>
      <View style={styles.rowBetween}>
        <Muted style={styles.eyebrow}>{label}</Muted>
        <Muted style={[styles.eyebrow, enough ? { color: roles.ok } : null]} testID={`${testID}-count`}>{open ? `${value.length} · mindestens ${minimum || 1}` : `${value.length}/${size}`}</Muted>
      </View>
      <View style={styles.wrap}>
        {roster.map((person) => {
          const active = value.includes(person.id);
          const locked = Boolean(person.lineup_blocked) && !active;
          const disabled = locked || (!active && full);
          return (
            <Pressable key={person.id} onPress={() => onChange(toggleLineup(value, person.id, size))} disabled={disabled}
              accessibilityRole="checkbox" accessibilityState={{ checked: active, disabled }} accessibilityLabel={person.name || "Spieler"}
              style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled, locked && styles.chipLocked]} testID={`${testID}-${person.id}`}>
              {/* Platz fürs Häkchen immer reserviert (#2096): sonst springt die Reihe beim Antippen. */}
              <View style={styles.check}>
                {active ? <Ionicons name="checkmark" size={14} color={colors.white} /> : locked ? <Ionicons name="id-card-outline" size={14} color={colors.muted} /> : null}
              </View>
              <Body numberOfLines={1} style={[styles.chipText, active && styles.chipTextActive]}>{person.name || "Spieler"}</Body>
            </Pressable>
          );
        })}
      </View>
      {blocked.length ? (
        <View testID={`${testID}-blocked`}>
          {blocked.map((person) => (
            <Muted key={person.id} style={styles.warn}>{open ? "Nicht eintragbar" : "Nicht aufstellbar"}: {person.name} – {person.reason}</Muted>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Teilnehmerliste einmal je Spiel (#2204): alle ankreuzen, die mindestens eine Map gespielt haben - nach oben offen. */
function ParticipantsChips({ league, value, onChange, label = "Wer hat gespielt?", testID = "league-participants" }: {
  league: LeagueBlock; value: string[]; onChange: (next: string[]) => void; label?: string; testID?: string;
}) {
  const minimum = league.lineup_min_players || 1;
  return (
    <View style={styles.stackSmall}>
      <LineupChips roster={league.roster || []} value={value} size={null} minimum={minimum} onChange={onChange} label={label} testID={testID} />
      <Muted testID={`${testID}-hint`}>Kreuze alle an, die mindestens eine Map gespielt haben. Mindestens {minimum}, bei Wechseln auch mehr. Wer fehlt, zählt nicht als Einsatz.</Muted>
    </View>
  );
}

/** Sieger einer Map: aus den Punkten, sonst antippen (ohne Punkte, bei Gleichstand). */
function MapWinner({ game, league, onPick }: { game: FormGame; league: LeagueBlock; onPick: (winner: string) => void }) {
  const auto = scoreWinner(game, league);
  const tied = scoresTied(game, league);
  const rule = ruleFor(league, game.mode);
  const testID = `league-game-${game.position}-winner`;
  const sides = league.sides || [];
  const nameOf = (id: string) => sides.find((side) => side.registration_id === id)?.name || "";
  if (auto && game.winner === auto) {
    return (
      <View style={styles.autoWinner} accessibilityRole="text" testID={`${testID}-auto`}>
        <Ionicons name="trophy-outline" size={18} color={roles.honor} />
        <View style={styles.flex}>
          <Body style={styles.autoWinnerText}>Sieger: {nameOf(auto)}</Body>
          <Muted>aus den Punkten</Muted>
        </View>
      </View>
    );
  }
  if (tied && rule && !rule.draw_allowed) {
    return <Muted style={styles.warn} testID={`${testID}-no-draw`}>Gleichstand gibt es in diesem Modus nicht – bitte die Punkte prüfen.</Muted>;
  }
  if (league.scores_required && !tied) {
    return <Muted testID={`${testID}-pending`}>Den Sieger ergeben die Punkte – einfach beide eintragen.</Muted>;
  }
  return (
    <View style={styles.stackSmall}>
      <Muted style={styles.eyebrow}>{tied ? `Gleichstand – wer hat Map ${game.position} gewonnen?` : `Wer hat Map ${game.position} gewonnen?`}</Muted>
      <View style={styles.row} accessibilityRole="radiogroup">
        {sides.map((side) => {
          const active = game.winner === side.registration_id;
          return (
            <Pressable key={side.registration_id} onPress={() => onPick(side.registration_id)} accessibilityRole="radio" accessibilityState={{ checked: active }}
              style={[styles.sideButton, active && styles.sideButtonActive]} testID={`${testID}-${side.registration_id}`}>
              <Body numberOfLines={2} style={[styles.sideText, active && { color: roles.honor }]}>{active ? "Sieger: " : ""}{side.name}</Body>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function GameEditor({ game, games, league, index, onChange }: { game: FormGame; games: FormGame[]; league: LeagueBlock; index: number; onChange: (next: FormGame) => void }) {
  const modes = poolModes(league.pool);
  // Veto (#1618, D.3): Modus und Map der Position stehen fest - Captain und Vertreter tragen nur Sieger, Punkte und Aufstellung ein.
  const plan = game.planned ? plannedFor(game.position, league) : null;
  const fixedMode = Boolean(plan) || (league.mode_order || []).length > 0 || modes.length <= 1;
  const maps = mapsFor(league.pool, game.mode);
  const [openScores, setOpenScores] = useState(Object.keys(game.scores || {}).length > 0);
  const showScores = openScores || Boolean(league.scores_required);
  const rule = ruleHint(ruleFor(league, game.mode));
  const set = (patch: Partial<FormGame>) => onChange({ ...game, ...patch });
  const sides = league.sides || [];
  return (
    <View style={styles.game} testID={`league-game-${game.position}`}>
      <Body style={styles.gameTitle}>Map {game.position}{game.mode && fixedMode ? ` · ${modeLabel(league.pool, game.mode)}` : ""}</Body>
      {rule ? <Muted testID={`league-game-${game.position}-rule`}>Gewertet: {rule}</Muted> : null}
      {plan ? (
        <View style={styles.planned} testID={`league-game-${game.position}-planned`}>
          <MediaImage uri={plan.map_image_url} style={styles.plannedImage} fallback={<View style={styles.plannedImage} />} />
          <View style={styles.flex}>
            <Body style={styles.strong} numberOfLines={1}>{plan.map_name}</Body>
            <Muted>laut Veto{plannedRoleLabel(plan.role) ? ` (${plannedRoleLabel(plan.role)})` : ""} · {plan.mode_label || modeLabel(league.pool, game.mode)}</Muted>
          </View>
        </View>
      ) : null}
      {!fixedMode ? (
        <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={`Modus Map ${game.position}`}>
          {modes.map((group) => {
            const active = game.mode === group.mode;
            return (
              <Pressable key={String(group.mode)} onPress={() => set({ mode: String(group.mode), map_id: "" })} accessibilityRole="radio" accessibilityState={{ checked: active }}
                style={[styles.chip, active && styles.chipActive]} testID={`league-game-${game.position}-mode-${group.mode}`}>
                <Body style={[styles.chipText, active && styles.chipTextActive]}>{group.label || group.mode}</Body>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {!plan && (fixedMode || game.mode) ? (
        <View style={styles.mapGrid} accessibilityRole="radiogroup" accessibilityLabel={`Map ${game.position}`}>
          {maps.map((item) => {
            const active = game.map_id === item.map_id;
            // Schon gespielt (#2096): dieselbe Map im selben Modus (bzw. je nach Season überhaupt) nur einmal je Serie.
            const earlier = active ? null : repeatedMap(games, game.position, game.mode, item.map_id, league);
            return (
              <Pressable key={item.map_id} onPress={() => set({ map_id: item.map_id })} disabled={Boolean(earlier)} accessibilityRole="radio"
                accessibilityState={{ checked: active, disabled: Boolean(earlier) }} accessibilityHint={earlier ? `Lief schon als Map ${earlier.position}` : undefined}
                style={[styles.mapTile, active && styles.mapTileActive, earlier && styles.chipDisabled]} testID={`league-game-${game.position}-map-${item.map_id}`}>
                <MediaImage uri={item.image_url} style={[styles.mapImage, !active && styles.mapImageQuiet]} fallback={<View style={styles.mapImage} />} />
                <Body numberOfLines={1} style={styles.mapName}>{item.name}</Body>
                {active ? <View style={styles.mapCheck}><Ionicons name="checkmark" size={14} color={colors.black} /></View> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {showScores ? (
        <View style={styles.row}>
          {sides.map((side) => (
            <View key={side.registration_id} style={styles.flex}>
              <Muted numberOfLines={1}>{league.scores_required ? "Punkte (Pflicht)" : "Punkte"} {side.name}</Muted>
              <TextInput value={game.scores?.[side.registration_id] ?? ""} keyboardType="numeric" inputMode="numeric"
                onChangeText={(value) => onChange(withScores(game, { ...game.scores, [side.registration_id]: value }, league))}
                accessibilityLabel={`Punkte ${side.name || ""} Map ${game.position}`} style={styles.input} placeholderTextColor={colors.muted}
                testID={`league-game-${game.position}-score-${side.registration_id}`} />
            </View>
          ))}
        </View>
      ) : (
        <Pressable onPress={() => setOpenScores(true)} hitSlop={8} accessibilityRole="button" testID={`league-game-${game.position}-scores-open`}>
          <Muted style={styles.link}>Punkte eintragen (freiwillig)</Muted>
        </Pressable>
      )}
      <MapWinner game={game} league={league} onPick={(winner) => set({ winner })} />
      {isSeries(league) ? null : (
        <LineupChips roster={league.roster || []} value={game.lineup} size={league.team_size || 1} onChange={(lineup) => set({ lineup })}
          label={index === 0 ? "Deine Aufstellung" : "Deine Aufstellung (wie Map davor übernommen)"} testID={`league-game-${game.position}-lineup`} />
      )}
    </View>
  );
}

/** Die Maps der Gegenseite in Worten - zum Bestätigen. */
export function GamesSummary({ games = [], league }: { games?: ServerGame[] | null; league: LeagueBlock }) {
  const sides = league.sides || [];
  return (
    <View style={styles.stackSmall} testID="league-games-summary">
      {(games || []).map((game) => {
        const winner = sides.find((side) => side.registration_id === game.winner_registration_id)?.name;
        const scores = sides.map((side) => game.scores?.[side.registration_id]);
        const withValues = scores.some((value) => value !== undefined && value !== null && value !== "");
        return (
          <Body key={game.position} testID={`league-games-summary-${game.position}`}>
            <Body style={styles.strong}>Map {game.position} </Body>
            {game.map_name || "Map"}{game.mode_label ? ` (${game.mode_label})` : ""}
            <Body style={{ color: roles.honor }}> → {winner || "?"}</Body>
            {withValues ? ` ${scores.map((value) => value ?? "–").join(":")}` : ""}
          </Body>
        );
      })}
    </View>
  );
}

function ConfirmWithLineup({ league, state, busy, readOnly, onReport, onWrongResult }: {
  league: LeagueBlock; state: ReportState; busy: boolean; readOnly: boolean;
  onReport: (payload: LeagueReportSend) => Promise<boolean>; onWrongResult?: () => void;
}) {
  const proposal = league.proposal_games || [];
  const series = isSeries(league);
  const [lineups, setLineups] = useState<Record<number, string[]>>(() => Object.fromEntries(proposal.map((game) => [game.position, []])));
  const [list, setList] = useState<string[]>(() => personIds(league.own_lineup));
  const [error, setError] = useState("");
  const confirm = async () => {
    const games: FormGame[] = proposal.map((game) => ({ position: game.position, mode: "", map_id: "", winner: "", scores: {}, lineup: lineups[game.position] || [] }));
    const problem = series ? participantsProblem(list, league) : gamesProblem(games, league, { needMaps: false });
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    await onReport({ ...confirmPayload(proposal, series ? list : lineups, league), screenshot_url: null, note: null });
  };
  return (
    <View style={styles.stack}>
      <GamesSummary games={proposal} league={league} />
      {state?.proposal_by ? <Muted>gemeldet von {state.proposal_by}</Muted> : null}
      <Muted testID="league-confirm-scores-hint">Es zählen die Punkte der ersten Meldung – stimmen sie nicht, bitte über „Stimmt nicht“ Einspruch einlegen.</Muted>
      {readOnly ? (
        <Muted testID="match-report-lead-confirms">Bestätigen können Captain und Vertreter.</Muted>
      ) : (
        <>
          {series ? (
            <ParticipantsChips league={league} value={list} onChange={setList} label="Wer hat bei euch gespielt?" testID="league-confirm-participants" />
          ) : proposal.map((game) => (
            <LineupChips key={game.position} roster={league.roster || []} value={lineups[game.position] || []} size={league.team_size || 1}
              label={`Deine Aufstellung Map ${game.position}`} testID={`league-confirm-lineup-${game.position}`}
              onChange={(lineup) => setLineups((current) => followLineups(current, game.position, lineup))} />
          ))}
          {error ? <Muted style={styles.error} accessibilityRole="alert" testID="league-confirm-error">{error}</Muted> : null}
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button label="Stimmt" onPress={() => { void confirm(); }} disabled={busy} testID="match-report-confirm" />
            </View>
            <View style={styles.flex}>
              <Button label="Stimmt nicht" variant="secondary" onPress={() => onWrongResult?.()} disabled={busy} testID="match-report-wrong" />
            </View>
          </View>
        </>
      )}
    </View>
  );
}

export function LeagueReportCard({ league, state = null, busy = false, readOnly = false, onReport, onWrongResult }: {
  league: LeagueBlock;
  state?: ReportState;
  busy?: boolean;
  readOnly?: boolean;
  onReport: (payload: LeagueReportSend) => Promise<boolean>;
  onWrongResult?: () => void;
}) {
  const status = state?.status || "open";
  const [editing, setEditing] = useState(status === "open");
  const [games, setGames] = useState<FormGame[]>(() => startGames(league));
  const series = isSeries(league);
  const [list, setList] = useState<string[]>(() => personIds(league.own_lineup));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [seenStatus, setSeenStatus] = useState(status);
  if (seenStatus !== status) {
    setSeenStatus(status);
    setEditing(status === "open");
  }
  const problem = series ? gamesProblem(games, league, { withLineup: false }) || participantsProblem(list, league) : gamesProblem(games, league);
  const sentence = seriesSentence(games, league);

  // Gedächtnis je Map (#2334): Ein Zwischenstand beim Tippen der Punkte kann die Serie kurz entscheiden - weggefallene Maps kommen
  // mit ihren Angaben zurück, sobald sie wieder offen ist.
  const memory = useRef<Record<number, FormGame>>({});
  const change = (position: number, game: FormGame) => {
    const all = Object.values(rememberGames(memory.current, games)).sort((a, b) => a.position - b.position);
    const changedAll = changeGame(all, position, game);
    memory.current = rememberGames({}, changedAll);
    const changed = changedAll.filter((row) => games.some((shown) => shown.position === row.position));
    setGames(settleGames(changed, league, memory.current));
  };

  const submit = async () => {
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    const done = await onReport({ ...reportPayload(games, league, list), screenshot_url: null, note: note.trim() || null });
    if (done) setNote("");
  };

  return (
    <View style={styles.stack} testID="match-report">
      <Muted style={styles.eyebrowCyan}>Ergebnis melden · Best of {league.best_of || 1}</Muted>
      {status !== "open" && status !== "agreed" ? (
        <View style={[styles.state, status === "confirm" ? styles.stateConfirm : status === "conflict" ? styles.stateConflict : styles.stateWaiting]} testID="match-report-state">
          <Body style={styles.strong}>{REPORT_STATE_TEXT[status] || REPORT_STATE_TEXT.waiting}</Body>
          {status === "confirm" ? (
            <ConfirmWithLineup league={league} state={state} busy={busy} readOnly={readOnly || state?.can_confirm === false} onReport={onReport} onWrongResult={onWrongResult} />
          ) : (league.own_games || []).length ? <GamesSummary games={league.own_games} league={league} /> : null}
          {(status === "waiting" || status === "conflict") && !editing && !readOnly ? (
            <Pressable onPress={() => setEditing(true)} hitSlop={8} accessibilityRole="button" testID="match-report-change">
              <Muted style={styles.link}>Meldung ändern</Muted>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {editing && !readOnly ? (
        <View style={styles.stack} testID="match-report-form">
          {!league.pool ? (
            <Muted style={styles.warn} accessibilityRole="alert">Für diese Staffel ist noch kein Map-Pool hinterlegt – bitte die Turnierleitung fragen.</Muted>
          ) : games.map((game, index) => (
            <GameEditor key={game.position} index={index} game={game} games={games} league={league} onChange={(next) => change(game.position, next)} />
          ))}
          {series && league.pool ? <ParticipantsChips league={league} value={list} onChange={setList} /> : null}
          <FormInput label="Notiz für die Turnierleitung (freiwillig)" value={note} onChangeText={setNote} maxLength={1000} testID="match-report-note" />
          <View style={[styles.sentence, (!sentence || problem) && styles.sentenceEmpty]} accessibilityLiveRegion="polite">
            <Body style={styles.strong} testID="match-report-sentence">{problem || sentence}</Body>
          </View>
          {error ? <Muted style={styles.error} accessibilityRole="alert" testID="match-report-error">{error}</Muted> : null}
          <Button label={busy ? "Meldet ..." : "Ergebnis melden"} onPress={() => { void submit(); }} disabled={busy} testID="match-report-submit" />
          <Muted>{series ? "Die Gegenseite bestätigt und trägt ein, wer bei ihr gespielt hat." : "Die Gegenseite bestätigt und stellt dabei ihre Aufstellung auf."} Ohne Antwort gilt dein Ergebnis nach 48 Stunden.</Muted>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  autoWinner: { alignItems: "flex-start", backgroundColor: "rgba(255,215,0,0.1)", borderColor: "rgba(255,215,0,0.5)", borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: 8, minHeight: MIN_TOUCH, padding: 10 },
  autoWinnerText: { color: roles.honor, fontWeight: "900" },
  check: { alignItems: "center", height: 14, justifyContent: "center", width: 14 },
  chip: { alignItems: "center", backgroundColor: colors.black, borderColor: "rgba(255,255,255,0.15)", borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: 6, maxWidth: "100%", minHeight: MIN_TOUCH, paddingHorizontal: 12, paddingVertical: 8 },
  chipActive: { backgroundColor: "rgba(41,182,232,0.15)", borderColor: colors.cyan },
  chipDisabled: { opacity: 0.4 },
  chipLocked: { borderStyle: "dashed" },
  chipText: { color: "rgba(255,255,255,0.75)", flexShrink: 1 },
  chipTextActive: { color: colors.white, fontWeight: "800" },
  error: { color: colors.live, fontWeight: "800" },
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
  eyebrowCyan: { color: colors.cyan, fontSize: 12, fontWeight: "900", letterSpacing: 0.5, textTransform: "uppercase" },
  flex: { flex: 1, minWidth: 0 },
  game: { backgroundColor: colors.black, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: 10, padding: 12 },
  gameTitle: { color: colors.cyan, fontWeight: "900", textTransform: "uppercase" },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, color: colors.white, marginTop: 4, minHeight: MIN_TOUCH, paddingHorizontal: 12 },
  link: { color: colors.cyan, fontWeight: "900", paddingVertical: 8, textDecorationLine: "underline" },
  mapCheck: { alignItems: "center", backgroundColor: colors.cyan, borderRadius: 10, height: 20, justifyContent: "center", position: "absolute", right: 6, top: 6, width: 20 },
  mapGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  mapImage: { backgroundColor: "rgba(255,255,255,0.05)", height: 64, width: "100%" },
  mapImageQuiet: { opacity: 0.7 },
  mapName: { fontWeight: "800", paddingHorizontal: 8, paddingVertical: 6 },
  mapTile: { borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexBasis: "47%", flexGrow: 1, overflow: "hidden" },
  mapTileActive: { borderColor: colors.cyan, borderWidth: 2 },
  planned: { alignItems: "center", backgroundColor: "rgba(31,208,142,0.06)", borderColor: "rgba(31,208,142,0.4)", borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: 10, padding: 8 },
  plannedImage: { backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 4, height: 48, width: 64 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rowBetween: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", gap: 8 },
  sentence: { backgroundColor: "rgba(41,182,232,0.1)", borderColor: "rgba(41,182,232,0.35)", borderRadius: 8, borderWidth: 1, padding: 12 },
  sentenceEmpty: { backgroundColor: "rgba(255,255,255,0.04)", borderColor: colors.border },
  sideButton: { borderColor: "rgba(255,255,255,0.15)", borderRadius: radius.lg, borderWidth: 1, flexBasis: "45%", flexGrow: 1, justifyContent: "center", minHeight: MIN_TOUCH, paddingHorizontal: 12, paddingVertical: 8 },
  sideButtonActive: { backgroundColor: "rgba(255,215,0,0.15)", borderColor: roles.honor },
  sideText: { color: "rgba(255,255,255,0.75)", fontWeight: "800" },
  stack: { gap: 10 },
  stackSmall: { gap: 6 },
  state: { borderRadius: radius.lg, borderWidth: 1, gap: 8, padding: 12 },
  stateConfirm: { backgroundColor: "rgba(255,159,67,0.1)", borderColor: "rgba(255,159,67,0.4)" },
  stateConflict: { backgroundColor: "rgba(41,182,232,0.1)", borderColor: "rgba(41,182,232,0.35)" },
  stateWaiting: { backgroundColor: "rgba(41,182,232,0.1)", borderColor: "rgba(41,182,232,0.35)" },
  strong: { fontWeight: "900" },
  warn: { color: roles.warn },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
