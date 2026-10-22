import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { SelectField } from "@/components/tls/FormFields";
import { dayLabel } from "@/lib/referenceCalendar";
import {
  PARTNER_STATES, applyBody, applySummary, changeLines, countsText, defaultSelection, isSelectable, sourceHost, targetText,
} from "@/lib/partnerSource";
import { UnknownNamesSheet } from "./UnknownNamesSheet";
import { toast } from "sonner";
import { CloudDownload, Pencil } from "lucide-react";

// Partner-Plattform der Saison (#1964, nur Vorstand): Turniertage mit Runden, Lobbys und Punkten von der Plattform des
// Partners holen. Die Quelle (Plattform, Adresse nur aus der festen Liste, Serie beim Partner, Partner für den Hinweis
// „Daten von …“ auf der Serienseite) steht hier. „Jetzt holen“ zeigt je Turnier, was Übernehmen täte - geschrieben wird
// erst mit „Übernehmen“, immer als Entwurf. Ein Blatt mit Abweichungen hakt der Vorstand selbst an; ein Fehler der
// Quelle steht nur hier im Abschnitt.

function emptyForm(source, partners) {
  const organizer = partners.find((partner) => partner.role === "organizer");
  return {
    platform: source?.platform || "",
    base_url: source?.base_url || "",
    series_ref: source?.series_ref || "",
    series_name: source?.series_name || "",
    partner_id: source ? source.partner_id || "" : organizer?.id || "",
  };
}

function SourceForm({ url, state, onSaved, onCancel }) {
  const { source, choices, partners } = state;
  const [form, setForm] = useState(() => emptyForm(source, partners));
  const [seriesList, setSeriesList] = useState(null);
  const [listError, setListError] = useState("");
  const [saving, setSaving] = useState(false);
  const platform = choices.find((choice) => choice.key === form.platform);

  const setPlatform = (key) => {
    const chosen = choices.find((choice) => choice.key === key);
    setForm((current) => ({ ...current, platform: key, base_url: chosen ? chosen.base_urls[0] : "", series_ref: "", series_name: "" }));
  };

  useEffect(() => {
    if (!form.platform || !form.base_url) {
      setSeriesList(null);
      return undefined;
    }
    let active = true;
    setListError("");
    api.get(`${url}/series`, { params: { platform: form.platform, base_url: form.base_url } })
      .then(({ data }) => { if (active) setSeriesList(data.items || []); })
      .catch((err) => { if (active) { setSeriesList([]); setListError(formatApiError(err.response?.data?.detail) || "Serien nicht geladen."); } });
    return () => { active = false; };
  }, [url, form.platform, form.base_url]);

  const seriesOptions = useMemo(() => {
    const listed = (seriesList || []).map((item) => [item.ref, item.season && !item.name.includes(item.season) ? `${item.name} (${item.season})` : item.name]);
    if (form.series_ref && !listed.some(([ref]) => ref === form.series_ref)) listed.unshift([form.series_ref, form.series_name || `Serie ${form.series_ref}`]);
    return [["", seriesList ? "Serie wählen …" : "Lädt …"], ...listed];
  }, [seriesList, form.series_ref, form.series_name]);

  const pickSeries = (ref) => {
    const found = (seriesList || []).find((item) => item.ref === ref);
    setForm((current) => ({ ...current, series_ref: ref, series_name: found ? found.name : current.series_name }));
  };

  const ready = !form.platform || (form.base_url && form.series_ref);
  const save = async () => {
    setSaving(true);
    try {
      const body = form.platform
        ? { platform: form.platform, base_url: form.base_url, series_ref: form.series_ref, series_name: form.series_name || null, partner_id: form.partner_id || null }
        : { platform: null };
      const { data } = await api.put(url, body);
      toast.success(data.source ? "Quelle gespeichert." : "Partner-Plattform abgeschaltet.");
      onSaved(data.source);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 space-y-3" data-testid="partner-source-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Plattform" value={form.platform} onChange={setPlatform} testId="partner-source-platform"
          options={[["", "Keine – Ergebnisse nur von Hand"], ...choices.map((choice) => [choice.key, `${choice.label} (${choice.provider})`])]} />
        <SelectField label="Adresse" value={form.base_url} onChange={(value) => setForm((current) => ({ ...current, base_url: value, series_ref: "" }))}
          disabled={!platform} testId="partner-source-base" hint="Nur Adressen aus der festen Liste der Website."
          options={platform ? platform.base_urls.map((base) => [base, sourceHost(base)]) : [["", "–"]]} />
        <SelectField label="Serie beim Partner" value={form.series_ref} onChange={pickSeries} disabled={!platform}
          testId="partner-source-series" options={seriesOptions} />
        <SelectField label="Hinweis „Daten von …“ verlinkt" value={form.partner_id} onChange={(value) => setForm((current) => ({ ...current, partner_id: value }))}
          disabled={!platform} testId="partner-source-partner" hint="Partner dieser Saison – ohne Partner verlinkt der Hinweis die Plattform."
          options={[["", "Ohne Partner – Link zur Plattform"], ...partners.map((partner) => [partner.id, partner.role === "organizer" ? `${partner.name} (Veranstalter)` : partner.name])]} />
      </div>
      {listError && <p className="text-sm text-amber-200" role="alert" data-testid="partner-source-list-error">{listError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={!ready || saving} data-testid="partner-source-save"
          className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          Quelle speichern
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} data-testid="partner-source-cancel"
            className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
            Abbrechen
          </button>
        )}
      </div>
    </div>
  );
}

