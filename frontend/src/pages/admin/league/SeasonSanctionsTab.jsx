// Reiter „Strafen“ der Season-Seite (E.3, docs/LIGA.md „E.3 Strafen“): oben „Strafe verhängen“ als geführtes Formular (Katalog →
// Art → wen → Spiel und Nachweise → Verstoß und Begründung → Zeitraum), darunter die Strafen dieser Season mit Stand, Zeitraum,
// Einspruch, Bestätigen und Widerruf. Keine Automatik: Jede Strafe wählt die Leitung von Hand. Über das eigene Team und über den
// Einspruch gegen die eigene Entscheidung entscheidet eine zweite Person - die Karte sagt es statt der Knöpfe.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Gavel, Plus, Scale, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { ConflictReasonField, OwnTeamNote, overrideMissing, overridePayload } from "@/components/tls/league/ConflictOverride";
import { api, formatApiError } from "@/lib/api";
import { chatAttachmentSrc } from "@/lib/chatAttachments";
import { deadlineTone, remainingText } from "@/lib/leagueProcedures";
import {
  APPEAL_STATE_LABELS, EMPTY_SANCTION_FORM, SANCTION_STATUS, applyCatalog, applyKind, kindOf, matchesOf, needsPeriod, periodPayload,
  sanctionPayload, sanctionProblem,
} from "@/lib/leagueSanctions";
import { viennaDateTime } from "@/lib/vienna";

const WHEN = { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };
const CHIP = {
  warn: "border-warn/50 text-warn", live: "border-[#FF6B60]/50 text-[#FF6B60]", calm: "border-white/15 text-white/60",
};
const TONE = { none: "text-white/55", calm: "text-white/70", soon: "text-warn", over: "text-white/45" };
const BUTTON = "tls-btn inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50";
const OWN_MATCH = "Du bist an diesem Spiel selbst beteiligt. Das entscheidet eine zweite berechtigte Person.";
const OWN_DECISION = "Über den Einspruch entscheidet eine andere Person: Du hast diese Strafe verhängt oder bestätigt.";

function errorOf(failure, fallback) {
  return formatApiError(failure.response?.data?.detail) || fallback;
}

function ProofLinks({ proofs, count, testId }) {
  if (!count) return null;
  const hidden = count - proofs.length;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid={testId}>
      <span className="text-white/50">Nachweise:</span>
      {proofs.map((proof, index) => (
        <a key={proof.id} href={proof.type === "link" ? proof.link : chatAttachmentSrc(proof.url)} target="_blank" rel="noopener noreferrer nofollow"
          className="inline-flex min-h-11 items-center gap-1 text-[#29B6E8] hover:underline">
          {proof.type === "link" ? "Video-Link" : proof.type === "file" ? "MOSS-Datei" : "Bild"} {index + 1}
          <ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only">(öffnet in neuem Tab)</span>
        </a>
      ))}
      {hidden > 0 ? <span className="text-white/50">{hidden} weitere{hidden === 1 ? "r" : ""} am Spiel, für dich nicht sichtbar</span> : null}
    </div>
  );
}

/** Ende oder Anzahl Spiele einer Sperre - beim Verhängen und beim Bestätigen einer vorläufigen Sperre. */
function PeriodFields({ form, set, limits, testId }) {
  if (!needsPeriod(form)) return null;
  return (
    <FormGrid cols={2}>
      {form.kind === "player_ban" ? (
        <SelectField label="Dauer" value={form.period} onChange={(value) => set("period", value)} testId={`${testId}-period`}
          options={[["matches", "Anzahl Liga-Spiele"], ["until", "Bis zu einem Zeitpunkt"]]}
          hint="Mindestens ein Liga-Spiel, höchstens bis zum Ende der Season. Darüber hinaus: Teamsperre oder Ligaausschluss." />
      ) : null}
      {form.kind === "player_ban" && form.period === "matches" ? (
        <TextField label="Liga-Spiele" type="number" min={1} max={limits?.matches_max || 50} value={form.matches} onChange={(value) => set("matches", value)}
          required testId={`${testId}-matches`} hint="Gezählt werden die nächsten entschiedenen Spiele des Co-Teams." />
      ) : (
        <TextField label="Gesperrt bis" type="datetime-local" value={form.ends_at} onChange={(value) => set("ends_at", value)}
          required={form.kind !== "external"} testId={`${testId}-ends`}
          hint={form.kind === "external" ? "Wiener Zeit. Leer: bis zum Widerruf." : "Wiener Zeit"} />
      )}
    </FormGrid>
  );
}

