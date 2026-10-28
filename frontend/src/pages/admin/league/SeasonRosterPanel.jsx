import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, History, IdCard } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { FormSection } from "@/components/tls/AdminForm";
import { TextField } from "@/components/tls/FormFields";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { ID_STATE_LABELS } from "@/lib/leagueIds";
import { viennaDateTime } from "@/lib/vienna";

// Kader und Spiel-IDs einer Season (docs/LIGA.md, #2108): je Co-Team die Spieler mit der ID, die in der Season gilt.
// Ändert jemand die ID im Profil, gilt weiter die festgehaltene, bis die Liga-Leitung die neue freigibt (mit Grund,
// steht im Protokoll). Dazu der Stichtag für neue Spieler - danach braucht jeder Neue eine Freigabe.

const STATE_CLASS = {
  locked: "border-ok/40 text-ok",
  pending: "border-[#29B6E8]/40 text-[#29B6E8]",
  missing: "border-warn/50 text-warn",
  late: "border-warn/50 text-warn",
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
  if (counts.changed) parts.push(`${counts.changed} mit neuer ID im Profil`);
  return parts.length ? parts.join(" · ") : "Alle Spieler haben eine gültige ID.";
}

function canApprove(player) {
  return Boolean(player.profile_text) && (player.changed || player.state === "late" || player.state === "pending");
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

function PlayerRow({ player, open, busy, onOpen, onClose, onApprove }) {
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

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/admin/leagues/seasons/${seasonId}/roster`);
      setData(body);
      setDeadline(body.season?.roster_deadline || "");
      setError("");
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
  return (
    <FormSection title="Kader und Spiel-IDs" testId="season-roster"
      hint={`Je Spieler die ${label}, die in dieser Season gilt – festgehalten beim Zuteilen, bei der Aufnahme ins Co-Team oder spätestens beim ersten Aufstellen. Ändert jemand sie im Profil, gilt weiter die festgehaltene, bis du die neue freigibst.`}>
      {error ? <p role="alert" className="text-sm text-warn">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-white/50">Lade Kader …</p> : null}
      {data && !fields.length ? (
        <p className="text-sm text-white/55" data-testid="season-roster-free">Das Spiel dieser Liga hat keine Pflicht-ID – aufstellbar ist jeder im Kader.</p>
      ) : null}
      {data && fields.length ? (
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
              <div className="border-b border-white/10 px-3 py-2">
                <p className="text-[11px] font-bold uppercase tracking-widest text-white/45">{squad.staffel_label}</p>
                <p className="font-bold text-white [overflow-wrap:anywhere]">{squad.display_name}</p>
              </div>
              <ul className="divide-y divide-white/5">
                {squad.players.map((player) => (
                  <PlayerRow key={player.id} player={player} busy={busy} open={open === `${squad.registration_id}:${player.id}`}
                    onOpen={() => setOpen(`${squad.registration_id}:${player.id}`)} onClose={() => setOpen("")}
                    onApprove={(reason) => approve(player, reason)} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </FormSection>
  );
}
