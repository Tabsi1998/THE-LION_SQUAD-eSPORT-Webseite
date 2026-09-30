import { Link } from "react-router-dom";
import { Dices, Gift, RotateCcw } from "lucide-react";
import { opensLabel } from "@/advent/doors";
import { pickupLabel, stampText } from "./form";

// Die Verlosung eines Türchens (#641) in der Verwaltung: wie viele mitmachen, bis wann, und die Ziehung. Das
// Protokoll nennt Zeit, Person, Lose und Gewinner - hier stehen Namen, weil der Gewinn übergeben werden muss.
// Nach außen sagt die Seite nur, dass gezogen wurde.

const STATUS = {
  open: { label: "Teilnahme läuft", tone: "border-[#5fd38d]/50 text-[#5fd38d]" },
  closed: { label: "Teilnahme vorbei – noch nicht gezogen", tone: "border-[#e9c46a]/60 text-[#e9c46a]" },
  drawn: { label: "Gezogen", tone: "border-[#29B6E8]/60 text-[#29B6E8]" },
};
const AUDIENCE = { all: "alle mit Konto", members: "nur Vereinsmitglieder" };

/** Der Text für die Rückfrage vor der Ziehung. */
export function drawQuestion(raffle, isOpen) {
  const lots = raffle.entries === 1 ? "einer Teilnahme" : `${raffle.entries} Teilnahmen`;
  const prizes = raffle.winners === 1 ? "wird ein Gewinn" : `werden ${raffle.winners} Gewinne`;
  const early = raffle.needs_close_early && isOpen ? ` Die Teilnahme läuft noch bis ${opensLabel(raffle.closes_at)} – mit der Ziehung endet sie jetzt.` : "";
  return `Unter ${lots} ${prizes} gezogen. Wer gewinnt, bekommt sofort eine Nachricht.${early} Die Ziehung lässt sich nicht wiederholen.`;
}

export function RafflePanel({ day, raffle, isOpen, busy = false, onDraw, onRedraw }) {
  if (!raffle) return null;
  const status = STATUS[raffle.status] || STATUS.open;
  const entries = raffle.entries === 1 ? "1 Teilnahme" : `${raffle.entries} Teilnahmen`;
  return (
    <div className="mt-3 rounded-sm border border-[#e9c46a]/25 bg-[#e9c46a]/[0.04] p-3" data-testid={`advent-raffle-${day}`} data-status={raffle.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Gift className="h-4 w-4 shrink-0 text-[#e9c46a]" aria-hidden="true" />
        <span className="min-w-0 break-words text-sm font-bold text-white">{raffle.label}</span>
        {raffle.value && <span className="min-w-0 break-words text-xs text-white/50">{raffle.value}</span>}
        <span className={`rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${status.tone}`} data-testid={`advent-raffle-status-${day}`}>{status.label}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
        <span data-testid={`advent-raffle-entries-${day}`}>{entries}</span>
        <span>{raffle.winners === 1 ? "1 Gewinn" : `${raffle.winners} Gewinne`}</span>
        <span>{AUDIENCE[raffle.audience] || AUDIENCE.all}{raffle.staff_may_enter ? ", auch Vorstand und Verwaltung" : ""}</span>
        {raffle.status !== "drawn" && <span>Teilnahme bis {opensLabel(raffle.closes_at)}</span>}
      </div>

      {raffle.can_draw && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy || !isOpen || raffle.entries === 0} onClick={() => onDraw(day, raffle)} data-testid={`advent-raffle-draw-${day}`} className="inline-flex items-center gap-2 rounded-sm bg-[#e9c46a] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-black transition hover:opacity-90 disabled:opacity-40">
            <Dices className="h-3.5 w-3.5" /> {raffle.needs_close_early ? "Teilnahme beenden und ziehen" : "Ziehen"}
          </button>
          {!isOpen && <span className="text-xs text-white/45">Gezogen wird erst, wenn das Türchen offen war.</span>}
          {isOpen && raffle.entries === 0 && <span className="text-xs text-white/45">Noch macht niemand mit.</span>}
        </div>
      )}

      {raffle.protocol.length > 0 && (
        <ol className="mt-3 space-y-3 border-t border-white/10 pt-3" data-testid={`advent-raffle-protocol-${day}`}>
          {raffle.protocol.map((record) => (
            <li key={record.id} className="text-xs text-white/70" data-testid={`advent-raffle-record-${record.id}`}>
              <div className="font-bold text-white/85">
                {record.kind === "redraw" ? "Nachgezogen" : "Gezogen"} am {stampText(record.drawn_at)} von {record.drawn_by}
              </div>
              <div className="mt-0.5 text-white/50">
                {record.entries === 1 ? "1 Los" : `${record.entries} Lose`}, {record.eligible === 1 ? "1 konnte" : `${record.eligible} konnten`} gewinnen · {record.method}
                {record.closed_early ? " · Teilnahme dafür vorzeitig beendet" : ""}
              </div>
              <ul className="mt-1.5 space-y-1">
                {record.winners.map((winner) => (
                  <li key={winner.pickup_id} className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-white">{winner.name}</span>
                    <span className="text-white/50">Gewinn {pickupLabel(winner.pickup_status)}{winner.replaced ? " – dafür wurde nachgezogen" : ""}</span>
                    {winner.can_redraw && (
                      <button type="button" disabled={busy} onClick={() => onRedraw(day, raffle, winner)} data-testid={`advent-raffle-redraw-${winner.pickup_id}`} className="inline-flex items-center gap-1.5 rounded-sm border border-[#e9c46a]/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#e9c46a] transition hover:bg-[#e9c46a]/10 disabled:opacity-40">
                        <RotateCcw className="h-3 w-3" /> Nachziehen
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
          <li>
            <Link to="/admin/prizes?source=season" className="text-[11px] font-bold uppercase tracking-wider text-[#29B6E8] hover:underline" data-testid={`advent-raffle-prizes-${day}`}>Übergabe unter „Gewinne“ verwalten</Link>
          </li>
        </ol>
      )}
    </div>
  );
}
