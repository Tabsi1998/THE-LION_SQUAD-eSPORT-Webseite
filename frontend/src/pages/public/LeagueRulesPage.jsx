// Regelseite der Liga (docs/LIGA.md, #1646) unter /liga/<liga>/regeln und /liga/<liga>/<season>/regeln: Inhaltsverzeichnis, Suche in der Seite,
// feste Anker, Änderungen zur vorigen Fassung (ausblendbar), jede alte Fassung und der Vergleich Wort für Wort. Sichtbar nach der Season;
// unsichtbar heißt wie „gibt es nicht“.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronUp, FileText, ListTree, X } from "lucide-react";
import { toast } from "sonner";
import { API, api, formatApiError } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { SeasonNav } from "@/components/tls/league/public/SeasonShell";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { SelectField } from "@/components/tls/FormFields";
import { RulesChanges, RulesComparison, RulesDocument } from "@/components/tls/league/rules/RulesDocument";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { accentStyle } from "@/lib/leagueLook";
import { clearHits, dayLabel, findRanges, paintHits, renderRulesMarkdown, rulesApiPath, rulesPagePath, tocOf } from "@/lib/leagueRules";
import { viennaDate } from "@/lib/vienna";

const LONG_DAY = { day: "2-digit", month: "2-digit", year: "numeric" };
const QUIET_BUTTON = "tls-btn tls-btn--quiet rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider";

function Toc({ sections, active }) {
  const [open, setOpen] = useState(false);
  const toc = useMemo(() => tocOf(sections), [sections]);
  if (!toc.main.length && !toc.annexes.length) return null;
  const list = (rows) => (
    <ul>
      {rows.map((row) => (
        <li key={row.anchor}>
          <a href={`#${row.anchor}`} className="tls-rules-toc__link" data-level={row.level} aria-current={active === row.anchor ? "location" : undefined}
            onClick={() => setOpen(false)}>{row.title}</a>
        </li>
      ))}
    </ul>
  );
  return (
    <nav className="tls-rules-toc" aria-label="Inhalt" data-testid="rules-toc">
      <button type="button" className={`tls-rules-toc__toggle ${QUIET_BUTTON} flex w-full items-center justify-between gap-2`} aria-expanded={open}
        onClick={() => setOpen((value) => !value)} data-testid="rules-toc-toggle">
        <span className="inline-flex items-center gap-2"><ListTree className="h-4 w-4" aria-hidden="true" /> Inhalt</span>
        {open ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
      </button>
      <div className="tls-rules-toc__list mt-3 lg:mt-0" data-open={open ? "true" : "false"}>
        {toc.main.length ? <><p className="tls-rules-toc__head">Inhalt</p>{list(toc.main)}</> : null}
        {toc.annexes.length ? <><p className="tls-rules-toc__head">Anlagen</p>{list(toc.annexes)}</> : null}
      </div>
    </nav>
  );
}

/** Suche in der Seite: zählt und springt, färbt ohne Eingriff in den Text. Enter weiter, Umschalt+Enter zurück, Esc leert. */
function SearchBar({ rootRef, watch }) {
  const [query, setQuery] = useState("");
  const [ranges, setRanges] = useState([]);
  const [index, setIndex] = useState(0);
  const searched = query.trim().length >= 2;

  useEffect(() => {
    const found = findRanges(rootRef.current, query);
    setRanges(found);
    setIndex(0);
  }, [query, rootRef, watch]);

  useEffect(() => {
    paintHits(ranges, index);
    ranges[index]?.startContainer?.parentElement?.scrollIntoView?.({ block: "center" });
  }, [ranges, index]);
  useEffect(() => clearHits, []);

  const step = (delta) => {
    if (ranges.length) setIndex((value) => (value + delta + ranges.length) % ranges.length);
  };
  const onKey = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      setQuery("");
    }
  };
  return (
    <>
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKey} className="tls-rules-search"
        aria-label="In den Regeln suchen" placeholder="In den Regeln suchen" maxLength={80} data-testid="rules-search" />
      {searched ? (
        <>
          <span className="tls-rules-search__count" role="status" data-testid="rules-search-count">
            {ranges.length ? `${index + 1} von ${ranges.length}` : "Keine Treffer"}
          </span>
          <button type="button" className={QUIET_BUTTON} aria-label="Voriger Treffer" disabled={!ranges.length} onClick={() => step(-1)}><ChevronUp className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className={QUIET_BUTTON} aria-label="Nächster Treffer" disabled={!ranges.length} onClick={() => step(1)}><ChevronDown className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className={QUIET_BUTTON} aria-label="Suche leeren" onClick={() => setQuery("")}><X className="h-4 w-4" aria-hidden="true" /></button>
        </>
      ) : null}
    </>
  );
}

