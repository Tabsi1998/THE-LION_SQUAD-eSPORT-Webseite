// Startrechte für die nächste Season (#1627, docs/LIGA.md „F.2a Startrechte für die nächste Season“), Reiter „Anmeldung und Kader“,
// Sprungmarke `#startrechte`: die Einstellung der Season (automatisch dabei oder mit Zusage, Frist, Nachrückerregel, Nachricht) und -
// in einer Season aus dem Vorgänger - die Übersicht: je Co-Team der Stand mit Frist, frei gewordene Plätze mit Vorschlag, wer für wen
// nachgerückt ist und warum. Zustände, Fristen und Kandidaten rechnet der Server. Ohne die Einstellung bleibt alles wie in F.2.
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CircleAlert, Minus } from "lucide-react";
import { toast } from "sonner";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { ConflictReasonField, OwnTeamNote, overrideMissing, overridePayload } from "@/components/tls/league/ConflictOverride";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { api, formatApiError } from "@/lib/api";
import { STATE_CLASS } from "@/lib/leagueApplications";
import { MODE_OPTIONS, SUCCESSOR_OPTIONS, countsLine, openRightsQuestion, placeLine, settingsForm, settingsPayload, stateLabel, stateTone, untilText, whyText } from "@/lib/leagueStartRights";
import { MOVEMENT_TEXT, teamFrom } from "@/lib/leagueSuccessor";

const BUTTON = "inline-flex min-h-[44px] items-center rounded-sm px-3 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50";
const REASON_MIN = 5;
const MOVE_ICON = { up: ArrowUp, down: ArrowDown, stay: Minus };
const MOVE_CLASS = { up: "text-ok", down: "text-warn", stay: "text-white/45" };
const TONE_CLASS = { ...STATE_CLASS, muted: STATE_CLASS.quiet };

function StateBadge({ state }) {
  return (
    <span data-state={state} className={`inline-flex shrink-0 rounded-sm border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${TONE_CLASS[stateTone(state)]}`}>
      {stateLabel(state)}
    </span>
  );
}

/** Zusage für das Team eintragen: mit Grund - über das eigene Team entscheidet eine andere Person. */
function AcceptSheet({ seasonId, row, superadmin, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [saving, setSaving] = useState(false);
  const blockedOwn = Boolean(row.own_team && !superadmin);
  const needsReason = Boolean(row.own_team && superadmin);
  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await api.post(`/admin/leagues/seasons/${seasonId}/start-rights/${row.application_id}/accept`,
        { reason: reason.trim(), ...overridePayload(needsReason, conflictReason) });
      toast.success("Zusage eingetragen. Das Team bekommt eine Nachricht.");
      onDone();
    } catch (failure) {
      toast.error(formatApiError(failure.response?.data?.detail));
      setSaving(false);
    }
  };
  return (
    <AdminSheet title="Zusage eintragen" eyebrow={`${row.display_name} · ${row.division_label}`} onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel="Zusage eintragen" savingLabel="Trage ein …" submitTestId="start-right-accept-confirm" testId="start-right-accept-sheet"
      submitDisabled={blockedOwn || reason.trim().length < REASON_MIN || overrideMissing(needsReason, conflictReason)}>
      <div className="space-y-4 text-sm">
        <p className="text-white/75">
          Das Team hat dir zugesagt, aber nicht selbst auf „Startrecht annehmen“ gedrückt? Dann trägst du die Zusage hier ein.
          Sie ist keine Zuteilung und keine Zustimmung zum Regelwerk.
        </p>
        <TextAreaField label="Grund" required rows={2} value={reason} onChange={setReason} testId="start-right-accept-reason"
          hint="Mindestens fünf Zeichen, etwa „Zusage per Nachricht am 03.12.“. Steht im Verlauf und im Protokoll." />
        {blockedOwn ? <OwnTeamNote testId="start-right-accept-own-team" /> : null}
        {needsReason ? <ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="start-right-accept-conflict-reason" /> : null}
      </div>
    </AdminSheet>
  );
}

