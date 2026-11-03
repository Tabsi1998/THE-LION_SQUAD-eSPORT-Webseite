// Prüfung vor der Veröffentlichung einer Season (#2207, docs/LIGA.md „C.2 Maps und Pools“). Seit der Season-Seite mit Reitern (#2267)
// in drei Teilen: `useSeasonReadiness` lädt die Prüfung einmal für die ganze Seite, `SeasonReadinessPanel` steht im Überblick als
// „Was fehlt noch?“ - jeder Punkt springt an seine Stelle -, `SeasonPoolMinimum` (Mindestgröße je Modus) im Reiter Spielbetrieb.
// Probleme halten das Veröffentlichen auf (Sichtbarkeit von „aus“ auf sichtbar), Warnungen nicht.
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, ClipboardCheck, RefreshCw } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { FormSection } from "@/components/tls/AdminForm";
import { TextField } from "@/components/tls/FormFields";
import { minMapsForm, minMapsPayload, minMapsProblem } from "@/lib/seasonPools";
import { readinessAnchor, tabLabelOf } from "@/lib/seasonTabs";
import { toast } from "sonner";

/** Lädt die Prüfung - neu, sobald sich ``version`` ändert (Speichern irgendwo auf der Seite). */
export function useSeasonReadiness(seasonId, version) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const { data } = await api.get(`/admin/leagues/seasons/${seasonId}/readiness`);
      setResult({ ...data, problems: data?.problems || [], warnings: data?.warnings || [], requirements: data?.requirements || [] });
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
    setBusy(false);
  }, [seasonId]);
  useEffect(() => { load(); }, [load, version]);
  return { result, error, busy, reload: load };
}

function Items({ items, tone, onJump, testId }) {
  if (!items?.length) return null;
  return (
    <ul className="space-y-1.5" data-testid={testId}>
      {items.map((item, index) => {
        const anchor = onJump ? readinessAnchor(item.code) : "";
        return (
          <li key={`${item.code}-${index}`} data-code={item.code}
            className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-sm border px-3 py-2 text-sm ${tone === "problem" ? "border-live/40 bg-live/10 text-white" : "border-white/15 bg-white/[0.03] text-white/75"}`}>
            <span className="min-w-[min(100%,14rem)] flex-1 [overflow-wrap:anywhere]">{item.text}</span>
            {anchor ? (
              <button type="button" onClick={() => onJump(anchor)} data-testid={`${testId}-go-${item.code}`}
                className="tls-btn tls-btn--quiet inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-sm px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider">
                Zu {tabLabelOf(anchor)} <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function SeasonReadinessPanel({ readiness, visibility = "off", overrideReason = "", onOverrideReason, onJump, testId = "season-readiness" }) {
  const { result, error, busy, reload } = readiness;
  // „Nur Liga-Leitung“ ist Vorschau (#2207): veröffentlicht wird erst mit „Nur Mitglieder“ oder „Öffentlich“.
  const published = visibility === "members" || visibility === "public";
  const offerOverride = result && !result.ok && result.superadmin && !published && onOverrideReason;
  const clean = result && result.ok && !result.warnings.length;
  return (
    <FormSection title="Was fehlt noch?" testId={testId}
      hint="Prüfung vor der Veröffentlichung. Probleme (rot) halten das Veröffentlichen auf, Warnungen nicht. Jeder Punkt führt dorthin, wo du ihn erledigst.">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {result ? (
          <p className={`inline-flex items-center gap-2 text-sm font-semibold ${result.ok ? "text-[#29B6E8]" : "text-live"}`} data-testid={`${testId}-state`} role="status">
            {result.ok ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <ClipboardCheck className="w-4 h-4" aria-hidden="true" />}
            {result.ok ? "Bereit zur Veröffentlichung" : `${result.problems.length === 1 ? "1 Problem" : `${result.problems.length} Probleme`} vor der Veröffentlichung`}
            {result.warnings.length ? <span className="font-normal text-white/55">· {result.warnings.length === 1 ? "1 Warnung" : `${result.warnings.length} Warnungen`}</span> : null}
          </p>
        ) : <span className="text-sm text-white/45">Prüfe …</span>}
        <button type="button" onClick={reload} disabled={busy} data-testid={`${testId}-reload`}
          className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Neu prüfen
        </button>
      </div>
      {error ? <p className="text-sm text-warn" role="alert">{error}</p> : null}
      {result ? (
        <>
          <Items items={result.problems} tone="problem" onJump={onJump} testId={`${testId}-problems`} />
          <Items items={result.warnings} tone="warning" onJump={onJump} testId={`${testId}-warnings`} />
          {clean ? <p className="text-sm text-white/60" data-testid={`${testId}-clean`}>Nichts offen. Veröffentlichen geht mit „Sichtbarkeit“ rechts daneben.</p> : null}
          {offerOverride ? (
            <TextField label="Grund für die Notausnahme" maxLength={500} value={overrideReason} onChange={onOverrideReason}
              hint="Nur der Superadmin: Mit Grund (mindestens 5 Zeichen) veröffentlicht „Überblick speichern“ trotz Problemen. Der Grund steht im Protokoll."
              testId={`${testId}-override`} />
          ) : null}
        </>
      ) : null}
    </FormSection>
  );
}

/** Mindestgröße im Map-Pool je Modus (C.2) mit eigenem Speichern - im Reiter Spielbetrieb unter dem Pool. */
export function SeasonPoolMinimum({ seasonId, readiness, canEdit = true, onSaved, testId = "season-readiness" }) {
  const { result, reload } = readiness;
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const requirements = result?.requirements;
  useEffect(() => { setForm(minMapsForm(requirements || [])); }, [requirements]);
  if (!requirements?.length) return null;

  const saveMinimum = async () => {
    const problem = minMapsProblem(form);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/admin/leagues/seasons/${seasonId}`, { pool_min_maps: minMapsPayload(requirements, form) });
      toast.success("Mindestgröße gespeichert.");
      await reload();
      onSaved?.();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setBusy(false);
  };

  return (
    // Mit Pool-Editor steht der Bedarf schon bei jedem Modus - hier nur das Anpassen, darum zugeklappt.
    <FormSection title={canEdit ? "Mindestgröße anpassen" : "Mindestgröße im Map-Pool"} collapsible defaultOpen={!canEdit} testId={`${testId}-minimum`}
      hint={`Abgeleitet aus „Modus je Map“, der längsten Serie (Best of ${result.max_maps}) und der Map-Wiederholung. Stand nach dem letzten Speichern.`}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {requirements.map((row) => {
          const key = row.mode ?? "";
          const short = row.have < row.needed;
          return (
            <li key={key || "alle"} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2" data-testid={`${testId}-row-${key || "alle"}`}>
              <div className="min-w-0 text-sm">
                <div className="truncate font-semibold text-white">{row.label}</div>
                <div className={`text-xs tabular-nums ${short ? "text-live" : "text-white/55"}`}>{row.have} von mindestens {row.needed} {row.needed === 1 ? "Map" : "Maps"}</div>
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
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={saveMinimum} disabled={busy} data-testid={`${testId}-min-save`}
            className="tls-btn tls-btn--secondary px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
            Mindestgröße speichern
          </button>
          <span className="text-xs text-white/45">Eigene Zahl überschreibt, leer heißt abgeleitet.</span>
        </div>
      ) : null}
    </FormSection>
  );
}
