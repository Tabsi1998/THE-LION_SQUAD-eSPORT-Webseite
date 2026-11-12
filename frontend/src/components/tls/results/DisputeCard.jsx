import { useEffect, useState } from "react";
import { AlertTriangle, Clock, FileArchive, Gavel, MessageSquareText, Scale, UserCheck } from "lucide-react";
import { chatAttachmentSrc } from "@/lib/chatAttachments";
import { viennaDateTime } from "@/lib/vienna";
import { api, formatApiError } from "@/lib/api";
import { AGAINST_LABELS, MOSS_STATE_LABELS, PROCEDURE_STATE_LABELS, claimedText, deadlineTone, decisionText, remainingText } from "@/lib/leagueProcedures";
import { ProofList, proofAudienceText, proofHintText } from "@/components/tls/results/ProofList";

// Streitfall für die Turnierleitung (#1158): Meldung mit Grund, Foto und das eingetragene Ergebnis - entschieden wird
// mit einem Tipp. „Ergebnis bleibt“ (ohne Ergebnis: „Weiter wie bisher“) schließt den Dispute; „Ergebnis ändern“
// öffnet das Ergebnis-Fenster (Korrektur mit Grund im Protokoll). Beide Seiten bekommen die Entscheidung.

function clock(value) {
  if (!value) return "";
  try {
    return viennaDateTime(value, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function Photo({ photo, label }) {
  if (!photo?.url) return null;
  const src = chatAttachmentSrc(photo.url);
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block w-32 overflow-hidden rounded-sm border border-white/10" data-testid="dispute-photo-link">
      <img src={chatAttachmentSrc(photo.url, 400)} alt={label} className="h-20 w-full object-cover" loading="lazy" />
    </a>
  );
}

export function DisputeCard({ item, busy = false, highlighted = false, onKeep, onChange }) {
  const [note, setNote] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const dispute = item?.dispute;
  if (!dispute) return null;
  const hasResult = Boolean(item.has_result);
  // Liga (#2203): `can_decide` sagt der Server - fehlt das Feld (normale Antwort älterer Stände), bleibt es wie bisher.
  const mayDecide = item.can_decide !== false;
  const needsReason = Boolean(item.conflict_override) && conflictReason.trim().length < 5;
  return (
    <div className={`rounded-sm border bg-[#121212] p-4 space-y-3 ${highlighted ? "border-[#FFD700]/70 ring-2 ring-[#FFD700]/40" : "border-[#FF3B30]/40"}`} data-testid={`lead-dispute-${item.id}`} id={`fall-ds-${item.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700]">Gemeldet von {dispute.by}{dispute.at ? ` · ${clock(dispute.at)}` : ""}</div>
          <div className="mt-1 flex items-center gap-2 font-heading text-lg font-black uppercase"><AlertTriangle className="w-4 h-4 text-[#FF6B60]" /> {dispute.category_label}</div>
          <div className="text-xs text-white/50 truncate">{item.stage_name ? `${item.stage_name} · ` : ""}{item.label}</div>
        </div>
      </div>
      {dispute.text ? <p className="text-sm text-white/80">„{dispute.text}“</p> : null}
      <Photo photo={dispute.photo} label="Foto zur Meldung" />
      {hasResult ? (
        <div className="text-xs text-white/60" data-testid={`lead-dispute-result-${item.id}`}>
          Eingetragen: <strong className="text-white">{item.result_summary}</strong>
          {dispute.result_by ? ` · von ${dispute.result_by}` : ""}{dispute.result_at ? ` um ${clock(dispute.result_at)}` : ""}
        </div>
      ) : <div className="text-xs text-white/50">Noch kein Ergebnis eingetragen.</div>}
      {(dispute.reports || []).length ? (
        <div className="space-y-1">
          {dispute.reports.map((report) => (
            <div key={`${report.by}-${report.at}`} className="text-xs text-white/55">Meldung von {report.by}: <strong className="text-white/80">{report.summary}</strong></div>
          ))}
        </div>
      ) : null}
      {item.conflict ? <p className="rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-white/85" data-testid={`lead-dispute-conflict-${item.id}`}>Du bist an diesem Spiel selbst beteiligt. Das entscheidet eine zweite berechtigte Person.</p> : null}
      {item.conflict_override ? (
        <label className="block rounded-sm border border-warn/40 bg-warn/10 px-3 py-2" data-testid={`lead-dispute-override-${item.id}`}>
          <span className="mb-2 block text-sm text-white/85">Du bist an diesem Spiel selbst beteiligt. Als Superadmin geht es nur als Notausnahme, der Grund steht im Protokoll.</span>
          <input value={conflictReason} onChange={(e) => setConflictReason(e.target.value)} maxLength={500} className="input" placeholder="Grund der Notausnahme" aria-label="Grund der Notausnahme" data-testid={`lead-dispute-reason-${item.id}`} />
        </label>
      ) : null}
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="input" placeholder="Begründung (freiwillig, geht an beide Seiten)" data-testid={`lead-dispute-note-${item.id}`} />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy || !mayDecide || needsReason} onClick={() => (item.conflict_override ? onKeep(note.trim() || null, conflictReason.trim()) : onKeep(note.trim() || null))} className="tls-btn tls-btn--secondary min-h-[44px] px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid={`lead-dispute-keep-${item.id}`}>
          {hasResult ? "Ergebnis bleibt" : "Weiter wie bisher"}
        </button>
        <button type="button" disabled={busy || !item.can_enter} onClick={onChange} className="tls-btn tls-btn--primary min-h-[44px] px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid={`lead-dispute-change-${item.id}`}>
          {hasResult ? "Ergebnis ändern" : "Ergebnis eintragen"}
        </button>
      </div>
      <p className="text-center text-[11px] text-white/45">Beide Seiten bekommen die Entscheidung als Benachrichtigung.</p>
    </div>
  );
}

// ---------------------------------------------------------------- Liga-Verfahren (#1619, E.2)
// Beanstandung, Protest und Einspruch auf der Matchseite: Stand, Fristen mit Countdown, Stellungnahme, Zuständige und Entscheidung.
// Der Server liefert je Rolle, was sie sehen und tun darf (`league.procedures`): die eigene Seite ergänzt und zieht zurück, die
// Gegenseite nimmt Stellung, die Liga-Leitung übernimmt, fordert MOSS an und entscheidet. „Ergebnis ändern“ läuft über das
// Ergebnis-Fenster - die Korrektur mit Grund entscheidet das Verfahren mit.

const TONE = { none: "text-white/55", calm: "text-white/70", soon: "text-warn", over: "text-[#FF6B60]" };
const STATE_STYLE = { open: "border-honor/50 text-honor", decided: "border-white/20 text-white/70", withdrawn: "border-white/15 text-white/50" };
const SMALL_BUTTON = "tls-btn tls-btn--secondary min-h-[44px] px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50";

function when(value) {
  if (!value) return "";
  try {
    return viennaDateTime(value, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Die Uhr für die Countdowns: tickt alle 30 Sekunden - genug für Fristen in Stunden, ruhig für die Seite. */
function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Deadline({ label, until, now, testId }) {
  if (!until) return null;
  const tone = deadlineTone(until, now);
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs" data-testid={testId}>
      <span className="flex items-center gap-1.5 text-white/55"><Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {label}</span>
      <span className={`text-right tabular-nums transition-colors motion-reduce:transition-none ${TONE[tone]}`}>
        <span className="text-white/45">{when(until)} · </span><strong data-tone={tone}>{remainingText(until, now)}</strong>
      </span>
    </div>
  );
}

/**
 * Einspruch einlegen (Nr. 41, 45): gegen die Entscheidung über ein Verfahren, eine Wertung kampflos oder eine Korrektur - einmal,
 * mit Begründung, innerhalb der Einspruchsfrist. Erst ein Knopf, dann das Feld: Niemand legt aus Versehen Einspruch ein.
 */
export function AppealForm({ matchId, against, until = null, onChanged, testId = "appeal" }) {
  const [openForm, setOpenForm] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const now = useNow(Boolean(until));
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post(`/matches/${matchId}/appeals`, { against_type: against.type, ref_id: against.ref_id, reason: text.trim() });
      setText("");
      setOpenForm(false);
      await onChanged?.();
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Der Einspruch ließ sich nicht einlegen.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2" data-testid={testId}>
      {until ? <Deadline label="Einspruch möglich bis" until={until} now={now} testId={`${testId}-until`} /> : null}
      {openForm ? (
        <form onSubmit={submit} className="tls-stagger space-y-2" noValidate>
          <label className="block">
            <span className="mb-1 block text-sm text-white/75">Einspruch {AGAINST_LABELS[against.type]} – Begründung</span>
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} maxLength={1000} className="input w-full min-h-[5rem] resize-y"
              placeholder="Warum ist die Entscheidung aus eurer Sicht falsch? Mindestens zehn Zeichen." data-testid={`${testId}-input`} />
          </label>
          <p className="text-xs text-white/50">Einspruch geht nur einmal. Es entscheidet eine andere Person als bei der ersten Entscheidung, ihre Entscheidung ist endgültig. Bis dahin gilt die erste Entscheidung weiter.</p>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy || text.trim().length < 10} className={SMALL_BUTTON} data-testid={`${testId}-send`}>Einspruch einlegen</button>
            <button type="button" disabled={busy} onClick={() => setOpenForm(false)} className="min-h-[44px] px-2 text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white">Abbrechen</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setOpenForm(true)} className={SMALL_BUTTON} data-testid={`${testId}-open`}>Einspruch einlegen</button>
      )}
      {error ? <p className="text-sm text-[#FF6B60]" role="alert" data-testid={`${testId}-error`}>{error}</p> : null}
    </div>
  );
}

/** Für die Leitung eingeklappt, damit die Karte kurz bleibt - alle anderen sehen den Inhalt direkt. */
function Fold({ when, summary, testId, children }) {
  if (!when) return children;
  return (
    <details className="rounded-sm border border-white/10 bg-[#0A0A0A] px-3" data-testid={testId}>
      <summary className="flex min-h-[44px] cursor-pointer items-center text-xs font-bold uppercase tracking-wider text-white/70 hover:text-white">{summary}</summary>
      <div className="space-y-2 pb-3">{children}</div>
    </details>
  );
}

export function ProcedureCard({ matchId, procedure, sideNames = {}, players = [], conflictOverride = false, onChanged, onChangeResult = null, proofsElsewhere = false }) {
  const p = procedure;
  const open = p.state === "open";
  const now = useNow(open);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [extra, setExtra] = useState("");
  const [player, setPlayer] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const base = `/matches/${matchId}/procedures/${p.id}`;
  const lead = conflictOverride ? { conflict_reason: conflictReason.trim() } : {};
  // Notausnahme des Superadmins (B.1): ohne Grund geht kein Schritt der Leitung.
  const blocked = conflictOverride && conflictReason.trim().length < 5;

  const run = async (call, after) => {
    setBusy(true);
    setError("");
    try {
      await call();
      after?.();
      await onChanged?.();
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Das hat nicht geklappt. Bitte noch einmal versuchen.");
    } finally {
      setBusy(false);
    }
  };

  const sideName = p.side ? sideNames[p.side] || (p.own ? "Eigene Seite" : "Gegenseite") : "Liga-Leitung";
  const claimed = claimedText(p.claimed, sideNames);
  const outcome = decisionText(p);
  const mossVisible = (p.moss_requests || []).length > 0 || p.can_lead;
  const mossPending = (p.moss_requests || []).some((row) => row.own && ["requested", "missing"].includes(row.state));

  return (
    <article className={`rounded-sm border bg-[#121212] p-4 ${open ? "border-honor/40" : "border-white/10"}`} data-testid={`procedure-${p.id}`} data-state={p.state} id={`verfahren-${p.id}`}>
      <div className="tls-stagger space-y-3">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/55">{sideName}{p.at ? ` · ${when(p.at)}` : ""}</div>
            <h3 className="mt-1 flex items-center gap-2 font-heading text-lg font-black uppercase">
              <Scale className="h-4 w-4 shrink-0 text-honor" aria-hidden="true" /> {p.kind_label}
            </h3>
            <div className="text-sm font-bold text-white/70" data-testid={`procedure-reason-label-${p.id}`}>{p.kind === "appeal" && p.against ? AGAINST_LABELS[p.against.type] : p.reason_label}</div>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${STATE_STYLE[p.state]}`} data-testid={`procedure-state-${p.id}`}>{PROCEDURE_STATE_LABELS[p.state]}</span>
        </header>

        <div className="space-y-2">
          {p.reason ? <p className="whitespace-pre-line text-sm text-white/85" data-testid={`procedure-reason-${p.id}`}>„{p.reason}“</p> : null}
          {(p.additions || []).map((row) => (
            <p key={row.at} className="whitespace-pre-line border-l-2 border-white/15 pl-3 text-sm text-white/75">Ergänzung {when(row.at)}: „{row.text}“</p>
          ))}
          {claimed ? <p className="text-xs text-white/60" data-testid={`procedure-claimed-${p.id}`}>Ergebnis aus Sicht der Seite: <strong className="text-white">{claimed}</strong></p> : null}
          {typeof p.notified_immediately === "boolean" ? <p className="text-xs text-white/60">Gegenseite sofort hingewiesen: <strong className="text-white">{p.notified_immediately ? "Ja" : "Nein"}</strong></p> : null}
        </div>

        {open ? (
          <div className="space-y-1.5 rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2.5" data-testid={`procedure-deadlines-${p.id}`}>
            {p.own ? <Deadline label="Ergänzen und Nachweise bis" until={p.evidence_until} now={now} testId={`procedure-evidence-until-${p.id}`} /> : null}
            {p.statement && !p.statement.text ? <Deadline label="Stellungnahme der Gegenseite bis" until={p.statement.due_at} now={now} testId={`procedure-statement-until-${p.id}`} /> : null}
            {p.target_at ? <Deadline label="Zielfrist der Leitung" until={p.target_at} now={now} testId={`procedure-target-${p.id}`} /> : null}
            <div className="flex items-center gap-1.5 text-xs" data-testid={`procedure-assignee-${p.id}`}>
              <UserCheck className="h-3.5 w-3.5 shrink-0 text-white/55" aria-hidden="true" />
              {p.assignee ? <span className="text-white/80">Übernommen von <strong>{p.assignee.name}</strong> am {when(p.assignee.at)}</span>
                : <span className="text-white/55">Noch von niemandem übernommen. Die Liga-Leitung weiß Bescheid.</span>}
            </div>
          </div>
        ) : null}

        {/* Direkt nach dem Einreichen stehen die Nachweise oben im Formular (Schritt 3) - jede Info nur an einer Stelle. */}
        {proofsElsewhere ? <p className="text-xs text-white/55" data-testid={`procedure-proofs-elsewhere-${p.id}`}>Deine Nachweise fügst du gerade oben im Formular hinzu.</p>
          : <ProofList matchId={matchId} kind="protest" refId={p.id} title="Nachweise" sideLabels={sideNames} testId={`procedure-proofs-${p.id}`} hint={false} />}
        {/* Was als Nachweis zählt und wer ihn sieht: einmal für die ganze Karte, nicht unter jeder der drei Listen. */}
        {open && !proofsElsewhere ? <p className="text-xs text-white/50" data-testid={`procedure-proof-hint-${p.id}`}>{proofHintText()}</p> : null}
        {!proofsElsewhere ? <p className="text-xs text-white/50" data-testid={`procedure-proof-audience-${p.id}`}>{proofAudienceText("protest")}</p> : null}

        {p.statement ? (
          <section className="space-y-2 border-t border-white/10 pt-3" data-testid={`procedure-statement-${p.id}`}>
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/60"><MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" /> Stellungnahme · {sideNames[p.statement.side] || "Gegenseite"}</div>
            {p.statement.text ? <p className="whitespace-pre-line text-sm text-white/85">„{p.statement.text}“ <span className="text-xs text-white/45">({when(p.statement.at)})</span></p>
              : <p className="text-sm text-white/55">{p.statement.expired ? "Die Frist ist abgelaufen, ohne dass eine Stellungnahme einging." : "Noch keine Stellungnahme."}</p>}
            {p.can_state ? (
              <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); run(() => api.post(`${base}/statement`, { text: text.trim() }), () => setText("")); }}>
                <label className="block">
                  <span className="sr-only">Eure Stellungnahme</span>
                  <textarea value={text} onChange={(event) => setText(event.target.value)} rows={3} maxLength={2000} className="input w-full min-h-[5rem] resize-y"
                    placeholder={p.statement.text ? "Stellungnahme ersetzen …" : "Wie seht ihr das? Mindestens zehn Zeichen."} data-testid={`procedure-statement-input-${p.id}`} />
                </label>
                <button disabled={busy || text.trim().length < 10} className={SMALL_BUTTON} data-testid={`procedure-statement-send-${p.id}`}>{p.statement.text ? "Stellungnahme ersetzen" : "Stellung nehmen"}</button>
              </form>
            ) : null}
            {p.statement.text || p.can_state ? (
              <Fold when={p.can_lead} summary="Nachweise zur Stellungnahme" testId={`procedure-statement-fold-${p.id}`}>
                <ProofList matchId={matchId} kind="statement" refId={p.id} title="Nachweise zur Stellungnahme" sideLabels={sideNames} testId={`procedure-statement-proofs-${p.id}`} hint={false} />
              </Fold>
            ) : null}
          </section>
        ) : null}

        {mossVisible ? (
          <section className="space-y-2 border-t border-white/10 pt-3" data-testid={`procedure-moss-${p.id}`}>
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/60"><FileArchive className="h-3.5 w-3.5" aria-hidden="true" /> MOSS-Datei</div>
            {(p.moss_requests || []).map((row) => (
              <div key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs" data-testid={`procedure-moss-request-${row.id}`}>
                <span className="text-white/80">{row.own ? "Deine Datei" : row.name}: <strong data-state={row.state}>{MOSS_STATE_LABELS[row.state] || row.state}</strong></span>
                {row.state === "requested" ? <span className={`tabular-nums ${TONE[deadlineTone(row.due_at, now)]}`}>bis {when(row.due_at)} · {remainingText(row.due_at, now)}</span> : null}
                {p.can_lead && ["requested", "missing"].includes(row.state) ? (
                  <button type="button" disabled={busy || blocked || extra.trim().length < 5} onClick={() => run(() => api.post(`${base}/moss-requests/${row.id}/excuse`, { reason: extra.trim(), ...lead }), () => setExtra(""))}
                    className="underline underline-offset-2 text-white/60 hover:text-white disabled:opacity-40" data-testid={`procedure-moss-excuse-${row.id}`}>Entschuldigen</button>
                ) : null}
              </div>
            ))}
            {mossPending ? <p className="text-xs text-warn">Bitte lade die ZIP-Datei unverändert hoch, so wie MOSS sie geschrieben hat (Regelwerk § 9a).</p> : null}
            {mossPending || p.can_lead || (p.moss_requests || []).length ? (
              <Fold when={p.can_lead} summary="MOSS-Nachweise" testId={`procedure-moss-fold-${p.id}`}>
                <ProofList matchId={matchId} kind="moss" refId={p.id} title="MOSS-Nachweise" sideLabels={sideNames} testId={`procedure-moss-proofs-${p.id}`} onChanged={onChanged} hint={false} />
                <p className="text-xs text-white/50" data-testid={`procedure-moss-audience-${p.id}`}>{proofAudienceText("moss")}</p>
              </Fold>
            ) : null}
            {p.can_lead ? (
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                  <label className="min-w-0">
                    <span className="sr-only">Spieler</span>
                    <select value={player} onChange={(event) => setPlayer(event.target.value)} className="input min-h-[44px] w-full" data-testid={`procedure-moss-player-${p.id}`}>
                      <option value="">Spieler wählen …</option>
                      {players.map((row) => <option key={`${row.side}-${row.id}`} value={row.id}>{row.name} ({sideNames[row.side] || "Seite"})</option>)}
                    </select>
                  </label>
                  <button type="button" disabled={busy || blocked || !player} onClick={() => run(() => api.post(`${base}/moss-requests`, { user_id: player, ...lead }), () => setPlayer(""))} className={SMALL_BUTTON} data-testid={`procedure-moss-request-${p.id}`}>MOSS-Datei anfordern</button>
                </div>
                {(p.moss_requests || []).some((row) => ["requested", "missing"].includes(row.state)) ? (
                  <input value={extra} onChange={(event) => setExtra(event.target.value)} maxLength={500} className="input" placeholder="Grund, falls eine Datei entschuldigt fehlt" aria-label="Grund der Entschuldigung" data-testid={`procedure-moss-excuse-reason-${p.id}`} />
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {outcome ? (
          <section className="space-y-1 rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2.5" data-testid={`procedure-decision-${p.id}`}>
            <div className="flex items-center gap-1.5 text-sm font-bold text-white"><Gavel className="h-4 w-4 text-honor" aria-hidden="true" /> {outcome}</div>
            {p.decision_note ? <p className="whitespace-pre-line text-sm text-white/75">Begründung: {p.decision_note}</p> : null}
            {p.resolved_at ? <p className="text-xs text-white/45">Entschieden am {when(p.resolved_at)}{p.resolved_by ? ` von ${p.resolved_by}` : ""}</p> : null}
            {p.can_appeal ? <AppealForm matchId={matchId} against={{ type: "protest_decision", ref_id: p.id }} until={p.appeal_until} onChanged={onChanged} testId={`procedure-appeal-${p.id}`} /> : null}
          </section>
        ) : null}

        {p.own_decision ? <p className="rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-white/85" data-testid={`procedure-own-decision-${p.id}`}>Du hast die Ausgangsentscheidung getroffen. Über den Einspruch entscheidet eine andere Person.</p> : null}

        {p.can_lead ? (
          <section className="space-y-2 border-t border-white/10 pt-3" data-testid={`procedure-lead-${p.id}`}>
            {conflictOverride ? (
              <label className="block rounded-sm border border-warn/40 bg-warn/10 px-3 py-2">
                <span className="mb-2 block text-sm text-white/85">Du bist an diesem Spiel selbst beteiligt. Als Superadmin geht es nur als Notausnahme, der Grund steht im Protokoll.</span>
                <input value={conflictReason} onChange={(event) => setConflictReason(event.target.value)} maxLength={500} className="input" placeholder="Grund der Notausnahme" aria-label="Grund der Notausnahme" />
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {!p.assignee?.own ? <button type="button" disabled={busy || blocked} onClick={() => run(() => api.post(`${base}/assign`, lead))} className={SMALL_BUTTON} data-testid={`procedure-assign-${p.id}`}>{p.assignee ? "Von mir übernehmen" : "Übernehmen"}</button> : null}
              {p.statement && !p.statement.text ? <button type="button" disabled={busy || blocked} onClick={() => run(() => api.post(`${base}/statement/extend`, { hours: 24, ...lead }))} className={SMALL_BUTTON} data-testid={`procedure-extend-${p.id}`}>Stellungnahme +24 Std.</button> : null}
            </div>
            <label className="block">
              <span className="mb-1 block text-sm text-white/75">Begründung der Entscheidung (Pflicht, geht an beide Seiten)</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} className="input w-full min-h-[5rem] resize-y" placeholder="Mindestens zehn Zeichen" data-testid={`procedure-note-${p.id}`} />
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" disabled={busy || blocked || note.trim().length < 10} onClick={() => run(() => api.post(`${base}/decision`, { decision: "keep", decision_note: note.trim(), ...lead }), () => setNote(""))}
                className={SMALL_BUTTON} data-testid={`procedure-keep-${p.id}`}>{p.kind === "appeal" ? "Einspruch abweisen" : "Ergebnis bleibt"}</button>
              {onChangeResult ? <button type="button" disabled={busy || note.trim().length < 10} onClick={() => onChangeResult(note.trim())}
                className="tls-btn tls-btn--primary min-h-[44px] px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid={`procedure-change-${p.id}`}>Ergebnis ändern</button> : null}
            </div>
            <p className="text-[11px] text-white/45">Entschieden wird nie automatisch. „Ergebnis ändern“ öffnet das Ergebnis-Fenster; die Begründung steht dort als Grund der Korrektur.</p>
          </section>
        ) : null}

        {p.can_amend ? (
          <form className="space-y-2 border-t border-white/10 pt-3" onSubmit={(event) => { event.preventDefault(); run(() => api.patch(base, { addition: extra.trim() }), () => setExtra("")); }} data-testid={`procedure-amend-${p.id}`}>
            <label className="block">
              <span className="mb-1 block text-sm text-white/75">Ergänzen</span>
              <textarea value={extra} onChange={(event) => setExtra(event.target.value)} rows={2} maxLength={1000} className="input w-full resize-y" placeholder="Was kommt noch dazu? Mindestens zehn Zeichen." data-testid={`procedure-amend-input-${p.id}`} />
            </label>
            <button disabled={busy || extra.trim().length < 10} className={SMALL_BUTTON} data-testid={`procedure-amend-send-${p.id}`}>Ergänzung speichern</button>
          </form>
        ) : null}

        {p.can_withdraw ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-3">
            <button type="button" disabled={busy} onClick={() => (confirmWithdraw ? run(() => api.post(`${base}/withdraw`), () => setConfirmWithdraw(false)) : setConfirmWithdraw(true))}
              className={`min-h-[44px] text-xs font-bold uppercase tracking-wider underline underline-offset-2 disabled:opacity-50 ${confirmWithdraw ? "text-[#FF6B60]" : "text-white/60 hover:text-white"}`} data-testid={`procedure-withdraw-${p.id}`}>
              {confirmWithdraw ? "Wirklich zurückziehen?" : "Zurückziehen"}
            </button>
            {confirmWithdraw ? <span className="text-xs text-white/55">Danach ist kein neues Verfahren mit demselben Grund möglich.</span> : null}
          </div>
        ) : null}

        {error ? <p className="text-sm text-[#FF6B60]" role="alert" data-testid={`procedure-error-${p.id}`}>{error}</p> : null}
      </div>
    </article>
  );
}