/** Nachrücken auslösen: einer der vorgeschlagenen Kandidaten, mit Grund. Bei Gleichstand wählt die Leitung - ein Los gibt es nicht. */
function FillSheet({ seasonId, place, superadmin, onClose, onDone }) {
  const [candidateId, setCandidateId] = useState(place.pick || "");
  const [reason, setReason] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [saving, setSaving] = useState(false);
  const chosen = place.candidates.find((row) => row.application_id === candidateId) || null;
  const blockedOwn = Boolean(chosen?.own_team && !superadmin);
  const needsReason = Boolean(chosen?.own_team && superadmin);
  const submit = async (event) => {
    event.preventDefault();
    if (saving || !chosen) return;
    setSaving(true);
    try {
      await api.post(`/admin/leagues/seasons/${seasonId}/start-rights/${place.application_id}/fill`,
        { candidate_id: chosen.application_id, reason: reason.trim(), ...overridePayload(needsReason, conflictReason) });
      toast.success(`${chosen.display_name} rückt nach und bekommt eine Nachricht.`);
      onDone();
    } catch (failure) {
      toast.error(formatApiError(failure.response?.data?.detail));
      setSaving(false);
    }
  };
  return (
    <AdminSheet title="Nachrücken lassen" eyebrow={`${place.division_label} · Platz von ${place.display_name}`} onClose={onClose} onSubmit={submit}
      saving={saving} submitLabel="Nachrücken lassen" savingLabel="Trage ein …" submitTestId="start-right-fill-confirm" testId="start-right-fill-sheet"
      submitDisabled={!chosen || blockedOwn || reason.trim().length < REASON_MIN || overrideMissing(needsReason, conflictReason)}>
      <div className="space-y-4 text-sm">
        <p className="text-white/75" data-testid="start-right-fill-intro">{placeLine(place)}</p>
        <fieldset className="space-y-1">
          <legend className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Wer rückt nach?</legend>
          {place.candidates.map((row) => (
            <label key={row.application_id} className="flex min-h-[44px] items-center gap-2 rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2">
              <input type="radio" name="start-right-candidate" value={row.application_id} checked={candidateId === row.application_id}
                onChange={() => setCandidateId(row.application_id)} data-testid={`start-right-fill-candidate-${row.application_id}`} className="shrink-0 accent-[#29B6E8]" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="block font-semibold text-white">{row.display_name}</span>
                <span className="block text-xs text-white/60">{teamFrom(row)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <TextAreaField label="Grund" required rows={2} value={reason} onChange={setReason} testId="start-right-fill-reason"
          hint="Mindestens fünf Zeichen. Steht im Verlauf und im Protokoll." />
        <p className="text-xs text-white/55">
          Das Team kann den Platz ablehnen oder die Frist verstreichen lassen – dann bleibt es in seiner Liga, und der Platz ist wieder frei.
        </p>
        {blockedOwn ? <OwnTeamNote testId="start-right-fill-own-team" /> : null}
        {needsReason ? <ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="start-right-fill-conflict-reason" /> : null}
      </div>
    </AdminSheet>
  );
}

function RightRow({ row, canAct, onAccept }) {
  const Icon = MOVE_ICON[row.movement] || Minus;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-2.5" data-testid={`start-right-${row.application_id}`}>
      <div className="flex min-w-0 flex-1 basis-64 items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${MOVE_CLASS[row.movement] || ""}`} aria-hidden="true" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 font-semibold text-white [overflow-wrap:anywhere]">{row.display_name}</span>
            <StateBadge state={row.state} />
          </div>
          <p className="mt-0.5 text-xs text-white/60 [overflow-wrap:anywhere]">{MOVEMENT_TEXT[row.movement]} · {teamFrom(row)}{row.via === "relegation" ? " · über die Relegation" : ""}</p>
          {row.state === "offered" && row.waits_for_lead ? <p className="mt-0.5 text-xs font-semibold text-warn">Frist vorbei – jetzt entscheidest du: Zusage eintragen oder im Eingang ablehnen.</p> : null}
          {row.state === "offered" && row.paused ? <p className="mt-0.5 text-xs text-white/85">Frist ruht, solange der Endstand geprüft wird</p> : null}
          {row.state === "offered" && row.accept_until && !row.waits_for_lead && !row.paused ? <p className="mt-0.5 text-xs text-white/85">Zusage bis {untilText(row.accept_until)}</p> : null}
          {row.state === "accepted" && row.accepted_via === "lead" ? (
            <p className="mt-0.5 text-xs text-white/60 [overflow-wrap:anywhere]">Von der Leitung eingetragen{row.accepted_by_name ? ` (${row.accepted_by_name})` : ""}: {row.accept_reason}</p>
          ) : null}
          {row.state === "participating" && row.staffel ? <p className="mt-0.5 text-xs text-white/60">{row.staffel}</p> : null}
          {row.fills ? (
            <p className="mt-0.5 text-xs text-white/85 [overflow-wrap:anywhere]" data-testid={`start-right-fills-${row.application_id}`}>
              Nachgerückt für {row.fills.for_name} ({whyText(row.fills.why)}){row.fills.by ? ` – ausgelöst von ${row.fills.by_name || "der Leitung"}: ${row.fills.reason}` : " – nach der Regel"}. Vorher: {row.fills.back_label}.
            </p>
          ) : null}
          {row.filled_by ? <p className="mt-0.5 text-xs text-white/60 [overflow-wrap:anywhere]">Der Platz ging an {row.filled_by.display_name}.</p> : null}
        </div>
      </div>
      {canAct && row.state === "offered" ? (
        <button type="button" onClick={() => onAccept(row)} className={`tls-btn tls-btn--quiet ${BUTTON}`} data-testid={`start-right-accept-${row.application_id}`}>Zusage eintragen</button>
      ) : null}
    </li>
  );
}

export function SeasonStartRightsPanel({ seasonId, canSeason = false, canApplications = false, version }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [accepting, setAccepting] = useState(null);
  const [filling, setFilling] = useState(null);
  // Rückfrage vor dem Ausschalten oder Umschalten (Entscheidung 26.11.): im Panel, nicht als Browser-Dialog.
  const [asking, setAsking] = useState(false);
  const url = `/admin/leagues/seasons/${seasonId}/start-rights`;
  // Die Übersicht lädt nach (jemand sagt zu, eine Frist verfällt) - das Formular bleibt, wie es gerade bearbeitet wird.
  const load = useCallback(async (resetForm = false) => {
    try {
      const { data: body } = await api.get(url);
      if (!body || typeof body.active !== "boolean") return;
      setData({ ...body, rows: body.rows || [], open_places: body.open_places || [], defaults: body.defaults || {}, counts: body.counts || {} });
      setForm((current) => (current && !resetForm ? current : settingsForm(body.settings, body.defaults)));
      setError("");
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Die Startrechte konnten nicht geladen werden.");
    }
  }, [url]);
  useEffect(() => { load(); }, [load, version]);
  useApiInvalidation(() => load(), ["leagues"]);

  if (!data || !form) return error ? <p className="text-sm text-warn" role="alert" data-testid="start-rights-error">{error}</p> : null;
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const question = openRightsQuestion(form, data.open_rights);
  const save = async (confirmed = false) => {
    // Offene Startrechte würden als zugesagt gelten: erst fragen, dann speichern.
    if (question && !confirmed) {
      setAsking(true);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { data: body } = await api.put(url, settingsPayload(form, confirmed));
      setData({ ...body, rows: body.rows || [], open_places: body.open_places || [], defaults: body.defaults || {}, counts: body.counts || {} });
      setForm(settingsForm(body.settings, body.defaults));
      setAsking(false);
      toast.success(body.active ? "Startrechte gespeichert." : "Startrechte aus – es bleibt bei „automatisch dabei“.");
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Die Startrechte konnten nicht gespeichert werden.");
      // Der Server fragt ebenfalls nach (409), wenn inzwischen ein Startrecht offen ist: Die Übersicht neu laden, dann steht die Rückfrage da.
      if (failure.response?.status === 409) await load();
    } finally {
      setSaving(false);
    }
  };
  const accept = form.active && form.mode === "accept";
  const divisions = [];
  for (const row of data.rows) {
    const last = divisions.at(-1);
    if (last && last.label === row.division_label) last.rows.push(row);
    else divisions.push({ label: row.division_label, level: row.division_level, rows: [row] });
  }
  const canFill = canApplications && !data.paused && !data.started;
  const done = () => { setAccepting(null); setFilling(null); load(); };

  return (
    <div id="startrechte" className="scroll-mt-24">
      <FormSection title="Startrechte" testId="season-start-rights"
        hint="Wie Co-Teams aus der Vorgänger-Season ihren Platz in dieser Season bekommen: automatisch oder mit Zusage innerhalb einer Frist – und wer nachrückt, wenn ein Platz frei wird. Ein Startrecht ist keine Zuteilung, keine Zustimmung zum Regelwerk und keine Pflicht mitzuspielen.">
        {!canSeason ? (
          <p className="rounded-sm border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-white/75" data-testid="start-rights-readonly">
            Nur lesen: Die Einstellung ändert, wer für diese Liga „Season konfigurieren“ hat.
          </p>
        ) : null}
        <CheckField label="Startrechte führen" checked={form.active} onChange={(value) => set("active", value)} disabled={!canSeason}
          testId="start-rights-active" className="min-h-[44px]"
          hint={form.active ? "An: Es gelten die Werte unten. Die neue Season aus dieser übernimmt sie als Vorgabe."
            : "Aus: Co-Teams aus der Vorgänger-Season sind automatisch dabei, wer nicht will, meldet sich ab. Nachrücken entscheidet die Leitung im Eingang."} />
        {form.active ? (
          <>
            <FormGrid cols={2}>
              <SelectField label="So bekommen die Teams ihren Platz" value={form.mode} onChange={(value) => set("mode", value)} options={MODE_OPTIONS}
                disabled={!canSeason} testId="start-rights-mode"
                hint="Mit Zusage: Das Team sagt innerhalb der Frist zu, sonst verfällt das Startrecht. Automatisch dabei: Wer nicht will, meldet sich ab." />
              <TextField label="Frist für die Zusage (Tage)" type="number" min={1} max={60} value={form.accept_days ?? ""} onChange={(value) => set("accept_days", value)}
                disabled={!canSeason || !accept} testId="start-rights-days"
                hint={`Vorgabe ${data.defaults.accept_days}. Zählt ab der Vergabe, für Nachrücker ab dem Nachrücken – und endet spätestens mit dem Start der Season.`} />
              <SelectField label="Wird ein Platz frei" value={form.successor} onChange={(value) => set("successor", value)} options={SUCCESSOR_OPTIONS}
                disabled={!canSeason} testId="start-rights-successor"
                hint="Die Regel: nach einem abgelehnten Aufstieg der beste Nicht-Aufsteiger, sonst der beste Absteiger (er bleibt). Bei Gleichstand wählst immer du." />
              <TextField label="Erinnerung vor Fristende (Stunden)" type="number" min={0} max={336} value={form.remind_hours ?? ""} onChange={(value) => set("remind_hours", value)}
                disabled={!canSeason || !accept} testId="start-rights-remind" hint={`Vorgabe ${data.defaults.remind_hours} · 0 = keine Erinnerung`} />
              {form.rest_days !== undefined ? (
                <TextField label="Restfrist nach einem Nachrück-Angebot (Tage)" type="number" min={0} max={30} value={form.rest_days ?? ""} onChange={(value) => set("rest_days", value)}
                  disabled={!canSeason || !accept} testId="start-rights-rest"
                  hint={`Vorgabe ${data.defaults.rest_days ?? 3}. Solange ein Nachrück-Angebot offen ist, ruht die eigene Frist. Wer es verstreichen lässt, hat danach in der eigenen Liga mindestens so viele Tage für die Zusage.`} />
              ) : null}
            </FormGrid>
            <CheckField label="Nachricht „Aufstieg bestätigt“ bzw. „Abstieg bestätigt“" checked={form.announce} onChange={(value) => set("announce", value)}
              disabled={!canSeason} testId="start-rights-announce" className="min-h-[44px]"
              hint="Einmal an Captain und Vertreter, sobald der Endstand dieser Season samt Playoffs und Relegation feststeht. Nie aus einer laufenden Tabelle." />
          </>
        ) : null}
        {error ? <p className="text-sm text-warn" role="alert" data-testid="start-rights-error">{error}</p> : null}
        {canSeason && asking && question ? (
          <div className="space-y-2 rounded-sm border border-warn/50 bg-warn/10 p-3 text-sm text-white" role="alertdialog" aria-labelledby="start-rights-confirm-title"
            data-testid="start-rights-confirm-open">
            <p id="start-rights-confirm-title" className="font-semibold">{form.active ? "Auf „Automatisch dabei“ umschalten?" : "Startrechte ausschalten?"}</p>
            <p>{question} Zurücknehmen lässt sich das nicht – wer nicht mitspielen will, meldet sich dann ab.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => save(true)} disabled={saving} data-testid="start-rights-confirm-yes" className={`tls-btn tls-btn--primary ${BUTTON}`}>
                {saving ? "Speichere …" : form.active ? "Ja, umschalten" : "Ja, ausschalten"}
              </button>
              <button type="button" onClick={() => setAsking(false)} disabled={saving} data-testid="start-rights-confirm-cancel" className={`tls-btn tls-btn--secondary ${BUTTON}`}>
                Abbrechen
              </button>
            </div>
          </div>
        ) : null}
        {canSeason && !(asking && question) ? (
          <button type="button" onClick={() => save(false)} disabled={saving} data-testid="start-rights-save" className={`tls-btn tls-btn--primary ${BUTTON} px-4`}>
            {saving ? "Speichere …" : "Startrechte speichern"}
          </button>
        ) : null}

        {data.active && data.predecessor && data.rows.length ? (
          <div className="space-y-3 border-t border-white/10 pt-4">
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Startrechte aus {data.predecessor.name}</h3>
              {countsLine(data.counts) ? <p className="mt-1 text-sm text-white/85" data-testid="start-rights-counts">{countsLine(data.counts)}</p> : null}
            </div>
            {data.paused ? (
              <p className="flex gap-2 rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-white" role="status" data-testid="start-rights-paused">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                <span>{data.predecessor.name} ist wieder geöffnet: Der Endstand wird geprüft. Die Fristen stehen still und laufen danach um die Dauer der Pause länger. Zusagen geht weiter, aber kein Startrecht verfällt und niemand rückt nach. Nach dem neuen Abschluss oben „Übernahme neu berechnen“.</span>
              </p>
            ) : null}
            {data.started && data.open_rights > 0 ? (
              <p className="flex gap-2 rounded-sm border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-white/85" role="status" data-testid="start-rights-started">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                <span>Das Startdatum ist erreicht: Ab jetzt verfällt kein Startrecht mehr von selbst, und niemand rückt automatisch nach. Offene Zusagen entscheidest du – „Zusage eintragen“ oder im Eingang ablehnen.</span>
              </p>
            ) : null}
            {data.open_places.length ? (
              <ul className="space-y-2" data-testid="start-rights-places">
                {data.open_places.map((place) => (
                  <li key={place.application_id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-warn/40 px-3 py-2"
                    data-testid={`start-right-place-${place.application_id}`}>
                    <span className="min-w-0 flex-1 basis-64 text-sm text-white/90 [overflow-wrap:anywhere]">{placeLine(place, { paused: data.paused, started: data.started })}</span>
                    {canFill && place.candidates.length ? (
                      <button type="button" onClick={() => setFilling(place)} className={`tls-btn tls-btn--secondary ${BUTTON}`} data-testid={`start-right-fill-${place.application_id}`}>Nachrücken lassen</button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid gap-3 lg:grid-cols-2" data-testid="start-rights-rows">
              {divisions.map((division) => (
                <div key={division.label} className="min-w-0 rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid={`start-rights-division-${division.level}`}>
                  <h4 className="font-bold text-white [overflow-wrap:anywhere]">{division.label}</h4>
                  <ul className="mt-1 divide-y divide-white/5">
                    {division.rows.map((row) => <RightRow key={row.application_id} row={row} canAct={canApplications && data.active} onAccept={setAccepting} />)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </FormSection>
      {accepting ? <AcceptSheet seasonId={seasonId} row={accepting} superadmin={Boolean(data.superadmin)} onClose={() => setAccepting(null)} onDone={done} /> : null}
      {filling ? <FillSheet seasonId={seasonId} place={filling} superadmin={Boolean(data.superadmin)} onClose={() => setFilling(null)} onDone={done} /> : null}
    </div>
  );
}
