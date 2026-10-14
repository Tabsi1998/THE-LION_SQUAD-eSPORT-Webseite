import { useContext, useEffect, useId, useRef, useState } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import { resolveMediaUrl } from "@/lib/api";
import { formatMatchStatus } from "@/lib/tournamentLabels";
import { asInstant, viennaDateTime } from "@/lib/vienna";
import { describeSlot, initials } from "@/lib/slotSource";
import { heatExits, isDone, isLive, isOut, isWalkover, matchFate, soloAdvance } from "@/lib/bracketGraph";
import { useBracketMotionState, useRowFlight } from "./bracketMotion";
import {
  FinderContext, FinishedContext, GraphContext, MatchLinkContext, MineContext, PathContext, nodePathState, useMatchChanged,
} from "./context";

// Die Karten des Web-Baums (#1340, #1178, #1259, #1561): ruhig - Setzplatz, Name, Ergebnis. Zeit, Station und Kennung
// stehen im kleinen Blatt (Drüberfahren, Antippen des Kopfes, Tastatur). Läuft ein Spiel, stehen Station und Spielzeit
// im Kopf. Ein Name ist ein Knopf: Antippen zeigt den Weg dieses Spielers.

const OUT_REGISTRATION = new Set(["withdrawn", "disqualified", "no_show", "cancelled"]);

export function canHover() {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches;
  } catch {
    return false;
  }
}

/** Nur Tastatur-Fokus zeigt den Weg vorab - ein Tippen entscheidet selbst (antippen = Weg an/aus). */
function keyboardFocus(element) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

export function formatNodeDateTime(value) {
  if (!value) return "";
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return "";
  return viennaDateTime(date, { dateStyle: "short", timeStyle: "short" });
}

export function getStationLabel(match) {
  const station = match?.station_label || match?.station_name || match?.station?.name || match?.station_id || "";
  if (!station) return "";
  return /^station\b/i.test(station) ? station : `Station ${station}`;
}

/** Name im Knoten: die Anmeldung, sonst leer - ein Setzplatz vor dem Start zeigt nichts (Betreiber, 23.09.). */
export function slotLabel(slot, regMap) {
  const reg = regMap.get(slot?.registration_id);
  const user = reg?.user || {};
  if (reg) return reg.display_name || user.display_name || reg.ingame_name || "-";
  return "";
}

function pendingLabel(slot, findMatch) {
  const info = describeSlot(slot, () => "", findMatch);
  return info.kind === "pending" ? info.label : "";
}

function isByeSlot(slot) {
  return ["bye", "walkover"].includes(String(slot?.status || "").toLowerCase()) || String(slot?.source?.type || "") === "bye";
}

/** Spielzeit seit dem Start, jede Sekunde neu - nur diese Zahl rendert neu, nicht der Baum. */
export function LiveClock({ startedAt }) {
  const start = startedAt ? asInstant(startedAt).getTime() : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (Number.isNaN(start)) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [start]);
  if (Number.isNaN(start)) return null;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const text = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return <span className="font-display tabular-nums" data-testid="bracket-live-clock">{text}</span>;
}

function LiveStatus({ match }) {
  const finished = useContext(FinishedContext);
  const status = String(match?.status || "").toLowerCase();
  if (finished && !isDone(match)) return <span className="text-quiet" data-testid="bracket-not-played">nicht gespielt</span>;
  if (!finished && isLive(match)) {
    const station = getStationLabel(match);
    return (
      <span className="inline-flex items-center gap-1.5 text-live" data-live="1">
        <span className="w-1.5 h-1.5 rounded-full bg-live tv-live-dot" aria-hidden="true" />
        {station || formatMatchStatus(status)}
        {match.started_at ? <>{" · "}<LiveClock startedAt={match.started_at} /></> : null}
      </span>
    );
  }
  return <span>{formatMatchStatus(status)}</span>;
}

