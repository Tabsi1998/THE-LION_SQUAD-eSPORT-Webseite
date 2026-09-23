import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { api, resolveMediaUrl } from "@/lib/api";
import { gameLabel } from "@/lib/gameLabels";
import { seoTextPreview } from "@/lib/textPreview";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { ExternalLink, Medal, Trophy, User, Users } from "lucide-react";

// Referenzen (#409): eine Referenz ist eine Turnierteilnahme des Vereins mit Einträgen - ein Team
// mit gemeinsamer Platzierung oder Einzelstarter mit je eigener. Die Karte zeigt die Teilnahme
// mit allen Einträgen in Podest-Optik; Plattform, Format, Liga und Saison kommen als Felder vom
// Server (alte Titel-Muster löst er selbst auf).

const medalClasses = {
  gold: "border-[#FFD700]/55 bg-[#FFD700]/12 text-[#FFD700]",
  silver: "border-white/35 bg-white/10 text-white",
  bronze: "border-[#CD7F32]/50 bg-[#CD7F32]/12 text-[#CD7F32]",
};
const modeLabels = { online: "Online", offline: "Vor Ort", hybrid: "Hybrid" };
const statusLabels = { active: "Laufend", planned: "Geplant", completed: "Abgeschlossen", archived: "Archiviert" };
const statusClasses = {
  active: "border-[#00D26A]/40 bg-[#00D26A]/10 text-[#00D26A]",
  planned: "border-[#29B6E8]/40 bg-[#29B6E8]/10 text-[#29B6E8]",
  completed: "border-white/15 bg-white/5 text-white/50",
  archived: "border-white/10 bg-white/5 text-white/35",
};

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("de-DE", { dateStyle: "medium" });
}

function referenceGameName(item) {
  return item.game_name || gameLabel(item.game) || "Externes Turnier";
}

export function displayTitle(item) {
  return item.display_title || item.title || "Referenz";
}

export function entriesOf(item) {
  return Array.isArray(item.entries) && item.entries.length ? item.entries : [];
}

function platformLabel(item, key) {
  const meta = Array.isArray(item.reference_meta?.platforms) ? item.reference_meta.platforms : [];
  return meta.find((entry) => entry.key === key)?.label || key;
}

function entryPeople(entry) {
  const members = (entry.lineup_members || []).map((member) => member.display_name).filter(Boolean);
  return [...members, ...(entry.lineup || [])];
}

function entryTitle(entry) {
  if (entry.kind === "solo") return entryPeople(entry)[0] || "Einzelstarter";
  return entry.team_name || "THE LION SQUAD";
}

function gameKey(item) {
  return item.game?.id || item.game_id || referenceGameName(item);
}

function gameTitle(item) {
  return item.game?.display_name || item.game?.name || referenceGameName(item);
}

export function groupReferences(items) {
  const games = new Map();
  items.forEach((item) => {
    const key = gameKey(item);
    if (!games.has(key)) games.set(key, { key, title: gameTitle(item), logo: item.game?.logo_url, items: [] });
    games.get(key).items.push(item);
  });
  return Array.from(games.values()).map((game) => ({ ...game, count: game.items.length }));
}

