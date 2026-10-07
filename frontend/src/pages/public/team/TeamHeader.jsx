import { Link } from "react-router-dom";
import { Crown } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";
import { MascotBadge } from "@/components/tls/Logo";
import { bandBackground, teamColorHex, TEAM_COLORS } from "@/lib/teamColors";
import { initials, orderedFaces } from "@/lib/teamPage";

// Wappen-Kopf der Team-Seite (#1347, Design-Idee 34): oben ein Band in der Team-Farbe als dunkler Verlauf mit
// Löwen-Anschnitt, mittig das Team-Logo, darunter Name, Kürzel, Spiel und Level in einer Zeile. Die Mitglieder stehen
// als Reihe von Gesichtern mit Rolle darunter, du mit Ecken-Klammern. Keine Krone über dem Logo, kein Riesen-Schriftzug -
// die Platz-1-Krone der Team-Rangliste bleibt als kleines goldenes Zeichen neben dem Level (Gold = Ehre).
// Band: Handy 120 px, Tablet 140 px, PC 160 px über die Containerbreite; Logo am Handy 72 px, sonst 96 px.

function faceTone(name) {
  // Fester Ton je Name (FNV-1a), damit nicht alle Gesichter ohne Bild dieselbe Farbe haben.
  let hash = 2166136261;
  for (const ch of String(name || "")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return TEAM_COLORS[hash % TEAM_COLORS.length].hex;
}

export function TeamCrest({ team, hex }) {
  return (
    <div
      className="w-[72px] h-[72px] md:w-24 md:h-24 shrink-0 rounded-[10px] overflow-hidden bg-[#0A0A0A] flex items-center justify-center shadow-xl shadow-black/60"
      style={{ border: `2px solid ${hex}` }}
      data-testid="team-crest"
    >
      {team.logo_url ? (
        <img src={resolveMediaUrl(team.logo_url)} alt={team.name} className="w-full h-full object-cover" />
      ) : (
        <span className="font-heading font-black text-xl md:text-2xl" style={{ color: hex }} data-testid="team-crest-placeholder">{team.tag || initials(team.name)}</span>
      )}
    </div>
  );
}

function YouCorners() {
  // Ecken-Klammern (#1316): vier kleine Winkel um dein Gesicht - wie die Ecken der Social-Knöpfe im Footer.
  const corner = "absolute w-2.5 h-2.5 border-[#29B6E8]";
  return (
    <span aria-hidden="true" className="pointer-events-none absolute -inset-1.5" data-testid="team-face-you">
      <span className={`${corner} top-0 left-0 border-t-2 border-l-2`} />
      <span className={`${corner} top-0 right-0 border-t-2 border-r-2`} />
      <span className={`${corner} bottom-0 left-0 border-b-2 border-l-2`} />
      <span className={`${corner} bottom-0 right-0 border-b-2 border-r-2`} />
    </span>
  );
}

export function TeamFaces({ team, userId }) {
  const faces = orderedFaces(team);
  if (!faces.length) return null;
  return (
    <div className="w-full overflow-x-auto tls-hide-scrollbar" data-testid="team-faces">
      <ul className="flex gap-3 sm:gap-4 w-max mx-auto px-2 py-2">
        {faces.map((face) => {
          const name = face.display_name || face.username || "Spieler";
          const mine = Boolean(userId && face.id === userId);
          return (
            <li key={face.id} className="shrink-0 w-[68px] text-center" data-testid={`team-face-${face.id}`}>
              <Link to={face.username ? `/u/${face.username}` : "#"} className="group inline-flex flex-col items-center gap-1.5" aria-label={`${name}, ${face.roleLabel}${mine ? " (du)" : ""}`}>
                <span className="relative inline-flex">
                  <span className="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center text-sm font-black text-white ring-1 ring-white/15 group-hover:ring-[#29B6E8]/60 transition" style={face.avatar_url ? undefined : { backgroundColor: faceTone(name) }}>
                    {face.avatar_url ? <img src={resolveMediaUrl(face.avatar_url)} alt="" loading="lazy" className="w-full h-full object-cover" /> : initials(name)}
                  </span>
                  {mine ? <YouCorners /> : null}
                </span>
                <span className="block w-full truncate text-[11px] font-bold text-white/85">{name}</span>
                <span className={`block text-[10px] uppercase tracking-wider ${face.role === "player" ? "text-white/45" : "text-white/75"}`} data-testid={`team-face-role-${face.id}`}>{face.roleLabel}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function TeamHeader({ team, header, levelInfo, userId, actions = null, children = null }) {
  const hex = header?.color_hex || teamColorHex(team.color);
  const game = header?.game;
  return (
    <section className="border-b border-white/10 pb-6" data-testid="team-header" data-color={header?.color || team.color || "cyan"}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        <Link to="/teams" className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← Teams</Link>
        <div className="relative mt-3 h-[120px] md:h-[140px] lg:h-[160px] rounded-sm overflow-hidden border border-white/10" style={{ background: bandBackground(hex) }} data-testid="team-band">
          <MascotBadge className="absolute -right-8 top-1/2 -translate-y-1/2 h-[190%] w-auto opacity-[0.14] pointer-events-none select-none" />
        </div>
        <div className="relative -mt-9 md:-mt-12 flex flex-col items-center text-center">
          <TeamCrest team={team} hex={hex} />
          <h1 className="mt-3 font-heading text-3xl md:text-4xl font-black leading-tight break-words max-w-full" data-testid="team-name">{team.name}</h1>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-white/65" data-testid="team-header-line">
            {team.tag ? <span className="font-bold tracking-wider">{team.tag}</span> : null}
            {game ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="px-2 py-0.5 rounded-sm border border-white/15 bg-white/[0.06] text-xs font-bold text-white/85" data-testid="team-game-plaque">{game.name || game.short_name}</span>
              </>
            ) : null}
            {levelInfo ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1" data-testid="team-header-level">
                  Level {levelInfo.level}
                  {levelInfo.crown === "gold" ? <Crown className="w-3.5 h-3.5 text-[#FFD700]" aria-label="Punktebestes Team" data-testid="team-header-crown" /> : null}
                </span>
              </>
            ) : null}
          </div>
          {team.description ? <p className="mt-3 text-sm md:text-base text-white/70 max-w-2xl">{team.description}</p> : null}
          {actions ? <div className="mt-4 flex flex-wrap justify-center gap-2" data-testid="team-header-actions">{actions}</div> : null}
          <div className="mt-5 w-full">
            <TeamFaces team={team} userId={userId} />
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

export default TeamHeader;
