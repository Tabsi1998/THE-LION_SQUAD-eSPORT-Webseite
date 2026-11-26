// „Neue Season aus …“ (F.2, #1627, docs/LIGA.md „F.2 Neue Season aus dem Vorgänger“): erst die Vorschau, dann anlegen. Was übernommen
// wird, welche Teams nach Auf- und Abstieg in welcher Liga N stehen und wer herausfällt, sagt der Server - die Seite zeigt es nur.
// Anlegen ist auf dem Server einmalig: Ein Doppelklick findet die schon angelegte Season.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, Minus } from "lucide-react";
import { toast } from "sonner";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { SUCCESSOR_OPTIONS } from "@/lib/leagueStartRights";
import { api, formatApiError } from "@/lib/api";
import { fromViennaInput } from "@/lib/vienna";
import { movementText, rulesLine, teamFrom } from "@/lib/leagueSuccessor";

const MOVE_ICON = { up: ArrowUp, down: ArrowDown, stay: Minus };
const MOVE_CLASS = { up: "text-ok", down: "text-warn", stay: "text-white/45" };

function TeamRow({ team }) {
  const Icon = MOVE_ICON[team.movement] || Minus;
  return (
    <li className="flex min-w-0 items-start gap-2 py-1.5 tls-type-small" data-testid={`successor-team-${team.squad_id}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${MOVE_CLASS[team.movement] || ""}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-white [overflow-wrap:anywhere]">{team.display_name}</span>
        <span className="block tls-type-small text-white/55">{movementText(team)} · {teamFrom(team)}</span>
      </span>
    </li>
  );
}

/** Platzprüfung einer Liga N (#1627): Passen die Teams in die Staffeln, die es bisher gab? Der Satz kommt vom Server. */
function SeatLine({ capacity, level }) {
  if (!capacity?.text) return null;
  const Icon = capacity.fits ? CircleCheck : CircleAlert;
  return (
    <p className={`mt-2 flex gap-2 tls-type-small [overflow-wrap:anywhere] ${capacity.fits ? "text-white/65" : "text-warn"}`} data-testid={`successor-seats-${level}`} data-fits={capacity.fits ? "yes" : "no"}>
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${capacity.fits ? "text-ok" : ""}`} aria-hidden="true" />
      <span><span className="sr-only">{capacity.fits ? "Passt: " : "Passt nicht: "}</span>{capacity.text}</span>
    </p>
  );
}

