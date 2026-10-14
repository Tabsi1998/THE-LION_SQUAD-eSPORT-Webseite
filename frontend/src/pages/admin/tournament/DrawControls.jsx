// Gegner mischen (#1548): die Auslosungen einer Phase in der Turnierverwaltung - wann gelost wurde, worauf eine Runde
// noch wartet und „Neu auslosen“, solange keines der betroffenen Spiele begonnen hat (der Server prüft dasselbe, 409).
import { useState } from "react";
import { Shuffle } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { drawGroupsOf, leagueRedrawAllowed } from "./shared";

// Viele Läufe (40 Fahrer, 10 Läufe): die Rückfrage nennt die Spiele nur bis zu einer lesbaren Zahl.
const MAX_NAMED_MATCHES = 6;

function matchList(keys) {
  return keys.length <= MAX_NAMED_MATCHES ? `die Spiele ${keys.join(", ")}` : `die ${keys.length} Spiele dieser Runde`;
}

function drawnAt(matches, group) {
  const match = (matches || []).find((row) => row?.settings?.draw_group === group && row?.draw?.drawn_at);
  return match ? formatDateTime(match.draw.drawn_at) : "";
}

export function DrawControls({ tournamentId, stage, matches = [], onChanged }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState("");
  const groups = drawGroupsOf(matches);
  const league = leagueRedrawAllowed(stage, matches);
  if (!groups.length && !league) return null;

  const redraw = async (key, payload, { title, description, success }) => {
    const ok = await confirm({ title, description, confirmLabel: "Neu auslosen", tone: "info" });
    if (!ok) return;
    setBusy(key);
    try {
      await api.post(`/tournaments/${tournamentId}/stages/${stage.id}/redraw`, payload);
      toast.success(success);
      onChanged?.();
    } catch (err) {
      toast.error(formatRequestError(err, "Neu auslosen hat nicht geklappt."));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3 space-y-2" data-testid="draw-controls">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/50">
        <Shuffle size={12} aria-hidden="true" /> Auslosung
      </div>
      {groups.map((row) => (
        <div key={row.group} className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/70">
          <span className="min-w-0 break-words">
            <span className="font-bold text-white">{row.label}</span>
            {!row.drawn && " – wird ausgelost, sobald alle Spiele davor fertig sind."}
            {row.drawn && row.canRedraw && ` – ausgelost${drawnAt(matches, row.group) ? ` am ${drawnAt(matches, row.group)}` : ""}.`}
            {row.drawn && !row.canRedraw && " – ausgelost; die Runde hat begonnen, das Los gilt."}
          </span>
          {row.canRedraw && (
            <button
              type="button"
              disabled={busy === row.group}
              data-testid={`redraw-${row.group}`}
              onClick={() => redraw(row.group, { group: row.group }, {
                title: `${row.label} neu auslosen?`,
                description: `Alle Weiterkommer werden neu auf ${matchList(row.matchKeys)} verteilt. Das geht nur, solange keines davon begonnen hat; die neue Auslosung steht im Protokoll.`,
                success: `${row.label} neu ausgelost.`,
              })}
              className="tls-btn tls-btn--secondary shrink-0 whitespace-nowrap px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
            >
              Neu auslosen
            </button>
          )}
        </div>
      ))}
      {league && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/70">
          <span className="min-w-0 break-words">
            <span className="font-bold text-white">Spieltage</span> – Reihenfolge und Heimrecht sind ausgelost. Neu auslosen geht bis Spieltag 1 beginnt.
          </span>
          <button
            type="button"
            disabled={busy === "league"}
            data-testid="redraw-league"
            onClick={() => redraw("league", {}, {
              title: "Spieltage neu auslosen?",
              description: "Jeder spielt weiter genau einmal je Hin- und Rückrunde gegen jeden; neu gelost werden, wer in welcher Woche gegen wen spielt, und das Heimrecht. Termine der Spieltage werden neu gerechnet, von Hand gesetzte bleiben.",
              success: "Spieltage neu ausgelost.",
            })}
            className="tls-btn tls-btn--secondary shrink-0 whitespace-nowrap px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
          >
            Spieltage neu auslosen
          </button>
        </div>
      )}
    </div>
  );
}
