// Reiter „Ligen und Staffeln“ der Season-Seite (#2267): Liga N mit Beiname und Abweichungen, ihre Staffeln (ein Liga-Turnier je Staffel),
// die Staffelgröße und „Vorgaben auf Staffeln übertragen“. Was beim Übertragen nicht mehr darf, meldet der Server je Staffel mit Grund.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRightLeft, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextField } from "@/components/tls/FormFields";
import { prizesPayload, prizesToForm } from "@/lib/leagueLook";
import { ACTIVE_STATUS_OPTIONS, BEST_OF_OPTIONS, overridesPayload, overridesToForm, settingsLine, syncSummary } from "@/lib/league";
import { nicknameRepeatsLevel } from "@/lib/seasonTabs";
import { PrizeEditor } from "./LeagueLookFields";
import { DivisionPlatformFields } from "./DivisionPlatformFields";
import { SeasonTabForm } from "./SeasonTabForm";
import { toast } from "sonner";

const STAFFEL_STATUS = {
  draft: "Entwurf", scheduled: "Angekündigt", registration_open: "Anmeldung offen", registration_closed: "Anmeldung zu",
  check_in: "Check-in", live: "Läuft", paused: "Pausiert", completed: "Beendet", results_published: "Ergebnisse veröffentlicht",
  archived: "Archiviert", cancelled: "Abgesagt",
};
const ICON_BUTTON = "p-1.5 text-white/50 hover:text-[#29B6E8] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm";
const ICON_DANGER = ICON_BUTTON.replace("hover:text-[#29B6E8]", "hover:text-live");

export function DivisionSheet({ division, season, nextLevel, onClose, onSaved }) {
  const [nickname, setNickname] = useState(division?.nickname || "");
  const [status, setStatus] = useState(division?.status || "active");
  const [form, setForm] = useState(() => overridesToForm(division?.overrides || {}));
  const [prizes, setPrizes] = useState(() => prizesToForm(division?.prizes));
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const level = division?.level || nextLevel || 1;
  const repeats = nicknameRepeatsLevel(nickname);
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      // Der Stand (#2106): die API kannte ihn, das Formular schickt ihn jetzt mit - archiviert fällt aus der Ligaseite.
      const body = { nickname: nickname.trim() || null, overrides: overridesPayload(form), ...(division ? { status } : {}) };
      // Eigene Gewinne (#2107) nur, wenn sie sich ändern - leer heißt wieder „wie die Season“.
      const ownPrizes = prizesPayload(prizes);
      if (JSON.stringify(ownPrizes) !== JSON.stringify(prizesPayload(prizesToForm(division?.prizes)))) body.prizes = ownPrizes;
      const response = division ? await api.patch(`/admin/leagues/divisions/${division.id}`, body)
        : await api.post(`/admin/leagues/seasons/${season.id}/divisions`, body);
      toast.success(division ? "Liga gespeichert." : "Liga angelegt.");
      (response?.data?.warnings || []).forEach((text) => toast.warning(text));
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      setSaving(false);
    }
  };
  const points = season.scoring_rules?.match_points || {};
  return (
    <AdminSheet title={division ? `${division.label} bearbeiten` : `Liga ${level} anlegen`} eyebrow={season.name} onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel={division ? "Speichern" : "Anlegen"} submitTestId="division-save" testId="division-sheet">
      {/* Beiname (#2267): Die Stufe zählt von selbst - der Obmann hatte „Liga 1“ als Beinamen eingetragen, der Titel hieß „Liga 1 · Liga 1“. */}
      <TextField label="Beiname (freiwillig)" maxLength={40} value={nickname} onChange={setNickname} placeholder="z. B. Elite"
        hint={`„Liga ${level}“ zählt die Seite von selbst – hier nur ein Zusatz. Anzeige: „Liga ${level}${nickname.trim() ? ` · ${nickname.trim()}` : ""}“.`}
        testId="division-nickname" />
      {repeats ? (
        <p className="-mt-2 text-xs text-warn" data-testid="division-nickname-repeat">
          „Liga {level}“ steht schon von selbst davor – so hieße es „Liga {level} · {nickname.trim()}“. Lass das Feld leer oder nimm einen Beinamen wie „Elite“.
        </p>
      ) : null}
      {division ? (
        <SelectField label="Stand" value={status} onChange={setStatus} options={ACTIVE_STATUS_OPTIONS}
          hint="Archiviert: nicht mehr auf der Ligaseite, Staffeln und Ergebnisse bleiben erhalten." testId="division-status" />
      ) : null}
      <p className="text-xs text-white/55">Leer lassen heißt: wie die Season. Nur was diese Liga anders macht, eintragen.</p>
      <FormGrid>
        <SelectField label="Best of" value={form.best_of} onChange={(value) => set("best_of", value)}
          options={[["", `wie Season (Best of ${season.best_of})`], ...BEST_OF_OPTIONS]} testId="override-best-of" />
        <TextField label="Teamgröße" type="number" min={1} max={20} value={form.team_size} onChange={(value) => set("team_size", value)}
          placeholder={`wie Season (${season.team_size})`} testId="override-team-size" />
        <TextField label="Mindestkader" type="number" min={1} max={40} value={form.min_squad_size} onChange={(value) => set("min_squad_size", value)}
          placeholder={`wie Season (${season.min_squad_size})`} testId="override-min-squad" />
        <TextField label="Teams je Staffel höchstens" type="number" min={2} max={20} value={form.max_staffel_size} onChange={(value) => set("max_staffel_size", value)}
          placeholder={`wie Season (${season.max_staffel_size})`} testId="override-staffel-size" />
        <TextField label="Antwort auf Terminvorschlag (Stunden)" type="number" min={1} max={720} value={form.match_schedule_response_hours}
          onChange={(value) => set("match_schedule_response_hours", value)} testId="override-response"
          placeholder={season.match_schedule_response_hours ? `wie Season (${season.match_schedule_response_hours})` : "wie Season"} />
      </FormGrid>
      <DivisionPlatformFields form={form} set={set} seasonId={season.id} />
      <FormGrid cols={3}>
        <TextField label="Punkte Sieg" type="number" step="any" value={form.points_win} onChange={(value) => set("points_win", value)} placeholder={String(points.win ?? 3)} testId="override-points-win" />
        <TextField label="Remis" type="number" step="any" value={form.points_draw} onChange={(value) => set("points_draw", value)} placeholder={String(points.draw ?? 1)} testId="override-points-draw" />
        <TextField label="Niederlage" type="number" step="any" value={form.points_loss} onChange={(value) => set("points_loss", value)} placeholder={String(points.loss ?? 0)} testId="override-points-loss" />
      </FormGrid>
      <PrizeEditor rows={prizes} onChange={setPrizes} testId="division-prizes"
        emptyHint={season.prizes?.length ? `Wie die Season: ${season.prizes.map((row) => `${row.place}. ${row.text}`).join(" · ")}` : "Wie die Season – dort sind noch keine Gewinne eingetragen."} />
    </AdminSheet>
  );
}