export default function ReferencesPage() {
  useDocumentTitle("Referenzen", "Externe Turniere, Ligen, Platzierungen, Podien und Erfolge von THE LION SQUAD eSports.");
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [filter, setFilter] = useState("all");
  const [gameFilter, setGameFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [seasonFilter, setSeasonFilter] = useState("all");

  const load = useCallback(() => {
    api.get("/references").then(({ data }) => {
      setItems(data.items || []);
      setSummary(data.summary || {});
    }).catch(() => {
      setItems([]);
      setSummary({});
    });
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["references"]);

  const filteredItems = items.filter((item) => {
    if (filter === "podium") return entriesOf(item).some((entry) => entry.placement && Number(entry.placement) <= 3);
    if (filter === "active") return item.status === "active" || item.status === "planned";
    if (filter === "completed") return item.status === "completed" || item.status === "archived";
    return true;
  }).filter((item) => {
    if (gameFilter !== "all" && gameKey(item) !== gameFilter) return false;
    if (platformFilter !== "all" && !(item.platforms || []).includes(platformFilter)) return false;
    if (seasonFilter !== "all" && (item.season || "") !== seasonFilter) return false;
    return true;
  });
  const gameOptions = groupReferences(items).map((game) => ({ key: game.key, label: game.title, count: game.count }));
  const platformOptions = Array.from(new Map(items.flatMap((item) => (item.platforms || []).map((key) => [key, { key, label: platformLabel(item, key) }]))).values());
  const seasonOptions = Array.from(new Set(items.map((item) => item.season).filter(Boolean))).sort((a, b) => b.localeCompare(a, "de-AT", { numeric: true }));
  const groupedItems = groupReferences(filteredItems);

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Verein</span>
          <h1 className="mt-3 font-heading text-4xl md:text-6xl font-black uppercase">Referenzen</h1>
          <p className="mt-4 text-white/70 max-w-3xl">
            Externe Turniere, Ligen und Events, bei denen THE LION SQUAD als Team oder mit Einzelstartern im Namen des Vereins angetreten ist.
            Platzierungen, Aufstellungen und Ergebnisquellen sind hier zentral verlinkt.
          </p>
        </div>

        {/* Drei Zahlen statt acht (#409): Teilnahmen, Podestplätze, Gold - der Rest sind Filter. */}
        <div className="mt-8 grid grid-cols-3 gap-3 max-w-2xl" data-testid="references-numbers">
          <Stat label="Teilnahmen" value={summary.total || 0} icon={Trophy} testId="references-stat-total" />
          <Stat label="Podestplätze" value={summary.podiums || 0} icon={Medal} testId="references-stat-podiums" />
          <Stat label="Gold" value={summary.gold || 0} tone="gold" testId="references-stat-gold" />
        </div>
        <div className="mt-2 text-xs text-white/40">
          Seit Vereinsgründung · {summary.entries || 0} Einträge (Teams und Einzelstarter) · {summary.games || 0} Spiele
        </div>

        <div className="mt-8 space-y-3">
          <FilterRow label="Status">
            <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>Alle</FilterButton>
            <FilterButton active={filter === "podium"} onClick={() => setFilter("podium")}>Podest</FilterButton>
            <FilterButton active={filter === "active"} onClick={() => setFilter("active")}>Laufend/Geplant</FilterButton>
            <FilterButton active={filter === "completed"} onClick={() => setFilter("completed")}>Abgeschlossen</FilterButton>
          </FilterRow>
          <FilterRow label="Spiel">
            <FilterButton active={gameFilter === "all"} onClick={() => setGameFilter("all")}>Alle Spiele</FilterButton>
            {gameOptions.map((game) => (
              <FilterButton key={game.key} active={gameFilter === game.key} onClick={() => setGameFilter(game.key)}>
                {game.label} ({game.count})
              </FilterButton>
            ))}
          </FilterRow>
          {platformOptions.length > 1 && (
            <FilterRow label="Plattform">
              <FilterButton active={platformFilter === "all"} onClick={() => setPlatformFilter("all")}>Alle Plattformen</FilterButton>
              {platformOptions.map((platform) => (
                <FilterButton key={platform.key} active={platformFilter === platform.key} onClick={() => setPlatformFilter(platform.key)}>
                  {platform.label}
                </FilterButton>
              ))}
            </FilterRow>
          )}
          {seasonOptions.length > 0 && (
            <FilterRow label="Saison">
              <FilterButton active={seasonFilter === "all"} onClick={() => setSeasonFilter("all")}>Alle Saisons</FilterButton>
              {seasonOptions.map((season) => (
                <FilterButton key={season} active={seasonFilter === season} onClick={() => setSeasonFilter(season)} testId={`references-season-${season}`}>
                  {season}
                </FilterButton>
              ))}
            </FilterRow>
          )}
        </div>

        {items.length === 0 ? (
          <div className="mt-12 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            <Medal className="w-10 h-10 mx-auto opacity-40 mb-4" />
            <div className="font-heading font-bold text-lg">Referenzen werden bald ergänzt.</div>
            <div className="text-sm mt-2">Sobald externe Turniere gepflegt sind, erscheinen sie hier.</div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="mt-8 border border-dashed border-white/15 rounded-sm p-10 text-center text-white/45" data-testid="references-empty-filter">
            Keine Referenzen in diesem Filter.
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            {groupedItems.map((game) => <ReferenceGameGroup key={game.key} group={game} />)}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

export function ReferenceDetailPage() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const seoTitle = item ? displayTitle(item) : "Referenz";
  const seoDescription = seoTextPreview(
    item?.description || item?.highlights,
    `${referenceGameName(item || {})} Referenz von THE LION SQUAD eSports mit Platzierung, Aufstellung und Ergebnis.`
  );
  useDocumentTitle(seoTitle, seoDescription, {
    image: item?.game?.logo_url,
    canonical: item?.id ? `${window.location.origin}/references/${item.id}` : undefined,
  });

  useEffect(() => {
    setLoading(true);
    api.get(`/references/${id}`).then(({ data }) => setItem(data)).catch(() => setItem(null)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PublicLayout><div className="p-20 text-center font-display tracking-widest text-white/40">LADE REFERENZ ...</div></PublicLayout>;
  if (!item) return <PublicLayout><div className="p-20 text-center text-white/50">Referenz nicht gefunden.</div></PublicLayout>;

  const entries = entriesOf(item);
  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link to="/references" className="text-xs uppercase tracking-widest font-bold text-[#29B6E8] hover:text-white">Zurück zu Referenzen</Link>
        <div className="mt-6 grid xl:grid-cols-[minmax(0,1fr)_20rem] gap-8 items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <Badge className={statusClasses[item.status || "completed"] || statusClasses.completed}>{statusLabels[item.status || "completed"] || item.status}</Badge>
              <Badge>{referenceGameName(item)}</Badge>
            </div>
            <FieldChips item={item} className="mt-4" />
            <h1 className="mt-3 font-heading text-4xl md:text-5xl xl:text-6xl font-black uppercase leading-[0.95] break-words max-w-5xl">{displayTitle(item)}</h1>
            <p className="mt-4 text-lg text-white/75">
              {item.organizer || "THE LION SQUAD"}
              {item.location ? ` · ${item.location}` : ""}
            </p>
            <MetaGrid item={item} />
          </div>
          <aside className="space-y-3 xl:sticky xl:top-24">
            <BestPlacementPanel item={item} large />
            <div className="grid gap-2">
              <RefButton href={item.external_url} label="Turnierseite" />
              <RefButton href={item.bracket_url} label="Bracket" />
              <RefButton href={item.match_url} label="Matchseite" />
              <RefButton href={item.result_url} label="Ergebnis" />
            </div>
          </aside>
        </div>
        <div className="mt-8 border border-white/10 bg-[#121212] rounded-sm p-5" data-testid="reference-detail-entries">
          <h2 className="font-heading text-xl font-black uppercase flex items-center gap-2"><Users className="w-5 h-5 text-[#29B6E8]" /> Einträge</h2>
          <div className="mt-4 grid gap-3">
            {entries.map((entry) => <EntryRow key={entry.id} entry={entry} large />)}
          </div>
        </div>
        <div className="mt-8">
          {item.description && <TextBlock title="Bericht" text={item.description} />}
          {item.highlights && <TextBlock title="Highlights" text={item.highlights} tone="gold" />}
        </div>
      </section>
    </PublicLayout>
  );
}

function Stat({ label, value, icon: Icon, tone, testId }) {
  const color = tone === "gold" ? "text-[#FFD700]" : tone === "bronze" ? "text-[#CD7F32]" : "text-[#29B6E8]";
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">{label}</div>
        {Icon && <Icon className={`w-4 h-4 ${color}`} />}
      </div>
      <div className={`mt-2 font-display text-3xl md:text-4xl font-black ${color}`}>{value}</div>
    </div>
  );
}

function FilterRow({ label, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="w-24 shrink-0 text-[10px] uppercase tracking-widest text-white/35 font-bold">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FilterButton({ active, onClick, children, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`px-3 py-2 border rounded-sm text-xs uppercase tracking-wider font-bold transition ${active ? "border-[#29B6E8] bg-[#29B6E8] text-black" : "border-white/10 text-white/55 hover:text-white hover:border-[#29B6E8]/45"}`}
    >
      {children}
    </button>
  );
}

function ReferenceGameGroup({ group }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <div className="w-11 h-11 border border-white/10 bg-black rounded-sm flex items-center justify-center overflow-hidden">
          {group.logo ? <img src={resolveMediaUrl(group.logo)} alt="" className="w-full h-full object-contain p-1.5" /> : <Trophy className="w-5 h-5 text-[#29B6E8]" />}
        </div>
        <div className="min-w-0">
          <h2 className="font-heading text-2xl font-black uppercase leading-tight truncate">{group.title}</h2>
          <div className="text-xs text-white/40">{group.count} {group.count === 1 ? "Teilnahme" : "Teilnahmen"}</div>
        </div>
      </div>
      <div className="grid xl:grid-cols-2 gap-4">
        {group.items.map((item) => <ReferenceCard key={item.id} item={item} />)}
      </div>
    </section>
  );
}

// Plattform, Format, Liga und Saison als Chips - aus den Feldern, nicht mehr aus dem Titel.
function FieldChips({ item, className = "" }) {
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

function ReferenceCard({ item }) {
  const status = item.status || "completed";
  const entries = entriesOf(item);
  return (
    <article className="h-full flex flex-col border border-white/10 rounded-sm bg-[#111] p-4 hover:border-[#29B6E8]/35 transition" data-testid={`reference-card-${item.id}`}>
      <div className="flex items-start gap-4">
        <BestPlacementPanel item={item} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={statusClasses[status] || statusClasses.completed}>{statusLabels[status] || status}</Badge>
            {item.organizer && <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{item.organizer}</span>}
          </div>
          <FieldChips item={item} className="mt-2" />
          <Link to={`/references/${item.id}`} className="block mt-2 font-heading text-xl md:text-2xl font-black uppercase leading-tight break-words hover:text-[#29B6E8] transition">{displayTitle(item)}</Link>
          <p className="mt-1 text-sm text-white/55">
            {[formatDate(item.start_date), item.location].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)}
      </div>
      {item.description && <p className="mt-3 text-sm text-white/62 leading-relaxed line-clamp-2">{item.description}</p>}
      <div className="mt-auto pt-4 flex flex-wrap gap-2">
        <Link to={`/references/${item.id}`} className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-[#29B6E8]/45 rounded-sm text-xs uppercase tracking-wider font-bold text-[#29B6E8] hover:bg-[#29B6E8]/10">Details</Link>
        <RefButton href={item.external_url} label="Turnier" />
        <RefButton href={item.bracket_url} label="Bracket" />
        <RefButton href={item.result_url} label="Ergebnis" />
      </div>
    </article>
  );
}

// Ein Eintrag der Teilnahme: Podest-Optik je Eintrag (Gold/Silber/Bronze als Rahmen), Team oder
// Einzelstarter, Aufstellung als Profil-Chips mit Link.
function EntryRow({ entry, large = false }) {
  const tone = entry.medal ? medalClasses[entry.medal] : "border-white/15 bg-white/5 text-white/65";
  const isSolo = entry.kind === "solo";
  const members = entry.lineup_members || [];
  const names = isSolo && members.length ? [] : (entry.lineup || []);
  const counts = entry.participant_count ? `von ${entry.participant_count}` : entry.team_count ? `von ${entry.team_count} Teams` : "";
  return (
    <div className={`flex items-center gap-3 border rounded-sm ${tone} ${large ? "p-4" : "p-2.5"}`} data-testid={`reference-entry-${entry.id}`}>
      <div className={`${large ? "w-16 h-16" : "w-12 h-12"} shrink-0 rounded-sm bg-black/35 border border-current/20 flex flex-col items-center justify-center`}>
        {entry.placement ? (
          <>
            {entry.medal ? <Medal className="w-3.5 h-3.5 mb-0.5" /> : null}
            <span className={`${large ? "text-2xl" : "text-lg"} font-display font-black leading-none tabular-nums`}>{entry.placement}.</span>
          </>
        ) : (
          <>
            <Trophy className="w-3.5 h-3.5 mb-0.5" />
            <span className="text-[9px] uppercase tracking-widest font-black">Dabei</span>
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-black opacity-80">
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

// Der beste Eintrag der Teilnahme als Kachel mit Spiel-Logo - der schnelle Blick in der Liste.
function BestPlacementPanel({ item, large = false }) {
  const medalClass = item.medal ? medalClasses[item.medal] : "border-white/15 bg-white/5 text-white/65";
  const placement = item.best_placement || item.placement;
  return (
    <div className={`border rounded-sm ${medalClass} ${large ? "p-5 flex xl:flex-col items-center xl:items-start gap-3" : "p-2 w-[6.5rem] shrink-0 flex flex-col items-center text-center gap-2"}`}>
      <div className={`${large ? "w-24 h-24" : "w-14 h-14"} rounded-sm bg-black/35 border border-current/20 flex items-center justify-center overflow-hidden shrink-0`}>
        {item.game?.logo_url ? (
          <img src={resolveMediaUrl(item.game.logo_url)} alt="" className="w-full h-full object-contain p-2" />
        ) : item.medal ? (
          <Medal className={large ? "w-10 h-10" : "w-7 h-7"} />
        ) : (
          <Trophy className={large ? "w-10 h-10" : "w-7 h-7"} />
        )}
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-widest font-black opacity-80">{large ? "Beste Platzierung" : "Bestes"}</div>
        <div className={`${large ? "text-5xl" : "text-2xl"} mt-1 font-display font-black leading-none`}>{placement ? `${placement}.` : "Dabei"}</div>
        {large && <div className="mt-2 text-xs text-white/55">{entriesOf(item).length} {entriesOf(item).length === 1 ? "Eintrag" : "Einträge"}</div>}
      </div>
    </div>
  );
}

function PlayerChip({ member }) {
  const content = (
    <>
      <span className="w-6 h-6 rounded-sm bg-black border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
        {member.avatar_url ? <img src={resolveMediaUrl(member.avatar_url)} alt="" className="w-full h-full object-cover" /> : <Users className="w-3.5 h-3.5 text-white/35" />}
      </span>
      <span className="truncate">{member.display_name}</span>
    </>
  );
  const className = "inline-flex items-center gap-1.5 max-w-full border border-[#29B6E8]/25 bg-[#29B6E8]/10 text-white/80 rounded-sm px-2 py-0.5 text-xs font-semibold";
  if (member.profile_url) return <Link to={member.profile_url} className={`${className} hover:border-[#29B6E8]/60 hover:text-[#29B6E8]`}>{content}</Link>;
  return <span className={className}>{content}</span>;
}

function MetaGrid({ item }) {
  const rows = [
    ["Spiel", referenceGameName(item)],
    ["Modus", modeLabels[item.mode] || item.mode],
    ["Datum", [formatDate(item.start_date), formatDate(item.end_date)].filter(Boolean).join(" - ")],
    ["Veranstalter", item.organizer],
    ["Liga", item.league],
    ["Saison", item.season],
  ].filter(([, value]) => value);
  return (
    <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {rows.map(([label, value]) => (
        <div key={label} className="border border-white/10 bg-[#121212] rounded-sm p-3">
          <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{label}</div>
          <div className="mt-1 text-sm text-white/75">{value}</div>
        </div>
      ))}
    </div>
  );
}

function TextBlock({ title, text, tone }) {
  return (
    <div className={`mt-8 border rounded-sm p-5 ${tone === "gold" ? "border-[#FFD700]/25 bg-[#FFD700]/10" : "border-white/10 bg-[#121212]"}`}>
      <h2 className={`font-heading text-xl font-black uppercase ${tone === "gold" ? "text-[#FFD700]" : "text-white"}`}>{title}</h2>
      <p className="mt-3 text-sm md:text-base text-white/70 leading-relaxed whitespace-pre-line">{text}</p>
    </div>
  );
}

function Badge({ children, className = "border-white/10 bg-white/5 text-white/55" }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-sm border text-[10px] uppercase tracking-widest font-bold ${className}`}>{children}</span>;
}

function RefButton({ href, label }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-white/10 hover:border-[#29B6E8]/50 rounded-sm text-xs uppercase tracking-wider font-bold text-white/70 hover:text-[#29B6E8]">
      {label} <ExternalLink className="w-3 h-3" />
    </a>
  );
}
