import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { disputeReasonLabel } from "@/lib/disputeReasons";
import { formatWhen } from "@/lib/datetime";

// „Deine Meldung – Entscheidung“ (#2124, TP4): wer ein Problem gemeldet hat, sieht auf der Matchseite, was daraus
// wurde. Der Server liefert der meldenden Seite nur ihre eigenen Meldungen (match_public_view: `disputes`) - mit
// `decision` („keep“ Ergebnis bleibt, „change“ Ergebnis geändert, „void“ hinfällig) und der Begründung der Leitung.

/** Die eigenen Meldungen zu einem Spiel, die neueste zuerst. */
export function ownDisputes(match, userId) {
  if (!userId) return [];
  return (Array.isArray(match?.disputes) ? match.disputes : [])
    .filter((row) => row && row.user_id === userId)
    .sort((left, right) => String(right.at || "").localeCompare(String(left.at || "")));
}

/** Was die Turnierleitung entschieden hat - in einem Satz. */
export function disputeDecisionText(row) {
  if (!row?.resolved_at) return "Die Turnierleitung prüft deine Meldung.";
  if (row.decision === "keep") return "Entschieden: Das Ergebnis bleibt.";
  if (row.decision === "void") return "Erledigt: Die Meldung ist hinfällig.";
  return "Entschieden: Das Ergebnis wurde korrigiert.";
}

export function OwnDisputes({ match, userId }) {
  const rows = ownDisputes(match, userId).slice(0, 3);
  if (!rows.length) return null;
  return (
    <div className="mt-5 space-y-2" data-testid="match-own-disputes">
      {rows.map((row, index) => {
        const done = Boolean(row.resolved_at);
        return (
          <div key={`${row.at || ""}-${index}`} className={`rounded-sm border px-4 py-3 text-sm ${done ? "border-white/15 bg-white/5" : "border-warn/40 bg-warn/10"}`} data-testid="match-own-dispute" data-state={done ? row.decision || "change" : "open"}>
            <div className="flex items-start gap-3">
              {done ? <CheckCircle2 className="mt-0.5 w-4 h-4 shrink-0 text-[#29B6E8]" /> : <AlertTriangle className="mt-0.5 w-4 h-4 shrink-0 text-warn" />}
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-widest text-white/55">
                  Deine Meldung · {disputeReasonLabel(row.category)}{row.at ? ` · ${formatWhen(row.at)}` : ""}
                </p>
                {row.reason ? <p className="mt-1 text-white/70 [overflow-wrap:anywhere]">„{row.reason}“</p> : null}
                <p className="mt-2 font-bold text-white" data-testid="match-own-dispute-decision">{disputeDecisionText(row)}</p>
                {done && row.decision_note ? <p className="mt-0.5 text-white/65 [overflow-wrap:anywhere]" data-testid="match-own-dispute-note">Begründung: {row.decision_note}</p> : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
