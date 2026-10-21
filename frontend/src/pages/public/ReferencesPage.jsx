import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { api, resolveMediaUrl } from "@/lib/api";
import { seoTextPreview } from "@/lib/textPreview";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { EntryRow, FieldChips, GameChip, MEDAL, PlacementBadge, RefButton, SectionTitle, bestPlacement, displayTitle, entriesOf, entryTitle, formatDate, medalOf, memberName, referenceGameName } from "@/components/tls/references/referenceParts";
import { Flag, Users } from "lucide-react";
import { referenceHref } from "@/lib/seasonClose";
import { RunningSeries } from "@/components/tls/references/RunningSeries";
import { HonorHeader } from "@/components/tls/references/HonorHeader";
import { Showcase } from "@/components/tls/references/Showcase";
import { SeriesPaths } from "@/components/tls/references/SeriesPaths";
import { Chronicle } from "@/components/tls/references/Chronicle";
import { JoinBand } from "@/components/tls/references/JoinBand";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { honorStats, linkedSeasons, podiumItems } from "@/lib/referencesOverview";
import "@/components/tls/references/references.css";

// Erfolge & Referenzen (#409, neu gestaltet #1878): oben die Ehrentafel des Vereins, dann was gerade läuft (#1748), die
// Vitrine mit der Hauptkarte und den übrigen Podestplätzen, Serien & Ligen mit ihrem Liga-Weg, die Chronik aller
// Teilnahmen je Jahr und zum Schluss das Mitmachen-Band. Eine Referenz ist eine Turnierteilnahme mit Einträgen (Team
// oder Einzelstarter). Die Logik steht in lib/referencesOverview.js; fremde Namen erscheinen hier nie.

const modeLabels = { online: "Online", offline: "Vor Ort", hybrid: "Hybrid" };
const statusLabels = { active: "Laufend", planned: "Geplant", completed: "Abgeschlossen", archived: "Archiviert" };

// Die Gruppierung der Chronik lebt in lib/referencesOverview.js; hier bleibt sie für ältere Aufrufer erreichbar.
export { timelineGroups } from "@/lib/referencesOverview";

/** Laufende Saisons und Serien & Ligen: eigene schlanke Endpunkte, ein Fehler blendet nur ihren Abschnitt aus. */
function useSeriesOverview() {
  const [running, setRunning] = useState([]);
  const [lineages, setLineages] = useState([]);
  useEffect(() => {
    let alive = true;
    api.get("/reference-series/public/running").then(({ data }) => {
      const list = Array.isArray(data?.items) ? data.items.filter((item) => item?.lineage && item?.series) : [];
      if (alive) setRunning(list);
    }).catch(() => { if (alive) setRunning([]); });
    api.get("/reference-series/public/lineages").then(({ data }) => {
      const list = Array.isArray(data?.items) ? data.items.filter((item) => item?.lineage?.slug && item?.seasons?.length) : [];
      if (alive) setLineages(list);
    }).catch(() => { if (alive) setLineages([]); });
    return () => { alive = false; };
  }, []);
  return { running, lineages };
}

