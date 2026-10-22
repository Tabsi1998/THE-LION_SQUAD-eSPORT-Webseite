import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { KIND_OPTIONS } from "@/lib/referenceSeries";
import { SEASON_NOTE_TONES } from "@/lib/seriesTiers";
import { dayNoon, viennaDate, viennaDateTime } from "@/lib/vienna";
import {
  HINT_LABELS, VISIBILITY_LABELS, WARN_HINTS, bundleSummary, initialSelection, previewPath, selectedHints, selectedSeasons,
  seasonText, undoText,
} from "@/lib/referenceBundles";
import { AlertTriangle, Info, Undo2 } from "lucide-react";
import { toast } from "sonner";

// Referenzen bündeln (#1751): der Assistent schlägt aus Referenzen ohne Saison Gruppen vor (Veranstalter bzw. Partner,
// Spiel, Modus, Bezeichnung). Je Gruppe die Vorschau - Spur vorhanden oder neu, je Referenz ihre Saison, der Liga-Weg
// und Hinweise aus den Altdaten. „Bündeln“ legt Spur und Saisons an bzw. wählt sie, verknüpft die Referenzen und macht
// nichts offener; „Rückgängig“ nimmt eine Bündelung zurück. Die Referenzen behalten ihre Adresse.

const KIND_LABELS = Object.fromEntries(KIND_OPTIONS);

function dayText(day) {
  const noon = day ? dayNoon(String(day).slice(0, 10)) : null;
  return noon ? viennaDate(noon, { day: "2-digit", month: "2-digit", year: "numeric" }) : "ohne Datum";
}

