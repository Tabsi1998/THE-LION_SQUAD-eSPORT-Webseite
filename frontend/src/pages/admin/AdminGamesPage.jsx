// Spiele der Verwaltung: die Liste mit Archiv und Löschen. Alles Weitere zu einem Spiel steht auf seiner Spielseite (#2249)
// unter /admin/games/<Spiel> - erreichbar über das Zahnrad oder den Namen. Neu anlegen geht schnell im Seitenblatt mit Name und
// Art, danach öffnet die Spielseite.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { SelectField, TextField } from "@/components/tls/FormFields";
import { TableScroll } from "@/components/tls/TableScroll";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { gameLabel, gameOptionLabel, isArchivedGame, selectableGames } from "@/lib/gameLabels";
import { GAME_KIND_OPTIONS, emptyNewGame, gameKindLabel, gamePageUrl, newGamePayload } from "@/lib/gameForm";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Plus, Settings, Trash2 } from "lucide-react";

const ICON = "p-1.5 text-white/40 rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]";

function NewGameSheet({ games, onClose }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyNewGame);
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const parentOptions = selectableGames(games).filter((game) => game.kind !== "edition").map((game) => [game.id, gameOptionLabel(game)]);
  const isEdition = form.kind === "edition";

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const { data } = await api.post("/games", newGamePayload(form));
      toast.success("Spiel angelegt – jetzt IDs, Modi und Maps eintragen.");
      navigate(gamePageUrl(data.id));
    } catch (err) {
      toast.error(formatRequestError(err, "Spiel konnte nicht angelegt werden.", { name: form.name }));
      setSaving(false);
    }
  };

  return (
    <AdminSheet title="Neues Spiel" eyebrow="Spiele" onClose={onClose} onSubmit={submit} saving={saving} submitLabel="Anlegen und öffnen"
      submitTestId="game-submit" testId="game-new-sheet">
      <p className="text-sm text-white/55">Name und Art genügen. Logo, Spiel-IDs, Modi und Maps trägst du danach auf der Spielseite ein.</p>
      <TextField label={isEdition ? "Versionsname" : "Name"} required value={form.name} onChange={(value) => set("name", value)}
        placeholder={isEdition ? "z. B. Black Ops 7" : "z. B. Call of Duty"} testId="game-name" />
      <SelectField label="Art" value={form.kind} onChange={(value) => set("kind", value)} options={GAME_KIND_OPTIONS}
        hint="Spielversionen (etwa Black Ops 7) hängen unter einem Hauptspiel und haben eigene Modi und Maps." testId="game-kind" />
      {isEdition ? (
        <SelectField label="Hauptspiel" value={form.parent_game_id} onChange={(value) => set("parent_game_id", value)}
          options={[["", "Hauptspiel wählen"], ...parentOptions]} testId="game-parent" />
      ) : null}
    </AdminSheet>
  );
}

