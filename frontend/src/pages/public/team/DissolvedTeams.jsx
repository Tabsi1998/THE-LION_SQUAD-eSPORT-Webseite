import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { restoreDaysLeft, TEAM_TAG_MAX } from "@/lib/teamPage";

// Aufgelöstes Team wiederherstellen (#2128, TM8) - unter „Deine Teams“ für die frühere Teamleitung, in der Verwaltung für
// Admins. Hat ein anderes Team das Kürzel inzwischen, fragt die Zeile nach einem neuen.
export function DissolvedTeamRow({ team, onRestored }) {
  const confirm = useConfirm();
  const { submitting, submitOnce } = useSubmissionGuard();
  const [error, setError] = useState("");
  const [askTag, setAskTag] = useState(false);
  const [tag, setTag] = useState("");

  const restore = async () => {
    if (!askTag && !await confirm({
      title: "Team wiederherstellen?",
      description: `${team.name} kommt mit allen zurück, die noch ein Konto haben. Es gibt einen neuen Beitrittscode und einen neuen Einladungs-Link; zurückgezogene Turnier-Anmeldungen bleiben zurückgezogen.`,
      confirmLabel: "Wiederherstellen",
      tone: "info",
    })) return;
    setError("");
    const attempt = await submitOnce(async () => {
      await api.post(`/teams/${team.id}/restore`, askTag ? { tag: tag.trim().toUpperCase() } : {});
      toast.success(`${team.name} ist wieder da.`);
      onRestored?.();
    });
    if (attempt.started && attempt.error) {
      const message = formatRequestError(attempt.error, "Wiederherstellen hat nicht geklappt.");
      setError(message);
      if (attempt.error?.response?.status === 409 && message.includes("Kürzel")) setAskTag(true);
    }
  };

  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3 space-y-2" data-testid={`dissolved-team-${team.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 bg-[#121212] border border-white/10 rounded-sm overflow-hidden flex items-center justify-center shrink-0">
          {team.logo_url ? <img src={resolveMediaUrl(team.logo_url)} alt="" className="w-full h-full object-cover" /> : <span className="font-heading font-black text-xs text-white/60">{team.tag}</span>}
        </div>
        <div className="min-w-0 flex-1 basis-40">
          <div className="font-heading font-bold [overflow-wrap:anywhere]">{team.name}</div>
          <div className="text-xs text-white/50">[{team.tag}] · {team.member_count} {team.member_count === 1 ? "Mitglied" : "Mitglieder"} · {restoreDaysLeft(team.days_left)}</div>
        </div>
        <button type="button" onClick={restore} disabled={submitting || (askTag && tag.trim().length < 2)} data-testid={`dissolved-team-restore-${team.id}`}
          className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center gap-2 px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50">
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> {submitting ? "Stelle her…" : "Wiederherstellen"}
        </button>
      </div>
      {askTag ? (
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/60">Neues Kürzel</span>
          <input value={tag} onChange={(event) => { setTag(event.target.value.toUpperCase().slice(0, TEAM_TAG_MAX)); setError(""); }} data-testid={`dissolved-team-tag-${team.id}`}
            className="mt-1.5 w-full bg-[#121212] border border-white/10 px-3 py-2 rounded-sm" />
        </label>
      ) : null}
      {error ? <AuthFormAlert id={`dissolved-team-error-${team.id}`}>{error}</AuthFormAlert> : null}
    </div>
  );
}

export default DissolvedTeamRow;
