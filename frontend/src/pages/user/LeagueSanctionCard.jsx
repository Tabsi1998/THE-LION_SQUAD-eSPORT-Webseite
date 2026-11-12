// Eine Strafe der Liga-Leitung unter „Meine Strafen“ (E.3, docs/LIGA.md „E.3 Strafen“): Art, Regelverstoß, Begründung, Zeitraum,
// die Einspruchsfrist mit Restzeit und der Einspruch selbst - einmal je Strafe, geführt in zwei Schritten (Knopf, dann Begründung).
// Die Strafe gilt bis zur Entscheidung weiter; das steht dabei, damit niemand trotz Einspruch aufstellt.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Gavel, Scale } from "lucide-react";
import { toast } from "sonner";
import { TextAreaField } from "@/components/tls/FormFields";
import { api, formatApiError } from "@/lib/api";
import { deadlineTone, remainingText } from "@/lib/leagueProcedures";
import { APPEAL_STATE_LABELS, SANCTION_STATUS } from "@/lib/leagueSanctions";
import { viennaDateTime } from "@/lib/vienna";

const WHEN = { dateStyle: "medium", timeStyle: "short" };
const CHIP = { warn: "border-warn/50 text-warn", live: "border-[#FF6B60]/50 text-[#FF6B60]", calm: "border-white/15 text-white/60" };
const TONE = { none: "text-white/60", calm: "text-white/75", soon: "text-warn", over: "text-white/50" };
export const APPEAL_MIN = 10;