function SanctionForm({ seasonId, data, onDone, onCancel }) {
  const [form, setForm] = useState(EMPTY_SANCTION_FORM);
  const [proofs, setProofs] = useState([]);
  const [conflictReason, setConflictReason] = useState("");
  const [needsOverride, setNeedsOverride] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const kind = kindOf(data.kinds, form.kind);
  const target = data.targets.find((row) => row.tournament_id === form.tournament_id) || null;
  const squad = target?.squads.find((row) => row.registration_id === form.registration_id) || null;
  const matches = useMemo(() => matchesOf(target, form.registration_id), [target, form.registration_id]);
  const problem = sanctionProblem(form, data.kinds);

  useEffect(() => {
    let alive = true;
    setProofs([]);
    if (!form.match_id) return undefined;
    api.get(`/admin/leagues/seasons/${seasonId}/sanctions/proofs`, { params: { match_id: form.match_id } })
      .then(({ data: found }) => alive && setProofs(found.items || [])).catch(() => alive && setProofs([]));
    return () => { alive = false; };
  }, [seasonId, form.match_id]);

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const { data: created } = await api.post(`/admin/leagues/seasons/${seasonId}/sanctions`,
        { ...sanctionPayload(form, data.kinds), ...overridePayload(needsOverride, conflictReason) });
      toast.success(`${created.kind_label} verhängt.`);
      onDone();
    } catch (failure) {
      // Befangen (403): Der Superadmin bekommt das Feld für die Notausnahme, alle anderen den Satz.
      if (failure.response?.status === 403 && data.superadmin) setNeedsOverride(true);
      setError(errorOf(failure, "Die Strafe konnte nicht gespeichert werden."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSection title="Strafe verhängen" testId="sanction-form" accent="#FF6B60"
      hint="Die Leitung wählt und begründet jede Strafe von Hand. Betroffene sehen Art, Regelverstoß und Begründung unter „Meine Strafen“ und können einmal Einspruch einlegen.">
      <FormGrid cols={2}>
        <SelectField label="Aus dem Strafkatalog (Anlage C)" value={form.catalog_key} testId="sanction-catalog"
          onChange={(value) => setForm((current) => applyCatalog(current, data.catalog.find((row) => row.key === value), data.kinds))}
          options={[["", "Frei eintragen"], ...data.catalog.map((row) => [row.key, `${row.label} → ${row.kind_label}`])]}
          hint="Füllt Art und Regelverstoß vor. Beides kannst du ändern." />
        <SelectField label="Art der Strafe" required value={form.kind} testId="sanction-kind"
          onChange={(value) => setForm((current) => applyKind(current, value, data.kinds))} options={data.kinds.map((row) => [row.key, row.label])} />
      </FormGrid>
      <FormGrid cols={2}>
        {kind?.targets.length > 1 ? (
          <SelectField label="Betrifft" value={form.target_type} onChange={(value) => set("target_type", value)} testId="sanction-target-type"
            options={[["squad", "Ein Co-Team"], ["player", "Eine Person"]]} />
        ) : null}
        <SelectField label="Staffel" required value={form.tournament_id} testId="sanction-staffel"
          onChange={(value) => setForm((current) => ({ ...current, tournament_id: value, registration_id: "", user_id: "", match_id: "", proof_ids: [] }))}
          options={[["", "Bitte wählen"], ...data.targets.map((row) => [row.tournament_id, row.title])]} />
        <SelectField label="Co-Team" required value={form.registration_id} disabled={!target} testId="sanction-squad"
          onChange={(value) => setForm((current) => ({ ...current, registration_id: value, user_id: "", match_id: "", proof_ids: [] }))}
          options={[["", "Bitte wählen"], ...(target?.squads || []).map((row) => [row.registration_id, row.name])]} />
        {form.target_type === "player" ? (
          <SelectField label="Person" required value={form.user_id} disabled={!squad} onChange={(value) => set("user_id", value)} testId="sanction-player"
            options={[["", "Bitte wählen"], ...(squad?.players || []).map((row) => [row.id, row.name])]} />
        ) : null}
        <SelectField label={kind?.match ? "Spiel" : "Spiel (wenn es eines betrifft)"} required={Boolean(kind?.match)} value={form.match_id} disabled={!squad}
          onChange={(value) => setForm((current) => ({ ...current, match_id: value, proof_ids: [] }))} testId="sanction-match"
          options={[["", kind?.match ? "Bitte wählen" : "Kein bestimmtes Spiel"], ...matches.map((row) => [row.id, `Spieltag ${row.matchday || "–"}: ${row.label}`])]}
          hint={kind?.match ? "Das Ergebnis änderst du danach über die Ergebniskorrektur am Spiel." : undefined} />
      </FormGrid>
      {form.match_id ? (
        <div className="space-y-1" data-testid="sanction-proofs">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Nachweise aus dem Spiel</div>
          {proofs.length ? proofs.map((proof, index) => (
            <label key={proof.id} className="flex min-h-11 items-center gap-2 text-sm text-white/80">
              <input type="checkbox" checked={form.proof_ids.includes(proof.id)} data-testid={`sanction-proof-${proof.id}`}
                onChange={(event) => set("proof_ids", event.target.checked ? [...form.proof_ids, proof.id] : form.proof_ids.filter((id) => id !== proof.id))} />
              <span>{proof.type === "link" ? "Video-Link" : proof.type === "file" ? "MOSS-Datei" : "Bild"} {index + 1} · {viennaDateTime(proof.created_at, WHEN)}</span>
              <a href={proof.type === "link" ? proof.link : chatAttachmentSrc(proof.url)} target="_blank" rel="noopener noreferrer nofollow" className="text-[#29B6E8] hover:underline">ansehen</a>
            </label>
          )) : <p className="text-xs text-white/50">Zu diesem Spiel liegen keine Nachweise vor, die du sehen darfst. Sie kommen über Meldung, Vorfall oder Protest am Spiel dazu.</p>}
          <p className="text-xs text-white/45">Angehängte Nachweise bleiben, solange die Strafe läuft oder ein Einspruch offen ist.</p>
        </div>
      ) : null}
      <TextField label="Regelverstoß" required maxLength={200} value={form.rule_ref} onChange={(value) => set("rule_ref", value)} testId="sanction-rule"
        placeholder="z. B. § 13.1 oder Eintrag aus Anlage C.4" hint="Paragraf des Regelwerks oder Eintrag aus dem Strafkatalog." />
      <TextAreaField label="Begründung" required rows={4} value={form.reason} onChange={(value) => set("reason", value)} testId="sanction-reason"
        hint="Sehen die Betroffenen und die Leitung. Dritte sehen sie nicht." />
      {form.kind === "point_deduction" ? (
        <FormGrid cols={2}>
          <TextField label="Punktabzug" type="number" min={1} max={data.limits?.points_max || 99} required value={form.points} onChange={(value) => set("points", value)}
            testId="sanction-points" hint="Wirkt sofort in der Tabelle. Die Tabelle zeigt den Abzug, nicht den Grund." />
        </FormGrid>
      ) : null}
      {kind?.provisional ? (
        <CheckField label="Vorläufig, bis der Fall geprüft ist" checked={form.provisional} onChange={(value) => set("provisional", value)} testId="sanction-provisional"
          hint="Wirkt sofort auf die Spielberechtigung. Danach bestätigst du die Sperre mit Dauer oder widerrufst sie." />
      ) : null}
      <PeriodFields form={form} set={set} limits={data.limits} testId="sanction" />
      {form.kind === "disqualification" ? (
        <p className="rounded-sm border border-warn/40 px-3 py-2 text-sm text-white/85" data-testid="sanction-disqualification-note">
          Das Co-Team scheidet aus. Alle Spiele zählen nach der Regel dieser Season, offene werden kampflos gewertet, das Team steht am Tabellenende.
        </p>
      ) : null}
      {needsOverride ? <ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="sanction-conflict-reason" /> : null}
      {error ? <p className="text-sm text-warn" role="alert" data-testid="sanction-form-error">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={submit} disabled={saving || Boolean(problem) || overrideMissing(needsOverride, conflictReason)}
          className={`${BUTTON} tls-btn--primary`} data-testid="sanction-submit">
          <Gavel className="h-4 w-4" aria-hidden="true" /> {saving ? "Speichere …" : "Strafe verhängen"}
        </button>
        <button type="button" onClick={onCancel} className={`${BUTTON} tls-btn--quiet`} data-testid="sanction-cancel">Abbrechen</button>
        {problem ? <span className="text-xs text-white/55" data-testid="sanction-form-hint">{problem}</span> : null}
      </div>
    </FormSection>
  );
}

/** Ein Schritt an der Karte, der einen Text braucht: Widerruf, Entscheidung über den Einspruch, Bestätigen. */
function CardAction({ item, action, superadmin, seasonId, onDone, onCancel }) {
  const [text, setText] = useState("");
  const [period, setPeriod] = useState({ kind: item.kind, provisional: false, period: "matches", matches: "1", ends_at: "" });
  const [conflictReason, setConflictReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Befangen ist, wer zur betroffenen Seite gehört oder am genannten Spiel beteiligt ist (item.conflict). Lehnt der Server
  // trotzdem mit 403 ab (seit dem Laden beteiligt), bekommt der Superadmin das Feld für die Notausnahme nachträglich.
  const [refused, setRefused] = useState(false);
  const needsOverride = superadmin && (item.own_side || refused);
  const base = `/admin/leagues/seasons/${seasonId}/sanctions/${item.id}`;
  const steps = {
    revoke: { label: "Grund für den Widerruf", button: "Widerrufen", url: `${base}/revoke`, body: () => ({ reason: text.trim() }), done: "Strafe widerrufen." },
    upheld: { label: "Begründung: Strafe bleibt", button: "Strafe bleibt", url: `${base}/appeal/decision`, body: () => ({ decision: "upheld", note: text.trim() }), done: "Einspruch entschieden: Die Strafe bleibt." },
    granted: { label: "Begründung: Strafe aufheben", button: "Strafe aufheben", url: `${base}/appeal/decision`, body: () => ({ decision: "granted", note: text.trim() }), done: "Einspruch entschieden: Die Strafe ist aufgehoben." },
    confirm: { button: "Sperre bestätigen", url: `${base}/confirm`, body: () => periodPayload(period), done: "Sperre bestätigt." },
  };
  const step = steps[action];
  const missing = action === "confirm"
    ? (period.period === "matches" && item.kind === "player_ban" ? !(Number.parseInt(period.matches, 10) >= 1) : !period.ends_at)
    : text.trim().length < 5;
  const run = async () => {
    setSaving(true);
    setError("");
    try {
      await api.post(step.url, { ...step.body(), ...overridePayload(needsOverride, conflictReason) });
      toast.success(step.done);
      onDone();
    } catch (failure) {
      if (failure.response?.status === 403 && superadmin && !item.own_decision) setRefused(true);
      setError(errorOf(failure, "Das hat nicht geklappt."));
      setSaving(false);
    }
  };
  return (
    <div className="mt-3 space-y-3 rounded-sm border border-white/15 bg-[#0A0A0A] p-3" data-testid={`sanction-action-${action}-${item.id}`}>
      {action === "confirm" ? (
        <>
          <p className="text-sm text-white/80">Die vorläufige Sperre wird endgültig. Sie läuft ab ihrem Beginn weiter, die Einspruchsfrist beginnt jetzt.</p>
          <PeriodFields form={period} set={(key, value) => setPeriod((current) => ({ ...current, [key]: value }))} testId={`sanction-confirm-${item.id}`} />
        </>
      ) : (
        <TextAreaField label={step.label} required rows={2} value={text} onChange={setText} testId={`sanction-action-text-${item.id}`}
          hint={action === "revoke" ? "Mindestens fünf Zeichen. Der Widerruf nimmt jede Wirkung zurück, die Betroffenen erfahren es." : "Mindestens fünf Zeichen. Die Entscheidung ist endgültig, die Betroffenen lesen die Begründung."} />
      )}
      {needsOverride && item.conflict === "match" ? <p className="text-xs font-semibold text-white/80">{OWN_MATCH}</p> : null}
      {needsOverride ? <ConflictReasonField value={conflictReason} onChange={setConflictReason} testId={`sanction-action-conflict-${item.id}`} /> : null}
      {error ? <p className="text-sm text-warn" role="alert" data-testid={`sanction-action-error-${item.id}`}>{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={run} disabled={saving || missing || overrideMissing(needsOverride, conflictReason)}
          className={`${BUTTON} ${action === "revoke" || action === "granted" ? "tls-btn--danger" : "tls-btn--primary"}`} data-testid={`sanction-action-run-${item.id}`}>
          {saving ? "Speichere …" : step.button}
        </button>
        <button type="button" onClick={onCancel} className={`${BUTTON} tls-btn--quiet`}>Abbrechen</button>
      </div>
    </div>
  );
}

/** Der Satz, warum die Knöpfe fehlen: eigenes Team oder am genannten Spiel beteiligt. */
function ConflictNote({ item }) {
  if (item.conflict === "match") return <p className="text-xs font-semibold text-white/80" data-testid={`sanction-own-team-${item.id}`}>{OWN_MATCH}</p>;
  return <OwnTeamNote testId={`sanction-own-team-${item.id}`} />;
}

function SanctionCard({ item, superadmin, seasonId, onChanged }) {
  const [action, setAction] = useState("");
  const status = SANCTION_STATUS[item.status] || SANCTION_STATUS.active;
  const appeal = item.appeal;
  const blocked = item.own_side && !superadmin;
  const now = Date.now();
  const done = () => { setAction(""); onChanged(); };
  return (
    <li className={`rounded-sm border bg-[#0A0A0A] p-4 ${appeal?.state === "open" ? "border-honor/40" : "border-white/10"}`} data-testid={`sanction-${item.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <div className="font-heading text-lg font-black uppercase leading-tight text-white">{item.kind_label}</div>
          <div className="text-sm text-white/80">
            {item.target_name || "Gelöschter User"}{item.target_type === "player" && item.squad_name ? <span className="text-white/50"> · {item.squad_name}</span> : null}
            {item.other_season ? <span className="text-white/50"> · aus einer anderen Season dieser Liga</span> : null}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${CHIP[status.tone]}`} data-testid={`sanction-status-${item.id}`}>{status.label}</span>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-white/50">Regelverstoß</dt><dd className="min-w-0 break-words text-white/90">{item.rule_ref}</dd>
        <dt className="text-white/50">Begründung</dt><dd className="min-w-0 whitespace-pre-line break-words text-white/90">{item.reason}</dd>
        {item.period ? <><dt className="text-white/50">{item.points ? "Höhe" : "Zeitraum"}</dt><dd className="tabular-nums text-white/90" data-testid={`sanction-period-${item.id}`}>{item.period}</dd></> : null}
        <dt className="text-white/50">Verhängt</dt><dd className="text-white/70">{viennaDateTime(item.created_at, WHEN)}{item.created_by_name ? ` von ${item.created_by_name}` : ""}</dd>
        {item.status === "revoked" ? (
          <><dt className="text-white/50">Widerrufen</dt><dd className="min-w-0 break-words text-white/70">{viennaDateTime(item.revoked_at, WHEN)}{item.revoked_by_name ? ` von ${item.revoked_by_name}` : ""}: {item.revoke_reason}</dd></>
        ) : null}
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {item.match_id ? <Link to={`/matches/${item.match_id}`} className="inline-flex min-h-11 items-center text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:underline" data-testid={`sanction-match-${item.id}`}>Zum Spiel</Link> : null}
        <ProofLinks proofs={item.proofs || []} count={item.proof_count || 0} testId={`sanction-proofs-${item.id}`} />
      </div>

      {appeal ? (
        <div className="mt-3 rounded-sm border border-honor/30 p-3" data-testid={`sanction-appeal-${item.id}`}>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-honor"><Scale className="h-3.5 w-3.5" aria-hidden="true" /> {APPEAL_STATE_LABELS[appeal.state]}</div>
          <p className="mt-1 text-xs text-white/50">{appeal.by_name || "Gelöschter User"} · {viennaDateTime(appeal.at, WHEN)}</p>
          <p className="mt-1 whitespace-pre-line break-words text-sm text-white/90">{appeal.text}</p>
          {appeal.note ? <p className="mt-2 break-words text-sm text-white/75">Entscheidung{item.decided_by_name ? ` von ${item.decided_by_name}` : ""}: {appeal.note}</p> : null}
          {appeal.state === "open" && !action ? (
            item.own_decision ? <p className="mt-2 text-xs font-semibold text-white/80" data-testid={`sanction-own-decision-${item.id}`}>{OWN_DECISION}</p>
              : blocked ? <div className="mt-2"><ConflictNote item={item} /></div> : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setAction("upheld")} className={`${BUTTON} tls-btn--secondary`} data-testid={`sanction-appeal-uphold-${item.id}`}>Strafe bleibt</button>
                  <button type="button" onClick={() => setAction("granted")} className={`${BUTTON} tls-btn--secondary`} data-testid={`sanction-appeal-grant-${item.id}`}>Strafe aufheben</button>
                </div>
              )
          ) : null}
        </div>
      ) : item.status !== "revoked" && item.state === "final" && item.appeal_until ? (
        <p className={`mt-2 text-xs tabular-nums ${TONE[item.can_appeal ? deadlineTone(item.appeal_until, now) : "over"]}`} data-testid={`sanction-deadline-${item.id}`}>
          {item.can_appeal ? `Einspruch möglich, Frist ${remainingText(item.appeal_until, now)}` : "Einspruchsfrist abgelaufen, kein Einspruch"}
        </p>
      ) : null}

      {item.status !== "revoked" && !action ? (
        blocked ? (appeal?.state === "open" ? null : <div className="mt-3"><ConflictNote item={item} /></div>) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {item.status === "provisional" ? (
              <button type="button" onClick={() => setAction("confirm")} className={`${BUTTON} tls-btn--primary`} data-testid={`sanction-confirm-${item.id}`}>Sperre bestätigen</button>
            ) : null}
            <button type="button" onClick={() => setAction("revoke")} className={`${BUTTON} tls-btn--quiet`} data-testid={`sanction-revoke-${item.id}`}>
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Widerrufen
            </button>
          </div>
        )
      ) : null}
      {action ? <CardAction item={item} action={action} superadmin={superadmin} seasonId={seasonId} onDone={done} onCancel={() => setAction("")} /> : null}
    </li>
  );
}

export function SeasonSanctionsTab({ seasonId }) {
  const [state, setState] = useState({ status: "loading", data: null, error: "" });
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("current");
  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/leagues/seasons/${seasonId}/sanctions`);
      setState({ status: "ready", data, error: "" });
    } catch (failure) {
      setState({ status: "error", data: null, error: errorOf(failure, "Die Strafen ließen sich nicht laden.") });
    }
  }, [seasonId]);
  useEffect(() => { load(); }, [load]);

  if (state.status === "loading") return <p className="text-sm text-white/50">Strafen werden geladen …</p>;
  if (state.status === "error") return <p className="text-sm text-warn" role="alert" data-testid="season-sanctions-error">{state.error}</p>;
  const { data } = state;
  const current = data.items.filter((row) => ["provisional", "active"].includes(row.status) || row.appeal?.state === "open");
  const shown = filter === "current" ? current : data.items;
  return (
    <div className="space-y-6">
      {adding ? (
        <SanctionForm seasonId={seasonId} data={data} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />
      ) : null}
      <FormSection title="Strafen dieser Season" testId="season-sanctions"
        hint={`Wettbewerbsstrafen nach Regelwerk § 13 und Anlage C. Einspruch einmal je Strafe, innerhalb von ${data.appeal_hours} Stunden ab der endgültigen Entscheidung (Reiter „Proteste“). Verwarnungen der Community-Moderation stehen nicht hier.`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-white/75" data-testid="season-sanctions-count">
            <strong className="text-white">{current.length}</strong> {current.length === 1 ? "Strafe läuft" : "Strafen laufen"}
            {data.open_appeals ? <span className="text-honor"> · {data.open_appeals} {data.open_appeals === 1 ? "Einspruch wartet" : "Einsprüche warten"}</span> : null}
          </p>
          {!adding ? (
            <button type="button" onClick={() => setAdding(true)} disabled={!data.targets.some((row) => row.squads.length)}
              className={`${BUTTON} tls-btn--primary`} data-testid="sanction-add">
              <Plus className="h-4 w-4" aria-hidden="true" /> Strafe verhängen
            </button>
          ) : null}
        </div>
        <div className="flex gap-2" role="group" aria-label="Strafen filtern">
          {[["current", `Laufend (${current.length})`], ["all", `Alle (${data.items.length})`]].map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} data-testid={`sanction-filter-${key}`}
              className={`${BUTTON} ${filter === key ? "tls-btn--secondary" : "tls-btn--quiet"}`}>{label}</button>
          ))}
        </div>
        {!data.targets.some((row) => row.squads.length) ? <p className="text-sm text-white/60" data-testid="season-sanctions-no-teams">In dieser Season ist noch kein Co-Team einer Staffel zugeteilt.</p> : null}
        {shown.length ? (
          <ul className="tls-stagger space-y-3" data-testid="season-sanctions-list">
            {shown.map((item) => <SanctionCard key={item.id} item={item} superadmin={data.superadmin} seasonId={seasonId} onChanged={load} />)}
          </ul>
        ) : (
          <p className="text-sm text-white/60" data-testid="season-sanctions-empty">
            {filter === "current" && data.items.length ? "Gerade läuft keine Strafe. Unter „Alle“ stehen die abgelaufenen und widerrufenen." : "In dieser Season wurde noch keine Strafe verhängt."}
          </p>
        )}
      </FormSection>
    </div>
  );
}
