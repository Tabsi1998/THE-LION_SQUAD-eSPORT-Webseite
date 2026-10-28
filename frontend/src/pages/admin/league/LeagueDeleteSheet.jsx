// Liga, Season, Liga N oder Staffel löschen (#2106) - als Blatt in der Seite, nie als Browser-Rückfrage. Vorher fragt
// das Blatt den Server, was mitginge (`…/delete-plan`), und listet es auf. Hängt etwas dran (Co-Teams, Spiele,
// Ergebnisse, eine laufende Season), sagt es warum und bietet „Archivieren“ an: ausgeblendet, aber erhalten. Gelöscht
// wird nur mit Grund - er steht im Protokoll.
import { useEffect, useState } from "react";
import { Archive } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { TextAreaField } from "@/components/tls/FormFields";
import { deletionGroups } from "@/lib/league";
import { toast } from "sonner";

const MIN_REASON = 5;

/** Wohin die Anfragen gehen - je Ebene. */
export function deleteBase(kind, target) {
  if (kind === "league") return `/admin/leagues/${target.id}`;
  if (kind === "season") return `/admin/leagues/seasons/${target.id}`;
  if (kind === "division") return `/admin/leagues/divisions/${target.id}`;
  return `/admin/leagues/staffeln/${target.tournament_id}`;
}

/** Eine Staffel fragt keinen Plan ab: sie geht allein, die Sperre prüft der Server (wie in der Turnierverwaltung). */
function staffelPlan(target) {
  const count = Number(target.participant_count || 0);
  return {
    deletable: true, name: `Staffel ${target.staffel}`, blockers: [],
    staffeln: [{ tournament_id: target.tournament_id, title: target.title || `Staffel ${target.staffel}` }],
    note: count ? `${count === 1 ? "Das zugeteilte Co-Team wird" : `Die ${count} zugeteilten Co-Teams werden`} dabei aus der Staffel genommen.` : "",
  };
}

export function LeagueDeleteSheet({ kind, target, name, onClose, onDeleted, onArchive }) {
  const [plan, setPlan] = useState(() => (kind === "staffel" ? staffelPlan(target) : null));
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const base = deleteBase(kind, target);

  useEffect(() => {
    if (kind === "staffel") return undefined;
    let alive = true;
    api.get(`${base}/delete-plan`)
      .then(({ data }) => { if (alive) setPlan(data); })
      .catch((err) => { if (alive) setError(formatApiError(err.response?.data?.detail)); });
    return () => { alive = false; };
  }, [base, kind]);

  const title = `${name || plan?.name || ""} löschen`;
  const reasonOk = reason.trim().length >= MIN_REASON;
  const submit = async (event) => {
    event.preventDefault();
    if (!reasonOk) return;
    setSaving(true);
    try {
      await api.delete(base, { data: { reason: reason.trim() } });
      toast.success(`${name || plan?.name} gelöscht.`);
      onDeleted?.();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      // 409: inzwischen hängt etwas dran - den Plan neu holen, damit „Archivieren statt löschen“ erscheint.
      if (err.response?.status === 409 && kind !== "staffel") {
        try {
          const { data } = await api.get(`${base}/delete-plan`);
          setPlan(data);
        } catch (reloadErr) {
          setError(formatApiError(reloadErr.response?.data?.detail));
        }
      }
      setSaving(false);
    }
  };

  const archive = async () => {
    setSaving(true);
    const ok = await onArchive?.();
    if (!ok) setSaving(false);
  };

  const blocked = plan && !plan.deletable;
  return (
    <AdminSheet title={title} eyebrow="Löschen" accent={blocked ? "#29B6E8" : "var(--tls-live)"} onClose={onClose}
      onSubmit={plan?.deletable ? submit : undefined} saving={saving} savingLabel="Lösche …" submitLabel="Endgültig löschen"
      submitDisabled={!reasonOk} submitTestId="league-delete-confirm" testId="league-delete-sheet" noValidate
      footer={blocked && onArchive ? (
        <button type="button" onClick={archive} disabled={saving || plan.archived} data-testid="league-delete-archive"
          className="tls-btn tls-btn--primary ml-auto px-4 py-2.5 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-50">
          <Archive className="w-3.5 h-3.5" aria-hidden="true" /> {plan.archived ? "Schon archiviert" : "Archivieren"}
        </button>
      ) : null}>
      {error ? <p className="text-sm text-warn" role="alert">{error}</p> : null}
      {!plan && !error ? <p className="text-sm text-white/60" role="status">Prüfe, was dranhängt …</p> : null}

      {blocked ? (
        <div className="space-y-3" data-testid="league-delete-blocked">
          <div className="rounded-sm border border-warn/30 bg-warn/5 px-4 py-3">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-warn">Archivieren statt löschen</h3>
            <p className="mt-1 text-sm text-white/80">Löschen geht nicht, weil schon gespielt oder zugeteilt wurde:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/80">
              {plan.blockers.map((text) => <li key={text} className="break-words">{text}</li>)}
            </ul>
          </div>
          <p className="text-sm text-white/60">
            {plan.archived
              ? "Ist schon archiviert – ausgeblendet, aber mit allen Spielen und Ergebnissen erhalten."
              : "Archivieren blendet es auf der Ligaseite aus; Spiele, Ergebnisse und Protokoll bleiben erhalten. Zurückholen geht über den Stand „Aktiv“."}
          </p>
        </div>
      ) : null}

      {plan?.deletable ? (
        <div className="space-y-4" data-testid="league-delete-list">
          <p className="text-sm text-white/80">Das wird endgültig gelöscht – zurückholen geht nicht:</p>
          <ul className="space-y-1 rounded-sm border border-white/10 bg-[#0A0A0A] px-4 py-3 text-sm">
            <li className="font-semibold text-white break-words">{name || plan.name}</li>
            {kind !== "staffel" && deletionGroups(plan).map((group) => (
              <li key={group.label} className="pt-2">
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/50">{group.label}</div>
                <ul className="mt-1 space-y-0.5 text-white/75">
                  {group.items.map((item) => <li key={item} className="break-words">{item}</li>)}
                </ul>
              </li>
            ))}
          </ul>
          {plan.note ? <p className="text-sm text-white/65">{plan.note}</p> : null}
          {kind !== "staffel" && plan.staffeln?.length ? (
            <p className="text-xs text-white/50">Die Staffeln sind Entwürfe ohne Co-Teams und Spiele – sie gehen mit.</p>
          ) : null}
          <TextAreaField label="Grund" required rows={2} value={reason} onChange={(value) => setReason(value.slice(0, 500))}
            placeholder="z. B. falsch angelegt, doppelt" hint={`Steht im Protokoll, mindestens ${MIN_REASON} Zeichen.`} testId="league-delete-reason" />
        </div>
      ) : null}
    </AdminSheet>
  );
}
