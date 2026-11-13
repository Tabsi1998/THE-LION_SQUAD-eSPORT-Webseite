import { useState } from "react";
import { ArrowRightLeft, BellRing, Eraser, Hourglass, ListPlus, Play, RotateCcw, Unlock, Wrench } from "lucide-react";
import { delayText } from "@/lib/liveQueue";
import { stationWho, queueWhat } from "@/lib/tvQueue";
import { viennaTime } from "@/lib/vienna";
import { MatchClock } from "./MatchClock";
import "./live.css";

// Eine Station als Kachel (#1556, #1162): Zustand, Spiel und Namen im Klartext, darunter die Knöpfe für den Turniertag -
// „Aufrufen“, „Starten“, „Freigeben“, „Defekt“ und „Umlegen“. Ein eigener Baustein, damit die Hallen-Ansicht je Event-Tag
// (#1376) dieselbe Kachel für alle Turniere zeigen kann. Die Kachel rechnet nichts: Reihenfolge, „Als Nächstes“ und was
// aufrufbar ist, kommen vom Server (services/live_queue.py). Knöpfe nur mit Recht (`canOperate`) und nur, wenn die Seite
// den passenden Handler mitgibt - die Matchplan-Ansicht der Verwaltung zeigt so weiter nur Aufrufen und Starten.

const clock = (value) => (value ? viennaTime(value, { hour: "2-digit", minute: "2-digit" }) : "");

function when(entry) {
  const parts = [entry?.forecast_at ? `${entry.forecast ? "voraussichtlich " : ""}ca. ${clock(entry.forecast_at)}` : "", delayText(entry?.delay_minutes)];
  return parts.filter(Boolean).join(" · ");
}

function calledLine(entry) {
  return [
    entry.called_at ? `Aufgerufen ${clock(entry.called_at)}` : "Aufgerufen",
    entry.report_by ? `antreten bis ${clock(entry.report_by)}` : "",
    entry.no_show_due_at ? `nicht erschienen ab ${clock(entry.no_show_due_at)}` : "",
    // Im Lauf markiert (#1823): die Frist ist vorbei, es steht, wer fehlt.
    entry.no_show_names?.length ? `${entry.no_show_names.join(", ")} nicht erschienen` : "",
  ].filter(Boolean).join(" · ");
}

// Zustand der Kachel: Farbe aus den Tokens (live, brand, warn, ok) - dieselben wie auf TV und Matchplan.
const TONES = {
  running: ["Läuft", "border-live/40 bg-live/10 text-live"],
  called: ["Aufgerufen", "border-brand/50 bg-brand/10 text-brand"],
  broken: ["Defekt", "border-warn/50 bg-warn/10 text-warn"],
  free: ["Frei", "border-ok/40 bg-ok/10 text-ok"],
  // Geteilte Event-Station (#1162): hier spielt gerade ein anderes Turnier - dessen Leitung bedient sie.
  other: ["Anderes Turnier", "border-white/25 bg-white/5 text-white/70"],
  // Als belegt gespeichert, aber ohne offenes Spiel (#1162) - etwa nach dem Löschen einer Phase.
  stuck: ["Hängt", "border-warn/50 bg-warn/10 text-warn"],
};

export function stationTone(station) {
  if (station?.status === "broken") return "broken";
  if (station?.hold_issue?.kind === "other") return "other";
  if (station?.running) return "running";
  if (station?.next?.state === "called") return "called";
  if (station?.hold_issue?.kind === "stuck") return "stuck";
  return "free";
}

// Was die Station gerade hält: ein laufendes Spiel oder einen Aufruf - nur das lässt sich freigeben und umlegen.
export function stationHolds(station) {
  if (station?.running) return station.running;
  return station?.next?.state === "called" ? station.next : null;
}

// „Anderes Spiel aufrufen“ (#1162): alle bereiten Spiele, die noch nicht aufgerufen sind oder laufen - „Als Nächstes“
// dieser Station oben, dann nach Prognose; Spiele, deren Spieler gerade anderswo spielen oder aufgerufen sind
// (`busy_at` vom Server), stehen ausgegraut am Ende. Die Stationen der Warteschlange passen alle zu Spiel und Gerät des Turniers
// (der Server prüft es beim Aufruf noch einmal).
export function callableFor(station, matches = {}) {
  const own = station?.next?.match_id;
  return Object.values(matches || {})
    .filter((entry) => entry && entry.state === "queued" && entry.ready)
    .sort((a, b) => (b.match_id === own) - (a.match_id === own) || Boolean(a.busy_at) - Boolean(b.busy_at)
      || String(a.forecast_at || "").localeCompare(String(b.forecast_at || ""))
      || String(a.match_key || "").localeCompare(String(b.match_key || ""), "de", { numeric: true }));
}

