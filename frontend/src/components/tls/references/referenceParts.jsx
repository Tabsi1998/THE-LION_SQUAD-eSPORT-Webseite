import { Link } from "react-router-dom";
import { ArrowRight, ExternalLink, Handshake, Medal, Trophy, User, Users } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";
import { gameLabel } from "@/lib/gameLabels";
import { useCountUp } from "@/hooks/useCountUp";

// Bausteine der Referenzen (#409, #859): Medaillen, Platz-Abzeichen, Karte einer Teilnahme, Einträge mit Aufstellung -
// gemeinsam für die Referenzen-Seite und die Vereinsplatzierungen im Mitgliederprofil, damit beide gleich aussehen.

export const MEDAL = {
  gold: { label: "Gold", ring: "from-[#FFF2A8] via-[#FFD700] to-[#9A7400]", text: "text-[#FFD700]", soft: "bg-[#FFD700]/10 border-[#FFD700]/40", glow: "shadow-[0_0_48px_rgba(255,215,0,0.22)]" },
  silver: { label: "Silber", ring: "from-[#FFFFFF] via-[#C9C9C9] to-[#6E6E6E]", text: "text-[#E2E2E2]", soft: "bg-white/10 border-white/40", glow: "shadow-[0_0_48px_rgba(220,220,220,0.16)]" },
  bronze: { label: "Bronze", ring: "from-[#F2C08E] via-[#CD7F32] to-[#6E3F16]", text: "text-[#E4A464]", soft: "bg-[#CD7F32]/10 border-[#CD7F32]/45", glow: "shadow-[0_0_48px_rgba(205,127,50,0.2)]" },
};

export const MEDAL_RANK = { gold: 0, silver: 1, bronze: 2 };

export function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("de-DE", { dateStyle: "medium" });
}

export function referenceGameName(item) {
  return item.game_name || gameLabel(item.game) || "Externes Turnier";
}

export function displayTitle(item) {
  return item.display_title || item.title || "Referenz";
}

export function entriesOf(item) {
  return Array.isArray(item.entries) && item.entries.length ? item.entries : [];
}

export function platformLabel(item, key) {
  const meta = Array.isArray(item.reference_meta?.platforms) ? item.reference_meta.platforms : [];
  return meta.find((entry) => entry.key === key)?.label || key;
}

/**
 * Der beste eigene Eintrag dieser Person (Profil-ID) in einer Teilnahme - wie im Mitgliederprofil (#409, #859): ein
 * Einzelstarter hat seine Platzierung, ein Teammitglied die seines Teams. null, wenn sie in keinem Eintrag steht.
 */
export function memberEntryOf(item, profileId) {
  const mine = entriesOf(item).filter((entry) => (entry.member_profile_ids || []).includes(profileId)
    || (entry.lineup_members || []).some((member) => member?.profile_id === profileId));
  if (!mine.length) return null;
  const rank = (entry) => Number(entry.placement) || 1e6;
  return mine.reduce((best, entry) => (rank(entry) < rank(best) ? entry : best));
}

/** Steht diese Person in der Teilnahme - an der Referenz oder in einem Eintrag? (#859) */
export function hasMember(item, profileId) {
  if (!profileId) return true;
  return (item.member_profile_ids || []).includes(profileId) || Boolean(memberEntryOf(item, profileId));
}

/** Der Name dieser Person aus den Aufstellungen - für den Filter-Chip. */
export function memberName(items, profileId) {
  for (const item of items) {
    for (const entry of entriesOf(item)) {
      const member = (entry.lineup_members || []).find((row) => row?.profile_id === profileId && row.display_name);
      if (member) return member.display_name;
    }
  }
  return "";
}

export function entryPeople(entry) {
  const members = (entry.lineup_members || []).map((member) => member.display_name).filter(Boolean);
  return [...members, ...(entry.lineup || [])];
}

export function entryTitle(entry) {
  if (entry.kind === "solo") return entryPeople(entry)[0] || "Einzelstarter";
  return entry.team_name || "THE LION SQUAD";
}

export function gameKey(item) {
  return item.game?.id || item.game_id || referenceGameName(item);
}

export function gameTitle(item) {
  return item.game?.display_name || item.game?.name || referenceGameName(item);
}

export function bestPlacement(item) {
  return Number(item.best_placement || item.placement || 0) || null;
}

