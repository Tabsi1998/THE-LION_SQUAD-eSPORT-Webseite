// Vorgabe der Woche (#2326, docs/LIGA.md D.3): je Spielwoche und Modus eine Map aus dem Pool - für jeden Schritt „Vorgabe“ der
// gespeicherten Veto-Vorlage. „Rotiert automatisch durch den Pool“ füllt alle Wochen als Vorschlag, danach ist jede Woche einzeln
// änderbar; fehlende Wochen stehen oben und sind in der Liste markiert. Eigenes Speichern mit Protokoll; eine Änderung gilt nur für
// Spiele, deren Veto noch nicht begonnen hat. Steht im Kasten „Veto“ der Season (SeasonVetoRulesPanel).
import { useEffect, useMemo, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { applyRotation, knownPresets, missingWeeks, presetChangeLine, presetValue, presetsPayload, presetsToForm, weekDates, weekList, withPreset } from "@/lib/leagueVeto";
import { viennaDateTime } from "@/lib/vienna";

// „10.11.2026, 19:30“ - ohne Sekunden.
const WHEN = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };
const FIELD = "min-h-11 w-full rounded-sm border bg-[#121212] px-2 py-1 text-sm text-white focus:border-[#29B6E8] focus:outline-none disabled:opacity-50";

