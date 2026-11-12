// Regelwerk pflegen (docs/LIGA.md, #1646) unter /admin/leagues/rules/<league|league_season>/<id>: Entwurf in Markdown mit Anlagen,
// Bausteinen und Variablen (#2269), Vorschau wie auf der Seite, Veröffentlichen mit Gültig-ab und Grund. Eine veröffentlichte Fassung
// ändert niemand mehr; ändern sich Einstellungen, die im Regelwerk stehen, zeigt die Seite „Regelwerk muss freigegeben werden“ mit dem
// Vorschlag der neuen Fassung und den markierten Unterschieden - die Leitung prüft, gibt frei und wählt, ob die Teams neu zustimmen.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, ExternalLink, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { API, api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { FormSection } from "@/components/tls/AdminForm";
import { CheckField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { MarkdownEditor, appendText } from "@/components/tls/MarkdownEditor";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { RuleOps, RulesChanges, RulesDocument } from "@/components/tls/league/rules/RulesDocument";
import {
  CHANGE_KIND_WORDS, RULES_MARKDOWN, addAnnex, annexLabel, dayLabel, insertBlock, moveAnnex, proposedReason, removeAnnex, rulesApiPath,
  rulesMediaProps, variableGroups, variableValueText,
} from "@/lib/leagueRules";
import { changedPlaces, seasonAnchorUrl } from "@/lib/seasonTabs";
import { viennaDate } from "@/lib/vienna";

const LONG_DAY = { day: "2-digit", month: "2-digit", year: "numeric" };
const QUIET = "tls-btn tls-btn--quiet inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50";
const PRIMARY = "tls-btn tls-btn--primary inline-flex items-center gap-1.5 rounded-sm px-4 py-2 text-[11px] font-black uppercase tracking-wider disabled:opacity-50";
const REASON_MIN = 5;
const ICON_BUTTON = "p-1.5 text-white/60 hover:text-[#29B6E8] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm disabled:opacity-30";
const SUMMARY = "tls-hit flex min-h-[40px] cursor-pointer list-none items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#29B6E8] [&::-webkit-details-marker]:hidden";

/** Wo eine Variable ohne Wert ist: Bei einer Fassung der Liga zählt jede Season, die sie einfriert - auch wenn die Seite „(je Season)“ zeigt. */
const whereEmpty = (leagueWide) => (leagueWide ? "in einer Season dieser Liga" : "in dieser Season");

function formOf(draft) {
  return { title: draft?.title || "", body_md: draft?.body_md || "", annexes: (draft?.annexes || []).map(({ title, body_md }) => ({ title: title || "", body_md: body_md || "" })) };
}

function VarAlerts({ unknown = [], empty = [], leagueWide = false, testId }) {
  return (
    <>
      {unknown.length ? (
        <p role="alert" className="mb-3 break-words text-sm text-warn" data-testid={`${testId}-unknown`}>
          Unbekannte Variable: {unknown.map((name) => `{{${name}}}`).join(", ")}. So lässt sich nichts veröffentlichen - bitte aus der Liste einfügen.
        </p>
      ) : null}
      {empty.length ? (
        <p role="status" className="mb-3 break-words text-sm text-white/70" data-testid={`${testId}-empty`}>
          Ohne Wert {whereEmpty(leagueWide)}, im Text steht „(nicht festgelegt)“: {empty.map((name) => `{{${name}}}`).join(", ")}.
        </p>
      ) : null}
    </>
  );
}

/** „Regelwerk muss freigegeben werden“: die geänderten Stellen, der Vorschlag mit markierten Unterschieden und die Freigabe. */
function PendingRelease({ changes, proposal, hasDraft, busy, today, leagueWide, refusedEmpty, onPrepare, onApprove }) {
  const [release, setRelease] = useState({ valid_from: today || "", change_reason: proposedReason(changes), requires_consent: true, confirm_empty: false });
  // Leere Variablen (Entscheidung Fabian): nur mit ausdrücklicher Bestätigung - der Haken erscheint erst, wenn es welche gibt. Nennt der
  // Vorschlag keine, zählt als Rückfall die Liste aus der Absage des Servers (422 mit Code empty_vars).
  const emptyVars = proposal?.empty_vars?.length ? proposal.empty_vars : refusedEmpty || [];
  const canApprove = release.change_reason.trim().length >= REASON_MIN && release.valid_from && !busy && !proposal?.unknown_vars?.length
    && (!emptyVars.length || release.confirm_empty);
  return (
    <section className="mb-6 rounded-sm border border-warn/40 bg-warn/5 p-4" data-testid="rules-data-changes" aria-labelledby="rules-pending-title">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="rules-pending-title" className="font-heading text-lg font-black uppercase text-white">Regelwerk muss freigegeben werden</h2>
          <p className="mt-1 text-sm text-white/75">
            Seit {changes.label} haben sich Werte geändert, die im Regelwerk stehen ({changedPlaces(changes.rows)}). {changes.label} zeigt weiter den Stand von damals,
            bis du eine neue Fassung freigibst. Von selbst geht nichts raus.
          </p>
        </div>
      </div>
      <ul className="mt-4 space-y-3">
        {changes.rows.map((row) => (
          <li key={`${row.season_id}-${row.kind}-${row.block}`} className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid={`rules-change-${row.kind || "block"}-${row.block}`}>
            <p className="mb-1 flex flex-wrap items-center gap-x-2 text-xs font-bold text-white/70">
              <span className="rounded-sm border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/55">{CHANGE_KIND_WORDS[row.kind] || CHANGE_KIND_WORDS.block}</span>
              {/* Die Marke einer Variable bleibt, wie sie im Text steht - nicht in Großbuchstaben. */}
              <span className={`min-w-0 break-words ${row.kind === "variable" ? "font-mono font-normal text-white/85" : "uppercase tracking-wider"}`}>{row.label}</span>
              <span className="text-white/45">· {row.season_name}{row.status === "missing" ? " · noch nicht festgehalten" : ""}</span>
            </p>
            <div className="tls-rules"><RuleOps ops={row.ops} /></div>
          </li>
        ))}
      </ul>
      {hasDraft ? (
        <p className="mt-4 text-sm text-white/75" data-testid="rules-pending-draft">Der Entwurf unten nimmt beim Veröffentlichen den neuen Stand - prüfen, dann veröffentlichen.</p>
      ) : null}
      {!hasDraft && proposal ? (
        <div className="mt-5 space-y-4" data-testid="rules-proposal">
          {/* Erst die Freigabe, darunter die ganze neue Fassung zum Prüfen - bei langen Regelwerken sonst ein weiter Weg zum Knopf. */}
          <div className="rounded-sm border border-white/10 bg-[#121212] p-4" data-testid="rules-approve">
            <p className="text-sm font-semibold text-white">Prüfen und freigeben</p>
            <p className="mt-1 text-sm text-white/65">
              Die neue Fassung übernimmt den Text von {changes.label} und die Werte von heute - sie steht darunter zum Prüfen, geänderte Abschnitte sind markiert.
              Zum Anpassen des Texts vorher „Text vorher anpassen“.
            </p>
            <VarAlerts unknown={proposal.unknown_vars} empty={emptyVars} leagueWide={leagueWide} testId="rules-proposal" />
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <TextField label="Gültig ab" type="date" value={release.valid_from} min={today} onChange={(value) => setRelease((row) => ({ ...row, valid_from: value }))} testId="rules-approve-valid-from" />
              <TextAreaField label="Änderungsgrund" value={release.change_reason} onChange={(value) => setRelease((row) => ({ ...row, change_reason: value }))} rows={2}
                hint="Steht öffentlich bei der Fassung, mindestens fünf Zeichen." testId="rules-approve-reason" />
            </div>
            <CheckField className="mt-3" label="Die Teams müssen der neuen Fassung zustimmen" checked={release.requires_consent} onChange={(value) => setRelease((row) => ({ ...row, requires_consent: value }))}
              hint="Captain und Vertreter sehen „Neue Fassung, bitte zustimmen“ - auf Startseite, Regelseite, Team-Seite und Matchseite." testId="rules-approve-consent" />
            {emptyVars.length ? (
              <CheckField className="mt-2" label="Trotzdem veröffentlichen - im Text steht dann „(nicht festgelegt)“" checked={release.confirm_empty}
                onChange={(value) => setRelease((row) => ({ ...row, confirm_empty: value }))} accent="#FFD700"
                hint={`Ohne Wert ${whereEmpty(leagueWide)}: ${emptyVars.map((name) => `{{${name}}}`).join(", ")}.`} testId="rules-approve-confirm-empty" />
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={PRIMARY} disabled={!canApprove} data-testid="rules-approve-publish"
                onClick={() => onApprove({ ...release, base_version_id: proposal.base.id, fingerprint: proposal.fingerprint })}>Freigeben und veröffentlichen</button>
              <button type="button" className={QUIET} disabled={busy} onClick={onPrepare} data-testid="rules-prepare">Text vorher anpassen</button>
            </div>
          </div>
          <details open className="group rounded-sm border border-white/10 bg-[#0A0A0A]">
            <summary className={`${SUMMARY} px-4 py-2`}>Vorschlag: die neue Fassung mit den Werten von heute</summary>
            <div className="tls-rules border-t border-white/10 p-4 md:p-6">
              <RulesChanges changes={proposal.changes} versionLabel="der neuen Fassung" testId="rules-proposal-changes" />
              <RulesDocument sections={proposal.sections} versionLabel="der neuen Fassung" testId="rules-proposal-document" />
            </div>
          </details>
        </div>
      ) : null}
      {!hasDraft && !proposal ? (
        <button type="button" className={`${PRIMARY} mt-3`} disabled={busy} onClick={onPrepare} data-testid="rules-prepare">Neue Version vorbereiten</button>
      ) : null}
    </section>
  );
}

/** Variablen einfügen: Liste mit Bezeichnung, Marke und dem Wert von heute, nach Gruppen, mit Suche. */
function VariablePalette({ variables, onInsert }) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => variableGroups(variables, query), [variables, query]);
  if (!variables?.length) return null;
  return (
    <details className="group rounded-sm border border-white/10 bg-[#0A0A0A]" data-testid="rules-variables">
      <summary className={`${SUMMARY} px-3`}>Variable einfügen <span className="font-normal normal-case tracking-normal text-white/50">- mit dem Wert von heute</span></summary>
      <div className="border-t border-white/10 p-3">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Suchen: Name, Bezeichnung oder Wert" aria-label="Variablen durchsuchen"
          className="mb-3 w-full rounded-sm border border-white/10 bg-[#121212] px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-[#29B6E8] focus:outline-none" data-testid="rules-variables-search" />
        {groups.length ? groups.map((group) => (
          <div key={group.name} className="mb-3 last:mb-0">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/50">{group.name}</p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {group.rows.map((row) => (
                <li key={row.name}>
                  <button type="button" onClick={() => onInsert(row.token)} title={row.hint || row.label} data-testid={`rules-var-${row.name}`}
                    className="tls-hit flex w-full min-w-0 flex-col items-start rounded-sm border border-white/10 px-2.5 py-1.5 text-left hover:border-[#29B6E8]/60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]">
                    <span className="text-sm text-white">{row.label}</span>
                    <span className="font-mono text-[11px] text-white/45">{row.token}</span>
                    <span className={`break-words text-xs ${row.value == null ? "text-warn" : "text-[#29B6E8]"}`}>{variableValueText(row)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )) : <p className="text-sm text-white/50">Keine Variable passt zur Suche.</p>}
      </div>
    </details>
  );
}

/** Die Hilfe: alle Bausteine und Variablen auf einen Blick, mit dem heutigen Wert. */
function RulesHelp({ blocks, variables }) {
  return (
    <details className="group rounded-sm border border-white/10 bg-[#0A0A0A]" data-testid="rules-help">
      <summary className={`${SUMMARY} px-3`}>Hilfe: alle Bausteine und Variablen</summary>
      <div className="space-y-4 border-t border-white/10 p-3 text-sm">
        <p className="text-white/70">
          Ein Baustein steht als eigener Absatz (Tabelle oder Liste), eine Variable mitten im Satz. Beide kommen aus den Einstellungen der Season und werden beim
          Veröffentlichen eingefroren. Ändert sich danach eine Einstellung, bleibt die Fassung, wie sie ist, und die Seite zeigt „Regelwerk muss freigegeben werden“.
        </p>
        <div className="tls-swipe pb-0">
          <table className="w-full text-left text-xs">
            <thead><tr className="text-white/50"><th className="py-1 pr-3 font-bold uppercase tracking-wider">Baustein</th><th className="py-1 pr-3 font-bold uppercase tracking-wider">Marke</th><th className="py-1 font-bold uppercase tracking-wider">Inhalt</th></tr></thead>
            <tbody>
              {blocks.map((block) => (
                <tr key={block.key} className="border-t border-white/5 align-top">
                  <td className="py-1.5 pr-3 text-white">{block.label}</td>
                  <td className="py-1.5 pr-3 font-mono text-white/60">{block.token}</td>
                  <td className="py-1.5 text-white/70">{block.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tls-swipe pb-0">
          <table className="w-full text-left text-xs">
            <thead><tr className="text-white/50"><th className="py-1 pr-3 font-bold uppercase tracking-wider">Variable</th><th className="py-1 pr-3 font-bold uppercase tracking-wider">Marke</th><th className="py-1 font-bold uppercase tracking-wider">Wert heute</th></tr></thead>
            <tbody>
              {(variables || []).map((row) => (
                <tr key={row.name} className="border-t border-white/5 align-top">
                  <td className="py-1.5 pr-3 text-white">{row.label}</td>
                  <td className="py-1.5 pr-3 font-mono text-white/60">{row.token}</td>
                  <td className={`py-1.5 ${row.value == null ? "text-white/45" : "text-white/80"}`}>{variableValueText(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
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
  const { user } = useAuth();
  const media = rulesMediaProps(user);
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(formOf(null));
  const [revision, setRevision] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [publish, setPublish] = useState({ valid_from: "", change_reason: "", requires_consent: false, confirm_empty: false });
  // Leere Variablen im Entwurf (Entscheidung Fabian): aus der Vorschau oder aus der Absage des Servers - erst dann erscheint der Haken.
  const [emptyVars, setEmptyVars] = useState([]);
  // Wohin ein Baustein oder eine Variable geht: der zuletzt benutzte Editor (Haupttext oder eine Anlage).
  const [target, setTarget] = useState("body");
  const bodyRef = useRef(null);
  const annexRefs = useRef([]);
  const base = `/admin/league-rules/${scope}/${scopeId}`;
  const leagueWide = scope === "league";

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

  /** Baustein (eigener Absatz) oder Variable (im Satz) in den zuletzt benutzten Editor - an der Schreibmarke, sonst ans Ende. */
  const insert = (token, { block }) => {
    const editor = target === "body" ? bodyRef.current : annexRefs.current[target];
    if (editor?.insertText) {
      editor.insertText(token, { block });
      setDirty(true);
      return;
    }
    const current = target === "body" ? form.body_md : form.annexes[target]?.body_md;
    const next = block ? insertBlock(current, token) : appendText(current, token);
    if (target === "body") change({ body_md: next });
    else changeAnnex(target, { body_md: next });
  };

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
      const detail = err.response?.data?.detail;
      // Leere Variablen (422 mit Liste): der Haken zum Bestätigen erscheint, der Text bleibt.
      if (detail?.code === "empty_vars" && Array.isArray(detail.names)) setEmptyVars(detail.names);
      toast.error(formatApiError(detail));
      // Einstellungen haben sich seit dem Vorschlag geändert (409): den Vorschlag neu laden, damit die Leitung ihn neu prüft.
      if (err.response?.status === 409) await load();
    } finally {
      setBusy(false);
    }
  };
  const onSave = () => run(async () => { await save(); toast.success("Entwurf gespeichert."); });
  const onPreview = () => run(async () => { const { data } = await api.post(`${base}/preview`, form); setPreview(data); setEmptyVars(data.empty_vars || []); });
  const onPrepare = () => run(async () => { await api.post(`${base}/draft/from-version`, {}); toast.success("Entwurf vorbereitet."); await load(); });
  const onApprove = (body) => run(async () => {
    if (!await confirm({ title: "Neue Fassung freigeben?", description: "Der Text der letzten Fassung mit den Werten von heute wird veröffentlicht. Danach lässt sie sich nicht mehr ändern.", confirmLabel: "Freigeben" })) return;
    await api.post(`${base}/proposal/publish`, body);
    toast.success("Neue Fassung freigegeben.");
    setEmptyVars([]);
    await load();
  });
  const onDiscard = () => run(async () => {
    if (!await confirm({ title: "Entwurf verwerfen?", description: "Der Text des Entwurfs ist danach weg. Veröffentlichte Fassungen bleiben.", confirmLabel: "Verwerfen" })) return;
    await api.delete(`${base}/draft`);
    setPreview(null);
    setEmptyVars([]);
    await load();
  });
  const onPublish = () => run(async () => {
    if (!await confirm({ title: "Version veröffentlichen?", description: "Danach lässt sie sich nicht mehr ändern. Bausteine und Variablen werden mit dem heutigen Stand eingefroren.", confirmLabel: "Veröffentlichen" })) return;
    const current = dirty || !revision ? (await save()).revision : revision;
    await api.post(`${base}/publish`, { revision: current, ...publish });
    toast.success("Version veröffentlicht.");
    setPublish((value) => ({ ...value, change_reason: "", requires_consent: false, confirm_empty: false }));
    setEmptyVars([]);
    setPreview(null);
    await load();
  });

  // Zurück in den Reiter „Regelwerk und Sperrliste“ der Season (#2267).
  const back = view?.season ? seasonAnchorUrl(view.season.id, "regelwerk") : "/admin/leagues";
  const canPublish = publish.change_reason.trim().length >= REASON_MIN && publish.valid_from && !busy && (!emptyVars.length || publish.confirm_empty);
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

          {view.data_changes ? (
            <PendingRelease key={`${view.data_changes.version_id}-${view.data_changes.rows.length}`} changes={view.data_changes} proposal={view.proposal}
              hasDraft={!!view.draft || editing} busy={busy} today={view.today} leagueWide={leagueWide} refusedEmpty={emptyVars}
              onPrepare={onPrepare} onApprove={onApprove} />
          ) : null}

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
                          onClick={() => insert(block.token, { block: true })}>{block.label}</button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-xs text-white/50">Der Inhalt kommt aus den Einstellungen der Season und wird beim Veröffentlichen eingefroren. Eingefügt wird in den zuletzt benutzten Editor.</p>
                  </div>
                  <VariablePalette variables={view.variables} onInsert={(token) => insert(token, { block: false })} />
                  <RulesHelp blocks={view.blocks} variables={view.variables} />
                  <div onFocusCapture={() => setTarget("body")}>
                    <MarkdownEditor ref={bodyRef} value={form.body_md} onChange={(value) => change({ body_md: value })} testId="rules-body" rows={18} mentionsEnabled={false} previewOptions={RULES_MARKDOWN} {...media}
                      placeholder="# § 1 Geltung" helperText="Markdown. Rohes HTML wird nicht übernommen. Variablen wie {{best_of}} und Bausteine wie [[baustein:modes]] füllt der Server." />
                  </div>
                </FormSection>

                <FormSection title="Anlagen" hint="Eigene Abschnitte im Inhaltsverzeichnis und im PDF. Der Buchstabe folgt der Reihenfolge." testId="rules-annexes">
                  {form.annexes.map((annex, index) => (
                    // Anlagen haben keine eigene Kennung, die Reihenfolge ist ihr Schlüssel.
                    <div key={index} className="rounded-sm border border-white/10 p-3" data-testid={`rules-annex-${index}`} onFocusCapture={() => setTarget(index)}>
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
                        <MarkdownEditor ref={(node) => { annexRefs.current[index] = node; }} value={annex.body_md} onChange={(value) => changeAnnex(index, { body_md: value })} testId={`rules-annex-body-${index}`} rows={8} mentionsEnabled={false} previewOptions={RULES_MARKDOWN} {...media}
                          helperText="Markdown wie im Haupttext, auch mit Bausteinen und Variablen." />
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
                    <VarAlerts unknown={preview.unknown_vars} empty={preview.empty_vars} leagueWide={leagueWide} testId="rules-preview-vars" />
                    {preview.foreign_images?.length ? (
                      <p role="alert" className="mb-4 break-words text-sm text-warn" data-testid="rules-preview-foreign">Fremde Bilder lassen sich nicht speichern: {preview.foreign_images.join(", ")}. Bitte über „Hochladen“ oder die Mediathek wählen.</p>
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
                  {emptyVars.length ? (
                    <CheckField label="Trotzdem veröffentlichen - im Text steht dann „(nicht festgelegt)“" checked={publish.confirm_empty}
                      onChange={(value) => setPublish((row) => ({ ...row, confirm_empty: value }))} accent="#FFD700"
                      hint={`Ohne Wert ${whereEmpty(leagueWide)}: ${emptyVars.map((name) => `{{${name}}}`).join(", ")}.`} testId="rules-confirm-empty" />
                  ) : null}
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
