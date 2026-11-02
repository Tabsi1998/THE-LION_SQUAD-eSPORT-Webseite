// Regelwerk pflegen (docs/LIGA.md, #1646) unter /admin/leagues/rules/<league|league_season>/<id>: Entwurf in Markdown mit Anlagen und
// Bausteinen, Vorschau wie auf der Seite, Veröffentlichen mit Gültig-ab und Grund. Eine veröffentlichte Fassung ändert niemand mehr; ändern sich
// Daten eines Bausteins, schlägt die Seite eine neue Version vor, ohne etwas zu veröffentlichen.
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { API, api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { FormSection } from "@/components/tls/AdminForm";
import { CheckField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { RuleOps, RulesChanges, RulesDocument } from "@/components/tls/league/rules/RulesDocument";
import { addAnnex, annexLabel, dayLabel, insertBlock, moveAnnex, removeAnnex, rulesApiPath } from "@/lib/leagueRules";
import { viennaDate } from "@/lib/vienna";

const LONG_DAY = { day: "2-digit", month: "2-digit", year: "numeric" };
const QUIET = "tls-btn tls-btn--quiet inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50";
const PRIMARY = "tls-btn tls-btn--primary inline-flex items-center gap-1.5 rounded-sm px-4 py-2 text-[11px] font-black uppercase tracking-wider disabled:opacity-50";
const REASON_MIN = 5;
const ICON_BUTTON = "p-1.5 text-white/60 hover:text-[#29B6E8] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm disabled:opacity-30";

function formOf(draft) {
  return { title: draft?.title || "", body_md: draft?.body_md || "", annexes: (draft?.annexes || []).map(({ title, body_md }) => ({ title: title || "", body_md: body_md || "" })) };
}

function DataChanges({ changes, hasDraft, busy, onPrepare }) {
  return (
    <section className="mb-6 rounded-sm border border-warn/30 bg-warn/5 p-4" data-testid="rules-data-changes" aria-label="Daten geändert">
      <h2 className="font-bold text-warn">Daten geändert, neue Version vorbereiten</h2>
      <p className="mt-1 text-sm text-white/75">
        {changes.label} zeigt die Listen von damals. Das bleibt so, bis du eine neue Version veröffentlichst. Von selbst geht nichts raus.
      </p>
      <div className="mt-3 space-y-3">
        {changes.rows.map((row) => (
          <div key={`${row.season_id}-${row.block}`} className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3">
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-white/70">
              {row.label} · {row.season_name}{row.status === "missing" ? " · noch nicht festgehalten" : ""}
            </p>
            <div className="tls-rules"><RuleOps ops={row.ops} /></div>
          </div>
        ))}
      </div>
      {hasDraft ? (
        <p className="mt-3 text-sm text-white/75">Der Entwurf unten nimmt beim Veröffentlichen den neuen Stand.</p>
      ) : (
        <button type="button" className={`${PRIMARY} mt-3`} disabled={busy} onClick={onPrepare} data-testid="rules-prepare">Neue Version vorbereiten</button>
      )}
    </section>
  );
}

function Versions({ view }) {
  const base = rulesApiPath(view.league.slug, view.season?.slug);
  return (
    <FormSection title="Veröffentlichte Fassungen" hint="Unveränderlich. Jede bleibt mit Grund und PDF abrufbar." testId="rules-versions">
      <ul className="divide-y divide-white/5">
        {view.versions.map((row) => (
          <li key={row.id} className="py-3" data-testid={`rules-version-${row.version}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-white">
                {row.label}{row.is_current ? " · gilt" : ""}
                <span className="ml-2 font-normal text-white/60">gültig ab {dayLabel(row.valid_from)} · veröffentlicht {viennaDate(row.published_at, LONG_DAY)}</span>
              </span>
              <span className="flex gap-2">
                <a className={QUIET} href={`${view.public_url}?version=${row.id}`} target="_blank" rel="noopener noreferrer">Seite <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
                <a className={QUIET} href={`${API}${base}/versions/${row.id}/pdf`} target="_blank" rel="noopener noreferrer">PDF</a>
              </span>
            </div>
            <p className="mt-1 break-words text-sm text-white/70">{row.change_reason}</p>
          </li>
        ))}
      </ul>
    </FormSection>
  );
}

function Consents({ consents }) {
  return (
    <FormSection title={`Zustimmungen zu ${consents.label}`} hint="Wer fehlt, sieht einen Hinweis. Ein Spiel läuft trotzdem weiter." testId="rules-consents">
      {consents.rows.length ? (
        <ul className="divide-y divide-white/5">
          {consents.rows.map((row) => (
            <li key={row.squad_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid={`rules-consent-row-${row.squad_id}`}>
              <span className="min-w-0 break-words text-white">{row.team_name || row.squad_name}</span>
              <span className={row.agreed ? "text-white/70" : "font-semibold text-warn"}>
                {row.agreed ? `zugestimmt am ${viennaDate(row.agreed_at, LONG_DAY)}${row.agreed_by ? ` von ${row.agreed_by}` : ""}` : "offen"}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-white/60">Es ist noch kein Co-Team zugeteilt.</p>}
    </FormSection>
  );
}

export default function AdminLeagueRulesPage() {
  const { scope, scopeId } = useParams();
  const confirm = useConfirm();
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(formOf(null));
  const [revision, setRevision] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [publish, setPublish] = useState({ valid_from: "", change_reason: "", requires_consent: false });
  const base = `/admin/league-rules/${scope}/${scopeId}`;

  const applyDraft = useCallback((draft) => {
    setEditing(!!draft);
    setForm(formOf(draft));
    setRevision(draft?.revision ?? null);
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(base);
      setView(data);
      setError(null);
      applyDraft(data.draft);
      setPublish((value) => ({ ...value, valid_from: value.valid_from || data.today || "" }));
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  }, [applyDraft, base]);
  useEffect(() => { load(); }, [load]);

  const change = (patch) => {
    setForm((value) => ({ ...value, ...patch }));
    setDirty(true);
  };
  const changeAnnex = (index, patch) => change({ annexes: form.annexes.map((row, position) => (position === index ? { ...row, ...patch } : row)) });

  const save = async () => {
    const { data } = await api.put(`${base}/draft`, { ...form, ...(revision ? { revision } : {}) });
    setRevision(data.revision);
    setDirty(false);
    return data;
  };
  const run = async (work) => {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };
  const onSave = () => run(async () => { await save(); toast.success("Entwurf gespeichert."); });
  const onPreview = () => run(async () => { const { data } = await api.post(`${base}/preview`, form); setPreview(data); });
  const onPrepare = () => run(async () => { await api.post(`${base}/draft/from-version`, {}); toast.success("Entwurf vorbereitet."); await load(); });
  const onDiscard = () => run(async () => {
    if (!await confirm({ title: "Entwurf verwerfen?", description: "Der Text des Entwurfs ist danach weg. Veröffentlichte Fassungen bleiben.", confirmLabel: "Verwerfen" })) return;
    await api.delete(`${base}/draft`);
    setPreview(null);
    await load();
  });
  const onPublish = () => run(async () => {
    if (!await confirm({ title: "Version veröffentlichen?", description: "Danach lässt sie sich nicht mehr ändern. Bausteine werden mit dem heutigen Stand eingefroren.", confirmLabel: "Veröffentlichen" })) return;
    const current = dirty || !revision ? (await save()).revision : revision;
    await api.post(`${base}/publish`, { revision: current, ...publish });
    toast.success("Version veröffentlicht.");
    setPublish((value) => ({ ...value, change_reason: "", requires_consent: false }));
    setPreview(null);
    await load();
  });

  const back = view?.season ? `/admin/leagues/seasons/${view.season.id}` : "/admin/leagues";
  const canPublish = publish.change_reason.trim().length >= REASON_MIN && publish.valid_from && !busy;
  return (
    <AdminLayout>
      <Link to={back} data-testid="rules-back" className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/50 hover:text-[#29B6E8]">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {view?.season ? view.season.name : "Liga"}
      </Link>
      {error ? <p role="alert" className="mt-6 text-sm text-warn">{error}</p> : null}
      {view ? (
        <>
          <div className="mb-6 mt-3 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-heading text-3xl font-black uppercase break-words md:text-4xl">Regelwerk</h1>
              <p className="mt-1 text-sm text-white/60">
                {view.league.name}{view.season ? ` · ${view.season.name}` : " · liga-weit, gilt für jede Season ohne eigenes"}
              </p>
            </div>
            <a href={view.public_url} target="_blank" rel="noopener noreferrer" className={QUIET} data-testid="rules-open-page">Seite öffnen <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
          </div>

          {view.data_changes ? <DataChanges changes={view.data_changes} hasDraft={!!view.draft || editing} busy={busy} onPrepare={onPrepare} /> : null}

          {view.inherited && !editing ? (
            <section className="mb-6 rounded-sm border border-white/10 bg-[#121212] p-4" data-testid="rules-inherited">
              <p className="text-sm text-white/85">Diese Season nutzt {view.inherited.label}, solange sie kein eigenes hat.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link className={QUIET} to={`/admin/leagues/rules/league/${view.league.id}`}>Regelwerk der Liga</Link>
                <button type="button" className={QUIET} disabled={busy} onClick={onPrepare}>Eigenes Regelwerk anlegen</button>
              </div>
            </section>
          ) : null}

          <div className="space-y-6">
            {!editing && !view.inherited ? (
              <FormSection title="Entwurf" hint="Es gibt gerade keinen Entwurf.">
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={PRIMARY} onClick={() => setEditing(true)} data-testid="rules-new-draft"><Plus className="h-3.5 w-3.5" aria-hidden="true" /> Neuen Entwurf beginnen</button>
                  {view.versions.length && !view.data_changes ? <button type="button" className={QUIET} disabled={busy} onClick={onPrepare} data-testid="rules-from-latest">Aus letzter Fassung</button> : null}
                </div>
              </FormSection>
            ) : null}

            {editing ? (
              <>
                <FormSection title="Entwurf" hint="Jede Überschrift wird ein Abschnitt mit eigenem Link. Bleibt sie gleich, bleibt auch der Link." testId="rules-draft">
                  <TextField label="Titel" value={form.title} onChange={(value) => change({ title: value })} maxLength={160} placeholder="Regelwerk der Liga" testId="rules-title" />
                  <div>
                    <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-white/60">Baustein einfügen</p>
                    <div className="flex flex-wrap gap-2">
                      {view.blocks.map((block) => (
                        <button key={block.key} type="button" title={block.hint} className={QUIET} data-testid={`rules-block-${block.key}`}
                          onClick={() => change({ body_md: insertBlock(form.body_md, block.token) })}>{block.label}</button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-xs text-white/50">Der Inhalt kommt aus den Daten der Season und wird beim Veröffentlichen eingefroren.</p>
                  </div>
                  <MarkdownEditor value={form.body_md} onChange={(value) => change({ body_md: value })} testId="rules-body" rows={18} mentionsEnabled={false}
                    placeholder="# § 1 Geltung" helperText="Markdown. Rohes HTML wird nicht übernommen." />
                </FormSection>

                <FormSection title="Anlagen" hint="Eigene Abschnitte im Inhaltsverzeichnis und im PDF. Der Buchstabe folgt der Reihenfolge." testId="rules-annexes">
                  {form.annexes.map((annex, index) => (
                    // Anlagen haben keine eigene Kennung, die Reihenfolge ist ihr Schlüssel.
                    <div key={index} className="rounded-sm border border-white/10 p-3" data-testid={`rules-annex-${index}`}>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-white">{annexLabel(index)}</span>
                        <span className="flex gap-1">
                          <button type="button" className={ICON_BUTTON} aria-label={`${annexLabel(index)} nach oben`} disabled={index === 0} onClick={() => change({ annexes: moveAnnex(form.annexes, index, -1) })}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
                          <button type="button" className={ICON_BUTTON} aria-label={`${annexLabel(index)} nach unten`} disabled={index === form.annexes.length - 1} onClick={() => change({ annexes: moveAnnex(form.annexes, index, 1) })}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
                          <button type="button" className={ICON_BUTTON} aria-label={`${annexLabel(index)} entfernen`} onClick={() => change({ annexes: removeAnnex(form.annexes, index) })}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                        </span>
                      </div>
                      <div className="space-y-3">
                        <TextField label="Titel der Anlage" value={annex.title} onChange={(value) => changeAnnex(index, { title: value })} maxLength={160} testId={`rules-annex-title-${index}`} />
                        <MarkdownEditor value={annex.body_md} onChange={(value) => changeAnnex(index, { body_md: value })} testId={`rules-annex-body-${index}`} rows={8} mentionsEnabled={false}
                          helperText="Markdown wie im Haupttext, auch mit Bausteinen." />
                      </div>
                    </div>
                  ))}
                  <button type="button" className={QUIET} onClick={() => change({ annexes: addAnnex(form.annexes) })} data-testid="rules-annex-add"><Plus className="h-3.5 w-3.5" aria-hidden="true" /> Anlage hinzufügen</button>
                </FormSection>

                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={PRIMARY} disabled={busy} onClick={onSave} data-testid="rules-save">Entwurf speichern</button>
                  <button type="button" className={QUIET} disabled={busy} onClick={onPreview} data-testid="rules-preview">Vorschau</button>
                  {view.draft ? (
                    <button type="button" disabled={busy} onClick={onDiscard} data-testid="rules-discard" className="tls-btn tls-btn--danger rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">Verwerfen</button>
                  ) : null}
                  {dirty ? <span className="text-xs text-white/60" role="status">Nicht gespeichert</span> : null}
                </div>

                {preview ? (
                  <section className="tls-rules rounded-sm border border-white/10 bg-[#0A0A0A] p-4 md:p-6" data-testid="rules-preview-panel" aria-label="Vorschau">
                    <p className="mb-4 text-xs font-bold uppercase tracking-wider text-white/60">Vorschau mit den Daten von heute</p>
                    {preview.unknown_blocks?.length ? (
                      <p role="alert" className="mb-4 text-sm text-warn">Unbekannter Baustein: {preview.unknown_blocks.join(", ")}. So lässt sich nichts veröffentlichen.</p>
                    ) : null}
                    <RulesChanges changes={preview.changes} versionLabel="dieser Fassung" testId="rules-preview-changes" />
                    <RulesDocument sections={preview.sections} versionLabel="dieser Fassung" testId="rules-preview-document" />
                  </section>
                ) : null}

                <FormSection title="Veröffentlichen" hint="Danach lässt sich die Fassung nicht mehr ändern, sie gilt ab dem gewählten Tag." testId="rules-publish-section">
                  <TextField label="Gültig ab" type="date" value={publish.valid_from} min={view.today} onChange={(value) => setPublish((row) => ({ ...row, valid_from: value }))} testId="rules-valid-from" />
                  <TextAreaField label="Änderungsgrund" value={publish.change_reason} onChange={(value) => setPublish((row) => ({ ...row, change_reason: value }))} rows={2}
                    placeholder="Was sich ändert und warum" hint="Steht öffentlich bei der Fassung, mindestens fünf Zeichen." testId="rules-reason" />
                  <CheckField label="Captains müssen dieser Fassung neu zustimmen" checked={publish.requires_consent} onChange={(value) => setPublish((row) => ({ ...row, requires_consent: value }))}
                    hint="Fehlt die Zustimmung, gibt es eine Aufgabe auf der Startseite. Spiele laufen trotzdem weiter." testId="rules-requires-consent" />
                  <button type="button" className={PRIMARY} disabled={!canPublish} onClick={onPublish} data-testid="rules-publish">Version veröffentlichen</button>
                </FormSection>
              </>
            ) : null}

            {view.versions.length ? <Versions view={view} /> : null}
            {view.consents ? <Consents consents={view.consents} /> : null}
          </div>
        </>
      ) : null}
    </AdminLayout>
  );
}