function MatchLink({ match, children, className }) {
  const inRouter = useInRouterContext();
  const { onMatchClick } = useContext(MatchLinkContext);
  if (onMatchClick) return <button type="button" className={className} onClick={() => onMatchClick(match)}>{children}</button>;
  const href = `/matches/${match.id}`;
  return inRouter ? <Link to={href} className={className}>{children}</Link> : <a href={href} className={className}>{children}</a>;
}

/** Das kleine Blatt (#1340): Zeit, Dauer, Station, Kennung und „Zum Spiel“. */
function MatchSheet({ match, id }) {
  const time = formatNodeDateTime(match?.scheduled_at);
  const station = getStationLabel(match);
  const duration = match?.duration_minutes || match?.settings?.duration_minutes;
  return (
    <div id={id} className="tls-bracket-sheet" role="group" aria-label={`Spiel ${match.match_key || ""}`.trim()}>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-text">
        {time ? <span>{time}</span> : null}
        {duration ? <span>{duration} Min.</span> : null}
        {station ? <span className="text-brand">{station}</span> : null}
        {!time && !station && !duration ? <span>Zeit und Station folgen</span> : null}
      </div>
      <MatchLink match={match} className="mt-1.5 inline-block text-xs font-bold uppercase tracking-wider text-brand hover:text-white">Zum Spiel</MatchLink>
    </div>
  );
}

function useSheet() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return { open, setOpen, ref };
}

/** Bild oder Kürzel (#833) - gestrichelt nur für freie Plätze. */
function SlotAvatar({ avatar, label, empty }) {
  if (avatar) return <img src={resolveMediaUrl(avatar)} alt="" className="w-5 h-5 rounded-sm object-cover shrink-0" />;
  const short = empty ? "" : initials(label);
  if (!short) return <span className="w-5 h-5 rounded-sm border border-dashed border-white/15 shrink-0" aria-hidden="true" />;
  return (
    <span className="w-5 h-5 rounded-sm border border-white/10 bg-white/[0.05] text-[9px] font-bold text-white/65 flex items-center justify-center shrink-0" aria-hidden="true" data-testid="bracket-initials">
      {short}
    </span>
  );
}

function podiumMeta(rank) {
  if (rank === 1) return { label: "#1", text: "text-honor font-semibold", badge: "border-honor/50 bg-honor/15 text-honor" };
  if (rank === 2) return { label: "#2", text: "text-silver font-semibold", badge: "border-silver/40 bg-silver/10 text-silver" };
  if (rank === 3) return { label: "#3", text: "text-bronze font-semibold", badge: "border-bronze/50 bg-bronze/15 text-bronze" };
  return null;
}