export function medalForPlacement(placement) {
  return placement === 1 ? "gold" : placement === 2 ? "silver" : placement === 3 ? "bronze" : null;
}

export function medalOf(item) {
  if (item.medal) return item.medal;
  return medalForPlacement(bestPlacement(item));
}

export function timeOf(item) {
  const date = new Date(item.start_date || item.end_date || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function SectionTitle({ icon: Icon, accent, eyebrow, title, hint }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <div className="text-[11px] uppercase tracking-[0.3em] font-bold flex items-center gap-2" style={{ color: accent }}>
          {Icon && <Icon className="w-3.5 h-3.5" />} {eyebrow}
        </div>
        <h2 className="mt-2 font-heading text-2xl md:text-3xl font-black uppercase">{title}</h2>
      </div>
      {hint && <div className="text-xs uppercase tracking-widest font-bold text-white/40">{hint}</div>}
    </div>
  );
}

export function MedalStat({ medal, value, testId }) {
  const [shown, ref] = useCountUp(value);
  const tone = MEDAL[medal];
  return (
    <div ref={ref} className={`border rounded-sm px-3 sm:px-4 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 ${tone.soft}`} data-testid={testId}>
      <MedalEmblem medal={medal} size="md" />
      <div>
        <div className={`font-heading text-3xl md:text-4xl font-black tabular-nums ${tone.text}`}>{shown}</div>
        <div className="text-[10px] uppercase tracking-widest font-bold text-white/50">{tone.label}</div>
      </div>
    </div>
  );
}

export function CountLine({ label, value, testId }) {
  return <span data-testid={testId}><span className="text-white font-bold tabular-nums">{value}</span> {label}</span>;
}

// Die Medaille: ein Kreis mit metallischem Verlauf - Gold, Silber oder Bronze.
export function MedalEmblem({ medal, size = "md" }) {
  const tone = MEDAL[medal];
  const dims = size === "lg" ? "w-16 h-16" : size === "sm" ? "w-8 h-8" : "w-12 h-12";
  return (
    <span className={`${dims} shrink-0 rounded-full bg-gradient-to-br ${tone.ring} p-[3px] ${tone.glow}`} aria-hidden="true">
      <span className="w-full h-full rounded-full bg-[#0A0A0A]/80 flex items-center justify-center">
        <Medal className={`${size === "lg" ? "w-7 h-7" : size === "sm" ? "w-4 h-4" : "w-5 h-5"} ${tone.text}`} />
      </span>
    </span>
  );
}

// Die Platzierung als Abzeichen: Ring in Medaillenfarbe (oder neutral), Zahl groß, „Dabei“ ohne Platz.
export function PlacementBadge({ placement, medal, size = "md" }) {
  const tone = medal ? MEDAL[medal] : null;
  const dims = size === "xl" ? "w-32 h-32 md:w-40 md:h-40" : size === "lg" ? "w-20 h-20" : "w-14 h-14";
  const font = size === "xl" ? "text-5xl md:text-6xl" : size === "lg" ? "text-3xl" : "text-xl";
  return (
    <div className={`${dims} shrink-0 rounded-full p-[3px] bg-gradient-to-br ${tone ? `${tone.ring} ${tone.glow}` : "from-white/30 via-white/10 to-white/5"}`} data-testid="placement-badge" data-medal={medal || "none"}>
      <div className="w-full h-full rounded-full bg-[#0B0B0B] flex flex-col items-center justify-center">
        {placement ? (
          <>
            <span className={`font-display font-black leading-none tabular-nums ${font} ${tone ? tone.text : "text-white"}`}>{placement}.</span>
            {size !== "md" && <span className="mt-1 text-[10px] uppercase tracking-widest font-bold text-white/45">{tone ? tone.label : "Platz"}</span>}
          </>
        ) : (
          <>
            <Trophy className={`${size === "xl" ? "w-10 h-10" : "w-5 h-5"} text-white/60`} />
            <span className="mt-1 text-[9px] uppercase tracking-widest font-black text-white/50">Dabei</span>
          </>
        )}
      </div>
    </div>
  );
}

export function GameChip({ item }) {
  return (
    <span className="inline-flex items-center gap-2 pl-1 pr-2.5 py-1 border border-white/10 bg-black/40 rounded-sm text-[10px] uppercase tracking-widest font-bold text-white/70">
      <span className="w-5 h-5 rounded-sm bg-black overflow-hidden flex items-center justify-center">
        {item.game?.logo_url ? <img src={resolveMediaUrl(item.game.logo_url)} alt="" className="w-full h-full object-contain" /> : <Trophy className="w-3 h-3 text-[#29B6E8]" />}
      </span>
      {gameTitle(item)}
    </span>
  );
}

export function AvatarStack({ members, className = "", max = 6 }) {
  if (!members?.length) return null;
  const shown = members.slice(0, max);
  const rest = members.length - shown.length;
  return (
    <div className={`flex items-center ${className}`}>
      {shown.map((member, index) => (
        <span key={member.profile_id || member.display_name || index} title={member.display_name} className={`w-8 h-8 rounded-full border-2 border-[#0F0F0F] bg-[#1A1A1A] overflow-hidden flex items-center justify-center ${index ? "-ml-2" : ""}`}>
          {member.avatar_url ? <img src={resolveMediaUrl(member.avatar_url)} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] font-black text-white/60">{(member.display_name || "?").slice(0, 1).toUpperCase()}</span>}
        </span>
      ))}
      {rest > 0 && <span className="-ml-2 w-8 h-8 rounded-full border-2 border-[#0F0F0F] bg-[#29B6E8]/20 text-[#29B6E8] text-[10px] font-black flex items-center justify-center">+{rest}</span>}
    </div>
  );
}

// Plattform, Format, Liga und Saison als Chips - aus den Feldern, nicht mehr aus dem Titel.
export function FieldChips({ item, className = "" }) {
  const chips = [
    ...(item.platforms || []).map((key) => platformLabel(item, key)),
    item.format,
    item.league,
    item.season,
  ].filter(Boolean);
  if (!chips.length) return null;
  return (
    <div className={`${className} flex flex-wrap gap-1.5`} data-testid={`reference-chips-${item.id}`}>
      {chips.map((chip) => (
        <span key={chip} className="px-2 py-1 border border-white/10 bg-white/[0.03] rounded-sm text-[10px] uppercase tracking-widest text-white/50 font-bold">{chip}</span>
      ))}
    </div>
  );
}

// Eine Teilnahme in der Zeitleiste: Platzierung links, Titel und Chips, dann die Einträge.
export function ReferenceCard({ item, entry = null, testId = "" }) {
  // Mit `entry` (Mitgliederprofil, #859): die Platzierung des eigenen Teams oder Einzelstarts dieser Person - nicht die
  // beste der ganzen Teilnahme (#409) - und nur dieser Eintrag.
  const entries = entry ? [entry] : entriesOf(item);
  const placement = entry ? (Number(entry.placement) || null) : bestPlacement(item);
  const medal = entry ? (entry.medal || medalForPlacement(placement)) : medalOf(item);
  const tone = medal ? MEDAL[medal] : null;
  const single = entries.length === 1 ? entries[0] : null;
  return (
    <article className={`relative overflow-hidden h-full flex flex-col border rounded-sm bg-[#111] p-4 transition hover:border-[#29B6E8]/40 ${tone ? tone.soft : "border-white/10"}`} data-testid={testId || `reference-card-${item.id}`}>
      {tone && <div className={`absolute top-0 left-0 bottom-0 w-1 bg-gradient-to-b ${tone.ring}`} />}
      <div className="flex items-start gap-4">
        <PlacementBadge placement={placement} medal={medal} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <GameChip item={item} />
            {item.organizer && <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold truncate">{item.organizer}</span>}
            {(item.partners || []).map((partner) => (
              <Link key={partner.id} to={`/partners/${partner.slug || partner.id}`} data-testid={`reference-partner-${partner.slug || partner.id}`} className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8] hover:text-white">
                <Handshake className="w-3 h-3" /> {partner.name}
              </Link>
            ))}
          </div>
          <Link to={`/references/${item.id}`} className="block mt-2 font-heading text-lg md:text-xl font-black uppercase leading-tight break-words hover:text-[#29B6E8] transition">{displayTitle(item)}</Link>
          <p className="mt-1 text-xs text-white/50">
            {[formatDate(item.start_date), item.location, single?.team_count ? `${single.team_count} Teams` : single?.participant_count ? `${single.participant_count} Teilnehmer` : ""].filter(Boolean).join(" · ")}
          </p>
          <FieldChips item={item} className="mt-2" />
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)}
      </div>
      <div className="mt-auto pt-4 flex flex-wrap items-center gap-2">
        <Link to={`/references/${item.id}`} className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-bold text-[#29B6E8] hover:text-white">Details <ArrowRight className="w-3 h-3" /></Link>
        <span className="ml-auto flex flex-wrap gap-2">
          <RefButton href={item.external_url} label="Turnier" compact />
          <RefButton href={item.bracket_url} label="Bracket" compact />
          <RefButton href={item.result_url} label="Ergebnis" compact />
        </span>
      </div>
    </article>
  );
}

