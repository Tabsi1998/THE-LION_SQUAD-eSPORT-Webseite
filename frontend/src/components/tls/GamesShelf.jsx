import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";
import { PlatformIcon } from "@/lib/platformBrand";

// „Was wir spielen“ als Spiele-Regal (#1333): Wettkampf-Spiele (mit Turnieren oder Teilnahmen) als hohe Cover-Karten
// mit Verlauf, Kürzel-Schild, vollem Namen (zwei Zeilen erlaubt, nie „…“) und „3 Turniere“; ein Klick öffnet die Turniere
// des Spiels. Spiele „nur zum Spaß“ als kleine Chips darunter. Der Discord des Spiels steht als kleiner Link unter der
// Karte - kein Knopf in der Karte. Die Spiel-Plakette des Stil-Systems (#1317) ersetzt das Kürzel-Schild später.

/** „3 Turniere“, „1 Turnier · 16 Teilnahmen“ - Einzahl, wenn es genau eins ist. */
export function gameCountLine(game) {
  const parts = [];
  if (game?.tournaments > 0) parts.push(`${game.tournaments} ${game.tournaments === 1 ? "Turnier" : "Turniere"}`);
  if (game?.references > 0) parts.push(`${game.references} ${game.references === 1 ? "Teilnahme" : "Teilnahmen"}`);
  return parts.join(" · ");
}

/** Wettkampf: Spiele mit öffentlichen Turnieren oder Teilnahmen; der Rest ist „nur zum Spaß“. */
export function splitGames(games) {
  const list = Array.isArray(games) ? games : [];
  const competitive = list.filter((game) => (game.tournaments || 0) + (game.references || 0) > 0);
  return { competitive, fun: list.filter((game) => !competitive.includes(game)) };
}

export function gameTarget(game) {
  return game?.slug ? `/tournaments?game=${encodeURIComponent(game.slug)}` : "/tournaments";
}

export function gameCode(game) {
  const short = String(game?.short_name || "").trim();
  if (short) return short.slice(0, 4).toUpperCase();
  const words = String(game?.name || "").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 3).map((word) => word[0]).join("") : String(game?.name || "?").slice(0, 3)).toUpperCase();
}

function Plaque({ game, size = "md" }) {
  return (
    <span className={`inline-flex self-start shrink-0 items-center justify-center rounded-sm border border-white/25 bg-black/55 font-heading font-black tracking-wider text-white ${size === "sm" ? "h-6 min-w-6 px-1 text-[9px]" : "h-7 min-w-7 px-1.5 text-[10px]"}`} aria-hidden="true">
      {gameCode(game)}
    </span>
  );
}

function DiscordLink({ server, testId }) {
  if (!server?.available) return null;
  if (server.member === true) {
    return <span data-testid={`${testId}-joined`} className="inline-flex items-center gap-1 text-xs font-semibold text-[#43B581]"><Check className="w-3.5 h-3.5" /> Du bist dabei</span>;
  }
  if (!server.invite_url) return null;
  return (
    <a href={server.invite_url} target="_blank" rel="noopener noreferrer" data-testid={`${testId}-join`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#B8C0FF] hover:text-white transition">
      <PlatformIcon kind="discord" className="w-3.5 h-3.5" /> Discord des Spiels
    </a>
  );
}

/** Das Regal. `joined`: Gilden-ID → „bin dabei“ (nur angemeldet, #626). */
export function GamesShelf({ games, joined = {}, testIdPrefix = "games-shelf", funTitle = "Nur zum Spaß" }) {
  const { competitive, fun } = splitGames(games);
  if (!competitive.length && !fun.length) return null;
  return (
    <div data-testid={testIdPrefix}>
      {competitive.length > 0 && (
        <ul className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 sm:grid sm:grid-cols-4 lg:grid-cols-6 sm:overflow-visible sm:pb-0" data-testid={`${testIdPrefix}-competitive`}>
          {competitive.map((game) => {
            const cover = game.cover_url || game.logo_url;
            const server = game.discord ? { ...game.discord, member: joined[game.discord.guild_id] } : null;
            return (
              <li key={game.id} className="shrink-0 w-[42vw] max-w-[220px] sm:w-auto snap-start flex flex-col gap-2 min-w-0">
                <Link to={gameTarget(game)} data-testid={`${testIdPrefix}-${game.id}`} data-season-anchor="card" className="tls-card group relative block aspect-[3/4] overflow-hidden rounded-sm border border-white/10 bg-[#141416]">
                  {cover ? <img src={resolveMediaUrl(cover)} alt="" loading="lazy" className="tls-card__media absolute inset-0 h-full w-full object-cover" /> : null}
                  <span className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0A0A0A]/30 to-[#0A0A0A]/95" />
                  <span className="absolute inset-x-3 bottom-3 flex flex-col gap-1.5">
                    <Plaque game={game} />
                    <span className="tls-card__title font-bold text-sm sm:text-[15px] leading-tight break-words">{game.name}</span>
                    <span className="text-xs text-white/70">{gameCountLine(game)}</span>
                  </span>
                </Link>
                {server ? <DiscordLink server={server} testId={`${testIdPrefix}-${game.id}-discord`} /> : null}
              </li>
            );
          })}
        </ul>
      )}
      {fun.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2" data-testid={`${testIdPrefix}-fun`}>
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45 mr-1">{funTitle}</span>
          {fun.map((game) => (
            <span key={game.id} data-testid={`${testIdPrefix}-${game.id}`} className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] border border-white/10 py-1 pl-1 pr-3 text-sm font-semibold">
              <Plaque game={game} size="sm" /> {game.name}
              {game.discord?.available && game.discord.invite_url ? (
                <a href={game.discord.invite_url} target="_blank" rel="noopener noreferrer" aria-label={`Discord: ${game.name}`} className="text-[#B8C0FF] hover:text-white" data-testid={`${testIdPrefix}-${game.id}-discord-join`}>
                  <PlatformIcon kind="discord" className="w-3.5 h-3.5" />
                </a>
              ) : null}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