export function busyText(busyAt) {
  const where = busyAt?.station_text ? `an ${busyAt.station_text}` : "an einer anderen Station";
  return busyAt?.state === "called" ? `Spieler gerade ${where} aufgerufen` : `spielt gerade ${where}`;
}

// Freie Stationen, deren „Als Nächstes“ bereit ist - für „Alle freien Stationen aufrufen“.
export function callAllTargets(stations = [], canOperate = () => true) {
  return stations.filter((station) => stationTone(station) === "free" && canOperate(station)
    && station.next?.state === "queued" && station.next.ready);
}

// Wohin sich ein Spiel umlegen lässt: frei, nicht defekt, kein Aufruf, und die Person darf dort bedienen.
export function moveTargets(stations = [], from, canOperate = () => true) {
  return stations.filter((station) => station.id !== from?.id && station.status === "free" && !station.running
    && station.next?.state !== "called" && canOperate(station));
}

const BTN = "inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider";

export function StationTile({ station, index = 0, highlighted = false, busy = false, canOperate = false, targets = [], callable = [], onCall, onStart, onRelease, onBroken, onMove, onClear }) {
  const tone = stationTone(station);
  const [chip, chipClass] = TONES[tone];
  const { running, next, after } = station;
  const broken = tone === "broken";
  const holds = stationHolds(station);
  const [panel, setPanel] = useState("");
  const toggle = (name) => setPanel((current) => (current === name ? "" : name));
  const tools = canOperate && (onRelease || onBroken || onMove);
  return (
    <section className={`tls-live-station rounded-sm border bg-[#121212] p-3 ${broken ? "border-warn/40" : "border-white/10"}`} style={{ "--tls-live-i": index }} data-tone={tone} data-highlighted={highlighted ? "true" : undefined} data-testid={`live-station-${station.id}`} aria-label={station.station_text || station.name}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 font-heading text-sm font-black uppercase tracking-wide text-white [overflow-wrap:anywhere]">{station.station_text || station.name}</h3>
        <span className={`tls-live-chip inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${chipClass}`} data-tone={tone} data-testid={`live-chip-${station.id}`}>
          {running && !broken ? <span className="tls-live-dot" aria-hidden="true" /> : null}{chip}
        </span>
      </header>

      {station.hold_issue?.kind === "other" ? (
        <p className="tls-live-reveal mt-2 rounded-sm border border-white/15 bg-white/[0.03] px-2.5 py-2 text-xs text-white/70 [overflow-wrap:anywhere]" role="status" data-testid={`live-other-hint-${station.id}`}>
          Hier spielt gerade „{station.hold_issue.tournament_title}“ – dessen Leitung ruft auf, startet und gibt frei.
        </p>
      ) : null}

      {tone === "stuck" ? (
        <div className="tls-live-reveal mt-2 rounded-sm border border-warn/30 bg-warn/5 px-2.5 py-2 text-xs text-warn" role="status" data-testid={`live-stuck-hint-${station.id}`}>
          Als belegt gespeichert, aber ohne offenes Spiel – „Station räumen“ macht sie wieder frei.
          {canOperate && onClear ? (
            <button type="button" disabled={busy} onClick={() => onClear(station)} className={`tls-btn tls-btn--secondary mt-2 ${BTN}`} data-testid={`live-clear-${station.id}`}>
              <Eraser className="h-4 w-4 shrink-0" aria-hidden="true" /> Station räumen
            </button>
          ) : null}
        </div>
      ) : null}

      {broken && holds ? (
        <p className="tls-live-reveal mt-2 rounded-sm border border-warn/30 bg-warn/5 px-2.5 py-2 text-xs text-warn" role="status" data-testid={`live-broken-hint-${station.id}`}>
          {running ? "Das laufende Spiel steht noch hier – mit „Umlegen“ auf eine freie Station, Uhr und Startzeit bleiben." : "Der Aufruf steht noch hier – mit „Umlegen“ an einer freien Station neu aufrufen."}
        </p>
      ) : null}

      {running ? (
        <div className="mt-3" data-testid={`live-running-${station.id}`}>
          <div className="text-xs text-white/50 [overflow-wrap:anywhere]">{queueWhat(running)}</div>
          <div className="text-sm font-bold text-white [overflow-wrap:anywhere]">{stationWho(running)}</div>
          <MatchClock startedAt={running.started_at} durationMinutes={running.duration_minutes} pausedAt={running.paused_at} pausedSeconds={running.paused_seconds} testId={`live-clock-${running.match_id}`} className="mt-2" />
        </div>
      ) : null}

      {next ? (
        <div className={`tls-live-next mt-3 rounded-sm border p-2.5 ${next.state === "called" ? "border-brand/40 bg-brand/5" : "border-white/10 bg-white/[0.02]"}`} data-state={next.state} data-testid={`live-next-${station.id}`}>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/45">Als Nächstes</div>
          <div className="mt-0.5 text-xs text-white/50 [overflow-wrap:anywhere]">{queueWhat(next)}</div>
          <div className="text-sm font-bold text-white [overflow-wrap:anywhere]">{stationWho(next)}</div>
          <div className={`mt-1 flex items-start gap-1.5 text-xs ${next.state === "called" ? "text-brand" : "text-white/60"}`}>
            {next.state === "called" ? <BellRing className="tls-live-bell mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
            <span className="min-w-0 [overflow-wrap:anywhere]">{next.state === "called" ? calledLine(next) : when(next)}</span>
          </div>
          <NextAction station={station} next={next} running={running} broken={broken} blocked={tone === "other" || tone === "stuck"} busy={busy} canOperate={canOperate} onCall={onCall} onStart={onStart} />
        </div>
      ) : (
        !running ? <p className="mt-3 text-sm text-white/45">{broken ? "Station ist defekt – nichts wird hierher geplant." : "Nichts mehr in der Warteschlange."}</p> : null
      )}

      {tone === "free" && canOperate && onCall && callable.length ? (
        <div className="mt-2">
          <button type="button" disabled={busy} onClick={() => toggle("pick")} aria-expanded={panel === "pick"} className={`${BTN} border border-dashed border-white/20 text-white/70 hover:border-brand/60 hover:text-brand transition-colors`} data-testid={`live-pick-${station.id}`}>
            <ListPlus className="h-4 w-4 shrink-0" aria-hidden="true" /> Anderes Spiel aufrufen
          </button>
          {panel === "pick" ? (
            <ul className="tls-live-reveal mt-2 max-h-80 space-y-1.5 overflow-y-auto overscroll-contain" data-testid={`live-pick-list-${station.id}`}>
              {callable.map((entry) => (
                <li key={entry.match_id}>
                  <button type="button" disabled={busy || Boolean(entry.busy_at)} onClick={() => { setPanel(""); onCall(station, entry); }} className="tls-btn tls-btn--secondary flex min-h-[44px] w-full flex-col items-start rounded-sm px-3 py-2 text-left disabled:opacity-45" data-testid={`live-pick-${station.id}-${entry.match_id}`}>
                    <span className="text-[11px] uppercase tracking-wider text-white/50 [overflow-wrap:anywhere]">{entry.match_id === next?.match_id ? "Als Nächstes · " : ""}{queueWhat(entry)}{when(entry) ? ` · ${when(entry)}` : ""}</span>
                    <span className="text-sm font-bold normal-case tracking-normal text-white [overflow-wrap:anywhere]">{stationWho(entry)}</span>
                    {entry.busy_at ? (
                      <span className="text-xs normal-case tracking-normal text-warn" data-testid={`live-pick-busy-${entry.match_id}`}>{busyText(entry.busy_at)}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {after ? (
        <div className="mt-2 text-xs text-white/50 [overflow-wrap:anywhere]" data-testid={`live-after-${station.id}`}>
          <span className="font-bold uppercase tracking-wider text-white/40">Danach</span> · {queueWhat(after)} · {stationWho(after)}{when(after) ? ` · ${when(after)}` : ""}
        </div>
      ) : null}

      {tools ? (
        <div className="tls-live-tools mt-3 border-t border-white/10 pt-3" data-testid={`live-tools-${station.id}`}>
          <div className="grid grid-cols-3 gap-2">
            {onRelease ? (
              <button type="button" disabled={busy || !holds} onClick={() => toggle("release")} aria-expanded={panel === "release"} className={`tls-live-tool tls-btn tls-btn--secondary ${BTN} disabled:opacity-40`} data-testid={`live-release-${station.id}`}>
                <Unlock className="h-4 w-4 shrink-0" aria-hidden="true" /> Freigeben
              </button>
            ) : <span />}
            {onMove ? (
              <button type="button" disabled={busy || !holds} onClick={() => toggle("move")} aria-expanded={panel === "move"} className={`tls-live-tool tls-btn tls-btn--secondary ${BTN} disabled:opacity-40`} data-testid={`live-move-${station.id}`}>
                <ArrowRightLeft className="h-4 w-4 shrink-0" aria-hidden="true" /> Umlegen
              </button>
            ) : <span />}
            {onBroken ? (
              <button type="button" disabled={busy} onClick={() => (tone === "other" ? toggle("broken-other") : onBroken(station, !broken))} aria-label={broken ? "Station wieder bereit" : "Station defekt melden"} className={`tls-live-tool ${BTN} border ${broken ? "border-ok/40 text-ok hover:bg-ok/10" : "border-warn/40 text-warn hover:bg-warn/10"} transition-colors disabled:opacity-40`} data-testid={`live-broken-${station.id}`}>
                {broken ? <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Wrench className="h-4 w-4 shrink-0" aria-hidden="true" />} {broken ? "Bereit" : "Defekt"}
              </button>
            ) : <span />}
          </div>

          {panel === "broken-other" && tone === "other" ? (
            <ConfirmPanel testId={`live-broken-confirm-${station.id}`} yesTestId={`live-broken-yes-${station.id}`} busy={busy} yes="Defekt melden"
              text={`An dieser Station spielt gerade „${station.hold_issue.tournament_title}“. Trotzdem als defekt melden? Dessen Leitung bekommt Bescheid und legt das Spiel um.`}
              onNo={() => setPanel("")} onYes={() => { setPanel(""); onBroken(station, true, { confirm_other: true }); }} />
          ) : null}

          {panel === "release" && holds ? (
            // Beides fragt nach (#1162): ein laufendes Spiel verliert seine Station, ein Aufruf geht an die Spieler zurück.
            <ConfirmPanel testId={`live-release-confirm-${station.id}`} yesTestId={`live-release-yes-${station.id}`} busy={busy}
              yes={running ? "Freigeben" : "Zurücknehmen"}
              text={running ? "Das Spiel läuft noch. Station trotzdem freigeben? Das Ergebnis trägst du danach unter „Ergebnisse“ ein."
                : "Aufruf zurücknehmen? Die Spieler bekommen Bescheid, das Spiel geht zurück in die Warteschlange."}
              onNo={() => setPanel("")} onYes={() => { setPanel(""); onRelease(station, holds); }} />
          ) : null}

          {panel === "move" && holds ? (
            <div className="tls-live-reveal mt-3" data-testid={`live-move-picker-${station.id}`}>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/50">{running ? "Laufendes Spiel auf welche Station?" : "Aufruf an welche Station?"}</div>
              {targets.length ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {targets.map((target) => (
                    <button key={target.id} type="button" disabled={busy} onClick={() => { setPanel(""); onMove(station, holds, target); }} className={`tls-btn tls-btn--secondary ${BTN} normal-case tracking-normal [overflow-wrap:anywhere]`} data-testid={`live-move-to-${station.id}-${target.id}`}>
                      {target.station_text || target.name}
                    </button>
                  ))}
                </div>
              ) : <p className="mt-2 text-xs text-white/50">Gerade ist keine Station frei.</p>}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// Rückfrage in der Kachel - kein Dialog über der Seite, die Station bleibt im Blick.
function ConfirmPanel({ text, yes, busy, onYes, onNo, testId, yesTestId }) {
  return (
    <div className="tls-live-reveal mt-3 rounded-sm border border-white/10 bg-white/[0.03] p-2.5" data-testid={testId}>
      <p className="text-xs text-white/70 [overflow-wrap:anywhere]">{text}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" className={`tls-btn tls-btn--secondary ${BTN}`} onClick={onNo}>Abbrechen</button>
        <button type="button" disabled={busy} className={`tls-btn tls-btn--primary ${BTN}`} onClick={onYes} data-testid={yesTestId}>{yes}</button>
      </div>
    </div>
  );
}

function NextAction({ station, next, running, broken, blocked, busy, canOperate, onCall, onStart }) {
  if (!next.ready) {
    // Worauf es wartet, sagt der Server (#1858): das Los je Runde (Show-Auslosung) oder ein offenes Vorspiel.
    const waiting = next.waiting_for === "draw" ? "wartet auf die Auslosung" : "wartet auf die Vorspiele";
    return <p className="mt-2 flex items-center gap-1.5 text-xs text-white/45"><Hourglass className="h-3.5 w-3.5" aria-hidden="true" /> {waiting}</p>;
  }
  if (next.state === "called") {
    // An einer defekten Station startet nichts - der Aufruf wird umgelegt.
    return canOperate && !broken ? (
      <button type="button" disabled={busy} onClick={() => onStart(station, next)} className={`tls-btn tls-btn--primary mt-2.5 ${BTN} px-4`} data-testid={`live-start-${station.id}`}>
        <Play className="h-4 w-4" aria-hidden="true" /> {busy ? "Wird gespeichert …" : "Starten"}
      </button>
    ) : null;
  }
  if (running || blocked) return <p className="mt-2 text-xs text-white/45">{blocked ? "Aufrufen, sobald die Station frei ist." : "Aufrufen nach dem laufenden Spiel."}</p>;
  if (broken || !canOperate) return null;
  return (
    <button type="button" disabled={busy} onClick={() => onCall(station, next)} className={`tls-btn tls-btn--secondary mt-2.5 ${BTN} px-4`} data-testid={`live-call-${station.id}`}>
      <BellRing className="h-4 w-4" aria-hidden="true" /> {busy ? "Wird aufgerufen …" : "Aufrufen"}
    </button>
  );
}