/** Eine Zeile: Setzplatz, Bild, Name, „Du“, rechts Ergebnis oder Platz. Mit Anmeldung ein Knopf für den Weg. */
function PlayerRow({ match, slot, regMap, findMatch, result, played, isWinner, isLoser, qualified, podiumRank, rank, score, sweep, heat, walkover }) {
  const mine = useContext(MineContext);
  const path = useContext(PathContext);
  const { state, played: done } = useBracketMotionState();
  const ref = useRef(null);
  const regId = slot?.registration_id || null;
  const reg = regMap.get(regId);
  const label = slotLabel(slot, regMap);
  const bye = !reg && isByeSlot(slot);
  const pending = reg || bye ? "" : pendingLabel(slot, findMatch);
  const rowMotion = regId ? state.rows.get(`${match.id}:${regId}`) || null : null;
  useRowFlight(ref, rowMotion, done);
  const podium = podiumMeta(podiumRank);
  const out = Boolean(reg) && (isOut(result) || OUT_REGISTRATION.has(String(reg?.status || "").toLowerCase()));
  const isMine = Boolean(mine) && regId === mine;
  const pop = state.pop.has(match.id);
  const blink = walkover && isWinner && state.blink.has(match.id);
  const nameTone = out ? "text-quiet line-through" : podium?.text || (isWinner ? "text-white font-semibold" : isLoser ? "text-quiet" : qualified ? "text-white font-semibold" : label ? "text-white/85" : pending ? "text-muted-text italic" : "text-white/25");
  const seed = slot?.seed || reg?.seed || null;
  const draw = rowMotion?.type === "draw";
  const motion = draw ? "draw" : blink ? "blink" : undefined;
  const style = draw ? { "--tls-i": rowMotion.index, "--tls-draw-step": `${state.drawStep}ms` } : undefined;
  const handlers = regId ? {
    onClick: () => path.toggle(regId),
    onMouseEnter: () => canHover() && path.preview(new Set([regId])),
    onMouseLeave: () => canHover() && path.preview(null),
    onFocus: (event) => keyboardFocus(event.currentTarget) && path.preview(new Set([regId])),
    onBlur: () => path.preview(null),
  } : {};
  const Tag = regId ? "button" : "div";
  return (
    <Tag
      ref={ref}
      type={regId ? "button" : undefined}
      {...handlers}
      aria-pressed={regId ? path.selected === regId : undefined}
      aria-label={regId ? `Weg von ${label} zeigen` : undefined}
      data-path-trigger={regId ? "1" : undefined}
      data-row={regId ? `${match.id}:${regId}` : undefined}
      data-slot-anchor={`${match.id}:${slot?.slot}`}
      data-out={out ? "1" : undefined}
      data-motion={motion}
      data-sweep={sweep ? "1" : undefined}
      style={style}
      className={`tls-bracket-row ${isWinner || qualified ? "is-winner" : ""} ${sweep ? "tls-winner-sweep" : ""} ${podium ? "is-podium" : ""}`}
    >
      <span className="w-4 shrink-0 text-right font-display text-[11px] tabular-nums text-quiet">{seed || ""}</span>
      <SlotAvatar avatar={reg?.user?.avatar_url || reg?.avatar_url} label={label} empty={!reg} />
      <span className={`min-w-0 flex-1 break-words leading-tight ${String(label || pending).length > (heat ? 14 : 22) ? "text-xs" : "text-sm"} ${nameTone}`} data-pending={!label && pending ? "1" : undefined}>
        {bye ? "Freilos" : label || pending || "—"}
      </span>
      {isMine ? <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-brand">Du</span> : null}
      {walkover && isWinner ? <span className="tls-bracket-tag shrink-0">kampflos</span> : null}
      {podium ? <span className={`shrink-0 px-1 py-0.5 rounded-sm border text-[10px] font-display font-bold ${podium.badge}`}>{podium.label}</span> : null}
      {heat ? (
        <span className="flex shrink-0 items-center gap-1.5">
          {played && score != null ? <span className="font-display text-xs tabular-nums text-quiet">{score} P</span> : null}
          <span className={`tls-bracket-rank ${qualified ? "is-qualified" : ""}`} data-rank={rank || undefined} data-motion={pop && rank ? "pop" : undefined} style={rank ? { "--tls-i": rank - 1 } : undefined}>
            {played && rank ? rank : ""}
          </span>
        </span>
      ) : score != null ? (
        <span key={score} className={`tls-score-tick shrink-0 font-display text-base font-bold tabular-nums ${podium?.text || (isWinner ? "text-brand" : "text-quiet")}`} data-motion={pop ? "pop" : undefined} style={pop ? { "--tls-i": isWinner ? 0 : 1 } : undefined}>
          {score}
        </span>
      ) : null}
    </Tag>
  );
}

function nodeClasses({ live, mine, changed }) {
  return [
    "tls-bracket-node w-full text-left rounded-md border border-white/10 group",
    mine ? "is-mine" : "",
    changed ? "tls-changed-frame" : "",
    live ? "tls-bracket-live" : "",
  ].filter(Boolean).join(" ");
}

function CardHead({ match, title, meta, sheetId, open, onToggle }) {
  return (
    <button type="button" className="tls-bracket-head" aria-expanded={open} aria-controls={sheetId} onClick={onToggle}>
      <span className="min-w-0">
        {title}
        {meta}
      </span>
      <span className="shrink-0 text-[11px] text-muted-text">
        <LiveStatus match={match} />
      </span>
    </button>
  );
}

function DuelCard({ match, regMap, podiumMap, decisive }) {
  const { active } = useContext(PathContext);
  const finished = useContext(FinishedContext);
  const mine = useContext(MineContext);
  const findMatch = useContext(FinderContext)(match);
  const changed = useMatchChanged(match.id);
  const sheet = useSheet();
  const sheetId = useId();
  const resultMap = new Map((match.results || []).map((row) => [row.registration_id, row]));
  const slots = [...(match.slots || [])].slice(0, 2);
  while (slots.length < 2) slots.push({ slot: slots.length + 1, registration_id: null, status: "empty" });
  const done = isDone(match);
  const live = !finished && isLive(match);
  const walkover = isWalkover(match);
  const isMine = Boolean(mine) && slots.some((slot) => slot.registration_id === mine);
  return (
    <div
      ref={sheet.ref}
      data-node={match.id}
      data-testid={`bracket-match-v2-${match.id}`}
      data-changed={changed ? "true" : undefined}
      data-mine={isMine ? "true" : undefined}
      data-path={nodePathState(active, match.id) || undefined}
      data-open={sheet.open ? "1" : undefined}
      className={nodeClasses({ live, mine: isMine, changed })}
    >
      <CardHead
        match={match}
        sheetId={sheetId}
        open={sheet.open}
        onToggle={() => sheet.setOpen((value) => !value)}
        title={<span className="text-[11px] font-bold tracking-wider text-muted-text">{match.match_key || "Spiel"}</span>}
      />
      {slots.map((slot, index) => {
        const result = resultMap.get(slot.registration_id);
        const isWinner = done && Boolean(slot.registration_id) && Boolean(result?.rank === 1 || result?.qualified || match.winner_id === slot.registration_id);
        return (
          <PlayerRow
            key={slot.slot || index}
            match={match}
            slot={slot}
            regMap={regMap}
            findMatch={findMatch}
            result={result}
            played={done}
            isWinner={isWinner}
            isLoser={done && Boolean(slot.registration_id) && !isWinner}
            podiumRank={decisive ? podiumMap?.get(slot.registration_id) : null}
            score={done || result ? (result?.score ?? result?.points ?? (walkover ? null : 0)) : null}
            sweep={changed && isWinner}
            walkover={walkover}
          />
        );
      })}
      <MatchSheet match={match} id={sheetId} />
    </div>
  );
}

function HeatCard({ match, regMap, podiumMap, decisive }) {
  const { active } = useContext(PathContext);
  const { edges, matches, finalId } = useContext(GraphContext);
  const finished = useContext(FinishedContext);
  const mine = useContext(MineContext);
  const findMatch = useContext(FinderContext)(match);
  const changed = useMatchChanged(match.id);
  const sheet = useSheet();
  const sheetId = useId();
  const resultMap = new Map((match.results || []).map((row) => [row.registration_id, row]));
  const slots = match.slots || [];
  const played = slots.some((slot) => resultMap.has(slot.registration_id));
  // Freie Plätze (kein Spieler, Freilos) stehen als eine Zeile „2 Plätze frei“ statt als einzelne Zeilen (#1259).
  const freeCount = slots.filter((slot) => !slot.registration_id && isByeSlot(slot)).length;
  const taken = slots.filter((slot) => slot.registration_id || !isByeSlot(slot));
  const rows = played
    ? [...taken].sort((a, b) => (resultMap.get(a.registration_id)?.rank || 99) - (resultMap.get(b.registration_id)?.rank || 99))
    : taken;
  const filled = slots.filter((slot) => slot.registration_id).length;
  const exits = heatExits(match, edges, matches);
  const qualifiers = exits.qualifiers;
  const isMine = Boolean(mine) && slots.some((slot) => slot.registration_id === mine);
  const live = !finished && isLive(match);
  const name = match.match_type === "ffa" ? `Lauf ${match.match_key || ""}`.trim() : (match.match_key || "Spiel");
  // Gezählt werden nur Plätze, die noch jemand bekommen kann - ein Freilos-Platz („frei“) zählt nicht mit.
  const seats = taken.length;
  const field = filled === seats ? `${filled} Spieler` : filled ? `${filled} von ${seats} Spielern` : `${seats} ${seats === 1 ? "Platz" : "Plätze"}`;
  // Der letzte Lauf ohne Folgespiel (#1561): danach kommt nur der Pokal - „2 kommen weiter“ wäre falsch.
  const lastHeat = match.id === finalId && !exits.advance.length && !exits.drop.length;
  const onward = lastHeat ? "Platz 1 gewinnt" : qualifiers ? `${qualifiers} ${qualifiers === 1 ? "kommt" : "kommen"} weiter` : null;
  const meta = [field, onward].filter(Boolean).join(" · ");
  const empty = !filled && slots.every((slot) => !pendingLabel(slot, findMatch));
  const cutAt = qualifiers > 0 && exits.advance.length && qualifiers < rows.length ? qualifiers : 0;
  const cutText = `${qualifiers} ${qualifiers === 1 ? "kommt" : "kommen"} weiter → ${exits.advance.join(", ")}`;
  const dropText = exits.drop.length ? `Die anderen → ${exits.drop.join(", ")}` : exits.advance.length ? "Die anderen scheiden aus" : "";
  return (
    <div
      ref={sheet.ref}
      data-node={match.id}
      data-testid={`bracket-heat-${match.id}`}
      data-changed={changed ? "true" : undefined}
      data-mine={isMine ? "true" : undefined}
      data-path={nodePathState(active, match.id) || undefined}
      data-open={sheet.open ? "1" : undefined}
      className={nodeClasses({ live, mine: isMine, changed })}
    >
      <CardHead
        match={match}
        sheetId={sheetId}
        open={sheet.open}
        onToggle={() => sheet.setOpen((value) => !value)}
        title={<span className="block text-xs font-bold text-white/85" data-testid={`bracket-heat-title-${match.id}`}>{name}{isMine ? <span className="ml-2 text-[10px] uppercase tracking-widest text-brand">Du bist dabei</span> : null}</span>}
        meta={<span className="block text-[11px] leading-snug text-muted-text" data-testid={`bracket-heat-meta-${match.id}`}>{meta}</span>}
      />
      {empty ? (
        <div className="px-3 py-2 text-xs italic text-quiet">noch leer</div>
      ) : rows.map((slot, index) => {
        const result = resultMap.get(slot.registration_id);
        const rank = result?.rank || 0;
        const qualified = Boolean(result) && rank > 0 && rank <= (qualifiers || 1) && !isOut(result);
        return (
          <div key={slot.slot ?? index} className="contents">
            <PlayerRow
              match={match}
              slot={slot}
              regMap={regMap}
              findMatch={findMatch}
              result={result}
              played={played}
              qualified={played && qualified}
              isLoser={played && Boolean(slot.registration_id) && !qualified}
              podiumRank={decisive ? podiumMap?.get(slot.registration_id) : null}
              rank={rank}
              score={result?.score ?? result?.points}
              sweep={changed && rank === 1}
              heat
            />
            {cutAt && index === cutAt - 1 ? (
              <div className="tls-bracket-cut" data-testid={`bracket-heat-cut-${match.id}`}><span>{cutText}</span></div>
            ) : null}
          </div>
        );
      })}
      {freeCount && !empty ? (
        <div className="px-3 py-1.5 text-xs italic text-quiet" data-testid={`bracket-heat-free-${match.id}`}>{freeCount} {freeCount === 1 ? "Platz" : "Plätze"} frei</div>
      ) : null}
      {dropText && !empty ? (
        <div className="px-3 pb-2 pt-1 text-[11px] text-muted-text" data-testid={exits.drop.length ? `bracket-heat-drop-${match.id}` : `bracket-heat-out-${match.id}`}>{dropText}</div>
      ) : null}
      <MatchSheet match={match} id={sheetId} />
    </div>
  );
}

/** Ein Freilos (#1259): eine schmale Zeile „Freilos: Name kommt weiter“ - ohne Zeit und Station. */
function ByeLine({ match, regMap, advance }) {
  const { active } = useContext(PathContext);
  const findMatch = useContext(FinderContext)(match);
  const slot = advance.slot;
  const label = slotLabel(slot, regMap) || pendingLabel(slot, findMatch) || "noch offen";
  const regId = slot.registration_id;
  const path = useContext(PathContext);
  return (
    <div data-node={match.id} data-testid={`bracket-match-v2-${match.id}`} data-path={nodePathState(active, match.id) || undefined} className="tls-bracket-node tls-bracket-node--line">
      <div data-testid={`bracket-bye-${match.id}`} className="flex items-baseline gap-1.5 px-3 py-1.5 text-xs text-muted-text" data-slot-anchor={`${match.id}:${slot.slot}`}>
        <span className="uppercase tracking-wider text-[10px] font-bold text-quiet">Freilos:</span>{" "}
        {regId ? (
          <button type="button" data-path-trigger="1" data-row={`${match.id}:${regId}`} aria-pressed={path.selected === regId} onClick={() => path.toggle(regId)} className="min-w-0 break-words text-left font-semibold text-white/85 hover:text-white">{label}</button>
        ) : <span className="min-w-0 break-words italic">{label}</span>}{" "}
        <span>kommt weiter</span>
      </div>
    </div>
  );
}

/** Entfällt, zusammengelegt, Reset nicht nötig (#1549, #1550): ruhig, eine Zeile. */
function FateLine({ match, fate, heat }) {
  const { state } = useBracketMotionState();
  const title = heat ? `Lauf ${match.match_key || ""}`.trim() : (match.round_label || match.match_key || "Spiel");
  return (
    <div data-node={match.id} data-testid={heat ? `bracket-heat-${match.id}` : `bracket-match-v2-${match.id}`} data-fate={fate.kind} data-motion={state.fade.has(match.id) ? "fade" : undefined} className="tls-bracket-node tls-bracket-node--line tls-bracket-node--fate">
      <div data-testid={`bracket-fate-${match.id}`} className="px-3 py-1.5 text-xs text-quiet">
        <span className="font-bold text-white/55">{title}</span>{" · "}
        {fate.kind === "reset" ? <span data-testid="bracket-reset-not-needed">{fate.label}</span> : <span>{fate.label}</span>}
      </div>
    </div>
  );
}

/** Die Karte eines Spiels: Freilos-Zeile, entfällt, Duell oder Lauf. */
export function MatchCard({ match, regMap, podiumMap }) {
  const { decisive } = useContext(GraphContext);
  const heat = !((match.match_type || "duel") === "duel" && (match.slots || []).length <= 2);
  const fate = matchFate(match);
  if (fate) return <FateLine match={match} fate={fate} heat={heat} />;
  const advance = heat ? null : soloAdvance(match);
  if (advance) return <ByeLine match={match} regMap={regMap} advance={advance} />;
  const Card = heat ? HeatCard : DuelCard;
  return <Card match={match} regMap={regMap} podiumMap={podiumMap} decisive={decisive.has(match.id)} />;
}
