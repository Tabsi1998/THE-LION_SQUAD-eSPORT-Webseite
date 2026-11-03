// Prüfung vor der Veröffentlichung einer Season (#2207, docs/LIGA.md „C.2 Maps und Pools“). Eigenständig: braucht nur die
// Season-ID und meldet einen Grund für die Notausnahme nach oben. Probleme halten das Veröffentlichen auf (Sichtbarkeit von „aus“
// auf sichtbar), Warnungen nicht. Dazu die Mindestgröße je Modus mit eigenem Speichern.
import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { FormSection } from "@/components/tls/AdminForm";
import { TextField } from "@/components/tls/FormFields";
import { minMapsForm, minMapsPayload, minMapsProblem } from "@/lib/seasonPools";
import { toast } from "sonner";

function Items({ items, tone, testId }) {
  if (!items?.length) return null;
  return (
    <ul className="space-y-1.5" data-testid={testId}>
      {items.map((item, index) => (
        <li key={`${item.code}-${index}`} data-code={item.code}
          className={`rounded-sm border px-3 py-2 text-sm ${tone === "problem" ? "border-live/40 bg-live/10 text-white" : "border-white/15 bg-white/[0.03] text-white/75"}`}>
          {item.text}
        </li>
      ))}
    </ul>
  );
}

export function SeasonReadinessPanel({ seasonId, version, visibility = "off", canEdit = true, overrideReason = "", onOverrideReason,
  onSaved, testId = "season-readiness" }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({});

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const { data } = await api.get(`/admin/leagues/seasons/${seasonId}/readiness`);
      setResult({ ...data, problems: data?.problems || [], warnings: data?.warnings || [], requirements: data?.requirements || [] });
      setForm(minMapsForm(data.requirements));
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
    setBusy(false);
  }, [seasonId]);
  useEffect(() => { load(); }, [load, version]);

  const saveMinimum = async () => {
    const problem = minMapsProblem(form);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/admin/leagues/seasons/${seasonId}`, { pool_min_maps: minMapsPayload(result?.requirements, form) });
      toast.success("Mindestgröße gespeichert.");
      await load();
      onSaved?.();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setBusy(false);
  };

  const offerOverride = result && !result.ok && result.superadmin && visibility === "off" && onOverrideReason;
  return (
    <FormSection title="Prüfung vor der Veröffentlichung" testId={testId}
      hint="Probleme halten das Veröffentlichen auf (Sichtbarkeit von „Aus“ auf sichtbar). Warnungen halten nichts auf.">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {result ? (
          <p className={`inline-flex items-center gap-2 text-sm font-semibold ${result.ok ? "text-[#29B6E8]" : "text-live"}`} data-testid={`${testId}-state`} role="status">
            <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
            {result.ok ? "Bereit zur Veröffentlichung" : `${result.problems.length === 1 ? "1 Problem" : `${result.problems.length} Probleme`} vor der Veröffentlichung`}
            {result.warnings.length ? <span className="font-normal text-white/55">· {result.warnings.length === 1 ? "1 Warnung" : `${result.warnings.length} Warnungen`}</span> : null}
          </p>
        ) : <span />}
        <button type="button" onClick={load} disabled={busy} data-testid={`${testId}-reload`}
          className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Neu prüfen
        </button>
      </div>
      {error ? <p className="text-sm text-warn" role="alert">{error}</p> : null}
      {result ? (
        <>
          <Items items={result.problems} tone="problem" testId={`${testId}-problems`} />
          <Items items={result.warnings} tone="warning" testId={`${testId}-warnings`} />
          {offerOverride ? (
            <TextField label="Grund für die Notausnahme" maxLength={500} value={overrideReason} onChange={onOverrideReason}
              hint="Nur der Superadmin: Mit Grund (mindestens 5 Zeichen) veröffentlicht „Season speichern“ trotz Problemen. Der Grund steht im Protokoll."
              testId={`${testId}-override`} />
          ) : null}
          {result.requirements?.length ? (
            <div className="space-y-2" data-testid={`${testId}-minimum`}>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Mindestgröße im Map-Pool</div>
              <p className="text-xs text-white/50">
                Abgeleitet aus „Modus je Map“, der längsten Serie (Best of {result.max_maps}) und der Map-Wiederholung. Eigene Zahl überschreibt, leer heißt abgeleitet.
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {result.requirements.map((row) => {
                  const key = row.mode ?? "";
                  const short = row.have < row.needed;
                  return (
                    <li key={key || "alle"} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2" data-testid={`${testId}-row-${key || "alle"}`}>
                      <div className="min-w-0 text-sm">
                        <div className="truncate font-semibold text-white">{row.label}</div>
                        <div className={`text-xs tabular-nums ${short ? "text-live" : "text-white/55"}`}>{row.have} von mindestens {row.needed} Maps</div>
                      </div>
                      {canEdit ? (
                        <TextField label="Mindestens" type="number" min={1} max={50} value={form[key] ?? ""} placeholder={String(row.derived)}
                          onChange={(value) => setForm((current) => ({ ...current, [key]: value }))} className="w-24" testId={`${testId}-min-${key || "alle"}`} />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {result.total ? (
                <p className={`text-xs tabular-nums ${result.total.have < result.total.needed ? "text-live" : "text-white/55"}`} data-testid={`${testId}-total`}>
                  Über alle Modi: {result.total.have} von mindestens {result.total.needed} {result.total.kind === "maps" ? "verschiedenen Maps" : "Maps"}.
                </p>
              ) : null}
              {canEdit ? (
                <button type="button" onClick={saveMinimum} disabled={busy} data-testid={`${testId}-min-save`}
                  className="tls-btn tls-btn--secondary px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
                  Mindestgröße speichern
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </FormSection>
  );
}
