// Staffeln auslosen (docs/LIGA.md, „B.4 Los auf mehrere Staffeln“, #1623): Hat eine Liga N mehrere Staffeln, verteilt ein Los die
// angenommenen Co-Teams - ausgeglichen, Co-Teams eines Hauptteams getrennt. Erst die Vorschau (Seed gespeichert, neu laden würfelt nicht
// neu), dann Tausch mit Grund, dann „Übernehmen“: Erst dort entstehen Zuteilungen und Nachrichten. Dazu die Platzprüfung: Passen die
// Teams in die Staffeln, die es gibt? Gelost und geprüft wird auf dem Server.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, CircleAlert, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextField } from "@/components/tls/FormFields";
import { ConflictReasonField, OwnTeamNote, overrideMissing, overridePayload } from "@/components/tls/league/ConflictOverride";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { api, formatApiError } from "@/lib/api";
import { DRAW_REASON_MIN, divisionNeedsDraw, drawLogLine, drawStatusLine, drawVisible, drawWhen, staffelnLine, swapPartners, waitingLine } from "@/lib/leagueDraw";

const BUTTON = "inline-flex min-h-[40px] items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50";
const HEADING = "text-[11px] font-bold uppercase tracking-[0.2em] text-white/50";
const REASON_HINT = { redraw: "Warum neu gelost wird. Der Grund steht im Protokoll.", discard: "Warum das Los verworfen wird. Der Grund steht im Protokoll." };
const REASON_ACTION = { redraw: "Neu auslosen", discard: "Los verwerfen" };

