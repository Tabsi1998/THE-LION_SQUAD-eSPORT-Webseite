// Liga verwalten (docs/LIGA.md, #1622): Einstieg unter /admin/leagues. Eine Liga je Spiel, darin die Seasons - jede
// Season öffnet ihre eigene Seite mit Vorgaben, Sperrzeiten, Map-Pool, Liga N und Staffeln. Für den Bereich Ligen und
// Zuständige (#2203): Der Server schickt je Liga `capabilities`, danach richten sich die Knöpfe; er prüft selbst noch einmal.
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, Pencil, Plus, Trash2, Users } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { isArchivedGame, selectableGames } from "@/lib/gameLabels";
import { formatWhen } from "@/lib/datetime";
import { fromViennaInput } from "@/lib/vienna";
import { ACTIVE_STATUS_OPTIONS, SEASON_STATUS_OPTIONS, VISIBILITY_SHORT, leagueLookChanges, leagueLookToForm, weekdayName } from "@/lib/league";
import { accentProblem, accentStyle } from "@/lib/leagueLook";
import { LeagueEmblem } from "@/components/tls/league/public/LeagueLook";
import { LeagueDeleteSheet } from "./LeagueDeleteSheet";
import { LeagueStaffSheet } from "./LeagueStaffSheet";
import { leagueAnchorId } from "@/lib/staffelTabs";
import { AccentField, BannerField, EmblemField } from "./LeagueLookFields";
import { toast } from "sonner";
import { ShortCaps } from "@/components/tls/ShortCaps";
import { KIND_FIXED_HINT, PARTICIPANT_OPTIONS, SOLO, TEAM, gameAllowsSolo, isSoloLeague, participantKind, participantLabel } from "@/lib/leagueParticipants";

const STATUS_TEXT = Object.fromEntries(SEASON_STATUS_OPTIONS);
const ICON_BUTTON = "p-1.5 text-white/50 hover:text-[#29B6E8] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm";
const ICON_DANGER = ICON_BUTTON.replace("hover:text-[#29B6E8]", "hover:text-live");
const STEPS = [
  "Liga je Spiel anlegen – mit Co-Teams oder Spielern",
  "Season mit Beginn anlegen, dann Vorgaben, Sperrzeiten, Map-Pool, Regeltext und Sichtbarkeit festlegen",
  "Liga 1 anlegen",
  "Staffel anlegen und auf der Staffel-Seite die Co-Teams bzw. Spieler zuteilen",
];

/** Ein Wert, der feststeht - gleiche Beschriftung wie ein Feld, ohne Eingabe. */
function FixedField({ label, value, hint, testId }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="tls-type-label text-white/60 mb-1.5">{label}</div>
      <div className="w-full rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2 text-white/80">{value}</div>
      {hint ? <div className="mt-1 tls-type-small text-white/45">{hint}</div> : null}
    </div>
  );
}

