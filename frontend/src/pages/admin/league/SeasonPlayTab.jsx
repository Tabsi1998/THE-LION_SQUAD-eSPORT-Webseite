// Reiter „Spielbetrieb“ der Season-Seite (#2267): Die Modi stehen an EINER Stelle. Oben die Modi der Season anhaken (= welche Modi der
// Map-Pool hat), je Modus darunter die Maps und wie viele es mindestens sein müssen; dann die Ergebnisregel je Modus (C.3) und zuletzt
// die Serie: Best of, Teamgröße, „Modus je Map“ als einfache Auswahl, Map-Wiederholung und die Fristen nach dem Spiel. Passen Pool und
// Reihenfolge nicht zusammen, steht das direkt an der Reihenfolge.
//
// Modus-Symbol (#2266): der Map-Pool-Editor setzt es vor jeden Modus (Haken und Gruppe), „Modus je Map“ neben jede Auswahl. Die
// Einstellungen je Modus (#2271) stehen in SeasonResultRulesPanel.
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { ModeIcon } from "@/components/tls/ModeIcon";
import { SelectField, TextField } from "@/components/tls/FormFields";
import { MapPoolEditor } from "@/pages/admin/maps/MapPoolEditor";
import { PoolMapLock } from "@/pages/admin/maps/PoolMapLock";
import { PoolVersionCompare } from "@/pages/admin/maps/PoolVersionCompare";
import { BEST_OF_OPTIONS, MAP_REPEAT_OPTIONS, modeOrderProblem } from "@/lib/league";
import { orderPoolHints } from "@/lib/seasonTabs";
import { SeasonPoolMinimum } from "./SeasonReadinessPanel";
import { SeasonResultRulesPanel } from "./SeasonResultRulesPanel";
import { SeasonTabForm } from "./SeasonTabForm";
import { SeasonVetoRulesPanel } from "./SeasonVetoRulesPanel";

/** Name eines Modus - das Symbol davor setzt der Map-Pool-Editor selbst (#2266). */
export function SeasonModeLabel({ label }) {
  return <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>;
}

function ModeOrder({ modes, poolModes = [], bestOf, value, onChange, note = "", hints = [] }) {
  // Ein Modus, den das Spiel nicht mehr hat (#2129): bleibt sichtbar gesetzt und gilt weiter, neu wählen geht nicht.
  const gone = [...new Set(value.filter((mode) => mode && !modes.some((known) => known.mode === mode)))]
    .map((mode) => ({ mode, label: `${poolModes.find((group) => group.mode === mode)?.label || mode} (nicht mehr im Spiel)` }));
  const choices = [...modes, ...gone];
  if (!choices.length) return null;
  const count = Number(bestOf) || 1;
  const set = (index, mode) => {
    const next = Array.from({ length: count }, (_, at) => value[at] || "");
    next[index] = mode;
    onChange(next);
  };
  // Altbestand (#2207): Eine gespeicherte Reihenfolge, die nicht zur Serie passt, nennt der Hinweis statt eines Fehlers.
  const problem = note ? "" : modeOrderProblem(value, bestOf);
  return (
    <fieldset className="space-y-1.5" data-testid="season-mode-order">
      <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Modus je Map</legend>
      <p className="text-xs text-white/50">Welcher Modus auf welcher Map der Serie gespielt wird. Entweder alle frei oder jede Map belegt.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: count }, (_, index) => {
          const chosen = choices.find((mode) => mode.mode === value[index]);
          return (
            <div key={index} className="flex min-w-0 items-end gap-2">
              {/* Modus-Symbol (#2266): ohne Wahl nichts, ohne Bild das neutrale Symbol. */}
              <span className="mb-2 inline-flex h-7 w-7 shrink-0 items-center justify-center">
                {chosen ? <ModeIcon src={chosen.icon_url} size="md" testId={`mode-order-${index}-icon`} /> : null}
              </span>
              <SelectField label={`Map ${index + 1}`} value={value[index] || ""} onChange={(mode) => set(index, mode)} className="flex-1"
                options={[["", "frei"], ...choices.map((mode) => [mode.mode, mode.label])]} testId={`mode-order-${index}`} />
            </div>
          );
        })}
      </div>
      {note ? <p className="text-xs text-warn" data-testid="season-mode-order-note">{note}</p> : (
        <p className={`text-xs ${problem ? "text-warn" : "text-white/45"}`}>
          {problem || (value.some(Boolean) ? "Gilt in jeder Serie in dieser Reihenfolge." : "Alle frei: die Teams wählen den Modus je Map selbst.")}
        </p>
      )}
      {hints.length ? (
        <ul className="space-y-1" data-testid="season-mode-order-hints">
          {hints.map((text) => <li key={text} className="text-xs text-warn">{text}</li>)}
        </ul>
      ) : null}
    </fieldset>
  );
}

function ModeNeed({ row }) {
  if (!row) return null;
  const short = row.have < row.needed;
  return (
    <p className={`text-xs tabular-nums ${short ? "text-warn" : "text-white/50"}`} data-testid={`season-mode-need-${row.mode ?? "alle"}`}>
      Braucht mindestens {row.needed} {row.needed === 1 ? "Map" : "Maps"}{short ? ` – gespeichert sind ${row.have}` : ""}
    </p>
  );
}