export default function AdminGamesPage() {
  const [list, setList] = useState(null);
  const [servers, setServers] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const confirm = useConfirm();
  const load = useCallback(async () => { const { data } = await api.get("/games"); setList(Array.isArray(data) ? data : []); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get("/games/discord-servers").then(({ data }) => setServers(Array.isArray(data) ? data : [])).catch(() => setServers([])); }, []);
  useApiInvalidation(load, ["games"]);
  const games = list || [];
  const archivedCount = games.filter(isArchivedGame).length;
  const shown = games.filter((g) => showArchived || !isArchivedGame(g));

  const setStatus = async (game, status) => {
    try {
      await api.patch(`/games/${game.id}`, { status });
      toast.success(status === "archived" ? `„${gameLabel(game)}“ archiviert.` : `„${gameLabel(game)}“ zurückgeholt.`);
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Das hat nicht geklappt."));
    }
  };

  // Löschen nur ohne Verwendung (#2129): vorab fragen, was am Spiel hängt - bei Verwendung bietet der Dialog das Archiv an.
  const del = async (game) => {
    let used = null;
    try {
      ({ data: used } = await api.get(`/games/${game.id}/usage`));
    } catch (err) {
      toast.error(formatRequestError(err, "Spiel konnte nicht geprüft werden."));
      return;
    }
    if (used?.total) {
      if (isArchivedGame(game)) {
        toast.error(`„${gameLabel(game)}“ bleibt im Archiv: ${used.text}.`);
        return;
      }
      if (await confirm({
        title: `„${gameLabel(game)}“ wird noch verwendet`,
        description: `Gelöscht werden kann es nicht: ${used.text}. Archiviert steht es beim Anlegen nicht mehr zur Wahl, alles Bestehende zeigt es weiter.`,
        confirmLabel: "Archivieren",
        tone: "info",
      })) await setStatus(game, "archived");
      return;
    }
    if (!await confirm({
      title: `„${gameLabel(game)}“ löschen?`,
      description: "Es hängt nichts daran. Das Spiel wird dauerhaft entfernt.",
      confirmLabel: "Löschen",
    })) return;
    try {
      await api.delete(`/games/${game.id}`);
      toast.success("Spiel gelöscht.");
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Spiel konnte nicht gelöscht werden."));
    }
  };

  return (
    <AdminLayout>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Spiele</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Spiele</h1>
          <p className="mt-1 text-sm text-white/55">Das Zahnrad öffnet die Spielseite mit Allgemein, Spiel-IDs, Modi und Maps.</p>
        </div>
        <button type="button" onClick={() => setCreating(true)} data-testid="game-new"
          className="tls-btn tls-btn--primary inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
          <Plus className="w-4 h-4" aria-hidden="true" /> Neues Spiel
        </button>
      </div>

      {archivedCount ? (
        <label className="mb-3 flex items-center gap-2 text-xs text-white/65">
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="accent-[#29B6E8]" data-testid="games-show-archived" />
          Archivierte zeigen ({archivedCount})
        </label>
      ) : null}
      <TableScroll label="Spiele" testId="games-table">
        <table className="w-full text-sm">
          <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
            <tr>
              <th scope="col" className="text-left px-4 py-3">Name</th>
              <th scope="col" className="hidden md:table-cell text-left px-4 py-3">Art</th>
              <th scope="col" className="hidden md:table-cell text-left px-4 py-3">ID-Quelle</th>
              <th scope="col" className="hidden md:table-cell text-left px-4 py-3">Modi</th>
              <th scope="col" className="px-4 py-3"><span className="sr-only">Aktionen</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {shown.map((g) => (
              <tr key={g.id} className={isArchivedGame(g) ? "opacity-60" : undefined} data-testid={`game-row-${g.slug}`}>
                <td className="px-4 py-3 min-w-0">
                  <Link to={gamePageUrl(g.id)} className="font-semibold text-white hover:text-[#29B6E8] [overflow-wrap:anywhere]" data-testid={`game-open-${g.slug}`}>{gameLabel(g)}</Link>
                  {isArchivedGame(g) ? <div className="mt-0.5 text-[10px] uppercase tracking-widest text-warn" data-testid={`game-archived-${g.slug}`}>Archiviert – beim Anlegen nicht zur Wahl</div> : null}
                  {gameLabel(g) !== g.name && <div className="mt-0.5 text-[10px] uppercase tracking-widest text-white/35">Version: {g.name}</div>}
                  {g.discord_guild_id && servers.length ? <div className="mt-0.5 text-[10px] uppercase tracking-widest text-[#8EA1FF]" data-testid={`game-discord-${g.slug}`}>Discord: {servers.find((server) => server.guild_id === g.discord_guild_id)?.name || g.discord_guild_id}</div> : null}
                </td>
                <td className="hidden md:table-cell px-4 py-3 text-white/60">{gameKindLabel(g.kind)}</td>
                <td className="hidden md:table-cell px-4 py-3 text-white/60">{g.identity_source_game?.display_name || g.identity_source_game?.name || (g.inherit_player_ids !== false && (g.parent_game?.display_name || g.parent_game?.name)) || "Eigene IDs"}</td>
                <td className="hidden md:table-cell px-4 py-3 text-white/60 tabular-nums">{(g.match_modes || []).length || "–"}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    <Link to={gamePageUrl(g.id)} className={`${ICON} hover:text-[#29B6E8]`} title="Einstellungen" aria-label={`Einstellungen von ${gameLabel(g)}`} data-testid={`game-settings-${g.slug}`}>
                      <Settings className="w-4 h-4" aria-hidden="true" />
                    </Link>
                    <button type="button" onClick={() => setStatus(g, isArchivedGame(g) ? "active" : "archived")} className={`${ICON} hover:text-warn`}
                      title={isArchivedGame(g) ? "Spiel zurückholen" : "Spiel archivieren"} aria-label={isArchivedGame(g) ? `${gameLabel(g)} zurückholen` : `${gameLabel(g)} archivieren`} data-testid={`game-archive-${g.slug}`}>
                      {isArchivedGame(g) ? <ArchiveRestore className="w-4 h-4" aria-hidden="true" /> : <Archive className="w-4 h-4" aria-hidden="true" />}
                    </button>
                    <button type="button" onClick={() => del(g)} className={`${ICON} hover:text-[#FF3B30]`} title="Spiel löschen" aria-label={`${gameLabel(g)} löschen`} data-testid={`game-delete-${g.slug}`}>
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {list && !shown.length ? (
              <tr><td colSpan={5} className="px-4 py-6 text-sm text-white/55" data-testid="games-empty">Noch kein Spiel. „Neues Spiel“ legt eines an.</td></tr>
            ) : null}
          </tbody>
        </table>
      </TableScroll>
      {creating ? <NewGameSheet games={games} onClose={() => setCreating(false)} /> : null}
    </AdminLayout>
  );
}