// Ein Eintrag der Teilnahme: Platz in Medaillenfarbe, Team oder Einzelstarter, Aufstellung mit Avataren.
export function EntryRow({ entry, large = false }) {
  const tone = entry.medal ? MEDAL[entry.medal] : null;
  const isSolo = entry.kind === "solo";
  const members = entry.lineup_members || [];
  const names = isSolo && members.length ? [] : (entry.lineup || []);
  const counts = entry.participant_count ? `von ${entry.participant_count}` : entry.team_count ? `von ${entry.team_count} Teams` : "";
  return (
    <div className={`flex items-center gap-3 border rounded-sm ${tone ? tone.soft : "border-white/10 bg-white/[0.03]"} ${large ? "p-4" : "p-2.5"}`} data-testid={`reference-entry-${entry.id}`}>
      <div className={`${large ? "w-14 h-14" : "w-10 h-10"} shrink-0 rounded-full p-[2px] bg-gradient-to-br ${tone ? tone.ring : "from-white/25 to-white/5"}`}>
        <div className="w-full h-full rounded-full bg-[#0B0B0B] flex items-center justify-center">
          {entry.placement ? (
            <span className={`${large ? "text-xl" : "text-sm"} font-display font-black leading-none tabular-nums ${tone ? tone.text : "text-white"}`}>{entry.placement}.</span>
          ) : (
            <span className="text-[8px] uppercase tracking-widest font-black text-white/60">Dabei</span>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-black text-white/45">
            {isSolo ? <User className="w-3 h-3" /> : <Users className="w-3 h-3" />} {isSolo ? "Einzel" : "Team"}
          </span>
          <span className="font-bold text-sm text-white truncate">{entryTitle(entry)}</span>
          {entry.placement_label && <span className="text-[10px] uppercase tracking-widest text-white/45">{entry.placement_label}</span>}
          {counts && <span className="text-[10px] uppercase tracking-widest text-white/45">{counts}</span>}
        </div>
        {(!isSolo || members.length === 0) && (members.length > 0 || names.length > 0) && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {members.map((member) => <PlayerChip key={member.profile_id || member.display_name} member={member} />)}
            {names.map((name) => <span key={name} className="px-2 py-0.5 border border-white/10 bg-black/20 text-xs text-white/55 rounded-sm">{name}</span>)}
          </div>
        )}
        {isSolo && members[0] && (
          <div className="mt-1.5"><PlayerChip member={members[0]} /></div>
        )}
      </div>
    </div>
  );
}

export function PlayerChip({ member }) {
  const content = (
    <>
      <span className="w-6 h-6 rounded-full bg-black border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
        {member.avatar_url ? <img src={resolveMediaUrl(member.avatar_url)} alt="" className="w-full h-full object-cover" /> : <span className="text-[9px] font-black text-white/50">{(member.display_name || "?").slice(0, 1).toUpperCase()}</span>}
      </span>
      <span className="truncate">{member.display_name}</span>
    </>
  );
  const className = "inline-flex items-center gap-1.5 max-w-full border border-white/10 bg-black/30 text-white/80 rounded-full pl-0.5 pr-2.5 py-0.5 text-xs font-semibold";
  if (member.profile_url) return <Link to={member.profile_url} className={`${className} hover:border-[#29B6E8]/60 hover:text-[#29B6E8]`}>{content}</Link>;
  return <span className={className}>{content}</span>;
}

export function RefButton({ href, label, compact = false }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`inline-flex items-center justify-center gap-1.5 border border-white/10 hover:border-[#29B6E8]/50 rounded-sm uppercase tracking-wider font-bold text-white/70 hover:text-[#29B6E8] ${compact ? "px-2.5 py-1.5 text-[10px]" : "px-3 py-2 text-xs"}`}>
      {label} <ExternalLink className="w-3 h-3" />
    </a>
  );
}
