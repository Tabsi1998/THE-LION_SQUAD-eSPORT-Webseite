// Saisonfinale am TV (#1641): Nach dem Sieger-Moment zeigt der Turnierbaum-TV jeder abgeschlossenen Staffel auf „Weiter“ je Liga N die
// Auf- und Absteiger; „Weiter“ blättert zur nächsten Liga N, „Ende“ bringt das gewohnte Bild zurück. Ein Kasten im Reiter „Abschluss“
// (Sprungmarke `#tv-finale`) - drücken darf, wer „Spiele betreuen“ hat (der Server prüft). „Weiter“ schickt den Stand mit, den dieses
// Fenster zeigt: Hat ein zweites Fenster schon weitergeschaltet, antwortet der Server mit 409 - dann lädt der Kasten den Stand neu,
// statt eine Liga N zu überspringen.
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, MonitorPlay, Square } from "lucide-react";
import { FormSection } from "@/components/tls/AdminForm";
import { api, formatApiError } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

// Live (K-b): schließt während des Finales eine Staffel ab oder schaltet ein anderes Fenster, steht der neue Stand ohne Klick da.
const REFRESH_MS = 30000;

const REASONS = {
  season_hidden: "Diese Season ist nicht öffentlich – der TV zeigt das Saisonfinale nur bei öffentlichen Seasons.",
  none_closed: "Noch keine Staffel abgeschlossen. Der Schritt kommt nach dem Abschluss.",
  no_movers: "In dieser Season steigt niemand auf oder ab – es gibt nichts zu zeigen.",
};

/** Was der TV gerade zeigt - ein Satz für die Leitung. */
export function finaleStatus(state) {
  if (!state) return "";
  if (state.reason) return REASONS[state.reason] || "";
  if (!state.step) return "Der TV zeigt das gewohnte Bild (Tabelle bzw. Sieger).";
  return `Der TV zeigt ${state.labels?.[state.step - 1] || `Liga ${state.step}`} (${state.step} von ${state.count}).`;
}

export function SeasonTvFinaleControl({ seasonId, canSteer = false }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [stale, setStale] = useState("");
  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/leagues/seasons/${seasonId}/tv-finale`);
      setState(data);
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Der Stand am TV konnte nicht geladen werden.");
    }
  }, [seasonId]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["tournaments", "leagues"], { fallbackMs: REFRESH_MS });

  const press = async (action) => {
    setBusy(action);
    setError("");
    setStale("");
    try {
      const body = action === "next" ? { action, from_step: state?.step ?? 0 } : { action };
      const { data } = await api.post(`/admin/leagues/seasons/${seasonId}/tv-finale`, body);
      setState(data);
    } catch (failure) {
      if (failure.response?.status === 409) {
        setStale(formatApiError(failure.response?.data?.detail) || "Der Stand hat sich geändert – neu geladen.");
        await load();
      } else {
        setError(formatApiError(failure.response?.data?.detail) || "Der TV konnte nicht umgeschaltet werden.");
      }
    } finally {
      setBusy("");
    }
  };

  if (!state) return error ? <p className="text-sm text-warn" role="alert" data-testid="tv-finale-error">{error}</p> : null;
  const blocked = Boolean(state.reason);
  const last = state.step > 0 && state.step >= state.count;
  return (
    <FormSection title="Saisonfinale am TV" id="tv-finale" className="scroll-mt-24" testId="tv-finale-control"
      hint="Nach dem Sieger-Moment: je Liga N die Auf- und Absteiger am Turnierbaum-TV aller abgeschlossenen Staffeln dieser Season.">
      <p className="flex items-start gap-2 text-sm text-white/80" role="status" data-testid="tv-finale-status">
        <MonitorPlay className="mt-0.5 h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" /> {finaleStatus(state)}
      </p>
      {!blocked && state.labels?.length ? (
        <ol className="mt-2 flex flex-wrap gap-2 text-xs" aria-label="Reihenfolge am TV" data-testid="tv-finale-labels">
          {state.labels.map((label, index) => (
            <li key={label} className={`rounded-sm border px-2 py-1 font-bold uppercase tracking-wider ${index + 1 === state.step ? "border-honor/60 text-honor" : "border-white/15 text-white/60"}`}>
              {index + 1}. {label}
            </li>
          ))}
        </ol>
      ) : null}
      {stale ? <p className="mt-2 text-sm text-white/80" role="status" data-testid="tv-finale-stale">{stale}</p> : null}
      {error ? <p className="mt-2 text-sm text-warn" role="alert" data-testid="tv-finale-error">{error}</p> : null}
      {canSteer ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => press("next")} disabled={blocked || last || Boolean(busy)} data-testid="tv-finale-next"
            className="tls-btn tls-btn--primary inline-flex min-h-11 items-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-40">
            <ChevronRight className="h-4 w-4" aria-hidden="true" /> {busy === "next" ? "Schalte …" : "Weiter"}
          </button>
          <button type="button" onClick={() => press("end")} disabled={!state.step || Boolean(busy)} data-testid="tv-finale-end"
            className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-40">
            <Square className="h-4 w-4" aria-hidden="true" /> {busy === "end" ? "Schalte …" : "Ende"}
          </button>
          {last ? <span className="text-xs text-white/55" data-testid="tv-finale-last">Letzte Liga N – mit „Ende“ zurück zum gewohnten Bild.</span> : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-white/55" data-testid="tv-finale-readonly">Weiter und Ende drückt, wer für diese Liga „Spiele betreuen“ hat.</p>
      )}
    </FormSection>
  );
}
