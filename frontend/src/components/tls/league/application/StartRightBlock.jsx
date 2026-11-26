// Startrecht des eigenen Co-Teams (#1627, docs/LIGA.md „F.2a“): der Satz zum Stand (Zusage offen mit Frist, zugesagt, verfallen,
// nachgerückt) und die Knöpfe „Startrecht annehmen“ bzw. „Nachrücken ablehnen“. Auf der Team-Seite und auf der Ligaseite derselbe
// Baustein - die Zusage geht über denselben Antrag wie Anmelden und Abmelden. Ob etwas geht, sagt der Server (`can_accept`, `can_decline`).
import { useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { declineText, rightLine } from "@/lib/leagueStartRights";

const BUTTON = "inline-flex min-h-[44px] items-center rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50";

export function StartRightBlock({ applicationId, carry, onChanged, testPrefix = "start-right" }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const right = carry?.start_right;
  if (!right) return null;
  const line = rightLine(carry);
  const send = async (action) => {
    if (action === "decline") {
      const sure = await confirm({
        title: "Nachrücken ablehnen?",
        description: declineText(carry),
        confirmLabel: "Ablehnen", tone: "danger",
      });
      if (!sure) return;
    }
    setBusy(true);
    try {
      await api.post(`/me/league-applications/${applicationId}/start-right`, { action });
      toast.success(action === "accept" ? `Zugesagt für ${carry.division_label}. Die Staffel teilt die Liga-Leitung noch zu.`
        : `Abgelehnt. Ihr bleibt in ${right.fills?.from_label || "eurer Liga"}${right.fills?.own_open ? " – das gilt als eure Zusage dort" : ""}.`);
      onChanged?.();
    } catch (failure) {
      toast.error(formatApiError(failure.response?.data?.detail));
      // Frist vorbei oder schon entschieden: Der Stand vom Server gilt.
      onChanged?.();
    }
    setBusy(false);
  };
  if (!line && !right.can_accept && !right.can_decline) return null;
  return (
    <div className="mt-1" data-testid={`${testPrefix}-${applicationId}`} data-state={right.state}>
      {line ? <p className={`text-sm [overflow-wrap:anywhere] ${right.state === "offered" ? "font-semibold text-white" : "text-white/75"}`} data-testid={`${testPrefix}-line-${applicationId}`}>{line}</p> : null}
      {right.can_accept || right.can_decline ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {right.can_accept ? (
            <button type="button" disabled={busy} onClick={() => send("accept")} className={`tls-btn tls-btn--primary ${BUTTON}`} data-testid={`${testPrefix}-accept-${applicationId}`}>
              Startrecht annehmen
            </button>
          ) : null}
          {right.can_decline ? (
            <button type="button" disabled={busy} onClick={() => send("decline")} className={`tls-btn tls-btn--quiet ${BUTTON}`} data-testid={`${testPrefix}-decline-${applicationId}`}>
              Nachrücken ablehnen
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
