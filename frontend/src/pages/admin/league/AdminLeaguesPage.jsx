// Liga verwalten (docs/LIGA.md, #1622): Einstieg unter /admin/leagues. Eine Liga je Spiel, darin die Seasons - jede
// Season öffnet ihre eigene Seite mit Vorgaben, Sperrzeiten, Map-Pool, Liga N und Staffeln. Nur die Turnierleitung.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { fromViennaInput, viennaDate } from "@/lib/vienna";
import { ACTIVE_STATUS_OPTIONS, SEASON_STATUS_OPTIONS, VISIBILITY_SHORT, leagueLookChanges, leagueLookToForm, weekdayName } from "@/lib/league";
import { accentProblem, accentStyle } from "@/lib/leagueLook";
import { LeagueEmblem } from "@/components/tls/league/public/LeagueLook";
import { LeagueDeleteSheet } from "./LeagueDeleteSheet";
import { AccentField, BannerField, EmblemField } from "./LeagueLookFields";
import { toast } from "sonner";

const STATUS_TEXT = Object.fromEntries(SEASON_STATUS_OPTIONS);
const ICON_BUTTON = "p-1.5 text-white/50 hover:text-[#29B6E8] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm";
const ICON_DANGER = ICON_BUTTON.replace("hover:text-[#29B6E8]", "hover:text-live");
const STEPS = [
  "Liga je Spiel anlegen",
  "Season mit Beginn anlegen, dann Vorgaben, Sperrzeiten, Map-Pool, Regeltext und Sichtbarkeit festlegen",
  "Liga 1 anlegen",
  "Staffel anlegen und in der Turnierverwaltung der Staffel die Co-Teams zuteilen",
];