// Anlegen oder bearbeiten (#2106): Name, Beschreibung und Stand immer; das Spiel nur, solange keine Season eine Staffel
// hat, die Adresse nur vor der ersten Veröffentlichung - beides sagt der Server (`game_locked`, `slug_locked`).
function LeagueSheet({ league, games, onClose, onSaved }) {
  const editing = Boolean(league);
  const [form, setForm] = useState(() => ({
    name: league?.name || "", game_id: league?.game_id || selectableGames(games)[0]?.id || "", description: league?.description || "",
    slug: league?.slug || "", status: league?.status || "active", participant_kind: participantKind(league),
    ...leagueLookToForm(league),
  }));
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  // Teilnehmerart (#1629): „Spieler“ nur bei Spielen mit Einzelspielern - wechselt das Spiel auf eines ohne, gilt wieder Co-Teams.
  const chosenGame = games.find((game) => game.id === form.game_id);
  const soloPossible = gameAllowsSolo(chosenGame);
  const kind = soloPossible ? form.participant_kind : TEAM;
  const submit = async (event) => {
    event.preventDefault();
    const problem = accentProblem(form.accent_color);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const body = { name: form.name, description: form.description.trim() || null, status: form.status };
        if (!league.game_locked && form.game_id !== league.game_id) body.game_id = form.game_id;
        if (!league.slug_locked && form.slug.trim() && form.slug.trim() !== league.slug) body.slug = form.slug.trim();
        // Gestaltung (#2107): nur was sich geändert hat - leer entfernt das Bild bzw. die Farbe.
        Object.assign(body, leagueLookChanges(form, league));
        const { data } = await api.patch(`/admin/leagues/${league.id}`, body);
        toast.success(data.changed?.length ? "Liga gespeichert." : "Keine Änderung.");
      } else {
        // Teilnehmerart (#1629) nur bei „Spieler“ mitschicken - ohne Feld legt der Server wie bisher eine Team-Liga an.
        await api.post("/admin/leagues", { name: form.name, game_id: form.game_id, ...(kind === SOLO ? { participant_kind: SOLO } : {}),
          description: form.description || null, ...leagueLookChanges(form, {}) });
        toast.success("Liga angelegt.");
      }
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      setSaving(false);
    }
  };
  return (
    <AdminSheet title={editing ? "Liga bearbeiten" : "Liga anlegen"} eyebrow={editing ? league.name : undefined} onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel={editing ? "Speichern" : "Anlegen"} submitTestId={editing ? "league-edit-save" : "league-create-save"} testId={editing ? "league-edit-sheet" : "league-create-sheet"}>
      <TextField label="Name" required maxLength={80} value={form.name} onChange={(value) => set("name", value)} placeholder="z. B. CoD-Liga" testId="league-name" />
      {/* Spiel und Teilnehmer gehören zusammen (#1629): „Spieler“ gibt es nur bei Spielen mit Einzelspielern. */}
      <FormGrid>
        <SelectField label="Spiel" required value={form.game_id} onChange={(value) => set("game_id", value)} disabled={editing && league.game_locked}
          options={selectableGames(games, league?.game_id).filter((game) => !(editing && isSoloLeague(league)) || game.id === league.game_id || gameAllowsSolo(game))
            .map((game) => [game.id, `${game.name}${isArchivedGame(game) ? " – archiviert" : ""}`])} testId="league-game"
          hint={editing
            ? (league.game_locked ? "Bleibt: eine Season hat schon eine Staffel. Für ein anderes Spiel eine neue Liga anlegen." : "Änderbar, solange keine Season eine Staffel hat. Die Modus-Reihenfolge der Seasons wird dabei geleert.")
            : "Die Adresse der Liga folgt dem Spiel, etwa /liga/call-of-duty."} />
        {editing ? (
          <FixedField label="Teilnehmer" value={participantLabel(league)} hint={KIND_FIXED_HINT} testId="league-kind-fixed" />
        ) : soloPossible ? (
          <SelectField label="Teilnehmer" value={kind} onChange={(value) => set("participant_kind", value)} options={PARTICIPANT_OPTIONS} testId="league-kind"
            hint={kind === SOLO ? "Jede Person spielt für sich, 1 gegen 1. Steht ab dem Anlegen fest." : "Co-Teams eines Vereinsteams spielen gegeneinander. Steht ab dem Anlegen fest."} />
        ) : (
          <FixedField label="Teilnehmer" value="Co-Teams" hint="Dieses Spiel ist nicht für Einzelspieler eingestellt." testId="league-kind-team-only" />
        )}
      </FormGrid>
      {editing ? (
        <FormGrid>
          <TextField label="Adresse" maxLength={80} value={form.slug} onChange={(value) => set("slug", value)} disabled={league.slug_locked} testId="league-slug"
            hint={league.slug_locked ? `Bleibt /liga/${league.slug}: eine Season war schon sichtbar, Links darauf sollen weiter gehen.` : `/liga/${form.slug || "…"} – änderbar bis zur ersten Veröffentlichung.`} />
          <SelectField label="Stand" value={form.status} onChange={(value) => set("status", value)} options={ACTIVE_STATUS_OPTIONS}
            hint="Archiviert: aus Ligaseite und Menü genommen, alles bleibt erhalten." testId="league-status" />
        </FormGrid>
      ) : null}
      <TextAreaField label="Beschreibung" rows={2} value={form.description} onChange={(value) => set("description", value)} placeholder="freiwillig" testId="league-description" />
      {/* Gestaltung (#2107): gilt für alle Seasons, jede Season kann Emblem und Banner überschreiben. */}
      <div className="space-y-4 border-t border-white/10 pt-4" data-testid="league-look">
        <div>
          <h3 className="tls-type-card">Gestaltung</h3>
          <p className="tls-type-small text-white/55">Gilt für alle Seasons; eine Season kann Emblem und Banner eigens festlegen. Wirkt beim Speichern sofort.</p>
        </div>
        <AccentField value={form.accent_color} onChange={(value) => set("accent_color", value)} />
        <EmblemField value={form.emblem_url} onChange={(value) => set("emblem_url", value || "")} accent={form.accent_color} testId="league-emblem" />
        <BannerField url={form.banner_url} focus={form.banner_focus} emblem={form.emblem_url} accent={form.accent_color} testId="league-banner"
          onChange={(url, focus) => setForm((current) => ({ ...current, banner_url: url || "", banner_focus: focus }))} />
      </div>
    </AdminSheet>
  );
}