export function SeasonPlayTab({ seasonId, data, form, set, canSeason, readiness, formProps, modes, longest, orderNote, seasonModes, onSeasonModes,
  onPoolDirty, onSavePool, onClearPool, onPendingSync, reload }) {
  const pool = data.map_pool;
  const requirements = readiness.result?.requirements || [];
  const needOf = (mode) => requirements.find((row) => (row.mode ?? null) === (mode ?? null));
  const hasModes = (data.game?.modes || []).length > 0;
  // Die Modi der Season kommen vom Pool-Editor; ohne Recht „Season konfigurieren“ gibt es ihn nicht, dann gelten die gespeicherten.
  const picked = seasonModes?.picked ?? (pool?.modes || []).filter((group) => (group.maps || []).length).map((group) => group.mode);
  const withMaps = seasonModes?.withMaps ?? picked;
  const labelOf = (mode) => (data.game?.modes || []).find((row) => row.mode === mode)?.label || (pool?.modes || []).find((row) => row.mode === mode)?.label || mode;
  const orderModes = hasModes && picked.length ? modes.filter((row) => picked.includes(row.mode) || form.game_mode_order.includes(row.mode)) : modes;
  const hints = orderPoolHints(form.game_mode_order.slice(0, longest), withMaps, labelOf);
  return (
    <div className="space-y-6">
      <section id="modi" className="scroll-mt-24 space-y-3" aria-label="Modi und Maps">
        {canSeason ? (
          <MapPoolEditor key={pool?.id || "leer"} title="Modi und Maps der Season" game={data.game} library={data.library} entry={pool} defaultPool={data.default_pool}
            hint="Jede neue Staffel bekommt eine Kopie; Änderungen kommen beim Übertragen an. Ohne Pool kann niemand mit Maps melden."
            onSave={onSavePool} onClear={onClearPool} libraryLink testId="season-pool" saveLabel="Modi und Maps speichern" pickModes onModesChange={onSeasonModes} onDirtyChange={onPoolDirty}
            modeAside={(mode) => <ModeNeed row={needOf(mode)} />} renderModeLabel={(mode, label) => <SeasonModeLabel mode={mode} label={label} />} />
        ) : null}
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {/* C.2 (#2207): Map sperren und Versionen vergleichen - eigenständige Bausteine am Pool. */}
          {canSeason && pool && !pool.stale ? (
            <PoolMapLock endpoint={`/admin/leagues/seasons/${seasonId}/map-pool/remove-map`} pool={pool} onDone={reload} testId="season-pool-lock" />
          ) : null}
          <PoolVersionCompare baseUrl={`/admin/leagues/seasons/${seasonId}/map-pool`} version={pool?.version} testId="season-pool-compare" />
        </div>
      </section>

      <div id="mindestgroesse" className="scroll-mt-24">
        <SeasonPoolMinimum seasonId={seasonId} readiness={readiness} canEdit={canSeason} onSaved={reload} />
      </div>

      <div id="ergebnisregeln" className="scroll-mt-24">
        {/* Ergebnisregeln (C.3, #1617): je Modus der Season, eigenes Speichern, Hinweis aufs Übertragen. */}
        {hasModes && !picked.length ? (
          <FormSection title="Ergebnisregeln" testId="season-result-rules-empty">
            <p className="text-sm text-white/60">Hake oben die Modi der Season an – dann steht hier je Modus die Ergebnisregel.</p>
          </FormSection>
        ) : (
          <SeasonResultRulesPanel seasonId={seasonId} canEdit={canSeason} onSaved={onPendingSync} modes={hasModes ? picked : undefined} />
        )}
      </div>

      {canSeason ? (
        <SeasonTabForm {...formProps}>
          <FormSection title="Serie" id="serie" className="scroll-mt-24" testId="season-series"
            hint="Wie ein Spiel abläuft. Liga N kann Best of und Teamgröße abweichend festlegen (Reiter Ligen und Staffeln).">
            <FormGrid cols={3}>
              <SelectField label="Best of" value={form.best_of} onChange={(value) => set("best_of", value)} options={BEST_OF_OPTIONS} testId="season-form-best-of" />
              <TextField label="Teamgröße (je Map)" type="number" min={1} max={20} value={form.team_size} onChange={(value) => set("team_size", value)}
                hint="Spieler je Seite; Kadergrößen unter Anmeldung und Kader" testId="season-form-team-size" />
              <SelectField label="Map-Wiederholung in einer Serie" value={form.map_repeat} onChange={(value) => set("map_repeat", value)} options={MAP_REPEAT_OPTIONS}
                hint="Die Meldung prüft es." testId="season-form-map-repeat" />
            </FormGrid>
            <ModeOrder modes={orderModes} poolModes={pool?.modes} bestOf={longest} value={form.game_mode_order} onChange={(value) => set("game_mode_order", value)}
              note={orderNote} hints={hints} />
          </FormSection>
          {/* Veto (D.3, #1618): eigener Kasten mit eigenem Speichern, direkt nach Best of und „Modus je Map“, auf die sich die Vorlage bezieht. */}
          <div id="veto" className="scroll-mt-24">
            <SeasonVetoRulesPanel seasonId={seasonId} />
          </div>
          <FormSection title="Nach dem Spiel" testId="season-after-match" hint="Fristen fürs Bestätigen und Nachtragen.">
            <FormGrid>
              <TextField label="Ergebnis gilt nach (Stunden)" type="number" min={1} max={336} value={form.result_confirm_hours} onChange={(value) => set("result_confirm_hours", value)}
                hint="ohne Antwort der Gegenseite" testId="season-form-confirm" />
              <TextField label={form.lineup_mode === "series" ? "Teilnehmerliste nachtragen bis (Stunden)" : "Aufstellung nachtragen bis (Stunden)"} type="number" min={1} max={336}
                value={form.lineup_amend_hours} onChange={(value) => set("lineup_amend_hours", value)}
                hint={form.lineup_mode === "series" ? "ab der Bestätigung, danach geht der Fall an die Leitung" : "nach dem Ergebnis"} testId="season-form-amend" />
            </FormGrid>
          </FormSection>
        </SeasonTabForm>
      ) : null}
    </div>
  );
}
