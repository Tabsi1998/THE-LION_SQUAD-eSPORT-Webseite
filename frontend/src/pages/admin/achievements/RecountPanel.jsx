/**
 * Neuberechnung der Erfolge (#2340), nur für den Superadmin: Stand des stillen Modus, Probelauf mit Ergebnis-Tabelle
 * und „Neuberechnung abschließen“ mit Rückfrage. Beide Läufe arbeiten im Hintergrund - die Tafel fragt nach, solange
 * einer läuft. Der Server prüft die Rechte selbst.
 */
import { useCallback, useEffect, useState } from "react";
import { Calculator, CheckCircle2, Play } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { MaterialChip, Panel, errorText, formatWhen } from "./shared";

export const POLL_MS = 4000;

const BUTTON = "px-3 py-1.5 border text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 disabled:opacity-40";

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Was der Abschluss gerade tut - in Worten. */
export function finishLabel(finish = {}) {
  if (finish.done) return `Abgeschlossen am ${formatWhen(finish.finished_at)} · ${plural(finish.notified || 0, "Sammel-Nachricht", "Sammel-Nachrichten")}`;
  if (finish.running) {
    // Vor der Auswertung ergänzt der Abschluss an alten Pokalen, wer im Finale stand - dann gibt es noch keinen Schritt.
    if (!finish.phase) return "Läuft: Finalisten an alten Pokalen werden ergänzt";
    if (finish.phase === "notify") return `Läuft: Sammel-Nachrichten – ${finish.notified || 0} verschickt`;
    return `Läuft: ${finish.evaluated || 0} von ${finish.users_total || 0} Konten ausgewertet`;
  }
  if (finish.interrupted) return `Unterbrochen bei ${finish.evaluated || 0} von ${finish.users_total || 0} Konten – „Neuberechnung abschließen“ setzt fort`;
  return "Noch offen";
}

export function RecountPanel() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const load = useCallback(() => api.get("/admin/achievements/recount").then(({ data }) => setState(data)).catch((err) => toast.error(errorText(err))), []);
  useEffect(() => { load(); }, [load]);
  const running = Boolean(state?.dry_run?.running || state?.finish?.running);
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  const post = async (path, done) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post(path);
      setState(data);
      toast.success(done);
    } catch (err) {
      toast.error(errorText(err));
      load();
    } finally {
      setBusy(false);
    }
  };

  const startDryRun = () => post("/admin/achievements/recount/dry-run", "Probelauf läuft – das Ergebnis erscheint hier.");
  const finish = async () => {
    const approved = await confirm({
      title: "Neuberechnung abschließen?",
      description: "Alle Konten werden still ausgewertet. Danach bekommt jede Person mit nachgerechneten Erfolgen eine Sammel-Nachricht (Postfach und Push, kein Discord), und der stille Modus endet – ab dann wird jeder Erfolg wieder einzeln gemeldet.",
      confirmLabel: "Abschließen",
    });
    if (!approved) return;
    await post("/admin/achievements/recount/finish", "Abschluss läuft – der Stand erscheint hier.");
  };

  if (!state) return null;
  const dry = state.dry_run || {};
  const run = state.finish || {};
  const canFinish = state.exists && !run.done && !run.running && !busy;

  return (
    <Panel
      title="Neuberechnung"
      icon={Calculator}
      hint="Nach Korrekturen an den Erfolgen werden Ansprüche still nachvergeben – gespeichert wie immer, aber ohne Postfach, Push und Discord. Zum Schluss bekommt jede Person eine Sammel-Nachricht. Echte Ereignisse melden weiter wie gewohnt."
      actions={(
        <>
          <button type="button" onClick={startDryRun} disabled={busy || dry.running} data-testid="ach-recount-dry-run" className={`${BUTTON} border-[#29B6E8]/50 text-[#29B6E8]`}>
            <Play className="w-3.5 h-3.5" /> Probelauf
          </button>
          <button type="button" onClick={finish} disabled={!canFinish} data-testid="ach-recount-finish" className={`${BUTTON} border-[#FFD700]/50 text-[#FFD700]`}>
            <CheckCircle2 className="w-3.5 h-3.5" /> Neuberechnung abschließen
          </button>
        </>
      )}
      testId="ach-recount"
    >
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
        <dt className="text-white/45">Stiller Modus</dt>
        <dd data-testid="ach-recount-mode">
          {!state.exists ? "Keine Neuberechnung angelegt" : state.active ? `An seit ${formatWhen(state.started_at)}` : `Aus seit ${formatWhen(state.ended_at)}`}
        </dd>
        <dt className="text-white/45">Abschluss</dt>
        <dd data-testid="ach-recount-finish-state">{state.exists ? finishLabel(run) : "–"}</dd>
        <dt className="text-white/45">Probelauf</dt>
        <dd data-testid="ach-recount-dry-state">
          {dry.running ? `Läuft: ${dry.checked || 0} von ${dry.total || 0} Konten gerechnet`
            : dry.status === "done" ? `${formatWhen(dry.finished_at)} · ${plural(dry.checked || 0, "Konto", "Konten")} gerechnet`
              : dry.status === "failed" || dry.status === "interrupted" ? "Abgebrochen – bitte neu starten" : "Noch nicht gelaufen"}
        </dd>
      </dl>

      {dry.status === "done" && !dry.running && (
        <div className="mt-4" data-testid="ach-recount-result">
          <p className="text-sm text-white/80" data-testid="ach-recount-summary">
            {plural(dry.affected_users || 0, "Person bekäme", "Personen bekämen")} {plural(dry.awards || 0, "Stufe", "Stufen")} neu dazu.
          </p>
          {dry.tiers?.length ? (
            <div className="mt-3 tls-swipe pb-0">
              <table className="w-full text-xs min-w-[300px]">
                <thead className="text-[10px] uppercase tracking-widest text-white/45">
                  <tr>
                    <th className="text-left py-2 pr-3">Stufe</th>
                    <th className="text-left py-2 pr-3">Gruppe</th>
                    <th className="text-right py-2">Personen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {dry.tiers.map((row) => (
                    <tr key={row.tier_code} data-testid={`ach-recount-row-${row.tier_code}`}>
                      <td className="py-2 pr-3">{row.name} {row.material && <MaterialChip tier={row} className="ml-1" />}</td>
                      <td className="py-2 pr-3 text-white/60">{row.group_name || "–"}{row.negative ? " · negativ" : ""}</td>
                      <td className="py-2 text-right tabular-nums font-semibold">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="mt-2 text-xs text-white/45">Niemand bekäme etwas dazu.</p>}
          <p className="mt-2 text-[11px] text-white/40">
            Folge-Stufen wie Sammler entstehen erst durch Vergaben – die Zahl ist eine Untergrenze.
            {dry.errors ? ` ${plural(dry.errors, "Konto ließ", "Konten ließen")} sich nicht rechnen (siehe Server-Protokoll).` : ""}
          </p>
        </div>
      )}
    </Panel>
  );
}
