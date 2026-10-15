import { BellRing, Hourglass, Play, Timer } from "lucide-react";
import { delayText, queueSummaryLine } from "@/lib/liveQueue";
import { viennaTime } from "@/lib/vienna";
import { MatchClock } from "./MatchClock";
import "./live.css";

// Warteschlange je Station (#1556) für die Turnierleitung am Handy: was läuft (mit Spielzeit-Uhr), was als Nächstes
// kommt („Aufrufen“, dann „Gestartet“), was danach. Die Reihenfolge rechnet der Server (services/live_queue.py) - die
// Seite zeigt nur. Knöpfe nur, wer die Station bedienen darf (`queue.operate`).

const clock = (value) => (value ? viennaTime(value, { hour: "2-digit", minute: "2-digit" }) : "");

function who(entry) {
  const names = entry?.names || [];
  if (names.length === 2) return `${names[0]} gegen ${names[1]}`;
  if (names.length > 2) return `${names.length} Teilnehmer`;
  if (names.length === 1 && !entry.open_slots) return names[0];
  if (entry?.open_slots) return names.length ? `${names[0]} · ${entry.open_slots === 1 ? "1 Platz" : `${entry.open_slots} Plätze`} offen` : `${entry.open_slots} Plätze offen`;
  return "Teilnehmer offen";
}

function when(entry) {
  const parts = [entry?.forecast_at ? `${entry.forecast ? "voraussichtlich " : ""}ca. ${clock(entry.forecast_at)}` : "", delayText(entry?.delay_minutes)];
  return parts.filter(Boolean).join(" · ");
}

function calledLine(entry) {
  return [
    entry.called_at ? `Aufgerufen ${clock(entry.called_at)}` : "Aufgerufen",
    entry.report_by ? `antreten bis ${clock(entry.report_by)}` : "",
    entry.no_show_due_at ? `nicht erschienen ab ${clock(entry.no_show_due_at)}` : "",
  ].filter(Boolean).join(" · ");
}

const CHIP = {
  running: ["Läuft", "border-live/40 bg-live/10 text-live"],
  called: ["Aufgerufen", "border-brand/50 bg-brand/10 text-brand"],
  broken: ["Defekt", "border-warn/50 bg-warn/10 text-warn"],
  free: ["Frei", "border-ok/40 bg-ok/10 text-ok"],
};

function chipOf(station) {
  if (station.status === "broken") return CHIP.broken;
  if (station.running) return CHIP.running;
  if (station.next?.state === "called") return CHIP.called;
  return CHIP.free;
}