export function SyncResults({ rows }) {
  if (!rows) return null;
  if (!rows.length) return <p className="text-sm text-white/55" data-testid="sync-results">Noch keine Staffel – nichts zu übertragen.</p>;
  return (
    <ul className="space-y-2" data-testid="sync-results" aria-live="polite">
      {rows.map((row) => {
        const summary = syncSummary(row);
        return (
          <li key={row.tournament_id} className="rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm">
            <div className="font-semibold text-white">{row.title}</div>
            <div className="text-xs text-white/65">{summary.head}{summary.applied.length ? ` · ${summary.applied.join(", ")}` : ""}</div>
            {summary.skipped.map((text) => <div key={text} className="mt-1 text-xs text-warn">Nicht übertragen – {text}</div>)}
          </li>
        );
      })}
    </ul>
  );
}

export function SeasonDivisionsTab({ data, form, set, canSeason, formProps, staffelCount, syncing, syncRows, onSync, onAddDivision, onEditDivision, onDelete,
  onCreateStaffel }) {
  return (
    <div className="space-y-6">
      <section id="staffeln" className="scroll-mt-24 space-y-4 rounded-sm border border-white/10 bg-[#121212] p-4 md:p-5" aria-label="Ligen und Staffeln" data-testid="season-divisions">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-heading text-xl font-bold uppercase">Ligen und Staffeln</h2>
            <p className="mt-0.5 text-xs text-white/50">Liga 1, 2 … sind die Stufen der Season. In jeder entstehen Staffeln – je Staffel ein Liga-Turnier mit den Vorgaben der Season.</p>
          </div>
          {canSeason ? (
            <button type="button" onClick={onAddDivision} data-testid="division-add"
              className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Liga {(data.divisions.at(-1)?.level || 0) + 1} anlegen
            </button>
          ) : null}
        </div>
        {!data.divisions.length ? <p className="text-sm text-white/55">Noch keine Liga. Lege Liga 1 an – darin entstehen die Staffeln.</p> : null}
        {data.divisions.map((division) => (
          <div key={division.id} className="border-t border-white/10 pt-4 first:border-t-0 first:pt-0" data-testid={`division-${division.level}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-bold text-white [overflow-wrap:anywhere]">
                  {division.label}
                  {division.status === "archived" ? <span className="ml-2 rounded-sm bg-white/5 px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-white/55" data-testid={`division-archived-${division.level}`}>Archiviert</span> : null}
                </h3>
                {nicknameRepeatsLevel(division.nickname) ? (
                  <p className="text-xs text-warn" data-testid={`division-nickname-repeat-${division.level}`}>Der Beiname wiederholt die Stufe. Über den Stift leeren oder ändern.</p>
                ) : null}
                <p className="text-xs text-white/55">{settingsLine(division.settings)}{Object.keys(division.overrides || {}).length ? " · weicht von der Season ab" : ""}</p>
                <p className="text-xs text-white/55">{division.calendar.active_weeks} Spielwochen – höchstens {division.calendar.max_teams_per_staffel} Teams je Staffel</p>
              </div>
              {canSeason ? (
                <div className="flex items-center gap-1">
                  <button type="button" className={ICON_BUTTON} onClick={() => onEditDivision(division)} aria-label={`${division.label} bearbeiten`} data-testid={`division-edit-${division.level}`}>
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button type="button" className={ICON_DANGER} onClick={() => onDelete({ kind: "division", target: division, name: division.label })}
                    aria-label={`${division.label} löschen`} data-testid={`division-delete-${division.level}`}>
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => onCreateStaffel(division)} data-testid={`staffel-add-${division.level}`}
                    className="tls-btn tls-btn--primary px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Staffel anlegen
                  </button>
                </div>
              ) : null}
            </div>
            {division.staffeln.length ? (
              <ul className="mt-3 divide-y divide-white/5 rounded-sm border border-white/10 bg-[#0A0A0A]">
                {division.staffeln.map((staffel) => (
                  <li key={staffel.tournament_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid={`staffel-${division.level}-${staffel.staffel}`}>
                    <span className="font-semibold text-white">Staffel {staffel.staffel}</span>
                    <span className="text-xs text-white/55 tabular-nums">{staffel.participant_count} von {staffel.max_participants} Teams · {STAFFEL_STATUS[staffel.status] || staffel.status}</span>
                    <span className="ml-auto inline-flex items-center gap-2">
                      <Link to={`/admin/tournaments/${staffel.tournament_id}`} data-testid={`staffel-manage-${division.level}-${staffel.staffel}`}
                        className="inline-flex items-center gap-1 text-xs font-bold text-[#29B6E8] hover:text-white">
                        Turnierverwaltung · Co-Teams zuteilen <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      </Link>
                      {/* Staffel löschen (#2106) nur als Entwurf - dieselbe Sperre wie in der Turnierverwaltung prüft der Server. */}
                      {staffel.status === "draft" && canSeason ? (
                        <button type="button" className={ICON_DANGER} onClick={() => onDelete({ kind: "staffel", target: staffel, name: `${division.label} · Staffel ${staffel.staffel}` })}
                          aria-label={`Staffel ${staffel.staffel} löschen`} data-testid={`staffel-delete-${division.level}-${staffel.staffel}`}>
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-xs text-white/50">Noch keine Staffel.</p>}
          </div>
        ))}
      </section>

      {canSeason ? (
        <SeasonTabForm {...formProps}>
          <FormSection title="Staffelgröße" testId="season-staffel-size"
            hint={`Wie viele Teams höchstens in eine Staffel kommen. Der Kalender lässt gerade höchstens ${data.calendar?.max_teams_per_staffel ?? "–"} zu; mehr Teams brauchen eine zweite Staffel.`}>
            <TextField label="Teams je Staffel höchstens" type="number" min={2} max={20} value={form.max_staffel_size} onChange={(value) => set("max_staffel_size", value)}
              testId="season-form-staffel-size" className="max-w-xs" />
          </FormSection>
        </SeasonTabForm>
      ) : null}

      {canSeason ? (
        <FormSection title="Vorgaben auf Staffeln übertragen" testId="season-sync" id="uebertragen" className="scroll-mt-24"
          hint="Regeltext und Map-Pool immer, auch bei gesperrten Staffeln; die Antwortfrist auf Terminvorschläge auch während der Season, nur nicht bei gesperrten; Termine und Kalender nur vor dem Start; Best of, Teamgröße, Mindestkader, Punkte und Fristen nur vor dem ersten Ergebnis. Die Sichtbarkeit gilt schon beim Speichern.">
          <button type="button" onClick={onSync} disabled={syncing || !staffelCount} data-testid="season-sync-run"
            className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50">
            <ArrowRightLeft className="w-3.5 h-3.5" aria-hidden="true" /> {syncing ? "Übertrage …" : "Vorgaben übertragen"}
          </button>
          <SyncResults rows={syncRows} />
        </FormSection>
      ) : null}
    </div>
  );
}
