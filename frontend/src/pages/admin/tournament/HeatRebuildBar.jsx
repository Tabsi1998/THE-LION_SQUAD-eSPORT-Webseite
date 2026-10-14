// Läufe umbauen (#1550): die Hinweisleiste mit dem Vorschlag des Servers - Zusammenlegen, Ausgleichen, Abkürzen -
// und den zwei Knöpfen der Turnierleitung. Der Vorschlag liegt am Turnier (`heat_rebuild_plan`), solange er offen ist;
// nach Bestätigen oder Ablehnen lädt die Seite neu und die Leiste verschwindet. Die schöne Darstellung mit Animation
// im Baum und am TV kommt mit #1561/#1564.
import { useState } from "react";
import { GitMerge } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";

const KIND_LABELS = {
  merged: "Zusammenlegen",
  rebalanced: "Ausgleichen",
  shortened: "Abkürzen",
  quota: "Quote",
  cancelled: "Entfällt",
};

export function HeatRebuildBar({ tournament, onDecided }) {
  const [busy, setBusy] = useState("");
  const plan = tournament?.heat_rebuild_plan;
  if (!plan || !tournament?.can_manage_structure) return null;
  const ops = Array.isArray(plan.ops) ? plan.ops.filter((op) => op && (op.text || op.kind)) : [];

  const decide = async (action) => {
    setBusy(action);
    try {
      await api.post(`/tournaments/${tournament.id}/heat-rebuild/${action}`, { plan_id: plan.id });
      toast.success(action === "confirm" ? "Läufe umgebaut – Baum und TV laden neu." : "Vorschlag abgelehnt, die Läufe bleiben wie sie sind.");
    } catch (error) {
      toast.error(formatRequestError(error, action === "confirm"
        ? "Der Umbau konnte nicht angewendet werden."
        : "Der Vorschlag konnte nicht abgelehnt werden."));
    } finally {
      setBusy("");
      onDecided?.();
    }
  };

  return (
    <div data-testid="admin-tr-heat-rebuild" role="status" className="border border-honor/40 bg-honor/5 rounded-sm p-4 space-y-3 min-w-0">
      <div className="flex items-start gap-2 min-w-0">
        <GitMerge className="w-4 h-4 mt-0.5 shrink-0 text-honor" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-widest text-honor">Vorschlag: Läufe umbauen</div>
          <div className="text-xs text-white/60 mt-1">Unterbesetzte Läufe lassen sich zusammenlegen, ausgleichen oder abkürzen. Laufende und aufgerufene Läufe bleiben unangetastet.</div>
        </div>
      </div>
      {ops.length > 0 ? (
        <ul className="space-y-1 text-sm text-white/85">
          {ops.map((op, index) => (
            <li key={index} data-testid="admin-tr-heat-rebuild-op" className="flex gap-2 min-w-0 break-words">
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-honor/80 mt-0.5 w-24">{KIND_LABELS[op.kind] || "Umbau"}</span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{op.text || KIND_LABELS[op.kind] || "Umbau"}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-white/85 break-words [overflow-wrap:anywhere]">{plan.summary || "Die Läufe sollen umgebaut werden."}</div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => decide("confirm")} disabled={!!busy} data-testid="admin-tr-heat-rebuild-confirm" className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
          {busy === "confirm" ? "Wird umgebaut …" : "Bestätigen"}
        </button>
        <button type="button" onClick={() => decide("reject")} disabled={!!busy} data-testid="admin-tr-heat-rebuild-reject" className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
          Ablehnen
        </button>
      </div>
    </div>
  );
}
