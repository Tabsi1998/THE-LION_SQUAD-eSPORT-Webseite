import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { COUNT_MODE_OPTIONS, DOUBLE_UP_OPTIONS, POINTS_MODE_OPTIONS, TABLE_TIEBREAKER_OPTIONS, TIEBREAKER_OPTIONS, emptyBonus } from "@/lib/referenceSeries";
import { TEAM_MODE_OPTIONS } from "@/lib/seriesSpecialRules";
import { kindShows, kindWord } from "@/lib/seriesKinds";
import { Plus, X } from "lucide-react";

// Regeln einer Serie (#1741) - alles einstellbar, nichts fest verdrahtet. Die Felder kommen aus `rulesToForm`, gerechnet
// wird im Server. Eine Team-Liga braucht nur Sieg/Unentschieden/Niederlage und den Vorrang ihrer Tabelle.
// Turnierserie (#1961): dazu Runden je Turniertag mit Rundenpunkten und eigene Sonderboni; „Top N“ beim Vorrang.

function DoubleUpPoints({ rules, set }) {
  // #2015: wie PineApps bekommt ein Team auf Platz k die Punkte von Einzelplatz 2k−1 (Team 2 → Platz 3).
  return (
    <SelectField label="Double-Up-Punkte" value={rules.double_up_points || "best_player_place"} onChange={(v) => set("double_up_points", v)} options={DOUBLE_UP_OPTIONS}
      hint="Team-Platz k: beide Spieler bekommen die Punkte von Platz 2k−1 (Team 2 → Platz 3) oder die von Platz k." testId="series-rules-double-up" />
  );
}

// Double Up (#2024) statt der Teamwertung einer Rennliga: als Schalter der Saison - eingeschaltet steht der Haken im
// Ergebnisblatt schon gesetzt; je Turniertag lässt er sich trotzdem ändern.
function DoubleUpFields({ rules, set }) {
  return (
    <FormSection title="Double Up" hint="Zweierteams teilen Platz und Punkte. Eingeschaltet ist „Double Up“ im Ergebnisblatt schon angehakt – je Turniertag änderbar." plain testId="series-rules-double-up-section">
      <CheckField label="Diese Saison spielt Double Up" checked={Boolean(rules.double_up)} onChange={(v) => set("double_up", v)} testId="series-rules-double-up-on" />
      <FormGrid>
        <DoubleUpPoints rules={rules} set={set} />
      </FormGrid>
    </FormSection>
  );
}

