import { useState } from "react";
import { ArrowRightLeft, BellRing, Hourglass, Play, RotateCcw, Unlock, Wrench } from "lucide-react";
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
};

export function stationTone(station) {
  if (station?.status === "broken") return "broken";
  if (station?.running) return "running";
  if (station?.next?.state === "called") return "called";
  return "free";
}

// Was die Station gerade hält: ein laufendes Spiel oder einen Aufruf - nur das lässt sich freigeben und umlegen.
export function stationHolds(station) {
  if (station?.running) return station.running;
  return station?.next?.state === "called" ? station.next : null;
}

// Wohin sich ein Spiel umlegen lässt: frei, nicht defekt, kein Aufruf, und die Person darf dort bedienen.
export function moveTargets(stations = [], from, canOperate = () => true) {
  return stations.filter((station) => station.id !== from?.id && station.status === "free" && !station.running
    && station.next?.state !== "called" && canOperate(station));
}

const BTN = "inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider";

export function StationTile({ station, index = 0, busy = false, canOperate = false, targets = [], onCall, onStart, onRelease, onBroken, onMove }) {
  const tone = stationTone(station);
  const [chip, chipClass] = TONES[tone];
  const { running, next, after } = station;
  const broken = tone === "broken";
  const holds = stationHolds(station);
  const [panel, setPanel] = useState("");
  const toggle = (name) => setPanel((current) => (current === name ? "" : name));
  const tools = canOperate && (onRelease || onBroken || onMove);
  return (
    <section className={`tls-live-station rounded-sm border bg-[#121212] p-3 ${broken ? "border-warn/40" : "border-white/10"}`} style={{ "--tls-live-i": index }} data-tone={tone} data-testid={`live-station-${station.id}`} aria-label={station.station_text || station.name}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 font-heading text-sm font-black uppercase tracking-wide text-white [overflow-wrap:anywhere]">{station.station_text || station.name}</h3>
        <span className={`tls-live-chip inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${chipClass}`} data-tone={tone} data-testid={`live-chip-${station.id}`}>
          {running && !broken ? <span className="tls-live-dot" aria-hidden="true" /> : null}{chip}
        </span>
      </header>

      {broken && holds ? (
        <p className="tls-live-reveal mt-2 rounded-sm border border-warn/30 bg-warn/5 px-2.5 py-2 text-xs text-warn" role="status" data-testid={`live-broken-hint-${station.id}`}>
          {running ? "Das laufende Spiel steht noch hier – mit „Umlegen“ auf eine freie Station, Uhr und Startzeit bleiben." : "Der Aufruf steht noch hier – mit „Umlegen“ an einer freien Station neu aufrufen."}
        </p>
      ) : null}

      {running ? (
        <div className="mt-3" data-testid={`live-running-${station.id}`}>
          <div className="text-xs text-white/50 [overflow-wrap:anywhere]">{queueWhat(running)}</div>
          <div className="text-sm font-bold text-white [overflow-wrap:anywhere]">{stationWho(running)}</div>
          <MatchClock startedAt={running.started_at} durationMinutes={running.duration_minutes} testId={`live-clock-${running.match_id}`} className="mt-2" />
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
          <NextAction station={station} next={next} running={running} broken={broken} busy={busy} canOperate={canOperate} onCall={onCall} onStart={onStart} />
        </div>
      ) : (
        !running ? <p className="mt-3 text-sm text-white/45">{broken ? "Station ist defekt – nichts wird hierher geplant." : "Nichts mehr in der Warteschlange."}</p> : null
      )}

      {after ? (
        <div className="mt-2 text-xs text-white/50 [overflow-wrap:anywhere]" data-testid={`live-after-${station.id}`}>
          <span className="font-bold uppercase tracking-wider text-white/40">Danach</span> · {queueWhat(after)} · {stationWho(after)}{when(after) ? ` · ${when(after)}` : ""}
        </div>
      ) : null}

      {tools ? (
        <div className="mt-3 border-t border-white/10 pt-3" data-testid={`live-tools-${station.id}`}>
          <div className="grid grid-cols-3 gap-2">
            {onRelease ? (
              <button type="button" disabled={busy || !holds} onClick={() => (running ? toggle("release") : onRelease(station, holds))} aria-expanded={running ? panel === "release" : undefined} className={`tls-btn tls-btn--secondary ${BTN} disabled:opacity-40`} data-testid={`live-release-${station.id}`}>
                <Unlock className="h-4 w-4 shrink-0" aria-hidden="true" /> Freigeben
              </button>
            ) : <span />}
            {onMove ? (
              <button type="button" disabled={busy || !holds} onClick={() => toggle("move")} aria-expanded={panel === "move"} className={`tls-btn tls-btn--secondary ${BTN} disabled:opacity-40`} data-testid={`live-move-${station.id}`}>
                <ArrowRightLeft className="h-4 w-4 shrink-0" aria-hidden="true" /> Umlegen
              </button>
            ) : <span />}
            {onBroken ? (
              <button type="button" disabled={busy} onClick={() => onBroken(station, !broken)} aria-label={broken ? "Station wieder bereit" : "Station defekt melden"} className={`${BTN} border ${broken ? "border-ok/40 text-ok hover:bg-ok/10" : "border-warn/40 text-warn hover:bg-warn/10"} transition-colors disabled:opacity-40`} data-testid={`live-broken-${station.id}`}>
                {broken ? <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Wrench className="h-4 w-4 shrink-0" aria-hidden="true" />} {broken ? "Bereit" : "Defekt"}
              </button>
            ) : <span />}
          </div>

          {panel === "release" && running ? (
            <div className="tls-live-reveal mt-3 rounded-sm border border-white/10 bg-white/[0.03] p-2.5" data-testid={`live-release-confirm-${station.id}`}>
              <p className="text-xs text-white/70">Das Spiel läuft noch. Station trotzdem freigeben? Das Ergebnis trägst du danach unter „Ergebnisse“ ein.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" className={`tls-btn tls-btn--secondary ${BTN}`} onClick={() => setPanel("")}>Abbrechen</button>
                <button type="button" disabled={busy} className={`tls-btn tls-btn--primary ${BTN}`} onClick={() => { setPanel(""); onRelease(station, holds); }} data-testid={`live-release-yes-${station.id}`}>Freigeben</button>
              </div>
            </div>
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

function NextAction({ station, next, running, broken, busy, canOperate, onCall, onStart }) {
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
  if (running) return <p className="mt-2 text-xs text-white/45">Aufrufen nach dem laufenden Spiel.</p>;
  if (broken || !canOperate) return null;
  return (
    <button type="button" disabled={busy} onClick={() => onCall(station, next)} className={`tls-btn tls-btn--secondary mt-2.5 ${BTN} px-4`} data-testid={`live-call-${station.id}`}>
      <BellRing className="h-4 w-4" aria-hidden="true" /> {busy ? "Wird aufgerufen …" : "Aufrufen"}
    </button>
  );
}
