import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, History, IdCard, Users } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { FormSection } from "@/components/tls/AdminForm";
import { TextField } from "@/components/tls/FormFields";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { ID_STATE_LABELS } from "@/lib/leagueIds";
import { ELIGIBILITY_LABELS, TRANSFER_LABELS, ageLabel, hasSeasonRules, rulesLines } from "@/lib/leagueEligibility";
import { viennaDateTime } from "@/lib/vienna";
import { SquadKaderSheet } from "./SquadKaderSheet";

// Kader und Spiel-IDs einer Season (docs/LIGA.md, #2108): je Co-Team die Spieler mit der ID, die in der Season gilt.
// Ändert jemand die ID im Profil, gilt weiter die festgehaltene, bis die Liga-Leitung die neue freigibt (mit Grund,
// steht im Protokoll). Dazu der Stichtag für neue Spieler - danach braucht jeder Neue eine Freigabe.

const STATE_CLASS = {
  locked: "border-ok/40 text-ok",
  pending: "border-[#29B6E8]/40 text-[#29B6E8]",
  missing: "border-warn/50 text-warn",
  late: "border-warn/50 text-warn",
  banned: "border-warn/50 text-warn",
  free: "border-white/15 text-white/55",
};

function when(value) {
  try {
    return value ? viennaDateTime(value, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  } catch {
    return "";
  }
}

function countsLine(counts = {}) {
  const parts = [];
  if (counts.missing) parts.push(`${counts.missing} ohne ID`);
  if (counts.late) parts.push(`${counts.late} warten auf Freigabe`);
  if (counts.banned) parts.push(`${counts.banned} gesperrt`);
  if (counts.waiting) parts.push(`${counts.waiting} in der Wartezeit`);
  if (counts.age) parts.push(`${counts.age} ohne passende Altersangabe`);
  if (counts.changed) parts.push(`${counts.changed} mit neuer ID im Profil`);
  return parts.length ? parts.join(" · ") : "Alle Spieler haben eine gültige ID.";
}

// Kader unter Mindestgröße (#2202): Abgänge bleiben möglich - hier sieht die Leitung, wer auffüllen muss.
function ShortKaders({ squads = [] }) {
  const short = squads.filter((squad) => squad.short);
  if (!short.length) return null;
  return (
    <div className="mb-4 rounded-sm border border-warn/40 bg-warn/5 p-3" data-testid="season-roster-short">
      <p className="inline-flex items-center gap-2 text-sm font-bold text-warn">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> Kader unter der Mindestgröße
      </p>
      <ul className="mt-2 space-y-1 text-sm text-white/80">
        {short.map((squad) => (
          <li key={squad.registration_id} className="[overflow-wrap:anywhere]">
            <span className="font-semibold text-white">{squad.display_name}</span>: {squad.member_count} von mindestens {squad.min_squad_size} Spielern
            {squad.staffel_label ? <span className="text-white/55"> · {squad.staffel_label}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Kader bearbeiten (#2203): Solange die Staffel läuft, geht das außer dem eigenen Team nur von hier aus.
function EditKaderButton({ squad, onOpen }) {
  if (!squad.squad_id) return null;
  return (
    <button type="button" onClick={() => onOpen(squad)} className="tls-btn tls-btn--quiet inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider" data-testid={`roster-edit-${squad.registration_id}`}>
      <Users className="h-3.5 w-3.5" aria-hidden="true" /> Kader bearbeiten
    </button>
  );
}

function canApprove(player) {
  return player.state !== "banned" && Boolean(player.profile_text) && (player.changed || player.state === "late" || player.state === "pending");
}

function ApproveForm({ player, busy, onApprove, onCancel }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    if (reason.trim().length < 5) {
      setError("Bitte kurz den Grund angeben (mindestens 5 Zeichen) – er steht im Protokoll.");
      return;
    }
    setError("");
    await onApprove(reason.trim());
  };
  return (
    <form onSubmit={submit} noValidate className="mt-2 space-y-2 rounded-sm border border-white/10 bg-white/[0.02] p-3" data-testid={`roster-approve-form-${player.id}`}>
      <p className="text-xs text-white/70 [overflow-wrap:anywhere]">
        Ab jetzt gilt <span className="font-mono text-white">{player.profile_text}</span>
        {player.state === "locked" ? <> statt <span className="font-mono">{player.text}</span></> : null}.
      </p>
      <label className="block">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-white/60">Grund (steht im Protokoll)</span>
        <input value={reason} onChange={(event) => setReason(event.target.value)} className="input" maxLength={500}
          placeholder="z. B. Konto gewechselt, per Discord belegt" data-testid={`roster-approve-reason-${player.id}`} />
      </label>
      {error ? <p role="alert" className="text-xs text-warn">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="tls-btn tls-btn--primary min-h-[40px] rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50" data-testid={`roster-approve-save-${player.id}`}>
          Freigeben
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="tls-btn tls-btn--quiet min-h-[40px] rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">
          Abbrechen
        </button>
      </div>
    </form>
  );
}

// Wartezeit aufheben (#2204): nur mit Grund, er steht im Protokoll. Das erfährt die Person über ihren Stand im Profil.
function WaiveForm({ player, busy, onWaive, onCancel }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    if (reason.trim().length < 5) {
      setError("Bitte kurz den Grund angeben (mindestens 5 Zeichen) – er steht im Protokoll.");
      return;
    }
    setError("");
    await onWaive(reason.trim());
  };
  return (
    <form onSubmit={submit} noValidate className="mt-2 space-y-2 rounded-sm border border-white/10 bg-white/[0.02] p-3" data-testid={`roster-waive-form-${player.id}`}>
      <label className="block">
        <span className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-white/60">Grund (steht im Protokoll)</span>
        <input value={reason} onChange={(event) => setReason(event.target.value)} className="input" maxLength={500} placeholder="z. B. Team wäre sonst nicht spielfähig" data-testid={`roster-waive-reason-${player.id}`} />
      </label>
      {error ? <p role="alert" className="text-xs text-warn">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="tls-btn tls-btn--primary min-h-[40px] rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50" data-testid={`roster-waive-save-${player.id}`}>
          Wartezeit aufheben
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="tls-btn tls-btn--quiet min-h-[40px] rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function EligibilityLine({ player, waiving, onWaiveOpen }) {
  const row = player.eligibility;
  if (!row) return null;
  const idDecides = !row.ok && row.state === player.state;
  const age = ageLabel(row.age);
  if (row.ok && !age) return null;
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid={`roster-eligibility-${player.id}`} data-state={row.state}>
      {!row.ok && !idDecides ? <span className="font-bold text-warn">{ELIGIBILITY_LABELS[row.state] || row.state}:</span> : null}
      {!row.ok && !idDecides ? <span className="min-w-0 text-white/70 [overflow-wrap:anywhere]">{row.reason}</span> : null}
      {row.ok && age ? <span className="text-white/50">{age}</span> : null}
      {row.state === "waiting" && !waiving ? (
        <button type="button" onClick={onWaiveOpen} className="tls-btn tls-btn--secondary ml-auto min-h-[36px] rounded-sm px-3 py-1 text-[11px] font-bold uppercase tracking-wider" data-testid={`roster-waive-${player.id}`}>
          Wartezeit aufheben
        </button>
      ) : null}
    </div>
  );
}

function TransferRequests({ rows, busy, onApprove, onReject }) {
  const [refusing, setRefusing] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const pending = rows.filter((row) => row.status === "pending");
  const done = rows.filter((row) => row.status !== "pending");
  if (!rows.length) return null;
  const refuse = async (event, row) => {
    event.preventDefault();
    if (reason.trim().length < 5) {
      setError("Bitte kurz den Grund angeben (mindestens 5 Zeichen) – er steht im Protokoll.");
      return;
    }
    setError("");
    await onReject(row, reason.trim());
    setRefusing("");
    setReason("");
  };
  return (
    <div className="mb-4 rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid="season-transfers">
      <p className="text-[11px] font-bold uppercase tracking-widest text-white/55">Transfers</p>
      {!pending.length ? <p className="mt-1 text-sm text-white/50">Kein Antrag offen.</p> : null}
      <ul className="mt-2 space-y-3">
        {pending.map((row) => (
          <li key={row.id} className="min-w-0" data-testid={`season-transfer-${row.id}`}>
            <p className="text-sm text-white [overflow-wrap:anywhere]"><span className="font-semibold">{row.user_name}</span>: von {row.from_squad_name || "–"} zu {row.to_squad_name || "–"}</p>
            {refusing === row.id ? (
              <form onSubmit={(event) => refuse(event, row)} noValidate className="mt-2 space-y-2">
                <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} className="input" placeholder="Grund der Ablehnung (steht im Protokoll)" data-testid={`season-transfer-reason-${row.id}`} />
                {error ? <p role="alert" className="text-xs text-warn">{error}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={busy} className="tls-btn tls-btn--primary min-h-[40px] rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50" data-testid={`season-transfer-reject-save-${row.id}`}>Ablehnen</button>
                  <button type="button" onClick={() => setRefusing("")} className="tls-btn tls-btn--quiet min-h-[40px] rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">Abbrechen</button>
                </div>
              </form>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => onApprove(row)} className="tls-btn tls-btn--primary min-h-[40px] rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50" data-testid={`season-transfer-approve-${row.id}`}>Genehmigen</button>
                <button type="button" disabled={busy} onClick={() => setRefusing(row.id)} className="tls-btn tls-btn--quiet min-h-[40px] rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider" data-testid={`season-transfer-reject-${row.id}`}>Ablehnen</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {done.length ? (
        <details className="mt-2">
          <summary className="tls-hit inline-flex cursor-pointer items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-white/50 hover:text-white">
            <History className="h-3 w-3" aria-hidden="true" /> Entschieden ({done.length})
          </summary>
          <ul className="mt-1 space-y-1 border-l border-white/10 pl-3 text-xs text-white/60">
            {done.map((row) => (
              <li key={row.id} className="[overflow-wrap:anywhere]">{when(row.decided_at)} · {row.user_name}: {TRANSFER_LABELS[row.status] || row.status}{row.reason ? ` – „${row.reason}“` : ""}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function PlayerRow({ player, open, busy, onOpen, onClose, onApprove, waiving, onWaiveOpen, onWaive }) {
  return (
    <li className="min-w-0 px-3 py-2" data-testid={`roster-player-${player.id}`} data-state={player.state}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 truncate font-semibold text-white">{player.name}</span>
        <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATE_CLASS[player.state] || STATE_CLASS.free}`}>
          {player.ok ? <Check className="h-3 w-3" aria-hidden="true" /> : <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
          {ID_STATE_LABELS[player.state] || player.state}
        </span>
        {player.text ? <span className="min-w-0 select-all font-mono text-sm text-white [overflow-wrap:anywhere]">{player.text}</span> : null}
        {canApprove(player) && !open ? (
          <button type="button" onClick={onOpen} className="tls-btn tls-btn--secondary ml-auto min-h-[36px] rounded-sm px-3 py-1 text-[11px] font-bold uppercase tracking-wider" data-testid={`roster-approve-${player.id}`}>
            {player.state === "locked" ? "Neue ID freigeben" : "ID freigeben"}
          </button>
        ) : null}
      </div>
      {player.changed ? (
        <p className="mt-1 text-xs text-warn [overflow-wrap:anywhere]" data-testid={`roster-changed-${player.id}`}>
          Im Profil steht inzwischen {player.profile_text ? <span className="font-mono">{player.profile_text}</span> : "keine ID"} – in der Liga gilt weiter die festgehaltene.
        </p>
      ) : null}
      {!player.ok && player.reason ? <p className="mt-1 text-xs text-warn">{player.reason}</p> : null}
      <EligibilityLine player={player} waiving={waiving} onWaiveOpen={onWaiveOpen} />
      {waiving ? <WaiveForm player={player} busy={busy} onWaive={onWaive} onCancel={onClose} /> : null}
      {player.locked_at && player.state === "locked" ? <p className="mt-0.5 text-[11px] text-white/45">festgehalten {when(player.locked_at)}</p> : null}
      {open ? <ApproveForm player={player} busy={busy} onApprove={onApprove} onCancel={onClose} /> : null}
      {(player.approvals || []).length ? (
        <details className="mt-1">
          <summary className="tls-hit inline-flex cursor-pointer items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-white/50 hover:text-white">
            <History className="h-3 w-3" aria-hidden="true" /> Protokoll ({player.approvals.length})
          </summary>
          <ul className="mt-1 space-y-1 border-l border-white/10 pl-3 text-xs text-white/60">
            {player.approvals.map((row, index) => (
              <li key={`${row.at}-${index}`} className="[overflow-wrap:anywhere]">
                {when(row.at)} · {row.by}: {row.old_text ? <><span className="font-mono">{row.old_text}</span> → </> : null}
                <span className="font-mono text-white/80">{row.new_text}</span> – „{row.reason}“
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

export function SeasonRosterPanel({ seasonId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState("");
  const [busy, setBusy] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [editing, setEditing] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [waiveOpen, setWaiveOpen] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/admin/leagues/seasons/${seasonId}/roster`);
      setData(body);
      setDeadline(body.season?.roster_deadline || "");
      setError("");
      if (body.rules?.one_team_per_season) {
        const { data: rows } = await api.get(`/admin/leagues/seasons/${seasonId}/transfers`);
        setTransfers(Array.isArray(rows?.items) ? rows.items : []);
      }
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  }, [seasonId]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["leagues"]);

  const approve = async (player, reason) => {
    setBusy(true);
    try {
      await api.post(`/admin/leagues/seasons/${seasonId}/roster/${player.id}/approve`, { reason });
      toast.success(`${player.name}: neue ID gilt ab jetzt.`);
      setOpen("");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setBusy(false);
  };

  const waive = async (player, squadId, reason) => {
    setBusy(true);
    try {
      await api.post(`/admin/leagues/seasons/${seasonId}/roster/${player.id}/waive-wait`, { squad_id: squadId, reason });
      toast.success(`${player.name}: Wartezeit aufgehoben.`);
      setWaiveOpen("");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setBusy(false);
  };

  const decideTransfer = async (row, action, reason = null) => {
    setBusy(true);
    try {
      await api.post(`/admin/leagues/seasons/${seasonId}/transfers/${row.id}/${action}`, { reason });
      toast.success(action === "approve" ? `${row.user_name}: Wechsel genehmigt.` : `${row.user_name}: Wechsel abgelehnt.`);
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setBusy(false);
  };

  const saveDeadline = async (value) => {
    setBusy(true);
    try {
      const { data: saved } = await api.put(`/admin/leagues/seasons/${seasonId}/roster-settings`, { roster_deadline: value || null });
      toast.success(saved.roster_deadline ? "Stichtag gespeichert." : "Kein Stichtag – neue Spieler zählen sofort.");
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setBusy(false);
  };

  const fields = data?.fields || [];
  const label = fields.map((field) => field.label).join(", ") || "Spiel-ID";
  // Spielberechtigung (#2204): Auch ein Spiel ohne Pflicht-ID zeigt die Spieler, wenn die Season Regeln trägt.
  const fullView = Boolean(fields.length || hasSeasonRules(data?.rules));
  const lines = rulesLines(data?.rules);
  return (
    <FormSection title="Kader und Spiel-IDs" testId="season-roster"
      hint={`Je Spieler die ${label}, die in dieser Season gilt – festgehalten beim Zuteilen, bei der Aufnahme ins Co-Team oder spätestens beim ersten Aufstellen. Ändert jemand sie im Profil, gilt weiter die festgehaltene, bis du die neue freigibst.`}>
      {error ? <p role="alert" className="text-sm text-warn">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-white/50">Lade Kader …</p> : null}
      {data ? <ShortKaders squads={data.squads} /> : null}
      {hasSeasonRules(data?.rules) && lines.length ? (
        <ul className="mb-4 space-y-0.5 text-xs text-white/60" data-testid="season-roster-rules">
          {lines.map((line) => <li key={line} className="[overflow-wrap:anywhere]">{line}</li>)}
        </ul>
      ) : null}
      {data ? <TransferRequests rows={transfers} busy={busy} onApprove={(row) => decideTransfer(row, "approve")} onReject={(row, reason) => decideTransfer(row, "reject", reason)} /> : null}
      {data && !fullView ? (
        <>
          <p className="text-sm text-white/55" data-testid="season-roster-free">Das Spiel dieser Liga hat keine Pflicht-ID – aufstellbar ist jeder im Kader.</p>
          {(data.squads || []).length ? (
            <ul className="mt-3 divide-y divide-white/5 rounded-sm border border-white/10 bg-[#0A0A0A]" data-testid="season-roster-plain">
              {data.squads.map((squad) => (
                <li key={squad.registration_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block font-semibold text-white [overflow-wrap:anywhere]">{squad.display_name}</span>
                    <span className="block text-xs text-white/55">{squad.staffel_label} · {squad.member_count} im Kader</span>
                  </span>
                  <EditKaderButton squad={squad} onOpen={setEditing} />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      {data && fullView ? (
        <div className="space-y-4">
          <form className="flex flex-wrap items-end gap-2" noValidate onSubmit={(event) => { event.preventDefault(); saveDeadline(deadline); }} data-testid="season-roster-deadline">
            <TextField label="Stichtag für neue Spieler" type="date" value={deadline} onChange={setDeadline} className="min-w-[12rem]"
              hint="Wer danach ins Co-Team kommt, braucht deine Freigabe. Leer = kein Stichtag." testId="season-roster-deadline-input" />
            <button type="submit" disabled={busy} className="tls-btn tls-btn--quiet min-h-[40px] rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50" data-testid="season-roster-deadline-save">
              Stichtag speichern
            </button>
          </form>
          <p className="inline-flex items-center gap-2 text-sm text-white/70" data-testid="season-roster-counts">
            <IdCard className="h-4 w-4 text-[#29B6E8]" aria-hidden="true" /> {countsLine(data.counts)}
          </p>
          {!data.squads.length ? <p className="text-sm text-white/50">Noch kein Co-Team zugeteilt.</p> : null}
          {data.squads.map((squad) => (
            <div key={squad.registration_id} className="min-w-0 rounded-sm border border-white/10 bg-[#0A0A0A]" data-testid={`roster-squad-${squad.registration_id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-white/45">{squad.staffel_label}</p>
                  <p className="font-bold text-white [overflow-wrap:anywhere]">{squad.display_name}</p>
                </div>
                <EditKaderButton squad={squad} onOpen={setEditing} />
              </div>
              <ul className="divide-y divide-white/5">
                {squad.players.map((player) => (
                  <PlayerRow key={player.id} player={player} busy={busy} open={open === `${squad.registration_id}:${player.id}`}
                    onOpen={() => setOpen(`${squad.registration_id}:${player.id}`)} onClose={() => { setOpen(""); setWaiveOpen(""); }}
                    onApprove={(reason) => approve(player, reason)}
                    waiving={waiveOpen === `${squad.registration_id}:${player.id}`} onWaiveOpen={() => setWaiveOpen(`${squad.registration_id}:${player.id}`)}
                    onWaive={(reason) => waive(player, squad.squad_id, reason)} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
      {editing ? <SquadKaderSheet squad={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </FormSection>
  );
}