function MarksSwitch({ on, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="tls-rules-switch" onClick={() => onChange(!on)} data-testid="rules-marks-switch">
      <span className="tls-rules-switch__track" aria-hidden="true" />
      Änderungen markieren
    </button>
  );
}

function ConsentHint({ consent, seasonId, onDone }) {
  const [busy, setBusy] = useState(null);
  const agree = async (squadId) => {
    setBusy(squadId);
    try {
      await api.post("/league-rules/consents", { version_id: consent.version_id, season_id: seasonId, squad_id: squadId });
      toast.success("Zustimmung gespeichert.");
      await onDone();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(null);
    }
  };
  const open = consent.squads.filter((row) => !row.agreed);
  const done = consent.squads.filter((row) => row.agreed);
  return (
    <section className={`mb-6 rounded-sm border p-4 ${open.length ? "border-warn/30 bg-warn/5" : "border-white/10"}`} aria-label="Zustimmung" data-testid="rules-consent">
      {open.length ? (
        <>
          <h2 className="font-bold text-white">Bitte {consent.label} zustimmen</h2>
          <p className="mt-1 text-sm text-white/75">Du bist für dein Co-Team verantwortlich. Spiele laufen auch ohne Zustimmung weiter.</p>
          <ul className="mt-3 space-y-2">
            {open.map((row) => (
              <li key={row.squad_id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words text-white">{row.squad_name}</span>
                <button type="button" disabled={busy === row.squad_id} onClick={() => agree(row.squad_id)} data-testid={`rules-consent-agree-${row.squad_id}`}
                  className="tls-btn tls-btn--primary rounded-sm px-3 py-2 text-xs font-black uppercase tracking-wider disabled:opacity-50">
                  {busy === row.squad_id ? "Speichere …" : "Zustimmen"}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {done.length ? (
        <ul className={`text-sm text-white/70 ${open.length ? "mt-3" : ""}`}>
          {done.map((row) => (
            <li key={row.squad_id} data-testid={`rules-consent-done-${row.squad_id}`}>
              {row.squad_name} hat zugestimmt am {viennaDate(row.agreed_at, LONG_DAY)}.
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function useActiveAnchor(sections, disabled) {
  const [active, setActive] = useState(null);
  useEffect(() => {
    if (disabled || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      const seen = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (seen) setActive(seen.target.id);
    }, { rootMargin: "-25% 0px -65% 0px" });
    for (const row of sections) {
      const node = document.getElementById(row.anchor);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [sections, disabled]);
  return active;
}

export default function LeagueRulesPage() {
  const { league: leagueSlug, season: seasonSlug } = useParams();
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  const versionParam = params.get("version");
  const compareParam = params.get("vergleich");
  const [data, setData] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [missing, setMissing] = useState(false);
  const [marks, setMarks] = useState(true);
  const documentRef = useRef(null);
  const compareTitleRef = useRef(null);
  const base =rulesApiPath(leagueSlug, seasonSlug);
  const pagePath = rulesPagePath(leagueSlug, seasonSlug);

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(base, { params: versionParam ? { version: versionParam } : {} });
      setData(body);
      setMissing(false);
    } catch {
      setMissing(true);
    }
  }, [base, versionParam]);
  useEffect(() => { load(); }, [load]);

  const version = data?.version;
  useEffect(() => {
    if (!compareParam || !version?.id) {
      setComparison(null);
      return undefined;
    }
    let alive = true;
    api.get(`${base}/compare`, { params: { base: compareParam, target: version.id } })
      .then(({ data: body }) => { if (alive) setComparison(body); })
      .catch((err) => { if (alive) toast.error(formatApiError(err.response?.data?.detail)); });
    return () => { alive = false; };
  }, [base, compareParam, version?.id]);

  // Die Auswahl verschwindet mit dem Vergleich: Der Fokus geht auf seine Überschrift, nicht verloren.
  useEffect(() => {
    if (comparison && compareParam) compareTitleRef.current?.focus?.();
  }, [comparison, compareParam]);

  // Sprung auf einen Paragrafen: Der Text ist erst nach dem Laden da.
  const sectionCount = data?.sections?.length || 0;
  useEffect(() => {
    if (sectionCount && hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView?.();
  }, [hash, sectionCount]);

  const sections = useMemo(() => data?.sections || [], [data?.sections]);
  const active = useActiveAnchor(sections, !!compareParam);
  const fallbackHtml = useMemo(() => renderRulesMarkdown(data?.fallback_text || ""), [data?.fallback_text]);

  // Die Namen, wie die Fassung sie zeigt (#2269): beim Veröffentlichen eingefroren - eine Umbenennung ändert alte Fassungen nicht.
  const names = data?.version?.names;
  const name = (names ? [names.league, names.season] : [data?.league?.name, data?.season?.name]).filter(Boolean).join(" ");
  const title = name ? `Regeln ${name}` : "Regeln";
  const indexable = !!data?.public && !versionParam && !compareParam && !missing;
  useDocumentTitle(title, `Das Regelwerk der ${name || "Liga"}: Inhaltsverzeichnis, Änderungen je Version und PDF.`, {
    canonical: `${window.location.origin}${pagePath}`,
    robots: indexable ? "index, follow" : "noindex, nofollow",
  });

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  if (missing) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6" data-testid="rules-missing">
          <h1 className="font-heading text-3xl font-black uppercase">Regeln nicht gefunden</h1>
          <p className="mt-3 text-white/60">Diese Liga gibt es nicht oder sie ist (noch) nicht sichtbar.</p>
          <Link to="/liga" className="tls-btn tls-btn--secondary mt-6 inline-flex rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider">Zur Liga-Übersicht</Link>
        </div>
      </PublicLayout>
    );
  }
  if (!data) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8"><SkeletonDetailHeader label="Lade Regeln" /></div>
      </PublicLayout>
    );
  }

  const { league, season, versions = [], changes, upcoming, consent, seasons = [] } = data;
  const seasonPath = season ? `/liga/${league.slug}/${season.slug}` : null;
  const crumbs = [{ label: "Start", to: "/" }, { label: "Liga", to: "/liga" },
    ...(season ? [{ label: `${league.name} ${season.name}`, to: seasonPath }] : [{ label: league.name }]), { label: "Regeln" }];
  const pdfHref = version?.pdf_url ? `${API}${version.pdf_url.replace(/^\/api/, "")}${marks ? "" : "?marks=0"}` : null;
  const others = versions.filter((row) => row.id !== version?.id);
  const versionOptions = versions.map((row) => [row.id, `${row.label} · gültig ab ${dayLabel(row.valid_from)}${row.is_current ? " · gilt" : ""}`]);
  const showConsent = season && consent && version?.is_current && consent.version_id === version.id;
  const isOld = version && !version.is_current;

  return (
    <PublicLayout>
      <div className="tls-rules tls-league-look mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8" style={accentStyle(data.look?.accent_color)}>
        <Breadcrumbs items={crumbs} className="mb-4" />
        {/* Navigation der Season (#2268): Übersicht · Spieltage · Teams · Regelwerk. */}
        {season ? <SeasonNav leagueSlug={league.slug} seasonSlug={season.slug} className="mb-8" /> : null}
        <header className="mb-8 max-w-[72ch]">
          <h1 className="font-heading text-2xl font-black uppercase leading-tight [overflow-wrap:anywhere] [text-wrap:balance] md:text-4xl">{version?.title || "Regeln"}</h1>
          <p className="mt-2 text-white/75">{name}</p>
          {version ? (
            <p className="mt-3 text-sm text-white/75" data-testid="rules-meta">
              {version.label} · gültig ab {dayLabel(version.valid_from)}
              {version.published_at ? ` · Stand ${viennaDate(version.published_at, LONG_DAY)}` : ""}
            </p>
          ) : null}
          {version?.change_reason ? <p className="mt-1 text-sm text-white/60">Änderungsgrund: {version.change_reason}</p> : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {pdfHref ? (
              <a href={pdfHref} target="_blank" rel="noopener noreferrer" className="tls-btn tls-btn--secondary inline-flex items-center gap-2 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider" data-testid="rules-pdf">
                <FileText className="h-4 w-4" aria-hidden="true" /> PDF
              </a>
            ) : null}
            {seasonPath ? (
              <Link to={seasonPath} className={`${QUIET_BUTTON} inline-flex items-center gap-2`}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Zur Ligaseite
              </Link>
            ) : null}
            {season && version?.scope === "league" ? (
              <Link to={rulesPagePath(league.slug)} className={QUIET_BUTTON} data-testid="rules-from-league">Regelwerk der Liga</Link>
            ) : null}
          </div>
        </header>

        {isOld ? (
          <p role="status" className="mb-6 rounded-sm border border-white/15 bg-white/5 px-4 py-3 text-sm text-white/85" data-testid="rules-old-version">
            Du liest {version.label}. Das ist nicht die gültige Fassung. <Link to={pagePath} className="underline underline-offset-2">Zur gültigen Fassung</Link>
          </p>
        ) : null}
        {upcoming ? (
          <p className="mb-6 rounded-sm border border-white/15 bg-white/5 px-4 py-3 text-sm text-white/85" data-testid="rules-upcoming">
            {upcoming.label} gilt ab {dayLabel(upcoming.valid_from)}. <Link to={`${pagePath}?version=${upcoming.id}`} className="underline underline-offset-2">Jetzt lesen</Link>
          </p>
        ) : null}
        {showConsent ? <ConsentHint consent={consent} seasonId={season.id} onDone={load} /> : null}

        {seasons.length ? (
          <section className="mb-8" data-testid="rules-seasons" aria-label="Regeln je Season">
            <p className="mb-2 text-sm text-white/75">Die Listen stehen auf den Regeln der jeweiligen Season:</p>
            <ul className="flex flex-wrap gap-2">
              {seasons.map((row) => <li key={row.slug}><Link to={row.url} className={QUIET_BUTTON + " inline-flex"}>{row.name}</Link></li>)}
            </ul>
          </section>
        ) : null}

        {data.source === "fallback" ? (
          <div className="tls-rules-doc" data-testid="rules-fallback">
            <div className="prose-cms" dangerouslySetInnerHTML={{ __html: fallbackHtml }} />
          </div>
        ) : null}
        {data.source === "none" ? (
          <p className="text-white/70" data-testid="rules-empty">Für diese Liga gibt es noch keine Regeln.</p>
        ) : null}

        {data.source === "rules" ? (
          <div className="tls-rules-layout">
            <Toc sections={sections} active={active} />
            <div className="min-w-0">
              {comparison && compareParam ? (
                <RulesComparison sections={comparison.sections}>
                  <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <h2 ref={compareTitleRef} tabIndex={-1} data-testid="rules-compare-title" className="font-heading text-xl font-black uppercase outline-none scroll-mt-24">{comparison.base.label} und {comparison.target.label}</h2>
                    <button type="button" className={QUIET_BUTTON} onClick={() => setParam("vergleich", null)}>Zurück zum Text</button>
                  </div>
                </RulesComparison>
              ) : (
                <>
                  <div className="tls-rules-tools">
                    <SearchBar rootRef={documentRef} watch={`${version?.id}-${marks}`} />
                  </div>
                  {versions.length > 1 ? (
                    <div className="mb-6 grid gap-3 sm:grid-cols-2" style={{ maxWidth: "72ch" }}>
                      <SelectField label="Fassung" value={version?.id || ""} options={versionOptions} testId="rules-version-select"
                        onChange={(value) => setParam("version", value === versions.find((row) => row.is_current)?.id ? null : value)} />
                      <SelectField label="Vergleichen mit" value="" options={[["", "Fassung wählen"], ...others.map((row) => [row.id, `${row.label} · gültig ab ${dayLabel(row.valid_from)}`])]}
                        testId="rules-compare-select" onChange={(value) => setParam("vergleich", value || null)} />
                    </div>
                  ) : null}
                  <div style={{ maxWidth: "72ch" }}>
                    <RulesChanges changes={changes} versionLabel={version.label}>
                      <MarksSwitch on={marks} onChange={setMarks} />
                    </RulesChanges>
                  </div>
                  <RulesDocument ref={documentRef} sections={sections} marks={marks} versionLabel={version.label} />
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </PublicLayout>
  );
}