export default function ReferencesPage() {
  useDocumentTitle("Erfolge & Referenzen", "Turniere, Ligen, Platzierungen und Podestplätze von THE LION SQUAD eSports - die Erfolgswand des Vereins.");
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [showcase, setShowcase] = useState(null);
  const { running, lineages } = useSeriesOverview();
  // Aus dem Mitgliederprofil (#859): `?member=<Profil-ID>` zeigt in der Chronik nur die Teilnahmen dieser Person.
  const [searchParams, setSearchParams] = useSearchParams();
  const memberFilter = searchParams.get("member") || "";
  const chronicleRef = useRef(null);

  const load = useCallback(() => {
    api.get("/references").then(({ data }) => {
      setItems(data.items || []);
      setSummary(data.summary || {});
      setShowcase(data.showcase || null);
    }).catch(() => {
      setItems([]);
      setSummary({});
      setShowcase(null);
    });
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["references"]);
  // Wer aus dem Profil kommt, will die Teilnahmen sehen - nicht erst an Ehrentafel und Vitrine vorbei.
  useEffect(() => {
    if (memberFilter && items.length) chronicleRef.current?.scrollIntoView?.({ block: "start" });
  }, [memberFilter, items.length]);
  const clearMember = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("member");
    next.delete("name");
    setSearchParams(next, { replace: true });
  };
  const memberLabel = memberFilter ? (memberName(items, memberFilter) || searchParams.get("name") || "Mitglied") : "";

  const linked = useMemo(() => linkedSeasons(lineages), [lineages]);
  const stats = useMemo(() => honorStats({ summary, items, lineages }), [summary, items, lineages]);
  const hasPodium = podiumItems(items).length > 0;
  const links = [
    running.length ? { href: "#einsatz", label: "Im Einsatz", pulse: running.some((item) => item.today) } : null,
    hasPodium ? { href: "#vitrine", label: "Vitrine" } : null,
    lineages.length ? { href: "#serien", label: "Serien & Ligen" } : null,
    { href: "#chronik", label: "Chronik" },
  ].filter(Boolean);

  return (
    <PublicLayout>
      <HonorHeader stats={stats} links={links} />
      <RunningSeries items={running} index={2} />
      <Showcase items={items} showcase={showcase} linked={linked} index={3} />
      <SeriesPaths lineages={lineages} index={4} />
      <Chronicle ref={chronicleRef} items={items} linked={linked} memberId={memberFilter} memberLabel={memberLabel} onClearMember={clearMember} index={5} />
      <JoinBand index={6} />
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
    image: item?.game?.cover_url || item?.game?.logo_url,
    canonical: item?.id ? `${window.location.origin}/references/${item.id}` : undefined,
  });

  useEffect(() => {
    setLoading(true);
    api.get(`/references/${id}`).then(({ data }) => setItem(data)).catch(() => setItem(null)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PublicLayout><PublicLoadingState label="Lade Referenz" /></PublicLayout>;
  if (!item) return <PublicLayout><div className="p-20 text-center text-white/50">Referenz nicht gefunden.</div></PublicLayout>;

  const entries = entriesOf(item);
  const medal = medalOf(item);
  const cover = item.game?.cover_url;
  return (
    <PublicLayout>
      <section className="relative overflow-hidden border-b border-white/10" data-testid="reference-detail-hero">
        {cover && <img src={resolveMediaUrl(cover)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/85 to-[#0A0A0A]/40" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
          <Link to="/references" className="text-xs uppercase tracking-widest font-bold text-[#29B6E8] hover:text-white">← Erfolge &amp; Referenzen</Link>
          <div className="mt-6 grid md:grid-cols-[auto_minmax(0,1fr)] gap-6 md:gap-10 items-start">
            <PlacementBadge placement={bestPlacement(item)} medal={medal} size="xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <GameChip item={item} />
                <Badge>{statusLabels[item.status || "completed"] || item.status}</Badge>
                {medal && <Badge className={`${MEDAL[medal].soft} ${MEDAL[medal].text}`}>{MEDAL[medal].label}</Badge>}
              </div>
              <h1 className="mt-3 font-heading text-4xl md:text-5xl xl:text-6xl font-black uppercase leading-[0.95] break-words max-w-5xl">{displayTitle(item)}</h1>
              <p className="mt-3 text-lg text-white/70">
                {[item.organizer, item.league, item.season].filter(Boolean).join(" · ")}
              </p>
              <FieldChips item={item} className="mt-4" />
              {item.season_link && (
                <Link to={referenceHref(item)} data-testid="reference-detail-season" className="mt-4 inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-[#29B6E8]/40 bg-[#29B6E8]/10 hover:bg-[#29B6E8]/20 rounded-sm text-[11px] uppercase tracking-widest font-bold text-[#29B6E8] transition-colors">
                  <Flag className="w-3.5 h-3.5" aria-hidden="true" /> aus Saison {item.season_link.label}
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid xl:grid-cols-[minmax(0,1fr)_20rem] gap-8 items-start">
          <div className="min-w-0 space-y-8">
            <div data-testid="reference-detail-entries">
              <SectionTitle icon={Users} accent="#29B6E8" eyebrow={entries.length === 1 ? "Unser Eintrag" : "Unsere Einträge"} title={entries.length === 1 ? entryTitle(entries[0]) : "Team und Einzelstarter"} />
              <div className="mt-5 grid gap-3">
                {entries.map((entry) => <EntryRow key={entry.id} entry={entry} large />)}
              </div>
            </div>
            {item.highlights && <TextBlock title="Highlights" text={item.highlights} tone="gold" />}
            {item.description && <TextBlock title="Bericht" text={item.description} />}
          </div>
          <aside className="space-y-3 xl:sticky xl:top-24">
            <MetaList item={item} />
            <div className="grid gap-2">
              <RefButton href={item.external_url} label="Turnierseite" />
              <RefButton href={item.bracket_url} label="Bracket" />
              <RefButton href={item.match_url} label="Matchseite" />
              <RefButton href={item.result_url} label="Ergebnis" />
            </div>
          </aside>
        </div>
      </section>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------- Bausteine

function MetaList({ item }) {
  const rows = [
    ["Spiel", referenceGameName(item)],
    ["Veranstalter", item.organizer],
    ["Partner", (item.partners || []).length ? (
      <span className="flex flex-wrap justify-end gap-2">
        {item.partners.map((partner) => (
          <Link key={partner.id} to={`/partners/${partner.slug || partner.id}`} data-testid={`reference-detail-partner-${partner.slug || partner.id}`} className="text-[#29B6E8] hover:text-white">{partner.name}</Link>
        ))}
      </span>
    ) : ""],
    ["Liga", item.league],
    ["Saison", item.season],
    ["Modus", modeLabels[item.mode] || item.mode],
    ["Datum", [formatDate(item.start_date), formatDate(item.end_date)].filter(Boolean).join(" – ")],
    ["Ort", item.location],
  ].filter(([, value]) => value);
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm divide-y divide-white/5" data-testid="reference-detail-meta">
      {rows.map(([label, value]) => (
        <div key={label} className="px-4 py-2.5 flex items-start justify-between gap-3">
          <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold pt-0.5">{label}</span>
          <span className="text-sm text-white/80 text-right">{value}</span>
        </div>
      ))}
    </div>
  );
}

function TextBlock({ title, text, tone }) {
  return (
    <div className={`border rounded-sm p-5 ${tone === "gold" ? "border-[#FFD700]/25 bg-[#FFD700]/10" : "border-white/10 bg-[#121212]"}`}>
      <h2 className={`font-heading text-xl font-black uppercase ${tone === "gold" ? "text-[#FFD700]" : "text-white"}`}>{title}</h2>
      <p className="mt-3 text-sm md:text-base text-white/70 leading-relaxed whitespace-pre-line">{text}</p>
    </div>
  );
}

function Badge({ children, className = "border-white/10 bg-white/5 text-white/55" }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-sm border text-[10px] uppercase tracking-widest font-bold ${className}`}>{children}</span>;
}

export { displayTitle, entriesOf };
