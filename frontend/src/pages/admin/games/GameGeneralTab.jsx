// Reiter „Allgemein“ der Spielseite (#2249): Name, Adresse, Art, Hauptspiel, Kurzname, Logo, Cover und Discord. Spiel-IDs und
// Modi haben eigene Reiter - jede Angabe steht an genau einer Stelle.
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextField } from "@/components/tls/FormFields";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { gameLabel, gameOptionLabel, selectableGames } from "@/lib/gameLabels";
import { GAME_KIND_OPTIONS, slugFrom } from "@/lib/gameForm";

const KIND_HINTS = {
  standalone: "Ein Spiel ohne Versionen, etwa Mario Kart 8 Deluxe.",
  series: "Eine Reihe mit eigenen Versionen darunter, etwa Call of Duty.",
  edition: "Eine Version unter einem Hauptspiel, etwa Black Ops 7. Sie bekommt eigene Modi und Maps.",
};

// Spiel-Rolle im Discord (#629): je Hauptspiel eine; leer heißt „<Kurzname>-Spieler“. Editionen zählen fürs Hauptspiel.
export function roleNameDefault(form) {
  return `${(form.short_name || form.name || "Spiel").trim()}-Spieler`;
}

// Discord-Server je Spiel (#626): leer heißt erben - vom Hauptspiel, sonst der Hauptserver.
export function inheritedServerText(form, games, servers) {
  const main = servers.find((server) => server.role === "main");
  const parent = form.kind === "edition" ? games.find((game) => game.id === form.parent_game_id) : null;
  const parentServer = parent?.discord_guild_id ? servers.find((server) => server.guild_id === parent.discord_guild_id) : null;
  if (parentServer && parentServer.enabled && !parentServer.left) return `geerbt von ${gameLabel(parent)}: ${parentServer.name}`;
  return main ? `Hauptserver: ${main.name}` : "Hauptserver";
}

export function serverOptionLabel(server) {
  if (server.left) return `${server.name} – Bot nicht mehr dort`;
  return `${server.name}${server.role === "main" ? " (Hauptserver)" : ""}${server.enabled ? "" : " – ausgeschaltet"}`;
}

function DiscordServerField({ form, games, servers, onChange, testId }) {
  if (!servers.length) return null;
  const current = servers.find((server) => server.guild_id === form.discord_guild_id);
  const options = servers.filter((server) => !server.left || server.guild_id === form.discord_guild_id);
  const inherited = inheritedServerText(form, games, servers);
  return (
    <div className="space-y-1 min-w-0">
      <SelectField label="Discord-Server" value={form.discord_guild_id} onChange={onChange} testId={testId}
        options={[["", `Erben (${inherited})`], ...options.map((server) => [server.guild_id, serverOptionLabel(server)])]}
        hint="Wohin Turnier- und Liga-Meldungen dieses Spiels gehen." />
      {current && (!current.enabled || current.left) ? (
        <div className="text-[11px] text-[#FFD700]" data-testid={`${testId}-off`}>Dieser Server ist {current.left ? "nicht mehr erreichbar" : "ausgeschaltet"} – bis dahin gilt: {inherited}.</div>
      ) : null}
    </div>
  );
}

export function EditionPreview({ form, games }) {
  const parent = games.find((game) => game.id === form.parent_game_id);
  if (!parent || form.kind !== "edition" || !form.name) return null;
  return (
    <div className="rounded-sm border border-[#29B6E8]/20 bg-[#29B6E8]/5 p-3 text-xs text-white/60" data-testid="game-edition-preview">
      Anzeige in Turnieren und Profilen: <span className="font-bold text-white">{gameLabel({ ...form, parent_game: parent })}</span>
    </div>
  );
}

export function GameGeneralTab({ gameId, form, onChange, games, servers }) {
  const set = (key, value) => onChange({ ...form, [key]: value });
  const isEdition = form.kind === "edition";
  const parentOptions = selectableGames(games, form.parent_game_id).filter((game) => game.id !== gameId && game.kind !== "edition")
    .map((game) => [game.id, gameOptionLabel(game)]);
  return (
    <div className="space-y-5">
      <FormSection title="Name und Art" testId="game-general-identity">
        <FormGrid cols={2}>
          <TextField label={isEdition ? "Versionsname" : "Name"} required value={form.name}
            onChange={(value) => onChange({ ...form, name: value, slug: form.slug || slugFrom(value) })}
            placeholder={isEdition ? "z. B. Black Ops 7" : "z. B. Call of Duty"} testId="game-edit-name" />
          <TextField label="Kurzname" value={form.short_name} onChange={(value) => set("short_name", value)} placeholder="z. B. MK8DX"
            hint="Für enge Stellen wie Tabellen und die Discord-Rolle." testId="game-edit-short" />
          <SelectField label="Art" value={form.kind} onChange={(value) => set("kind", value)} options={GAME_KIND_OPTIONS} hint={KIND_HINTS[form.kind]} testId="game-edit-kind" />
          <TextField label="Adresse" required maxLength={80} value={form.slug} onChange={(value) => set("slug", slugFrom(value))}
            hint="Steht in Links und bleibt beim Umbenennen gleich. Unter ihr stehen die Spieler-IDs – ändert ihr sie, leiten alte Links weiter, und hängen schon IDs daran, fragt die Seite nach." testId="game-edit-slug" />
        </FormGrid>
        {isEdition && (
          <div className="space-y-3 rounded-sm border border-white/10 bg-[#0A0A0A] p-3">
            <SelectField label="Hauptspiel" value={form.parent_game_id} onChange={(value) => set("parent_game_id", value)}
              options={[["", "Hauptspiel wählen"], ...parentOptions]} hint="Woher die Version Discord und, wenn gewünscht, die Spiel-IDs erbt." testId="game-edit-parent" />
            <EditionPreview form={form} games={games} />
          </div>
        )}
      </FormSection>
      <FormSection title="Bilder" hint="Logo für Listen und Profile, Cover für Turnier- und Spielseiten." testId="game-general-images">
        <FormGrid cols={2}>
          <ImageUpload value={form.logo_url} onChange={(value) => set("logo_url", value)} label="Logo" testId="game-edit-logo" variant="square" endpoint="/uploads/logo?trim_empty_borders=false" allowLibrary logo />
          <ImageUpload value={form.cover_url} onChange={(value) => set("cover_url", value)} label="Cover" testId="game-edit-cover" variant="wide" allowLibrary />
        </FormGrid>
      </FormSection>
      {servers.length || !isEdition ? (
        <FormSection title="Discord" testId="game-general-discord">
          <FormGrid cols={2}>
            <DiscordServerField form={form} games={games} servers={servers} onChange={(value) => set("discord_guild_id", value)} testId="game-edit-discord" />
            {!isEdition && (
              <TextField label="Discord-Rolle" maxLength={100} value={form.discord_role_name} onChange={(value) => set("discord_role_name", value)}
                placeholder={roleNameDefault(form)} hint={`Leer: „${roleNameDefault(form)}“. Spielversionen nutzen die Rolle des Hauptspiels.`} testId="game-edit-role" />
            )}
          </FormGrid>
        </FormSection>
      ) : null}
    </div>
  );
}
