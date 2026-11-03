// Map in einem Schritt sperren (#2207): eine neue Pool-Version ohne die Map, übertragen auf alle Staffeln, mit Grund im Protokoll.
// Eigenständig - braucht nur die Adresse der Aktion (`endpoint`) und den geltenden Pool (`pool` mit `version` und `modes`). Alte
// Versionen, Spiele mit festgehaltenem Pool und fertige Spiele bleiben, wie sie sind.
import { useState } from "react";
import { Ban } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { SelectField, TextAreaField } from "@/components/tls/FormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { lockResultText, poolMapChoices } from "@/lib/seasonPools";
import { toast } from "sonner";

const ALL = "__alle__";

export function PoolMapLock({ endpoint, pool, onDone, testId = "pool-lock" }) {
  const confirm = useConfirm();
  const choices = poolMapChoices(pool);
  const [mapId, setMapId] = useState("");
  const [mode, setMode] = useState(ALL);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  if (!pool || !choices.length) return null;

  const chosen = choices.find((item) => item.map_id === mapId);
  const modeOptions = [[ALL, "aus allen Modi"], ...(chosen?.modes || []).filter((row) => row.mode !== null).map((row) => [row.mode, `nur aus ${row.label}`])];
  const ready = chosen && reason.trim().length >= 5;
  const submit = async () => {
    const where = mode === ALL ? "" : ` aus ${chosen.modes.find((row) => row.mode === mode)?.label}`;
    const ok = await confirm({
      title: `„${chosen.name}“${where} sperren?`,
      description: "Es entsteht eine neue Version des Map-Pools ohne diese Map, und sie geht sofort an alle Staffeln. Spiele, die ihren Pool schon festhalten, und fertige Spiele bleiben unverändert.",
      confirmLabel: "Sperren und übertragen",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const { data } = await api.post(endpoint, { map_id: mapId, mode: mode === ALL ? null : mode, reason: reason.trim(), expected_version: pool.version });
      setResult(data);
      setMapId("");
      setMode(ALL);
      setReason("");
      // Schon gesperrt (#2207): keine neue Version, nur fehlende Staffeln wurden nachgezogen.
      toast.success(data.unchanged ? `„${chosen.name}“ war schon gesperrt – fehlende Staffeln sind nachgezogen.`
        : `„${chosen.name}“ gesperrt – Version ${data.pool.version}.`);
      (data.warnings || []).forEach((text) => toast.warning(text));
      await onDone?.();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setBusy(false);
  };

  return (
    <details className="group rounded-sm border border-white/10 bg-[#121212] p-4" data-testid={testId}>
      <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-widest text-white/70 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm">
        Map aus dem Pool nehmen
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-white/55">Für eine kaputte oder gesperrte Map: neue Version ohne sie, sofort auf alle Staffeln übertragen, mit Grund im Protokoll.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Map" value={mapId} onChange={(value) => { setMapId(value); setMode(ALL); }} testId={`${testId}-map`}
            options={[["", "bitte wählen"], ...choices.map((item) => [item.map_id, item.name])]} />
          <SelectField label="Wo" value={mode} onChange={setMode} options={modeOptions} disabled={!chosen} testId={`${testId}-mode`} />
        </div>
        <TextAreaField label="Grund" rows={2} value={reason} onChange={setReason} placeholder="z. B. Fehler im Spiel, vom Hersteller gesperrt"
          hint="Mindestens 5 Zeichen – steht im Protokoll." testId={`${testId}-reason`} />
        <button type="button" onClick={submit} disabled={busy || !ready} data-testid={`${testId}-run`}
          className="tls-btn tls-btn--danger px-3 py-2 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50">
          <Ban className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? "Sperre …" : "Sperren und übertragen"}
        </button>
        {result ? (
          <ul className="space-y-1 text-xs" data-testid={`${testId}-result`} aria-live="polite">
            {result.staffeln.length ? result.staffeln.map((row) => (
              <li key={row.tournament_id} className={row.applied ? "text-white/70" : "text-warn"}>{row.title}: {lockResultText(row)}</li>
            )) : <li className="text-white/55">Noch keine Staffel – die neue Version gilt für jede neue Staffel.</li>}
            {(result.warnings || []).map((text) => <li key={text} className="text-warn">{text}</li>)}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