function TournamentDayFields({ rules, set, doubleUpHere }) {
  const on = Number(rules.day_rounds_count) > 0;
  const bonuses = rules.custom_bonuses || [];
  const setBonus = (formKey, values) => set("custom_bonuses", bonuses.map((bonus) => (bonus.formKey === formKey ? { ...bonus, ...values } : bonus)));
  return (
    <FormSection title="Turniertage" hint="Mehrere Runden an einem Termin (etwa Lobbys R1–R5): die Summe der Runden ergibt den Tagesplatz, daraus kommen die Punkte je Platz oben. Sonderboni zählen getrennt und werden nie gestrichen." plain testId="series-rules-days-section">
      <FormGrid cols={3}>
        <TextField label="Runden je Turniertag" type="number" min="0" max="20" value={rules.day_rounds_count} onChange={(v) => set("day_rounds_count", v)} hint="Leer oder 0: keine Runden." testId="series-rules-day-rounds" />
        {on && <TextField label="Rundenpunkte je Platz" value={rules.day_rounds_points} onChange={(v) => set("day_rounds_points", v)} placeholder="8, 7, 6, 5, 4, 3, 2, 1" hint="Platz in der Lobby samt Bots, Platz 1 zuerst." testId="series-rules-day-points" />}
        {doubleUpHere && <DoubleUpPoints rules={rules} set={set} />}
      </FormGrid>
      <div className="space-y-2" data-testid="series-rules-bonuses">
        {bonuses.map((bonus, index) => (
          <div key={bonus.formKey} className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-end gap-2" data-testid="series-rules-bonus">
            <TextField label={`Sonderbonus ${index + 1}`} value={bonus.label} onChange={(v) => setBonus(bonus.formKey, { label: v })} placeholder="Bingo" maxLength={40} testId="series-rules-bonus-label" />
            <TextField label="Punkte" type="number" step="any" min="0" value={bonus.points} onChange={(v) => setBonus(bonus.formKey, { points: v })} testId="series-rules-bonus-points" />
            <button type="button" onClick={() => set("custom_bonuses", bonuses.filter((item) => item.formKey !== bonus.formKey))} aria-label={`Sonderbonus ${bonus.label || index + 1} entfernen`}
              className="mb-1 p-2 rounded-sm text-white/45 hover:text-white hover:bg-white/5 transition active:scale-[0.97]" data-testid="series-rules-bonus-remove">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => set("custom_bonuses", [...bonuses, emptyBonus()])} data-testid="series-rules-bonus-add"
          className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
          <Plus className="w-3.5 h-3.5" /> Sonderbonus
        </button>
      </div>
    </FormSection>
  );
}

export function RulesFields({ rules, kind, profile = null, onChange }) {
  const set = (key, value) => onChange({ ...rules, [key]: value });
  const setAt = (key, index, value) => onChange({ ...rules, [key]: rules[key].map((item, at) => (at === index ? value : item)) });
  const scheme = rules.points_mode === "scheme";
  // Art-Profil (#2024): F1-Boni und Ausfall nur bei der Rennliga, die Teamwertung („je Rennen, Fahrer, Ersatzfahrer“) nur
  // dort - eine Turnierserie hat stattdessen Double Up. Ohne Profil wie bisher. Eine eingeschaltete Teamwertung bleibt
  // sichtbar, damit niemand sie unbemerkt behält.
  const raceBonuses = kindShows(profile, "race_bonuses");
  const teamScoring = kindShows(profile, "team_scoring") || Boolean(rules.team_enabled);
  const doubleUp = kindShows(profile, "double_up", false);
  const days = kindShows(profile, "day_rounds", kind === "series");
  const round = kindWord(profile, "round_one", "Runde");
  const roundsOf = kindWord(profile, "round_many", "Runden");

  if (kind === "team_league") {
    return (
      <FormSection title="Team-Liga" hint="Punkte für ein Spiel und der Vorrang in der Tabelle. Die Tabelle des Veranstalters gilt, sobald sie eingefügt ist." plain testId="series-rules-league">
        <FormGrid cols={3}>
          <TextField label="Sieg" type="number" step="any" value={rules.match_win} onChange={(v) => set("match_win", v)} testId="series-rules-win" />
          <TextField label="Unentschieden" type="number" step="any" value={rules.match_draw} onChange={(v) => set("match_draw", v)} testId="series-rules-draw" />
          <TextField label="Niederlage" type="number" step="any" value={rules.match_loss} onChange={(v) => set("match_loss", v)} testId="series-rules-loss" />
        </FormGrid>
        <FormGrid cols={3}>
          {rules.table_tiebreakers.map((value, index) => (
            <SelectField key={index} label={`Vorrang ${index + 1}`} value={value} onChange={(v) => setAt("table_tiebreakers", index, v)} options={TABLE_TIEBREAKER_OPTIONS} testId={`series-rules-table-tiebreaker-${index}`} />
          ))}
        </FormGrid>
      </FormSection>
    );
  }

  return (
    <>
      <FormSection title="Punkte" hint={raceBonuses ? "Punkte je Platz oder wie beim Veranstalter. Boni, Ausfall und Strafen gelten nur bei Punkten je Platz." : `Punkte je Platz am ${round} oder wie beim Veranstalter.`} plain testId="series-rules-points-section">
        <FormGrid>
          <SelectField label="Punkte" value={rules.points_mode} onChange={(v) => set("points_mode", v)} options={POINTS_MODE_OPTIONS} testId="series-rules-points-mode" />
          {scheme && <TextField label="Punkte je Platz" value={rules.points_by_place} onChange={(v) => set("points_by_place", v)} placeholder={raceBonuses ? "25, 18, 15, 12, 10" : "35, 30, 26, 23, 20"} hint="Platz 1 zuerst, dahinter 0." testId="series-rules-points" />}
        </FormGrid>
        {scheme && raceBonuses && (
          <FormGrid cols={3}>
            <TextField label="Schnellste Runde: Bonus" type="number" step="any" min="0" value={rules.fastest_lap_points} onChange={(v) => set("fastest_lap_points", v)} testId="series-rules-fastest-lap" />
            <TextField label="… nur bis Platz" type="number" min="1" value={rules.fastest_lap_max_place} onChange={(v) => set("fastest_lap_max_place", v)} hint="Leer: auf jedem Platz." testId="series-rules-fastest-lap-place" />
            <TextField label="Pole: Bonus" type="number" step="any" min="0" value={rules.pole_points} onChange={(v) => set("pole_points", v)} testId="series-rules-pole" />
            <TextField label="Punkte bei Ausfall" type="number" step="any" value={rules.dnf_points} onChange={(v) => set("dnf_points", v)} hint="Leer: Punkte nach Platz." testId="series-rules-dnf" />
            <TextField label="Punkte bei Nichtstart" type="number" step="any" value={rules.dns_points} onChange={(v) => set("dns_points", v)} testId="series-rules-dns" />
            <TextField label="Punkte bei Disqualifikation" type="number" step="any" value={rules.dsq_points} onChange={(v) => set("dsq_points", v)} testId="series-rules-dsq" />
          </FormGrid>
        )}
      </FormSection>

      <FormSection title="Was zählt" hint={`Bei Streichergebnissen zählen die besten „${roundsOf} im Kalender minus N“; wer weniger Ergebnisse hat, dem zählt alles.`} plain testId="series-rules-count-section">
        <FormGrid cols={3}>
          <SelectField label="Wertung" value={rules.count_mode} onChange={(v) => set("count_mode", v)} options={countOptions(profile)} testId="series-rules-count-mode" />
          {rules.count_mode !== "all" && <TextField label="N" type="number" min="0" value={rules.count_n} onChange={(v) => set("count_n", v)} testId="series-rules-count-n" />}
          <TextField label="Finale: die besten" type="number" min="1" value={rules.final_top_n} onChange={(v) => set("final_top_n", v)} hint="Leer: kein Finale." testId="series-rules-final" />
          <TextField label={`Aktivitätspunkte je ${round}`} type="number" step="any" min="0" value={rules.activity_points} onChange={(v) => set("activity_points", v)} testId="series-rules-activity" />
          <TextField label={`… ab ${round}`} type="number" min="1" value={rules.activity_from_round} onChange={(v) => set("activity_from_round", v)} testId="series-rules-activity-from" />
          {/* #1960: darunter bleibt ein Termin laut Regeln ohne Wertung - das Eintragen weist darauf hin. */}
          <TextField label="Mindestens am Start" type="number" min="1" value={rules.min_participants} onChange={(v) => set("min_participants", v)} hint="Leer: keine Mindestzahl." testId="series-rules-min-participants" />
        </FormGrid>
      </FormSection>

      {days && <TournamentDayFields rules={rules} set={set} doubleUpHere={!doubleUp} />}
      {doubleUp && <DoubleUpFields rules={rules} set={set} />}

      <FormSection title="Vorrang bei Gleichstand" hint="Der Reihe nach; entscheidet keines, teilen sich beide den Platz." plain testId="series-rules-tiebreak-section">
        <FormGrid cols={3}>
          {rules.tiebreakers.map((value, index) => (
            <SelectField key={index} label={`Vorrang ${index + 1}`} value={value} onChange={(v) => setAt("tiebreakers", index, v)} options={TIEBREAKER_OPTIONS} testId={`series-rules-tiebreaker-${index}`} />
          ))}
          {rules.tiebreakers.includes("top_n") && (
            <TextField label="N für „Top N“" type="number" min="1" max="64" value={rules.tiebreak_top_n} onChange={(v) => set("tiebreak_top_n", v)} hint="Etwa 4: wer öfter unter den besten vier war." testId="series-rules-top-n" />
          )}
        </FormGrid>
      </FormSection>

      {teamScoring && <FormSection title="Teamwertung" hint="Je Rennen zählen die besten Fahrer eines Teams; das Team je Rennen steht im Ergebnis, sonst gilt das Standard-Team." plain testId="series-rules-team-section">
        <CheckField label="Teamwertung führen" checked={rules.team_enabled} onChange={(v) => set("team_enabled", v)} testId="series-rules-team-enabled" />
        {rules.team_enabled && (
          <FormGrid>
            <TextField label="Fahrer, die je Rennen zählen" type="number" min="1" value={rules.team_counting_drivers} onChange={(v) => set("team_counting_drivers", v)} hint="Leer: alle." testId="series-rules-team-drivers" />
            <CheckField label="Gäste zählen fürs Team" checked={rules.team_guests_count} onChange={(v) => set("team_guests_count", v)} testId="series-rules-team-guests" />
            {/* #1960: wechselt ein Fahrer das Team, zählen seine Punkte je Rennen fürs gefahrene Team oder ganz fürs neue. */}
            <SelectField label="Teamwertung bei Wechseln" value={rules.team_mode || "per_race"} onChange={(v) => set("team_mode", v)} options={TEAM_MODE_OPTIONS} testId="series-rules-team-mode"
              hint="Gibt es die Teamwertung des Veranstalters, gilt sie – beim Eintragen einfügen." />
            {/* #1960: „Ersatzfahrer“ & Co. zählen für kein Team - auch nicht fürs Standard-Team des Fahrers. */}
            <TextField label="Kein Team (Ersatz)" value={rules.team_no_team_names ?? ""} onChange={(v) => set("team_no_team_names", v)} placeholder="Ersatzfahrer" testId="series-rules-no-team-names"
              hint="Steht so ein Eintrag als Team im Ergebnis, zählt die Fahrt für kein Team. Mehrere mit Komma trennen." />
            {/* #2000: Vorgabe für neue Fahrer-Anpassungen - je Anpassung änderbar. */}
            <CheckField label="Fahrer-Anpassungen zählen auch für die Teamwertung" checked={rules.team_adjustments_count} onChange={(v) => set("team_adjustments_count", v)} testId="series-rules-team-adjustments"
              hint="Vorgabe für neue Anpassungen, etwa wenn der Veranstalter Abzüge auch dem Team abzieht. Je Anpassung änderbar." />
          </FormGrid>
        )}
      </FormSection>}
    </>
  );
}

/** „Alle Runden zählen“ in den Begriffen der Art („Alle Turniertage zählen“). */
function countOptions(profile) {
  const many = kindWord(profile, "round_many", "");
  if (!many) return COUNT_MODE_OPTIONS;
  return COUNT_MODE_OPTIONS.map(([value, label]) => [value, value === "all" ? `Alle ${many} zählen` : label]);
}
