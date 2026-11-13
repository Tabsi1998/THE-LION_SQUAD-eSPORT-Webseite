// „Neue Season aus …“ (F.2, #1627, docs/LIGA.md „F.2 Neue Season aus dem Vorgänger“): erst die Vorschau, dann anlegen. Was übernommen
// wird, welche Teams nach Auf- und Abstieg in welcher Liga N stehen und wer herausfällt, sagt der Server - die Seite zeigt es nur.
// Anlegen ist auf dem Server einmalig: Ein Doppelklick findet die schon angelegte Season.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, CircleAlert, Minus } from "lucide-react";
import { toast } from "sonner";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { TextField } from "@/components/tls/FormFields";
import { api, formatApiError } from "@/lib/api";
import { fromViennaInput } from "@/lib/vienna";
import { MOVEMENT_TEXT, rulesLine, teamFrom } from "@/lib/leagueSuccessor";

const MOVE_ICON = { up: ArrowUp, down: ArrowDown, stay: Minus };
const MOVE_CLASS = { up: "text-ok", down: "text-warn", stay: "text-white/45" };

function TeamRow({ team }) {
  const Icon = MOVE_ICON[team.movement] || Minus;
  return (
    <li className="flex min-w-0 items-start gap-2 py-1.5 text-sm" data-testid={`successor-team-${team.squad_id}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${MOVE_CLASS[team.movement] || ""}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-white [overflow-wrap:anywhere]">{team.display_name}</span>
        <span className="block text-xs text-white/55">{MOVEMENT_TEXT[team.movement]} · {teamFrom(team)}</span>
      </span>
    </li>
  );
}

export function SeasonSuccessorSheet({ season, onClose, onCreated }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [startDay, setStartDay] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get(`/admin/leagues/seasons/${season.id}/successor`)
      .then(({ data: body }) => alive && setData(body))
      .catch((failure) => alive && setError(formatApiError(failure.response?.data?.detail) || "Die Vorschau konnte nicht geladen werden."));
    return () => { alive = false; };
  }, [season.id]);

  const submit = async (event) => {
    event.preventDefault();
    if (!data?.can_create || saving) return;
    setSaving(true);
    try {
      const { data: answer } = await api.post(`/admin/leagues/seasons/${season.id}/successor`, {
        start_date: fromViennaInput(`${startDay}T00:00`), confirm: true, ...(name.trim() ? { name: name.trim() } : {}),
      });
      toast.success(answer.replay ? `${answer.season.name} gibt es schon.` : `${answer.season.name} angelegt – ${answer.carried} Teams übernommen.`);
      onCreated(answer.season);
    } catch (failure) {
      toast.error(formatApiError(failure.response?.data?.detail));
      setSaving(false);
    }
  };

  return (
    <AdminSheet title={`Neue Season aus ${season.name}`} eyebrow="Season übernehmen" size="lg" onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel="Season anlegen" savingLabel="Lege an …" submitTestId="successor-create" submitDisabled={!data?.can_create || !startDay}
      testId="successor-sheet">
      {error ? <p className="text-sm text-warn" role="alert">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-white/45" aria-busy="true">Lade Vorschau …</p> : null}
      {data ? (
        <div className="space-y-5">
          {data.successor ? (
            <p className="rounded-sm border border-[#29B6E8]/40 bg-[#29B6E8]/5 p-3 text-sm text-white/85" data-testid="successor-exists">
              Aus dieser Season gibt es schon{" "}
              <Link to={`/admin/leagues/seasons/${data.successor.id}`} className="font-semibold text-[#29B6E8] hover:underline">{data.successor.name}</Link>.
            </p>
          ) : null}
          {data.problems.length ? (
            <ul className="space-y-1 text-sm text-warn" data-testid="successor-problems">
              {data.problems.map((text) => <li key={text} className="flex gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> <span>{text}</span></li>)}
            </ul>
          ) : null}

          {data.can_create ? (
            <FormGrid>
              <TextField label="Beginn der ersten Spielwoche" type="date" required value={startDay} onChange={setStartDay}
                hint="Ab 00:00 Uhr Wiener Zeit. Bis dahin können sich die Teams abmelden." testId="successor-start" />
              <TextField label="Name" maxLength={80} value={name} onChange={setName} placeholder={`leer: ${data.suggested.name}`} testId="successor-name" />
            </FormGrid>
          ) : null}

          <section aria-labelledby="successor-copied" className="space-y-2">
            <h3 id="successor-copied" className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Übernommen als Entwurf</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-white/75" data-testid="successor-copied">
              {data.copied.map((text) => <li key={text}>{text}</li>)}
              <li>Ligen mit Beinamen, Abweichungen, Zonen und Gewinnen</li>
              <li>{data.map_pool ? `Map-Pool Version ${data.map_pool.version}` : "Kein Map-Pool – die neue Season braucht einen."}</li>
              <li>{data.loadout_bans ? `Sperrliste Version ${data.loadout_bans.version}` : "Keine Sperrliste"}</li>
              <li data-testid="successor-rules">{rulesLine(data.rules)}</li>
            </ul>
            <p className="text-xs text-white/55">Neu setzen: {data.dates_to_set.join(", ")}. Die neue Season bleibt „Aus“, bis du sie veröffentlichst.</p>
          </section>

          <section aria-labelledby="successor-teams" className="space-y-3">
            <h3 id="successor-teams" className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Teams in der neuen Season ({data.carried})</h3>
            <p className="text-xs text-white/55">Auf- und Abstieg ergeben sich aus dem Endstand. Die Teams sind automatisch dabei und bekommen eine Nachricht; wer nicht will, meldet sich bis zum Start ab.</p>
            <div className="grid gap-3 md:grid-cols-2">
              {data.divisions.map((division) => (
                <div key={division.level} className="min-w-0 rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid={`successor-division-${division.level}`}>
                  <h4 className="font-bold text-white [overflow-wrap:anywhere]">{division.label}</h4>
                  <p className="text-xs text-white/50">{division.zones_label}</p>
                  {division.teams.length ? (
                    <ul className="mt-2 divide-y divide-white/5">{division.teams.map((team) => <TeamRow key={team.squad_id} team={team} />)}</ul>
                  ) : <p className="mt-2 text-xs text-white/50">Noch kein Team.</p>}
                </div>
              ))}
            </div>
            <p className="text-xs text-white/50">{data.relegation_note}</p>
          </section>

          {data.dropped.length ? (
            <section aria-labelledby="successor-dropped" className="space-y-2">
              <h3 id="successor-dropped" className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Nicht dabei ({data.dropped.length})</h3>
              <ul className="space-y-1 text-sm text-white/70" data-testid="successor-dropped">
                {data.dropped.map((team) => (
                  <li key={team.registration_id} className="[overflow-wrap:anywhere]">{team.display_name} – {team.reason} ({teamFrom(team)})</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </AdminSheet>
  );
}
