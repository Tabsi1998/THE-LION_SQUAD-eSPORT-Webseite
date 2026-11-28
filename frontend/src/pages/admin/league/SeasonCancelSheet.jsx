// „Season absagen“ (#2607, Entscheidung Nr. 302) - als Blatt in der Seite. Vorher fragt das Blatt den Server, was das Absagen täte
// (`…/cancel-plan`), und listet die Folgen: Anmeldungen, Staffeln, wer eine Nachricht bekommt. Abgesagt wird nur mit Grund (mindestens
// fünf Zeichen) - er steht auf der Ligaseite und in der Nachricht. Kein Zurücknehmen: Für einen Neustart „Neue Season aus …“.
import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { TextAreaField } from "@/components/tls/FormFields";
import { cancelConsequences } from "@/lib/seasonCancel";
import { toast } from "sonner";

export const MIN_REASON = 5;

export function SeasonCancelSheet({ season, onClose, onDone }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const base = `/admin/leagues/seasons/${season.id}`;

  useEffect(() => {
    let alive = true;
    api.get(`${base}/cancel-plan`)
      .then(({ data }) => { if (alive) setPlan(data); })
      .catch((err) => { if (alive) setError(formatApiError(err.response?.data?.detail)); });
    return () => { alive = false; };
  }, [base]);

  const reasonOk = reason.trim().length >= MIN_REASON;
  const submit = async (event) => {
    event.preventDefault();
    if (!reasonOk || !plan?.can_cancel) return;
    setSaving(true);
    try {
      const { data } = await api.post(`${base}/cancel`, { reason: reason.trim() });
      toast.success(data.already ? `${season.name} war schon abgesagt.` : `${season.name} ist abgesagt.`);
      onDone?.(data);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      setSaving(false);
      // 409: inzwischen hat eine Staffel begonnen - den Plan neu holen, damit der Grund dasteht.
      if (err.response?.status === 409) {
        try {
          const { data } = await api.get(`${base}/cancel-plan`);
          setPlan(data);
        } catch (reloadErr) {
          setError(formatApiError(reloadErr.response?.data?.detail));
        }
      }
    }
  };

  const blocked = plan && !plan.can_cancel;
  const lines = plan?.can_cancel ? cancelConsequences(plan) : [];
  return (
    <AdminSheet title={`${season.name} absagen`} eyebrow="Season absagen" accent="var(--tls-warn)" onClose={onClose}
      onSubmit={plan?.can_cancel ? submit : undefined} saving={saving} savingLabel="Sage ab …" submitLabel="Season absagen"
      submitDisabled={!reasonOk} submitTestId="season-cancel-confirm" testId="season-cancel-sheet" noValidate>
      {error ? <p className="tls-type-small text-warn" role="alert">{error}</p> : null}
      {!plan && !error ? <p className="tls-type-small text-white/60" role="status">Prüfe, was dranhängt …</p> : null}

      {blocked ? (
        <div className="rounded-sm border border-warn/30 bg-warn/5 px-4 py-3" data-testid="season-cancel-blocked">
          <h3 className="tls-type-label text-warn">{plan.cancelled ? "Schon abgesagt" : "Absagen geht nicht mehr"}</h3>
          {plan.cancelled ? (
            <p className="mt-1 tls-type-small text-white/80">Diese Season ist schon abgesagt. Zurücknehmen geht nicht.</p>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-5 tls-type-small text-white/80">
              {plan.problems.map((text) => <li key={text} className="break-words">{text}</li>)}
            </ul>
          )}
        </div>
      ) : null}

      {plan?.can_cancel ? (
        <div className="space-y-4" data-testid="season-cancel-plan">
          <p className="tls-type-body text-white/85">Das passiert in einem Schritt:</p>
          <ul className="space-y-2 rounded-sm border border-white/10 bg-[#0A0A0A] px-4 py-3 tls-type-small text-white/80">
            {lines.map((line) => (
              <li key={line.key} className="break-words" data-testid={`season-cancel-${line.key}`}>{line.text}</li>
            ))}
          </ul>
          <p className="tls-type-small text-white/65" data-testid="season-cancel-final">
            Zurücknehmen geht nicht. Für einen Neustart legst du eine neue Season an – zum Beispiel über „Neue Season aus …“ bei der Vorgänger-Season.
          </p>
          <TextAreaField label="Grund" required rows={2} value={reason} onChange={(value) => setReason(value.slice(0, 500))}
            placeholder="z. B. zu wenige Anmeldungen für einen Spielplan" hint={`Steht auf der Ligaseite und in der Nachricht an alle, mindestens ${MIN_REASON} Zeichen.`}
            testId="season-cancel-reason" />
        </div>
      ) : null}
    </AdminSheet>
  );
}