export function SeasonSuccessorSheet({ season, onClose, onCreated }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [startDay, setStartDay] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  // Startrechte der neuen Season (#1627, F.2a): vorbelegt mit der Einstellung dieser Season - ohne sie „automatisch dabei“ wie bisher.
  const [rights, setRights] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get(`/admin/leagues/seasons/${season.id}/successor`)
      .then(({ data: body }) => {
        if (!alive) return;
        setData(body);
        if (body.start_rights) {
          const base = body.start_rights.settings || body.start_rights.defaults;
          setRights({ accept: body.start_rights.settings?.mode === "accept", accept_days: base.accept_days, successor: base.successor });
        }
      })
      .catch((failure) => alive && setError(formatApiError(failure.response?.data?.detail) || "Die Vorschau konnte nicht geladen werden."));
    return () => { alive = false; };
  }, [season.id]);

  const submit = async (event) => {
    event.preventDefault();
    if (!data?.can_create || saving) return;
    setSaving(true);
    try {
      const { data: answer } = await api.post(`/admin/leagues/seasons/${season.id}/successor`, {
        start_date: fromViennaInput(`${startDay}T00:00`), confirm: true, ...(name.trim() ? { name: name.trim() } : {}), ...rightsPayload(),
      });
      toast.success(answer.replay ? `${answer.season.name} gibt es schon.` : `${answer.season.name} angelegt – ${answer.carried} Teams übernommen.`);
      onCreated(answer.season);
    } catch (failure) {
      toast.error(formatApiError(failure.response?.data?.detail));
      setSaving(false);
    }
  };

  // Mit Zusage: die ganze Einstellung für die neue Season. Ohne: nichts - außer diese Season hatte eine, dann ausdrücklich „automatisch“.
  function rightsPayload() {
    if (!rights || !data?.start_rights) return {};
    const { settings, defaults } = data.start_rights;
    if (rights.accept) {
      const days = Number.parseInt(String(rights.accept_days), 10);
      return { start_rights: { ...(settings || defaults), mode: "accept", accept_days: Number.isFinite(days) ? days : defaults.accept_days, successor: rights.successor } };
    }
    return settings ? { start_rights: { ...settings, mode: "auto" } } : {};
  }
  const setRight = (key, value) => setRights((current) => ({ ...current, [key]: value }));

  return (
    <AdminSheet title={`Neue Season aus ${season.name}`} eyebrow="Season übernehmen" size="lg" onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel="Season anlegen" savingLabel="Lege an …" submitTestId="successor-create" submitDisabled={!data?.can_create || !startDay}
      testId="successor-sheet">
      {error ? <p className="tls-type-small text-warn" role="alert">{error}</p> : null}
      {!data && !error ? <p className="tls-type-small text-white/45" aria-busy="true">Lade Vorschau …</p> : null}
      {data ? (
        <div className="space-y-5">
          {data.successor ? (
            <p className="rounded-sm border border-[#29B6E8]/40 bg-[#29B6E8]/5 p-3 tls-type-small text-white/85" data-testid="successor-exists">
              Aus dieser Season gibt es schon{" "}
              <Link to={`/admin/leagues/seasons/${data.successor.id}`} className="font-semibold text-[#29B6E8] hover:underline">{data.successor.name}</Link>.
            </p>
          ) : null}
          {data.problems.length ? (
            <ul className="space-y-1 tls-type-small text-warn" data-testid="successor-problems">
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
            <h3 id="successor-copied" className="tls-type-label text-white/50">Übernommen als Entwurf</h3>
            <ul className="list-disc space-y-1 pl-5 tls-type-small text-white/75" data-testid="successor-copied">
              {data.copied.map((text) => <li key={text}>{text}</li>)}
              <li>Ligen mit Beinamen, Abweichungen, Zonen und Gewinnen</li>
              <li>{data.map_pool ? `Map-Pool Version ${data.map_pool.version}` : "Kein Map-Pool – die neue Season braucht einen."}</li>
              <li>{data.loadout_bans ? `Sperrliste Version ${data.loadout_bans.version}` : "Keine Sperrliste"}</li>
              <li data-testid="successor-rules">{rulesLine(data.rules)}</li>
            </ul>
            <p className="tls-type-small text-white/55">Neu setzen: {data.dates_to_set.join(", ")}. Die neue Season bleibt „Aus“, bis du sie veröffentlichst.</p>
          </section>

          <section aria-labelledby="successor-teams" className="space-y-3">
            <h3 id="successor-teams" className="tls-type-small font-bold text-white/50">Teams in der neuen Season ({data.carried})</h3>
            <p className="tls-type-small text-white/55" data-testid="successor-teams-note">
              Auf- und Abstieg ergeben sich aus dem Endstand. {rights?.accept
                ? `Die Teams bekommen ein Startrecht und sagen innerhalb von ${rights.accept_days} Tagen zu – ohne Zusage verfällt es, und der Platz wird frei.`
                : "Die Teams sind automatisch dabei und bekommen eine Nachricht; wer nicht will, meldet sich bis zum Start ab."}
            </p>
            {rights && data.can_create ? (
              <div className="space-y-3 rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid="successor-rights">
                <CheckField label="Startrechte mit Zusage" checked={rights.accept} onChange={(value) => setRight("accept", value)} testId="successor-rights-accept"
                  className="min-h-[44px]"
                  hint="Ein Startrecht ist keine Anmeldung zu einer Staffel und keine Zustimmung zum Regelwerk. Später änderbar in der neuen Season unter „Anmeldung und Kader“ → Startrechte." />
                {rights.accept ? (
                  <FormGrid>
                    <TextField label="Frist für die Zusage (Tage)" type="number" min={1} max={60} value={rights.accept_days ?? ""} onChange={(value) => setRight("accept_days", value)}
                      hint="Zählt ab dem Anlegen und endet spätestens mit dem Start der Season." testId="successor-rights-days" />
                    <SelectField label="Wird ein Platz frei" value={rights.successor} onChange={(value) => setRight("successor", value)} options={SUCCESSOR_OPTIONS}
                      testId="successor-rights-successor" />
                  </FormGrid>
                ) : null}
              </div>
            ) : null}
            {data.capacity_hints?.length ? (
              <div className="space-y-1 rounded-sm border border-warn/40 p-3 tls-type-small" role="status" data-testid="successor-capacity">
                <p className="flex gap-2 font-semibold text-warn"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> <span>Platzprüfung: Nicht jede Liga kommt mit ihren bisherigen Staffeln aus.</span></p>
                <p className="tls-type-small text-white/70">Anlegen geht trotzdem. Lege in der neuen Season die fehlenden Staffeln an oder erhöhe die Staffelgröße, bevor du zuteilst oder auslost.</p>
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              {data.divisions.map((division) => (
                <div key={division.level} className="min-w-0 rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid={`successor-division-${division.level}`}>
                  <h4 className="font-bold text-white [overflow-wrap:anywhere]">{division.label}</h4>
                  <p className="tls-type-small text-white/50">{division.zones_label}</p>
                  <SeatLine capacity={division.capacity} level={division.level} />
                  {division.teams.length ? (
                    <ul className="mt-2 divide-y divide-white/5">{division.teams.map((team) => <TeamRow key={team.squad_id} team={team} />)}</ul>
                  ) : <p className="mt-2 tls-type-small text-white/50">Noch kein Team.</p>}
                </div>
              ))}
            </div>
            <p className="tls-type-small text-white/50">{data.relegation_note}</p>
          </section>

          {data.dropped.length ? (
            <section aria-labelledby="successor-dropped" className="space-y-2">
              <h3 id="successor-dropped" className="tls-type-label text-white/50">Nicht dabei ({data.dropped.length})</h3>
              <ul className="space-y-1 tls-type-small text-white/70" data-testid="successor-dropped">
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