export function ReferenceBundleSheet({ onClose, onDone }) {
  const [proposals, setProposals] = useState(null);
  const [bundles, setBundles] = useState([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [{ data }, listed] = await Promise.all([
        api.get("/reference-series/admin/bundles/proposals"),
        api.get("/reference-series/admin/bundles"),
      ]);
      setProposals(data || { groups: [], unlinked: 0 });
      setBundles(listed?.data?.items || []);
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const changed = () => { load(); onDone?.(); };
  const groups = proposals?.groups || [];

  return (
    <AdminSheet title="Referenzen bündeln" size="xl" onClose={onClose} cancelLabel="Schließen" testId="bundle-sheet">
      <p className="text-sm text-white/60 leading-relaxed max-w-[65ch]">
        Referenzen ohne Saison, die zusammengehören – gleicher Veranstalter, gleiches Spiel, gleicher Modus und gleiche Bezeichnung. Bündeln legt Spur und Saisons an oder wählt vorhandene. Neue Saisons bleiben leer: keine Termine, keine Ergebnisse, nur Status, Team und der Platz der Referenz. Sichtbarkeit wird nie geöffnet, Adressen der Referenzen bleiben.
      </p>
      {error && <p className="text-sm text-warn" role="alert" data-testid="bundle-error">{error}</p>}
      {!proposals && !error && <p className="text-sm text-white/50" data-testid="bundle-loading">Suche Gruppen …</p>}
      {proposals && groups.length === 0 && (
        <p className="border border-dashed border-white/15 rounded-sm p-4 text-sm text-white/50" data-testid="bundle-empty">
          Keine Gruppe offen. {proposals.unlinked > 0
            ? `${proposals.unlinked} ${proposals.unlinked === 1 ? "Referenz steht" : "Referenzen stehen"} ohne Saison allein – dafür braucht es keine Serie.`
            : "Jede Referenz gehört schon zu einer Saison."}
        </p>
      )}
      {groups.map((group) => <GroupCard key={group.key} group={group} onDone={changed} />)}
      {bundles.length > 0 && <BundleHistory bundles={bundles} onDone={changed} />}
    </AdminSheet>
  );
}

function GroupCard({ group, onDone }) {
  const [selected, setSelected] = useState(() => initialSelection(group));
  const [title, setTitle] = useState(group.lineage.title || "");
  const [kind, setKind] = useState(group.lineage.kind || "series");
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const { lineage } = group;
  const fresh = !lineage.id;
  const seasons = selectedSeasons(group, selected);
  const seasonOf = new Map(seasons.flatMap((season) => season.reference_ids.map((id) => [id, season])));
  const hints = selectedHints(group, selected);
  const path = previewPath(group, selected);
  const meta = [fresh ? "Neue Spur" : "Vorhandene Spur", KIND_LABELS[fresh ? kind : lineage.kind], lineage.organizer, lineage.label, lineage.game_name].filter(Boolean);

  const toggle = (id, on) => setSelected((current) => {
    const next = new Set(current);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const bundle = async () => {
    const name = fresh ? title.trim() : lineage.title;
    if (fresh && !name) {
      toast.error("Bitte einen Titel für die neue Spur eingeben.");
      return;
    }
    if (!await confirm({
      title: `${selected.size} ${selected.size === 1 ? "Referenz" : "Referenzen"} bündeln?`,
      description: `Spur „${name}“ – ${bundleSummary(group, selected)}. Lässt sich rückgängig machen.`,
      confirmLabel: "Bündeln",
    })) return;
    setSaving(true);
    try {
      const body = { group_key: group.key, reference_ids: group.references.map((ref) => ref.id).filter((id) => selected.has(id)) };
      if (fresh) Object.assign(body, { lineage_title: name, lineage_kind: kind });
      const { data } = await api.post("/reference-series/admin/bundles", body);
      toast.success(`${data?.linked ?? selected.size} ${data?.linked === 1 ? "Referenz" : "Referenzen"} gebündelt.`);
      onDone();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4 space-y-4" aria-labelledby={`bundle-title-${group.key}`} data-testid="bundle-group">
      <div className="min-w-0">
        <div className="flex items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-widest text-white/45 font-bold flex-wrap">
          {meta.map((part, index) => <span key={part} className={index === 0 ? (fresh ? "text-[#29B6E8]" : "text-ok") : ""}>{part}</span>)}
        </div>
        <h3 id={`bundle-title-${group.key}`} className="mt-1 font-heading text-xl font-black uppercase leading-tight break-words [overflow-wrap:anywhere]" data-testid="bundle-lineage-title">
          {fresh ? (title || "Neue Spur") : lineage.title}
        </h3>
      </div>

      {fresh && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <TextField label="Titel der Spur" value={title} onChange={setTitle} maxLength={160} testId="bundle-lineage-input" />
          <SelectField label="Art" value={kind} onChange={setKind} options={KIND_OPTIONS} testId="bundle-lineage-kind" />
        </div>
      )}

      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Referenzen</h4>
        <ul className="divide-y divide-white/5 border-y border-white/5">
          {group.references.map((ref) => {
            const season = seasonOf.get(ref.id);
            return (
              <li key={ref.id} className="py-2" data-testid={`bundle-ref-${ref.id}`}>
                <CheckField checked={selected.has(ref.id)} onChange={(on) => toggle(ref.id, on)} testId={`bundle-pick-${ref.id}`}
                  label={<span className="font-bold text-white break-words [overflow-wrap:anywhere]">{ref.title}</span>}
                  hint={[
                    dayText(ref.start_date),
                    ref.placement ? `Platz ${ref.placement}` : "",
                    season ? `→ ${seasonText(season)} (${season.id ? "vorhanden" : "neu"})` : "",
                    ref.visibility && ref.visibility !== "public" ? VISIBILITY_LABELS[ref.visibility] : "",
                  ].filter(Boolean).join(" · ")} />
              </li>
            );
          })}
        </ul>
      </div>

      {path.steps.length > 0 && (
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Liga-Weg</h4>
          <ol className="list-none m-0 p-0 grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Liga-Weg der Vorschau" data-testid="bundle-path">
            {path.steps.map((step) => <PathStep key={step.key} step={step} kind={fresh ? kind : lineage.kind} />)}
          </ol>
        </div>
      )}

      {hints.length > 0 && (
        <div>
          <h4 className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Hinweise aus den Altdaten</h4>
          <ul className="space-y-1.5" data-testid="bundle-hints">
            {hints.map((hint) => {
              const warn = WARN_HINTS.has(hint.code);
              const Icon = warn ? AlertTriangle : Info;
              return (
                <li key={`${hint.code}-${hint.reference_ids.join("-")}`} className={`flex items-start gap-2 text-sm ${warn ? "text-warn" : "text-white/65"}`} data-testid={`bundle-hint-${hint.code}`}>
                  <Icon className="w-3.5 h-3.5 mt-[3px] shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]"><span className="font-bold">{HINT_LABELS[hint.code] || hint.code}:</span> {hint.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <span className="text-sm text-white/55 tabular-nums" data-testid="bundle-summary">{bundleSummary(group, selected)}</span>
        <button type="button" onClick={bundle} disabled={saving || selected.size === 0} data-testid="bundle-confirm"
          className="tls-btn tls-btn--primary px-5 py-2.5 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          {saving ? "Bündle …" : "Bündeln"}
        </button>
      </div>
    </section>
  );
}

function PathStep({ step, kind }) {
  const place = step.club?.rank;
  return (
    <li className="min-w-0 flex flex-col gap-1 p-2.5 rounded-sm border border-white/[0.07] bg-[#0A0A0A]" data-testid="bundle-step">
      <span className="text-[11px] text-white/50 break-words [overflow-wrap:anywhere]">{step.season}{step.id ? "" : " · neu"}</span>
      <span className="font-bold text-sm text-white break-words [overflow-wrap:anywhere]">{step.tier || (kind === "team_league" ? "Liga" : "Gesamt")}</span>
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <span className={`font-display font-bold text-xl leading-none tabular-nums ${place === 1 ? "text-honor" : "text-white"}`}>{place ? `${place}.` : "–"}</span>
        {step.note && <span className={`text-[10px] font-bold uppercase tracking-[0.06em] ${SEASON_NOTE_TONES[step.note] || "text-white/50"}`}>{step.note}</span>}
      </span>
    </li>
  );
}

function BundleHistory({ bundles, onDone }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState("");

  const undo = async (item) => {
    if (!await confirm({
      title: "Bündelung zurücknehmen?",
      description: `Die ${item.linked} ${item.linked === 1 ? "Referenz wird" : "Referenzen werden"} gelöst. Neu angelegte Saisons und die Spur verschwinden nur, wenn sie seitdem unverändert sind.`,
      confirmLabel: "Zurücknehmen",
    })) return;
    setBusy(item.id);
    try {
      const { data } = await api.post(`/reference-series/admin/bundles/${item.id}/undo`);
      toast.success(`Zurückgenommen: ${undoText(data)}.`);
      onDone();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy("");
    }
  };

  return (
    <section aria-labelledby="bundle-history-title" data-testid="bundle-history">
      <h3 id="bundle-history-title" className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Zuletzt gebündelt</h3>
      <ul className="divide-y divide-white/5 border-y border-white/5">
        {bundles.map((item) => (
          <li key={item.id} className="py-2 flex items-center justify-between gap-3" data-testid={`bundle-history-${item.id}`}>
            <span className="min-w-0">
              <span className="block font-bold text-white break-words [overflow-wrap:anywhere]">{item.lineage_title}</span>
              <span className="block text-xs text-white/50 tabular-nums">
                {[`${item.linked} ${item.linked === 1 ? "Referenz" : "Referenzen"}`, item.created_at ? viennaDateTime(item.created_at, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "",
                  item.status === "undone" ? "zurückgenommen" : ""].filter(Boolean).join(" · ")}
              </span>
            </span>
            {item.status === "active" && (
              <button type="button" onClick={() => undo(item)} disabled={busy === item.id} data-testid={`bundle-undo-${item.id}`}
                className="tls-btn tls-btn--secondary shrink-0 px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50">
                <Undo2 className="w-3.5 h-3.5" aria-hidden="true" /> {busy === item.id ? "Nehme zurück …" : "Rückgängig"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
