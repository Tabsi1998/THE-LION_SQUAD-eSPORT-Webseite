// Gegner mischen (#1548, vier Modi #1590): die Auslosungen einer Phase in der Turnierverwaltung - wann gelost wurde,
// worauf eine Runde noch wartet, „Jetzt auslosen“ bei der Show-Auslosung und „Neu auslosen“, solange keines der
// betroffenen Spiele begonnen hat (sofort zufällig: nur die Spiele, die noch nicht begonnen haben). Der Server prüft
// dasselbe (409).
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

/** Der Satz hinter dem Rundennamen - je Modus und Stand. */
export function drawStatusText(row, matches) {
  if (row.mode === "instant") {
    if (!row.drawn) return "wird Platz für Platz gezogen, sobald ein Spiel davor fertig ist.";
    const total = row.assigned + row.open;
    return row.open ? `${row.assigned} von ${total} Plätzen gezogen.` : "alle Plätze gezogen.";
  }
  if (row.ready) return "Auslosung bereit – die Turnierleitung lost mit „Jetzt auslosen“ (sonst der Server nach der Frist).";
  if (!row.drawn) {
    return row.mode === "draw_show"
      ? "wartet, bis alle Spiele davor fertig sind – dann lost die Turnierleitung."
      : "wird ausgelost, sobald alle Spiele davor fertig sind.";
  }
  if (!row.canRedraw) return "ausgelost; die Runde hat begonnen, das Los gilt.";
  const at = drawnAt(matches, row.group);
  return `ausgelost${at ? ` am ${at}` : ""}.`;
}

const BUTTON = "tls-btn shrink-0 whitespace-nowrap px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider disabled:opacity-50";

export function DrawControls({ tournamentId, stage, matches = [], onChanged }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState("");
  const groups = drawGroupsOf(matches);
  const league = leagueRedrawAllowed(stage, matches);
  if (!groups.length && !league) return null;

  const post = async (key, path, payload, { title, description, confirmLabel, success, tone = "info" }) => {
    if (title) {
      const ok = await confirm({ title, description, confirmLabel, tone });
      if (!ok) return;
    }
    setBusy(key);
    try {
      await api.post(`/tournaments/${tournamentId}/stages/${stage.id}/${path}`, payload);
      toast.success(success);
      onChanged?.();
    } catch (err) {
      toast.error(formatRequestError(err, "Das hat nicht geklappt."));
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
        <div key={row.group} className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/70" data-testid={`draw-group-${row.group}`} data-mode={row.mode}>
          <span className="min-w-0 break-words">
            <span className="font-bold text-white">{row.label}</span>
            {" – "}{drawStatusText(row, matches)}
          </span>
          {row.ready && (
            <button
              type="button"
              disabled={busy === `draw:${row.group}`}
              data-testid={`draw-now-${row.group}`}
              onClick={() => post(`draw:${row.group}`, "draw", { group: row.group }, { success: `${row.label} ausgelost.` })}
              className={`${BUTTON} tls-btn--primary`}
            >
              Jetzt auslosen
            </button>
          )}
          {row.canRedraw && (
            <button
              type="button"
              disabled={busy === row.group}
              data-testid={`redraw-${row.group}`}
              onClick={() => post(row.group, "redraw", { group: row.group }, {
                title: `${row.label} neu auslosen?`,
                confirmLabel: "Neu auslosen",
                description: row.mode === "instant"
                  ? `Die schon gezogenen Plätze werden neu auf ${matchList(row.redrawKeys)} verteilt – nur Spiele, die noch nicht begonnen haben. Die neue Auslosung steht im Protokoll.`
                  : `Alle Weiterkommer werden neu auf ${matchList(row.matchKeys)} verteilt. Das geht nur, solange keines davon begonnen hat; die neue Auslosung steht im Protokoll.`,
                success: `${row.label} neu ausgelost.`,
              })}
              className={`${BUTTON} tls-btn--secondary`}
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
            onClick={() => post("league", "redraw", {}, {
              title: "Spieltage neu auslosen?",
              confirmLabel: "Neu auslosen",
              description: "Jeder spielt weiter genau einmal je Hin- und Rückrunde gegen jeden; neu gelost werden, wer in welcher Woche gegen wen spielt, und das Heimrecht. Termine der Spieltage werden neu gerechnet, von Hand gesetzte bleiben.",
              success: "Spieltage neu ausgelost.",
            })}
            className={`${BUTTON} tls-btn--secondary`}
          >
            Spieltage neu auslosen
          </button>
        </div>
      )}
    </div>
  );
}