/** Platzprüfung einer Liga N: passt = ruhig, passt nicht = Warnung mit dem Satz des Servers. */
export function SeatCheck({ suggestion, testId }) {
  if (!suggestion?.text) return null;
  const Icon = suggestion.fits ? CircleCheck : CircleAlert;
  return (
    <p className={`flex gap-2 text-sm [overflow-wrap:anywhere] ${suggestion.fits ? "text-white/70" : "text-warn"}`} data-testid={testId} data-fits={suggestion.fits ? "yes" : "no"}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${suggestion.fits ? "text-ok" : ""}`} aria-hidden="true" />
      <span><span className="sr-only">{suggestion.fits ? "Passt: " : "Passt nicht: "}</span>{suggestion.text}</span>
    </p>
  );
}

function StaffelCard({ staffel, canSwap, onSwap, active }) {
  return (
    <div className="min-w-0 rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid={`draw-staffel-${staffel.staffel}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-bold text-white">Staffel {staffel.staffel}</h4>
        <span className="text-xs tabular-nums text-white/55">{staffel.size} von {staffel.capacity} Plätzen</span>
      </div>
      <ul className="mt-2 divide-y divide-white/5">
        {staffel.seated.map((name) => (
          <li key={`seated-${name}`} className="py-2 text-sm text-white/55 [overflow-wrap:anywhere]">{name} <span className="text-xs">· schon zugeteilt</span></li>
        ))}
        {staffel.teams.map((team) => (
          <li key={team.squad_id} className="flex min-w-0 items-center gap-2 py-1" data-testid={`draw-team-${team.squad_id}`}>
            <span className="min-w-0 flex-1 py-1 text-sm font-semibold text-white [overflow-wrap:anywhere]">
              {team.display_name}
              {team.swapped ? <span className="ml-2 rounded-sm bg-white/5 px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-white/60">getauscht</span> : null}
            </span>
            {canSwap ? (
              <button type="button" onClick={() => onSwap(team)} aria-pressed={active === team.squad_id} aria-label={`${team.display_name} tauschen`}
                className={`tls-btn tls-btn--quiet inline-flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center rounded-sm ${active === team.squad_id ? "text-[#29B6E8]" : ""}`}
                data-testid={`draw-swap-open-${team.squad_id}`}>
                <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </li>
        ))}
        {!staffel.seated.length && !staffel.teams.length ? <li className="py-2 text-sm text-white/50">Kein Team.</li> : null}
      </ul>
    </div>
  );
}

export function DrawSheet({ seasonId, division, superadmin, onClose, onChanged }) {
  const [draw, setDraw] = useState(division.draw);
  const [busy, setBusy] = useState(false);
  const [swapFrom, setSwapFrom] = useState(null);
  const [swapWith, setSwapWith] = useState("");
  const [swapReason, setSwapReason] = useState("");
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const url = `/admin/leagues/seasons/${seasonId}/draws/${division.id}`;
  const open = draw?.status === "draft";
  // Befangenheit (Nr. 73): Steht das eigene Team im Los, macht es eine andere Person; der Superadmin nur mit Grund.
  const blockedOwn = Boolean(division.own_team && !superadmin);
  const needsReason = Boolean(division.own_team && superadmin);
  const override = overridePayload(needsReason, conflictReason);
  const locked = busy || blockedOwn || overrideMissing(needsReason, conflictReason);
  const count = (draw?.staffeln || []).reduce((sum, staffel) => sum + staffel.teams.filter((team) => !team.done).length, 0);

  const send = async (action, body, done) => {
    setBusy(true);
    try {
      const { data } = await api.post(action ? `${url}/${action}` : url, { ...body, ...override });
      setDraw(data.draw);
      setSwapFrom(null);
      setSwapWith("");
      setSwapReason("");
      setMode(null);
      setReason("");
      await done?.(data);
    } catch (failure) {
      toast.error(formatApiError(failure.response?.data?.detail));
      // Hat sich etwas geändert, steht gleich der neue Stand da.
      await onChanged({ refresh: setDraw });
    }
    setBusy(false);
  };

  const submit = (event) => {
    event.preventDefault();
    if (!open || draw.stale || locked) return;
    send("apply", { fingerprint: draw.fingerprint, confirm: true }, async (data) => {
      toast.success(`${data.assigned === 1 ? "1 Co-Team" : `${data.assigned} Co-Teams`} zugeteilt. Die Teams bekommen eine Nachricht.`);
      await onChanged({ close: true });
    });
  };
  const partners = swapFrom ? swapPartners(draw, swapFrom.squad_id) : [];
  const toggle = (next) => { setMode((current) => (current === next ? null : next)); setReason(""); };

  return (
    <AdminSheet title={`Los ${division.label}`} eyebrow={open ? "Vorschau" : "Übernommen"} size="xl" onClose={onClose} onSubmit={open ? submit : undefined} saving={busy}
      savingLabel="Einen Moment …" submitLabel={count === 1 ? "1 Co-Team zuteilen" : `${count} Co-Teams zuteilen`} submitTestId="draw-apply"
      submitDisabled={!open || draw.stale || locked || !count} cancelLabel={open ? "Schließen" : "Zurück"} testId="draw-sheet">
      {draw ? (
        <div className="space-y-5 text-sm">
          <div className="space-y-1">
            <p className="font-semibold text-white" data-testid="draw-status">{drawStatusLine(draw)}</p>
            <p className="text-xs text-white/60 [overflow-wrap:anywhere]">
              Ausgelost {drawWhen(draw.created_at)} · Seed <code className="font-mono text-white/80" data-testid="draw-seed">{draw.seed}</code>. Dieselbe Eingabe mit diesem Seed ergibt immer dieses Ergebnis.
            </p>
          </div>
          {open && draw.stale ? (
            <div className="space-y-2 rounded-sm border border-warn/40 p-3" role="alert" data-testid="draw-stale">
              <p className="flex gap-2 text-warn"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> <span>Seit dem Los hat sich etwas geändert: eine Anmeldung, eine Staffel oder ihre Teilnehmer. So lässt es sich nicht übernehmen.</span></p>
              <button type="button" disabled={locked} onClick={() => send("redraw", {})} className={`tls-btn tls-btn--primary ${BUTTON}`} data-testid="draw-redraw-stale">Neu auslosen</button>
            </div>
          ) : null}

          <section aria-labelledby="draw-result" className="space-y-2">
            <h3 id="draw-result" className={HEADING}>Verteilung</h3>
            <div className="grid gap-3 md:grid-cols-2" data-testid="draw-staffeln">
              {draw.staffeln.map((staffel) => (
                <StaffelCard key={staffel.tournament_id} staffel={staffel} canSwap={open && !draw.stale && !blockedOwn} active={swapFrom?.squad_id}
                  onSwap={(team) => { setSwapFrom((current) => (current?.squad_id === team.squad_id ? null : team)); setSwapWith(""); }} />
              ))}
            </div>
            {open && !draw.stale ? <p className="text-xs text-white/55">Zwei Co-Teams tauschst du über den Pfeil. Die Größen bleiben, die Regel für Co-Teams eines Hauptteams wird neu geprüft.</p> : null}
          </section>

          {swapFrom ? (
            <section aria-labelledby="draw-swap" className="space-y-3 rounded-sm border border-white/10 bg-[#121212] p-3" data-testid="draw-swap">
              <h3 id="draw-swap" className={HEADING}>Tausch</h3>
              <SelectField label={`${swapFrom.display_name} tauscht mit`} value={swapWith} onChange={setSwapWith} testId="draw-swap-with"
                options={[["", "Co-Team wählen …"], ...partners]} />
              <TextField label="Grund (Pflicht)" required value={swapReason} onChange={setSwapReason} maxLength={500} testId="draw-swap-reason"
                hint="Steht im Protokoll, mit deinem Namen." />
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={locked || !swapWith || swapReason.trim().length < DRAW_REASON_MIN}
                  onClick={() => send("swap", { squad_id: swapFrom.squad_id, other_squad_id: swapWith, reason: swapReason.trim() })}
                  className={`tls-btn tls-btn--primary ${BUTTON}`} data-testid="draw-swap-send">Tauschen</button>
                <button type="button" onClick={() => setSwapFrom(null)} className={`tls-btn tls-btn--quiet ${BUTTON}`}>Abbrechen</button>
              </div>
            </section>
          ) : null}

          {open && !draw.stale ? (
            <section aria-labelledby="draw-again" className="space-y-3">
              <h3 id="draw-again" className={HEADING}>Anders entscheiden</h3>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy || blockedOwn} onClick={() => toggle("redraw")} aria-expanded={mode === "redraw"} className={`tls-btn tls-btn--quiet ${BUTTON}`} data-testid="draw-redraw-open">Neu auslosen</button>
                <button type="button" disabled={busy || blockedOwn} onClick={() => toggle("discard")} aria-expanded={mode === "discard"} className={`tls-btn tls-btn--quiet ${BUTTON}`} data-testid="draw-discard-open">Verwerfen</button>
              </div>
              {mode ? (
                <div className="max-w-xl space-y-2">
                  <TextField label="Grund (Pflicht)" required value={reason} onChange={setReason} maxLength={500} hint={REASON_HINT[mode]} testId="draw-reason" />
                  <button type="button" disabled={locked || reason.trim().length < DRAW_REASON_MIN}
                    onClick={() => send(mode, { reason: reason.trim() }, mode === "discard" ? async () => { toast.success("Los verworfen."); await onChanged({ close: true }); } : undefined)}
                    className={`tls-btn ${mode === "discard" ? "tls-btn--danger" : "tls-btn--primary"} ${BUTTON}`} data-testid="draw-reason-send">{REASON_ACTION[mode]}</button>
                </div>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="draw-log" className="space-y-2">
            <h3 id="draw-log" className={HEADING}>Protokoll</h3>
            <ul className="space-y-1 text-xs text-white/70" data-testid="draw-log">
              {draw.log.map((step, index) => <li key={`${step.at}-${index}`} className="[overflow-wrap:anywhere]">{drawLogLine(step)}</li>)}
            </ul>
            {draw.swaps.length ? (
              <ul className="space-y-1 text-xs text-white/70" data-testid="draw-swaps">
                {draw.swaps.map((step, index) => (
                  <li key={`${step.at}-${index}`} className="[overflow-wrap:anywhere]">Tausch: {step.a_name} und {step.b_name} – {step.reason} ({step.by_name})</li>
                ))}
              </ul>
            ) : null}
          </section>

          {blockedOwn ? <OwnTeamNote testId="draw-own-team" /> : null}
          {needsReason && open ? <ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="draw-conflict-reason" /> : null}
        </div>
      ) : <p className="text-sm text-white/55">Dieses Los gibt es nicht mehr.</p>}
    </AdminSheet>
  );
}

function DivisionRow({ division, superadmin, busy, onDraw, onOpen }) {
  const blockedOwn = Boolean(division.own_team && !superadmin);
  const draw = division.draw;
  return (
    <li className="space-y-2 rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid={`draw-division-${division.level}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="font-bold text-white [overflow-wrap:anywhere]">{division.label}</h3>
          <p className="text-xs text-white/60 [overflow-wrap:anywhere]">{waitingLine(division)} · {staffelnLine(division.staffeln)}</p>
        </div>
        {draw ? (
          <button type="button" onClick={() => onOpen(division)} className={`tls-btn ${draw.status === "draft" ? "tls-btn--primary" : "tls-btn--quiet"} ${BUTTON}`} data-testid={`draw-open-${division.level}`}>
            {draw.status === "draft" ? "Vorschau öffnen" : "Los ansehen"}
          </button>
        ) : division.can_draw && !blockedOwn ? (
          <button type="button" disabled={busy} onClick={() => onDraw(division)} className={`tls-btn tls-btn--primary ${BUTTON}`} data-testid={`draw-run-${division.level}`}>Auslosen</button>
        ) : null}
      </div>
      <SeatCheck suggestion={division.suggestion} testId={`draw-seats-${division.level}`} />
      {draw ? <p className={`text-xs ${draw.stale ? "text-warn" : "text-white/70"}`} data-testid={`draw-state-${division.level}`}>{drawStatusLine(draw)}</p> : null}
      {!draw && division.problem && division.waiting.length ? <p className="text-xs text-white/60 [overflow-wrap:anywhere]" data-testid={`draw-problem-${division.level}`}>{division.problem}</p> : null}
      {!draw && division.can_draw && blockedOwn ? <OwnTeamNote testId={`draw-own-team-${division.level}`} /> : null}
    </li>
  );
}

// ``version``: ändert sich mit den Einstellungen der Season (Staffelgröße, Geschwister-Regel).
export function SeasonDrawPanel({ seasonId, version }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  const url = `/admin/leagues/seasons/${seasonId}/draws`;
  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(url);
      setData(body);
      return body;
    } catch {
      setData(null);
      return null;
    }
  }, [url]);
  useEffect(() => { load(); }, [load, version]);
  useApiInvalidation(load, ["leagues", "tournaments"]);

  const run = async (division) => {
    setBusy(true);
    try {
      await api.post(`${url}/${division.id}`, {});
      await load();
      setOpenId(division.id);
    } catch (failure) {
      toast.error(formatApiError(failure.response?.data?.detail));
      await load();
    }
    setBusy(false);
  };

  if (!drawVisible(data)) return null;
  const rows = data.divisions.filter(divisionNeedsDraw);
  const open = openId ? data.divisions.find((division) => division.id === openId) : null;
  return (
    <div id="auslosung" className="scroll-mt-24">
      <FormSection title="Staffeln auslosen" testId="season-draws"
        hint="Hat eine Liga mehrere Staffeln, verteilt das Los die angenommenen Co-Teams: gleich große Staffeln, Co-Teams eines Hauptteams getrennt. Du siehst zuerst die Vorschau. Erst „zuteilen“ schreibt die Staffeln fest und benachrichtigt die Teams.">
        <ul className="space-y-2">
          {rows.map((division) => <DivisionRow key={division.id} division={division} superadmin={Boolean(data.superadmin)} busy={busy} onDraw={run} onOpen={(row) => setOpenId(row.id)} />)}
        </ul>
      </FormSection>
      {open?.draw ? (
        <DrawSheet key={open.draw.id} seasonId={seasonId} division={open} superadmin={Boolean(data.superadmin)} onClose={() => setOpenId(null)}
          onChanged={async ({ close, refresh } = {}) => {
            const body = await load();
            if (close) setOpenId(null);
            if (refresh) refresh(body?.divisions?.find((division) => division.id === open.id)?.draw || null);
          }} />
      ) : null}
    </div>
  );
}
