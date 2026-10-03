import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { api } from "@/lib/api";
import { PlatformIcon } from "@/lib/platformBrand";

// Discord-Server des Vereins (#626): je Spiel der passende Server - eigener, der des Hauptspiels oder der
// Hauptserver. Öffentlich nur Name, Symbol, Mitgliederzahl und Einladung; „Du bist dabei“ sieht nur die
// angemeldete Person selbst, und nur mit verknüpftem Discord. Ausgeschaltete Server liefert die Website nie.

export function memberCountText(count) {
  const value = Number(count) || 0;
  if (value <= 0) return "";
  return value === 1 ? "1 Mitglied" : `${value.toLocaleString("de-AT")} Mitglieder`;
}

export function tileTitle(server, gameName) {
  if (server?.for_game && gameName) return `Discord-Server für ${gameName}`;
  return "Unser Discord-Server";
}

function ServerIcon({ server, className = "w-11 h-11" }) {
  if (server.icon_url) return <img src={server.icon_url} alt="" loading="lazy" className={`${className} rounded-full object-cover shrink-0`} />;
  return (
    <span className={`${className} rounded-full bg-[#5865F2] text-white inline-flex items-center justify-center shrink-0`}>
      <PlatformIcon kind="discord" className="w-1/2 h-1/2" />
    </span>
  );
}

/** Status oder Einladung: „Du bist dabei“ nur mit Bestätigung durch den Bot, sonst der Knopf zum Beitreten. */
export function JoinAction({ server, testId, size = "md" }) {
  if (server.member === true) {
    return (
      <span data-testid={`${testId}-joined`} className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[#43B581] shrink-0">
        <Check className="w-3.5 h-3.5" /> Du bist dabei
      </span>
    );
  }
  if (!server.invite_url) return null;
  const sizing = size === "sm" ? "px-2 py-1 text-[10px]" : "px-3 py-2 text-[11px]";
  return (
    <a href={server.invite_url} target="_blank" rel="noopener noreferrer" data-testid={`${testId}-join`}
      className={`${sizing} bg-[#5865F2] text-white font-bold uppercase tracking-wider rounded-sm hover:bg-[#4752C4] transition shrink-0`}>
      Beitreten
    </a>
  );
}

export function DiscordServerTile({ server, title, testId = "discord-server-tile" }) {
  if (!server?.available) return null;
  const members = memberCountText(server.member_count);
  return (
    <div data-testid={testId} className="border border-[#5865F2]/35 bg-[#5865F2]/[0.07] rounded-sm p-4 flex items-center gap-3 min-w-0">
      <ServerIcon server={server} />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-widest text-[#8EA1FF]">{title}</div>
        <div className="font-heading font-black uppercase truncate text-white">{server.name}</div>
        {members ? <div className="text-xs text-white/50">{members}</div> : null}
      </div>
      <JoinAction server={server} testId={testId} />
    </div>
  );
}

/** Kachel auf der Turnierseite: der Server zum Spiel des Turniers, mit eigenem Status, wenn angemeldet. */
export function GameDiscordTile({ gameId, gameName, testId = "game-discord-tile" }) {
  const [server, setServer] = useState(null);
  useEffect(() => {
    if (!gameId) return undefined;
    let alive = true;
    api.get(`/games/${encodeURIComponent(gameId)}/discord`)
      .then(({ data }) => { if (alive) setServer(data); })
      .catch(() => { if (alive) setServer(null); });
    return () => { alive = false; };
  }, [gameId]);
  if (!server?.available) return null;
  return <DiscordServerTile server={server} title={tileTitle(server, gameName)} testId={testId} />;
}

/** Mitgliederbereich: alle eingeschalteten Server mit dem eigenen Status; ohne Verknüpfung nur Einladungen. */
export function DiscordServerList({ data, testId = "discord-servers" }) {
  const servers = Array.isArray(data?.servers) ? data.servers.filter((server) => server.available) : [];
  if (!servers.length) return null;
  return (
    <div className="space-y-3" data-testid={testId}>
      {servers.map((server) => {
        const members = memberCountText(server.member_count);
        const rowId = `${testId}-${server.guild_id}`;
        return (
          <div key={server.guild_id} data-testid={rowId} className="flex items-center gap-3 min-w-0">
            <ServerIcon server={server} className="w-9 h-9" />
            <div className="min-w-0 flex-1">
              <div className="font-bold text-sm text-white truncate">{server.name}</div>
              <div className="text-[10px] uppercase tracking-widest text-white/40">{[server.main ? "Hauptserver" : "", members].filter(Boolean).join(" · ")}</div>
            </div>
            <JoinAction server={server} testId={rowId} size="sm" />
          </div>
        );
      })}
      {data.linked === false ? (
        <p className="text-[11px] text-white/45" data-testid={`${testId}-link-hint`}>
          <Link to="/profile?tab=socials" className="text-[#8EA1FF] hover:text-white">Discord verknüpfen</Link>, dann steht hier, wo du schon dabei bist.
        </p>
      ) : null}
    </div>
  );
}