function SeasonSheet({ league, defaults, onClose, onSaved }) {
  const [startDay, setStartDay] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { data } = await api.post(`/admin/leagues/${league.id}/seasons`, {
        start_date: fromViennaInput(`${startDay}T00:00`), ...(name.trim() ? { name: name.trim() } : {}),
      });
      toast.success(`${data.name} angelegt.`);
      onSaved(data);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      setSaving(false);
    }
  };
  const legs = Number(defaults.round_robin_legs) === 2 ? "Hin- und Rückrunde" : "nur Hinrunde";
  // Solo-Liga (#1629, S11): 1 gegen 1, der Kader ist die Person - Kaderregeln und „ein Team je Season“ gibt es dort nicht.
  const solo = isSoloLeague(league);
  return (
    <AdminSheet title="Season anlegen" eyebrow={league.name} onClose={onClose} onSubmit={submit} saving={saving} submitLabel="Anlegen"
      submitTestId="season-create-save" testId="season-create-sheet">
      <FormGrid>
        <TextField label="Beginn der ersten Spielwoche" type="date" required value={startDay} onChange={setStartDay}
          hint="Ab 00:00 Uhr Wiener Zeit." testId="season-start" />
        <TextField label="Name" maxLength={80} value={name} onChange={setName} placeholder="leer: Season 1, Season 2 …" testId="season-name" />
      </FormGrid>
      <p className="tls-type-small leading-relaxed text-white/60" data-testid="season-defaults">
        Startet mit den Vorgaben: {defaults.weeks_total} Wochen, Spielwoche {defaults.matchday_days} Tage,
        Standardtermin {weekdayName(defaults.default_match_weekday)} {defaults.default_match_time}, {legs}, Best of {defaults.best_of},
        {solo ? (
          <>{" "}1 gegen 1, bis {defaults.max_staffel_size} Spieler je Staffel, Mindestalter {defaults.min_age}, Check-in mit der Person selbst.</>
        ) : (
          <>
            {" "}{defaults.team_size} gegen {defaults.team_size}, bis {defaults.max_staffel_size} Teams je Staffel. Kader {defaults.min_squad_size} bis {defaults.max_squad_size} Spieler,
            Mindestalter {defaults.min_age}, Wartezeit neuer Spieler {defaults.new_player_wait_days} Tage, ein Team je Season.
          </>
        )}
        {" "}Sichtbar ist sie erst, wenn du es auf der Season-Seite einstellst.
      </p>
    </AdminSheet>
  );
}