export function LeagueSanctionCard({ p, onChanged }) {
  const sanction = p.sanction;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const status = SANCTION_STATUS[sanction.status] || SANCTION_STATUS.active;
  const now = Date.now();
  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      await api.post(`/penalties/sanctions/${sanction.id}/appeal`, { text: text.trim() });
      toast.success("Einspruch eingelegt. Die Liga-Leitung entscheidet.");
      setOpen(false);
      onChanged?.();
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Der Einspruch konnte nicht eingelegt werden.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div data-testid={`penalty-card-${p.ref_id}`} className="rounded-sm border border-white/10 bg-[#121212] p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-[#FF6B60]/10 text-[#FF6B60]"><Gavel className="h-5 w-5" aria-hidden="true" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <div className="font-heading text-lg font-black uppercase leading-tight text-[#FF6B60]">{p.label}</div>
              <div className="text-[11px] uppercase tracking-widest text-white/50">
                {p.team_penalty ? `Strafe der Liga-Leitung gegen das Co-Team ${p.team_name}` : "Strafe der Liga-Leitung gegen dich"}
              </div>
            </div>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${CHIP[status.tone]}`} data-testid={`sanction-status-${sanction.id}`}>{status.label}</span>
          </div>
          <div className="mt-2 text-sm text-white/80">
            {p.context_url ? (
              <Link to={p.context_url} className="inline-flex min-h-11 items-center gap-1 hover:text-[#29B6E8]">{p.context_title} <ArrowRight className="h-3 w-3" aria-hidden="true" /></Link>
            ) : p.context_title}
          </div>
          <dl className="mt-1 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-white/50">Regelverstoß</dt><dd className="min-w-0 break-words text-white/90">{sanction.rule_ref}</dd>
            <dt className="text-white/50">Begründung</dt><dd className="min-w-0 whitespace-pre-line break-words text-white/90">{sanction.reason}</dd>
            {sanction.period ? <><dt className="text-white/50">Zeitraum</dt><dd className="tabular-nums text-white/90" data-testid={`sanction-period-${sanction.id}`}>{sanction.period}</dd></> : null}
            <dt className="text-white/50">Verhängt</dt><dd className="text-white/70">{viennaDateTime(p.issued_at, WHEN)}{p.issued_by_name ? ` von ${p.issued_by_name}` : ""}</dd>
            {sanction.status === "revoked" ? (
              <><dt className="text-white/50">Aufgehoben</dt><dd className="min-w-0 break-words text-white/80" data-testid={`sanction-revoked-${sanction.id}`}>{viennaDateTime(sanction.revoked_at, WHEN)}: {sanction.revoke_reason}</dd></>
            ) : null}
          </dl>
          {sanction.match_id ? <Link to={`/matches/${sanction.match_id}`} className="mt-1 inline-flex min-h-11 items-center text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:underline">Zum Spiel</Link> : null}

          {sanction.appeal ? (
            <div className="mt-3 rounded-sm border border-honor/30 p-3" data-testid={`sanction-appeal-${sanction.id}`}>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-honor"><Scale className="h-3.5 w-3.5" aria-hidden="true" /> {APPEAL_STATE_LABELS[sanction.appeal.state]}</div>
              <p className="mt-1 text-xs text-white/50">Eingelegt {viennaDateTime(sanction.appeal.at, WHEN)}{sanction.appeal.by_name ? ` von ${sanction.appeal.by_name}` : ""}</p>
              <p className="mt-1 whitespace-pre-line break-words text-sm text-white/85">{sanction.appeal.text}</p>
              {sanction.appeal.state === "open" ? <p className="mt-2 text-sm text-white/75">Eine andere Person der Liga-Leitung entscheidet. Bis dahin gilt die Strafe weiter.</p>
                : <p className="mt-2 break-words text-sm text-white/85">Begründung der Entscheidung: {sanction.appeal.note}</p>}
            </div>
          ) : sanction.can_appeal ? (
            <div className="mt-3 rounded-sm border border-white/15 p-3" data-testid={`sanction-appeal-box-${sanction.id}`}>
              <p className={`text-sm tabular-nums ${TONE[deadlineTone(sanction.appeal_until, now)]}`} data-testid={`sanction-deadline-${sanction.id}`}>
                Einspruch möglich bis {viennaDateTime(sanction.appeal_until, WHEN)} ({remainingText(sanction.appeal_until, now)}).
              </p>
              {open ? (
                <div className="mt-3 space-y-3">
                  <TextAreaField label="Begründung des Einspruchs" required rows={4} value={text} onChange={setText} testId={`sanction-appeal-text-${sanction.id}`}
                    hint="Mindestens zehn Zeichen. Der Einspruch geht einmal je Strafe. Es entscheidet eine Person, die die Strafe nicht verhängt hat. Die Strafe gilt bis dahin weiter." />
                  {error ? <p className="text-sm text-warn" role="alert" data-testid={`sanction-appeal-error-${sanction.id}`}>{error}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={submit} disabled={saving || text.trim().length < APPEAL_MIN} data-testid={`sanction-appeal-submit-${sanction.id}`}
                      className="tls-btn tls-btn--primary inline-flex min-h-11 items-center rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                      {saving ? "Sende …" : "Einspruch einlegen"}
                    </button>
                    <button type="button" onClick={() => setOpen(false)} className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider">Abbrechen</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setOpen(true)} data-testid={`sanction-appeal-open-${sanction.id}`}
                  className="tls-btn tls-btn--secondary mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider">
                  <Scale className="h-3.5 w-3.5" aria-hidden="true" /> Einspruch einlegen
                </button>
              )}
            </div>
          ) : sanction.status === "provisional" ? (
            <p className="mt-3 text-sm text-white/75" data-testid={`sanction-provisional-${sanction.id}`}>Die Sperre gilt vorläufig, bis die Liga-Leitung den Fall geprüft hat. Einspruch ist ab der endgültigen Entscheidung möglich.</p>
          ) : sanction.status !== "revoked" && sanction.appeal_until ? (
            <p className="mt-3 text-sm text-white/50" data-testid={`sanction-deadline-${sanction.id}`}>Die Einspruchsfrist ist am {viennaDateTime(sanction.appeal_until, WHEN)} abgelaufen.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