// Anlegen oder bearbeiten (#2106): Name, Beschreibung und Stand immer; das Spiel nur, solange keine Season eine Staffel
// hat, die Adresse nur vor der ersten Veröffentlichung - beides sagt der Server (`game_locked`, `slug_locked`).
function LeagueSheet({ league, games, onClose, onSaved }) {
  const editing = Boolean(league);
  const [form, setForm] = useState(() => ({
    name: league?.name || "", game_id: league?.game_id || games[0]?.id || "", description: league?.description || "",
    slug: league?.slug || "", status: league?.status || "active",
    ...leagueLookToForm(league),
  }));
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
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
        await api.post("/admin/leagues", { name: form.name, game_id: form.game_id, description: form.description || null, ...leagueLookChanges(form, {}) });
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
      <SelectField label="Spiel" required value={form.game_id} onChange={(value) => set("game_id", value)} disabled={editing && league.game_locked}
        options={games.map((game) => [game.id, game.name])} testId="league-game"
        hint={editing
          ? (league.game_locked ? "Bleibt: eine Season hat schon eine Staffel. Für ein anderes Spiel eine neue Liga anlegen." : "Änderbar, solange keine Season eine Staffel hat. Die Modus-Reihenfolge der Seasons wird dabei geleert.")
          : "Die Adresse der Liga folgt dem Spiel, etwa /liga/call-of-duty."} />
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
          <h3 className="font-heading text-lg font-bold uppercase">Gestaltung</h3>
          <p className="text-xs text-white/55">Gilt für alle Seasons; eine Season kann Emblem und Banner eigens festlegen. Wirkt beim Speichern sofort.</p>
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
  return (
    <AdminSheet title="Season anlegen" eyebrow={league.name} onClose={onClose} onSubmit={submit} saving={saving} submitLabel="Anlegen"
      submitTestId="season-create-save" testId="season-create-sheet">
      <FormGrid>
        <TextField label="Beginn der ersten Spielwoche" type="date" required value={startDay} onChange={setStartDay}
          hint="Ab 00:00 Uhr Wiener Zeit." testId="season-start" />
        <TextField label="Name" maxLength={80} value={name} onChange={setName} placeholder="leer: Season 1, Season 2 …" testId="season-name" />
      </FormGrid>
      <p className="text-xs leading-relaxed text-white/60" data-testid="season-defaults">
        Startet mit den Vorgaben: {defaults.weeks_total} Wochen, Spielwoche {defaults.matchday_days} Tage,
        Standardtermin {weekdayName(defaults.default_match_weekday)} {defaults.default_match_time}, {legs}, Best of {defaults.best_of},
        {" "}{defaults.team_size} gegen {defaults.team_size}, bis {defaults.max_staffel_size} Teams je Staffel. Sichtbar ist sie erst,
        wenn du es auf der Season-Seite einstellst.
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
  return (
    <AdminLayout>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase">Liga</h1>
          <p className="mt-2 text-sm text-white/60">Eine Staffel ist ein Turnier: Spielwochen, Termine, Ergebnisse und Tabelle laufen in der Turnierverwaltung. Hier legst du den Rahmen fest.</p>
        </div>
        {data ? (
          <button type="button" onClick={() => setSheet({ kind: "league" })} disabled={!games.length} data-testid="league-add"
            className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Liga anlegen
          </button>
        ) : null}
      </div>

      <ol className="mb-8 grid gap-x-6 gap-y-2 text-sm text-white/70 sm:grid-cols-2" data-testid="league-steps" aria-label="So entsteht eine Liga">
        {STEPS.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#29B6E8]/50 text-[11px] font-bold tabular-nums text-[#29B6E8]">{index + 1}</span>
            <span className="min-w-0">{step}</span>
          </li>
        ))}
      </ol>

      {error ? <p className="text-sm text-warn" role="alert" data-testid="league-error">{error}</p> : null}
      {data && !games.length ? <p className="mb-4 text-sm text-white/60">Zuerst ein Spiel anlegen – unter <Link to="/admin/games" className="text-[#29B6E8] hover:underline">Spiele</Link>.</p> : null}
      {data && !leagues.length ? (
        <p className="border border-dashed border-white/15 rounded-sm px-4 py-6 text-sm text-white/60" data-testid="league-empty">
          Noch keine Liga. Lege eine je Spiel an – etwa die CoD-Liga – und darin die erste Season.
        </p>
      ) : null}

      <div className="space-y-6">
        {leagues.map((league) => (
          <section key={league.id} className="border border-white/10 rounded-sm bg-[#121212]" data-testid={`league-${league.slug}`} aria-label={league.name}>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3" style={accentStyle(league.accent_color)}>
              <LeagueEmblem src={league.emblem_url} size={40} testId={`league-emblem-${league.slug}`} />
              <div className="min-w-0 flex-1">
                <h2 className="font-heading text-xl font-bold uppercase break-words">{league.name}</h2>
                <p className="text-xs text-white/55">{league.game_name || "Spiel fehlt"} · /liga/{league.slug}{league.status === "archived" ? " · archiviert" : ""}</p>
                {league.description ? <p className="mt-1 text-xs text-white/60 break-words">{league.description}</p> : null}
              </div>
              <div className="flex items-center gap-1">
                <button type="button" className={ICON_BUTTON} onClick={() => setSheet({ kind: "edit", league })} aria-label={`${league.name} bearbeiten`} data-testid={`league-edit-${league.slug}`}>
                  <Pencil className="w-4 h-4" aria-hidden="true" />
                </button>
                <button type="button" className={ICON_DANGER} onClick={() => setSheet({ kind: "delete", league })} aria-label={`${league.name} löschen`} data-testid={`league-delete-${league.slug}`}>
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => setSheet({ kind: "season", league })} data-testid={`season-add-${league.slug}`}
                  className="tls-btn tls-btn--quiet ml-1 px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Season anlegen
                </button>
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
                        <span className="block text-xs text-white/55">
                          ab {viennaDate(season.start_date, { day: "2-digit", month: "2-digit", year: "numeric" })} · {season.weeks_total} Wochen · {STATUS_TEXT[season.status] || season.status}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${season.visibility === "off" ? "bg-white/5 text-white/55" : "bg-[#29B6E8]/15 text-[#29B6E8]"}`}>
                        {VISIBILITY_SHORT[season.visibility] || season.visibility}
                      </span>
                      <ChevronRight className="w-4 h-4 shrink-0 text-white/40" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-4 text-sm text-white/55">Noch keine Season.</p>
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
      {sheet?.kind === "season" ? (
        <SeasonSheet league={sheet.league} defaults={data?.season_defaults || {}} onClose={() => setSheet(null)}
          onSaved={(season) => { setSheet(null); navigate(`/admin/leagues/seasons/${season.id}`); }} />
      ) : null}
    </AdminLayout>
  );
}