function PreviewItem({ item, picked, onToggle }) {
  const state = PARTNER_STATES[item.state] || PARTNER_STATES.error;
  const lines = changeLines(item.changes);
  const unknown = (item.unknown_names || []).length;
  const counts = [countsText(item.counts), unknown ? `${unknown} ${unknown === 1 ? "unbekannter Name" : "unbekannte Namen"}` : ""].filter(Boolean).join(" · ");
  const problems = item.error ? [item.error] : (item.errors || []).map((problem) => problem.message);
  const selectable = isSelectable(item);
  return (
    <li className="py-3 flex items-start gap-3" data-testid="partner-item" data-state={item.state}>
      <span className="w-5 shrink-0 pt-0.5">
        {selectable && (
          <input type="checkbox" checked={picked} onChange={() => onToggle(item.ref)} data-testid="partner-item-pick"
            aria-label={`${item.name} übernehmen`} style={{ accentColor: "#29B6E8" }} className="h-4 w-4" />
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm font-bold tabular-nums text-white">{dayLabel(item.club_day) || "Tag offen"}</span>
          <span className="text-sm text-white/80 break-words [overflow-wrap:anywhere]">{item.name}</span>
          {item.double_up && <span className="inline-flex px-1.5 py-0.5 border border-white/15 rounded-sm text-[10px] font-bold uppercase tracking-widest text-white/70">Double Up</span>}
          <span className={`inline-flex px-1.5 py-0.5 border rounded-sm text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${state.tone}`}>{state.label}</span>
        </div>
        <div className="text-xs text-white/60">{targetText(item)}</div>
        {counts && <div className="text-xs text-white/45 tabular-nums">{counts}</div>}
        {problems.length > 0 && (
          <ul className="text-xs text-red-200 space-y-0.5" data-testid="partner-item-problems">
            {problems.map((text, index) => <li key={index}>{text}</li>)}
          </ul>
        )}
        {lines.length > 0 && (
          <details className="text-xs text-white/70" data-testid="partner-item-changes">
            <summary className="cursor-pointer text-white/60 hover:text-white">Abweichungen ansehen ({lines.length})</summary>
            <ul className="mt-1.5 space-y-1 border-l border-white/10 pl-3">
              {lines.map((line) => (
                <li key={line.key}><span className="font-semibold text-white">{line.name}</span>: {line.text}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

export function SeriesPartnerSourceSection({ series, onChanged }) {
  const url = `/reference-series/admin/series/${series.id}/partner-source`;
  const [state, setState] = useState(null);
  const [failed, setFailed] = useState("");
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [fetchError, setFetchError] = useState("");
  const [busy, setBusy] = useState("");
  const [picked, setPicked] = useState([]);
  const [unknownOpen, setUnknownOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(url);
      setState({ source: data.source || null, choices: data.choices || [], partners: data.partners || [] });
      setFailed("");
    } catch (err) {
      setFailed(formatApiError(err.response?.data?.detail) || "Partner-Plattform nicht geladen.");
    }
  }, [url]);
  useEffect(() => { load(); }, [load]);

  const fetchNow = useCallback(async () => {
    setBusy("fetch");
    setFetchError("");
    try {
      // Die Vorschau schreibt nichts - sie soll die übrigen Abschnitte nicht neu laden lassen.
      const { data } = await api.post(`${url}/preview`, null, { skipInvalidation: true });
      setPreview(data.items || []);
      setPicked(defaultSelection(data.items || []));
    } catch (err) {
      setPreview(null);
      setFetchError(formatApiError(err.response?.data?.detail) || "Die Partner-Plattform konnte nicht abgefragt werden.");
    } finally {
      setBusy("");
    }
  }, [url]);

  const toggle = (ref) => setPicked((current) => (current.includes(ref) ? current.filter((item) => item !== ref) : [...current, ref]));

  const apply = async () => {
    setBusy("apply");
    try {
      const { data } = await api.post(`${url}/apply`, applyBody(preview, picked));
      const summary = applySummary(data.items || []);
      (summary.ok ? toast.success : toast.error)(summary.text);
      onChanged?.();
      if (data.open_unknown) setUnknownOpen(true);
      await fetchNow();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy("");
    }
  };

  const source = state?.source;
  const choice = state?.choices.find((item) => item.key === source?.platform);
  const partner = state?.partners.find((item) => item.id === source?.partner_id);
  const selectedCount = (preview || []).filter((item) => picked.includes(item.ref) && isSelectable(item)).length;
  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" aria-labelledby="series-partner-source-heading" data-testid="series-partner-source">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="series-partner-source-heading" className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Partner-Plattform</h2>
          <p className="mt-1 text-sm text-white/60">Turniertage mit Runden, Lobbys und Punkten von der Plattform des Partners holen – als Entwurf, veröffentlicht wird nichts.</p>
        </div>
        {source && !editing && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={fetchNow} disabled={Boolean(busy)} data-testid="partner-source-fetch"
              className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-50">
              <CloudDownload className="w-3.5 h-3.5" aria-hidden="true" /> {busy === "fetch" ? "Holt …" : "Jetzt holen"}
            </button>
            <button type="button" onClick={() => setEditing(true)} disabled={Boolean(busy)} data-testid="partner-source-edit"
              className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-50">
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Quelle ändern
            </button>
          </div>
        )}
      </div>
      {failed && <p className="mt-3 text-sm text-white/60" role="alert">{failed}</p>}
      {state && source && !editing && (
        <p className="mt-3 text-sm text-white/75 break-words" data-testid="partner-source-summary">
          {[choice?.label || source.platform, sourceHost(source.base_url), `Serie ${source.series_name || source.series_ref}`].join(" · ")}
          <span className="block text-xs text-white/45 mt-0.5">Serienseite: „Daten von {partner?.name || choice?.provider || "Partner"}“{partner ? " mit Link zur Partnerseite" : " mit Link zur Plattform"}</span>
        </p>
      )}
      {state && (!source || editing) && (
        <SourceForm key={source ? `${source.platform}-${source.series_ref}` : "neu"} url={url} state={state} onCancel={source ? () => setEditing(false) : null}
          onSaved={(saved) => { setState((current) => ({ ...current, source: saved })); setEditing(false); setPreview(null); }} />
      )}
      {fetchError && (
        <p className="mt-3 border border-red-400/40 bg-red-400/10 rounded-sm px-3 py-2 text-sm text-red-100" role="alert" data-testid="partner-source-error">{fetchError}</p>
      )}
      {preview && !editing && (
        <div className="mt-4" data-testid="partner-source-preview">
          {preview.length === 0 ? (
            <p className="text-sm text-white/55" data-testid="partner-source-empty">Beim Partner stehen in dieser Serie noch keine Turniere.</p>
          ) : (
            <ol className="divide-y divide-white/5 border-y border-white/10">
              {preview.map((item) => <PreviewItem key={item.ref} item={item} picked={picked.includes(item.ref)} onToggle={toggle} />)}
            </ol>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={apply} disabled={!selectedCount || Boolean(busy)} data-testid="partner-source-apply"
              className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
              {busy === "apply" ? "Übernimmt …" : `Übernehmen (${selectedCount})`}
            </button>
            <span className="text-xs text-white/50">Ergebnisse kommen als Entwurf. Ein vorhandenes Ergebnis wird nur ersetzt, wenn du es anhakst – ein veröffentlichtes bekommt einen Entwurf daneben.</span>
          </div>
        </div>
      )}
      {unknownOpen && <UnknownNamesSheet series={series} onClose={() => setUnknownOpen(false)} onChanged={onChanged} />}
    </section>
  );
}