function WeekRow({ row, modes, form, problems, onChange }) {
  const dates = weekDates(row);
  const open = modes.some(({ mode }) => !presetValue(form, row.week, mode));
  return (
    <li className={`rounded-sm border px-3 py-2 ${open ? "border-warn/40 bg-warn/5" : "border-white/10 bg-[#0A0A0A]"}`} data-testid={`veto-preset-week-${row.week}`} data-missing={open ? "true" : "false"}>
      {/* Am Handy steht die Woche über der Auswahl (eine Zeile: Woche, Tage, „fehlt“), am PC links daneben - so wird nichts abgeschnitten. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex flex-wrap items-baseline gap-x-2 sm:block sm:w-36 sm:shrink-0">
          <div className="text-sm font-bold text-white">Spielwoche {row.week}</div>
          <div className="text-xs tabular-nums text-white/55">{dates || "ohne Kalenderwoche"}{open ? <span className="ml-2 font-bold text-warn" data-testid={`veto-preset-week-${row.week}-missing`}>fehlt</span> : null}</div>
        </div>
        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
          {modes.map((mode) => (
            <label key={mode.mode} className="block min-w-0 text-xs text-white/60">
              {mode.label} · Map {mode.position}
              <select className={`${FIELD} mt-1 ${presetValue(form, row.week, mode.mode) ? "border-white/10" : "border-warn/50"}`} value={presetValue(form, row.week, mode.mode)}
                onChange={(event) => onChange(row.week, mode.mode, event.target.value)} data-testid={`veto-preset-${row.week}-${mode.mode}`}>
                <option value="">Noch nicht gewählt</option>
                {mode.maps.map((item) => <option key={item.map_id} value={item.map_id}>{item.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>
      {problems?.length ? <p className="mt-2 text-xs text-warn" data-testid={`veto-preset-week-${row.week}-problem`}>{problems.join(" ")}</p> : null}
    </li>
  );
}

export function SeasonVetoPresets({ seasonId, unsaved }) {
  const [state, setState] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.get(`/admin/leagues/seasons/${seasonId}/veto-presets`).then(({ data }) => {
      if (!alive || !Array.isArray(data?.weeks)) return;
      setState(data);
      setForm(presetsToForm(knownPresets(data.presets, data.modes)));
    }).catch((failure) => alive && setError(formatApiError(failure.response?.data?.detail) || "Die Vorgaben der Woche konnten nicht geladen werden."));
    return () => { alive = false; };
  }, [seasonId]);

  const weeks = useMemo(() => state?.weeks || [], [state]);
  const modes = useMemo(() => state?.modes || [], [state]);
  const missing = useMemo(() => missingWeeks(form, weeks, modes), [form, weeks, modes]);
  const dirty = useMemo(() => JSON.stringify(presetsPayload(form, weeks, modes)) !== JSON.stringify(presetsPayload(presetsToForm(knownPresets(state?.presets, modes)), weeks, modes)), [form, weeks, modes, state]);
  // Was der Server an einer gespeicherten Vorgabe bemängelt (etwa eine Map, die nicht mehr im Pool steht) - solange nichts geändert ist.
  // Wochen ganz ohne Eintrag tragen schon das Wort „fehlt“.
  const stored = useMemo(() => new Set((state?.presets || []).map((row) => row.week)), [state]);
  const problemsOf = (week) => (dirty || !stored.has(week) ? [] : state?.problems?.find((row) => row.week === week)?.problems || []);

  const frame = "mt-2 space-y-3 rounded-sm border border-[#00D26A]/30 bg-[#00D26A]/[0.03] p-4";
  const title = <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#00D26A]">Vorgabe der Woche</h3>;
  if (!state) {
    return (
      <div className={frame} data-testid="veto-presets-box">
        {title}
        {error ? <p className="text-sm text-warn" role="alert" data-testid="veto-presets-error">{error}</p> : <p className="text-sm text-white/55">Lade …</p>}
      </div>
    );
  }
  if (!state.active || !modes.length) {
    return (
      <div className={frame} data-testid="veto-presets-box">
        {title}
        <p className="text-sm text-white/70" data-testid="veto-presets-save-first">
          Die Schrittfolge enthält eine Vorgabe. Sobald das Veto damit an und gespeichert ist, wählt ihr hier je Spielwoche die Map.
        </p>
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.put(`/admin/leagues/seasons/${seasonId}/veto-presets`, { presets: presetsPayload(form, weeks, modes) });
      setState(data);
      setForm(presetsToForm(knownPresets(data.presets, data.modes)));
      const started = Number(data.vetoes_started) || 0;
      toast.success(started ? `Vorgaben gespeichert – ${started === 1 ? "ein wartendes Veto hat" : `${started} wartende Vetos haben`} begonnen.` : "Vorgaben gespeichert.");
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Die Vorgaben konnten nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };
  const rotate = () => {
    setForm((current) => applyRotation(current, state.rotation));
    toast.success("Vorschlag eingetragen – jede Woche lässt sich noch ändern, gespeichert ist nichts.");
  };

  return (
    <div className={frame} data-testid="veto-presets-box">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {title}
        <button type="button" onClick={rotate} disabled={!state.rotation?.length} data-testid="veto-presets-rotate"
          className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Rotiert automatisch durch den Pool
        </button>
      </div>
      <p className="text-xs text-white/60">
        Je Spielwoche eine Map aus dem Pool des Modus. Sie gilt für alle Spiele dieses Spieltags – auch für ein verschobenes –, und niemand kann sie sperren oder wählen.
        Ohne Vorgabe beginnt das Veto in der Woche nicht; ihr bekommt dann einen Hinweis. Eine Änderung gilt nur für Spiele, deren Veto noch nicht begonnen hat.
      </p>
      {unsaved ? (
        <p className="rounded-sm border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-white/75" data-testid="veto-presets-template-unsaved">
          Die Schrittfolge oben ist geändert und noch nicht gespeichert – diese Liste zeigt den gespeicherten Stand.
        </p>
      ) : null}
      {missing.length ? (
        <p className="rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-white/85" data-testid="veto-presets-missing" aria-live="polite">
          <strong>Es {missing.length === 1 ? "fehlt" : "fehlen"} noch:</strong> Spielwoche {weekList(missing)}.
        </p>
      ) : <p className="text-xs text-ok" data-testid="veto-presets-complete">Jede Spielwoche hat ihre Vorgabe.</p>}
      <ol className="space-y-1.5" data-testid="veto-presets-weeks">
        {weeks.map((row) => (
          <WeekRow key={row.week} row={row} modes={modes} form={form} problems={problemsOf(row.week)}
            onChange={(week, mode, mapId) => setForm((current) => withPreset(current, week, mode, mapId))} />
        ))}
      </ol>
      {error ? <p className="text-sm text-warn" role="alert" data-testid="veto-presets-error">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={saving || !dirty} data-testid="veto-presets-save"
          className="tls-btn tls-btn--primary min-h-11 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          {saving ? "Speichere …" : "Vorgaben speichern"}
        </button>
        {dirty ? <span className="text-xs text-warn" data-testid="veto-presets-dirty">Noch nicht gespeichert.</span> : null}
      </div>
      {state.history?.length ? (
        <details className="text-xs text-white/60" data-testid="veto-presets-history">
          <summary className="tls-hit inline-flex cursor-pointer items-center gap-1.5 text-white/70"><History className="h-3.5 w-3.5" aria-hidden="true" /> Verlauf ({state.history.length} {state.history.length === 1 ? "Änderung" : "Änderungen"})</summary>
          <ol className="mt-2 space-y-2">
            {state.history.map((entry) => (
              <li key={entry.at} data-testid="veto-presets-history-entry">
                <div className="text-white/75">{viennaDateTime(entry.at, WHEN)} · {entry.by_name}</div>
                <ul className="mt-0.5 space-y-0.5 pl-3">
                  {entry.changes.map((change) => <li key={`${change.week}-${change.mode}`}>{presetChangeLine(change, modes)}</li>)}
                </ul>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}