export default function AdminLeaguesPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get("/admin/leagues");
      setData(body);
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["leagues"]);
  // Aus den Brotkrumen der Staffel-Seite (Paket D, #2262): `#liga-<id>` springt nach dem Laden an die Liga und setzt den Fokus dorthin.
  const { hash } = useLocation();
  const loaded = Boolean(data);
  useEffect(() => {
    if (!loaded || !hash) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) return;
    target.scrollIntoView?.({ block: "start" });
    target.focus?.({ preventScroll: true });
  }, [loaded, hash]);

  // „Archivieren statt löschen“ (#2106): der Stand der Liga, sonst bleibt alles.
  const archive = async (league) => {
    try {
      await api.patch(`/admin/leagues/${league.id}`, { status: "archived" });
      toast.success(`${league.name} archiviert.`);
      setSheet(null);
      await load();
      return true;
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      return false;
    }
  };

  const leagues = data?.leagues || [];
  const games = data?.games || [];
  // Bereich Ligen (#2203): Liga anlegen und löschen. Fehlt die Angabe (älterer Server), entscheidet die Antwort des Servers.
  const canCreate = data?.can_create !== false;
  const can = (league, capability) => !league.capabilities || league.capabilities.includes(capability);
  return (
    <AdminLayout>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <h1 className="tls-type-title"><ShortCaps>Liga</ShortCaps></h1>
          <p className="mt-2 tls-type-body text-white/60">Jede Staffel hat ihre Staffel-Seite: Teilnehmer, Spielplan, Ergebnisse und Tabelle laufen dort. Hier legst du den Rahmen fest.</p>
        </div>
        {data && canCreate ? (
          <button type="button" onClick={() => setSheet({ kind: "league" })} disabled={!games.length} data-testid="league-add"
            className="tls-btn tls-btn--primary px-4 py-2 rounded-sm tls-type-label inline-flex items-center gap-2 disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Liga anlegen
          </button>
        ) : null}
      </div>

      {canCreate ? (
        <ol className="mb-8 grid gap-x-6 gap-y-2 tls-type-small text-white/70 sm:grid-cols-2" data-testid="league-steps" aria-label="So entsteht eine Liga">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#29B6E8]/50 tls-type-small tls-type-num text-[#29B6E8]">{index + 1}</span>
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {error ? <p className="tls-type-small text-warn" role="alert" data-testid="league-error">{error}</p> : null}
      {data && canCreate && !games.length ? <p className="mb-4 tls-type-small text-white/60">Zuerst ein Spiel anlegen – unter <Link to="/admin/games" className="text-[#29B6E8] hover:underline">Spiele</Link>.</p> : null}
      {data && !leagues.length ? (
        <p className="border border-dashed border-white/15 rounded-sm px-4 py-6 tls-type-body text-white/60" data-testid="league-empty">
          Noch keine Liga. Lege eine je Spiel an – etwa die CoD-Liga – und darin die erste Season.
        </p>
      ) : null}

      <div className="space-y-6">
        {leagues.map((league) => (
          <section key={league.id} id={leagueAnchorId(league.id)} tabIndex={-1} className="scroll-mt-24 border border-white/10 rounded-sm bg-[#121212] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#29B6E8]" data-testid={`league-${league.slug}`} aria-label={league.name}>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3" style={accentStyle(league.accent_color)}>
              <LeagueEmblem src={league.emblem_url} size={40} testId={`league-emblem-${league.slug}`} />
              <div className="min-w-0 flex-1">
                <h2 className="tls-type-section break-words">{league.name}</h2>
                <p className="tls-type-small text-white/55" data-testid={`league-head-${league.slug}`}>
                  {league.game_name || "Spiel fehlt"} · {participantLabel(league)} · /liga/{league.slug}{league.status === "archived" ? " · archiviert" : ""}
                </p>
                {league.description ? <p className="mt-1 tls-type-small text-white/60 break-words">{league.description}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {can(league, "manage") ? (
                  <button type="button" className={ICON_BUTTON} onClick={() => setSheet({ kind: "edit", league })} aria-label={`${league.name} bearbeiten`} data-testid={`league-edit-${league.slug}`}>
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                  </button>
                ) : null}
                {canCreate ? (
                  <button type="button" className={ICON_DANGER} onClick={() => setSheet({ kind: "delete", league })} aria-label={`${league.name} löschen`} data-testid={`league-delete-${league.slug}`}>
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                ) : null}
                {can(league, "manage") ? (
                  <>
                    <button type="button" onClick={() => setSheet({ kind: "staff", league })} data-testid={`league-staff-${league.slug}`}
                      className="tls-btn tls-btn--quiet ml-1 px-3 py-1.5 rounded-sm tls-type-label inline-flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" aria-hidden="true" /> Zuständige
                    </button>
                    <button type="button" onClick={() => setSheet({ kind: "season", league })} data-testid={`season-add-${league.slug}`}
                      className="tls-btn tls-btn--quiet ml-1 px-3 py-1.5 rounded-sm tls-type-label inline-flex items-center gap-1.5">
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Season anlegen
                    </button>
                  </>
                ) : null}
                {/* Gesamtwertung über Seasons (F.5, #2215): lesen jede Zuständigkeit, ändern „Season konfigurieren“. */}
                <Link to={`/admin/leagues/${league.id}/gesamtwertung`} data-testid={`league-overall-link-${league.slug}`}
                  className="tls-btn tls-btn--quiet ml-1 px-3 py-1.5 rounded-sm tls-type-label">Gesamtwertung</Link>
                {/* Regelwerk (#1646): liga-weit, jede Season ohne eigenes erbt es. */}
                {can(league, "rules") ? (
                  <Link to={`/admin/leagues/rules/league/${league.id}`} data-testid={`league-rules-link-${league.slug}`}
                    className="tls-btn tls-btn--quiet ml-1 px-3 py-1.5 rounded-sm tls-type-label">Regelwerk</Link>
                ) : null}
              </div>
            </header>
            {league.seasons.length ? (
              <ul className="divide-y divide-white/5">
                {league.seasons.map((season) => (
                  <li key={season.id}>
                    <Link to={`/admin/leagues/seasons/${season.id}`} data-testid={`season-link-${season.slug}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]">
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-white">{season.name}</span>
                        <span className="block tls-type-small text-white/55">
                          ab {formatWhen(season.start_date, { time: false })} · {season.weeks_total} Wochen · {STATUS_TEXT[season.status] || season.status}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-sm px-2 py-0.5 tls-type-label ${season.visibility === "off" ? "bg-white/5 text-white/55" : "bg-[#29B6E8]/15 text-[#29B6E8]"}`}>
                        {VISIBILITY_SHORT[season.visibility] || season.visibility}
                      </span>
                      <ChevronRight className="w-4 h-4 shrink-0 text-white/40" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-4 tls-type-small text-white/55">Noch keine Season.</p>
            )}
          </section>
        ))}
      </div>

      {sheet?.kind === "league" ? <LeagueSheet games={games} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} /> : null}
      {sheet?.kind === "edit" ? <LeagueSheet league={sheet.league} games={games} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} /> : null}
      {sheet?.kind === "delete" ? (
        <LeagueDeleteSheet kind="league" target={sheet.league} name={sheet.league.name} onClose={() => setSheet(null)}
          onDeleted={() => { setSheet(null); load(); }} onArchive={() => archive(sheet.league)} />
      ) : null}
      {sheet?.kind === "staff" ? <LeagueStaffSheet league={sheet.league} onClose={() => setSheet(null)} /> : null}
      {sheet?.kind === "season" ? (
        <SeasonSheet league={sheet.league} defaults={(isSoloLeague(sheet.league) && data?.season_defaults_solo) || data?.season_defaults || {}} onClose={() => setSheet(null)}
          onSaved={(season) => { setSheet(null); navigate(`/admin/leagues/seasons/${season.id}`); }} />
      ) : null}
    </AdminLayout>
  );
}