export function StationQueueBoard({ queue, busyKey = "", onCall, onStart }) {
  const summary = queueSummaryLine(queue?.summary);
  const stations = queue?.stations || [];
  const operate = queue?.operate;
  const canOperate = (station) => Boolean(operate?.all || (operate?.station_ids || []).includes(station.id));
  return (
    <div data-testid="live-board">
      {summary ? (
        <div className="flex items-center gap-2 rounded-sm border border-white/10 bg-[#121212] px-3 py-2 text-sm font-bold text-white" data-testid="live-summary">
          <Timer className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{summary}</span>
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {stations.map((station, index) => (
          <StationCard key={station.id} station={station} index={index} busy={busyKey === station.id} canOperate={canOperate(station)} onCall={onCall} onStart={onStart} />
        ))}
      </div>
      {(queue?.unplaced || []).length ? (
        <p className="mt-3 text-xs text-white/50" data-testid="live-unplaced">
          {queue.unplaced.length === 1 ? "1 Spiel hat einen festen Termin ohne Station" : `${queue.unplaced.length} Spiele haben einen festen Termin ohne Station`} – es steht in „Ergebnisse“.
        </p>
      ) : null}
    </div>
  );
}

function StationCard({ station, index, busy, canOperate, onCall, onStart }) {
  const [chip, chipClass] = chipOf(station);
  const { running, next, after } = station;
  const broken = station.status === "broken";
  return (
    <section className="tls-live-station rounded-sm border border-white/10 bg-[#121212] p-3" style={{ "--tls-live-i": index }} data-testid={`live-station-${station.id}`} aria-label={station.station_text || station.name}>
      <header className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 font-heading text-sm font-black uppercase tracking-wide text-white [overflow-wrap:anywhere]">{station.station_text || station.name}</h3>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${chipClass}`}>
          {running ? <span className="tls-live-dot" aria-hidden="true" /> : null}{chip}
        </span>
      </header>

      {running ? (
        <div className="mt-3" data-testid={`live-running-${station.id}`}>
          <div className="text-xs text-white/50 [overflow-wrap:anywhere]">{running.label}</div>
          <div className="text-sm font-bold text-white [overflow-wrap:anywhere]">{who(running)}</div>
          <MatchClock startedAt={running.started_at} durationMinutes={running.duration_minutes} testId={`live-clock-${running.match_id}`} className="mt-2" />
        </div>
      ) : null}

      {next ? (
        <div className={`tls-live-next mt-3 rounded-sm border p-2.5 ${next.state === "called" ? "border-brand/40 bg-brand/5" : "border-white/10 bg-white/[0.02]"}`} data-state={next.state} data-testid={`live-next-${station.id}`}>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/45">Als Nächstes</div>
          <div className="mt-0.5 text-xs text-white/50 [overflow-wrap:anywhere]">{next.label}</div>
          <div className="text-sm font-bold text-white [overflow-wrap:anywhere]">{who(next)}</div>
          <div className={`mt-1 flex items-start gap-1.5 text-xs ${next.state === "called" ? "text-brand" : "text-white/60"}`}>
            {next.state === "called" ? <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
            <span className="min-w-0 [overflow-wrap:anywhere]">{next.state === "called" ? calledLine(next) : when(next)}</span>
          </div>
          <NextAction station={station} next={next} running={running} broken={broken} busy={busy} canOperate={canOperate} onCall={onCall} onStart={onStart} />
        </div>
      ) : (
        !running ? <p className="mt-3 text-sm text-white/45">{broken ? "Station ist defekt – nichts wird hierher geplant." : "Nichts mehr in der Warteschlange."}</p> : null
      )}

      {after ? (
        <div className="mt-2 text-xs text-white/50 [overflow-wrap:anywhere]" data-testid={`live-after-${station.id}`}>
          <span className="font-bold uppercase tracking-wider text-white/40">Danach</span> · {after.label} · {who(after)}{when(after) ? ` · ${when(after)}` : ""}
        </div>
      ) : null}
    </section>
  );
}

function NextAction({ station, next, running, broken, busy, canOperate, onCall, onStart }) {
  if (!next.ready) {
    return <p className="mt-2 flex items-center gap-1.5 text-xs text-white/45"><Hourglass className="h-3.5 w-3.5" aria-hidden="true" /> wartet auf die Vorspiele</p>;
  }
  if (next.state === "called") {
    return canOperate ? (
      <button type="button" disabled={busy} onClick={() => onStart(station, next)} className="tls-btn tls-btn--primary mt-2.5 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider" data-testid={`live-start-${station.id}`}>
        <Play className="h-4 w-4" aria-hidden="true" /> {busy ? "Wird gespeichert …" : "Gestartet"}
      </button>
    ) : null;
  }
  if (running) return <p className="mt-2 text-xs text-white/45">Aufrufen nach dem laufenden Spiel.</p>;
  if (broken || !canOperate) return null;
  return (
    <button type="button" disabled={busy} onClick={() => onCall(station, next)} className="tls-btn tls-btn--secondary mt-2.5 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider" data-testid={`live-call-${station.id}`}>
      <BellRing className="h-4 w-4" aria-hidden="true" /> {busy ? "Wird aufgerufen …" : "Aufrufen"}
    </button>
  );
}
