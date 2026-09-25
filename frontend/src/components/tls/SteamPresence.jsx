import { Link } from "react-router-dom";
import { Gamepad2, Users } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";

// „Gerade in Steam“ (#584): Zähler und bis zu acht Personen mit Spiel - nur Mitglieder mit verknüpftem
// Konto und Opt-in, nur der aktuelle Stand (nach zehn Minuten ohne Abruf leer). Nie öffentlich.

export function steamSummary(data) {
  if (!data) return "";
  if (data.stale) return "Stand veraltet – Steam wurde länger nicht abgefragt.";
  const count = data.online_count || 0;
  if (!count) return "Gerade niemand in Steam.";
  return count === 1 ? "Ein Mitglied gerade in Steam" : `${count} Mitglieder gerade in Steam`;
}

export function SteamPresence({ data }) {
  if (!data?.available) return null;
  const players = Array.isArray(data.players) ? data.players : [];
  const canJoin = data.me?.linked && !data.me?.opted_in;
  return (
    <div className="space-y-3" data-testid="steam-presence">
      <div className="text-sm text-white/70" data-testid="steam-presence-summary">{steamSummary(data)}</div>
      {players.length > 0 && (
        <div className="space-y-2">
          {players.map((player) => (
            <Link key={player.user_id} to={player.username ? `/u/${player.username}` : "#"} className="flex items-center gap-3 group" data-testid={`steam-presence-${player.user_id}`}>
              <span className="w-9 h-9 rounded-sm border border-white/10 bg-[#0A0A0A] overflow-hidden inline-flex items-center justify-center shrink-0">
                {player.avatar_url ? <img src={resolveMediaUrl(player.avatar_url)} alt="" className="w-full h-full object-cover" /> : <Users className="w-4 h-4 text-white/40" />}
              </span>
              <span className="min-w-0">
                <span className="block font-bold text-white truncate group-hover:text-[#FFD700] transition">{player.display_name || player.username}</span>
                <span className={`block text-xs truncate ${player.state === "playing" ? "text-[#66c0f4]" : "text-white/45"}`}>
                  {player.state === "playing" && <Gamepad2 className="inline w-3 h-3 mr-1 -mt-0.5" />}{player.state_text}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
      {canJoin && (
        <div className="text-xs text-white/45" data-testid="steam-presence-join">
          Auch dabei sein: <Link to="/profile?tab=socials" className="text-[#FFD700] hover:underline">Profil → Socials → „Meinen Steam-Status im Mitgliederbereich zeigen“</Link>.
        </div>
      )}
    </div>
  );
}
