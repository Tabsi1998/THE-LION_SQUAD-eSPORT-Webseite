import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { SkeletonLines } from "@/components/tls/Skeleton";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { emptyText, pickSession, roundHeading, roundPath, SESSION_PARAM, summaryCards } from "@/lib/roundResults";
import { RoundHead, RoundSummary, ResultList, ResultTable, SessionTabs } from "@/components/tls/series/RoundResults";
import { SeasonNotice, SessionRuleNotes } from "@/components/tls/series/SeriesSpecialRules";
import { NotFoundPage } from "@/pages/ErrorPages";
import { OriginalsButton } from "@/components/tls/series/OriginalViewer";

// Ergebnisseite einer Runde der Rennliga (#1950) unter /references/series/<spur>/<saison>/runde/<nr>: eigene Adresse
// zum Teilen, der Reiter steht als ?lauf=… darin (ohne: das Hauptrennen). Kopf mit Flagge und Pfeilen, Zusammenfassung,
// je Lauf die Ergebnistabelle wie beim Veranstalter. Gerechnet wird im Server; die Seite ist wie die Serienseite nicht
// indexiert. Eine Runde, die es nicht gibt, ist 404; eine alte Adresse der Serie führt zur aktuellen.

function seriesTitle(data) {
  const series = data?.series || {};
  return series.title || [data?.lineage?.title, [series.season, series.tier].filter(Boolean).join(" · ")].filter(Boolean).join(" ");
}

export default function ReferenceRoundPage() {
  const { lineageSlug, seasonSlug, roundNumber } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loadedFor, setLoadedFor] = useState(null);
  const [missing, setMissing] = useState(false);
  const address = `${lineageSlug}/${seasonSlug}/${roundNumber}`;

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/reference-series/public/${encodeURIComponent(lineageSlug)}/${encodeURIComponent(seasonSlug)}/rounds/${encodeURIComponent(roundNumber)}`);
      setData(body);
      setLoadedFor(address);
      setMissing(false);
    } catch (err) {
      if (err.response?.status === 404 || err.response?.status === 422) setMissing(true);
    }
  }, [lineageSlug, seasonSlug, roundNumber, address]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["reference-series"]);

  // Alte Adresse der Spur oder Saison: zur aktuellen, mit Reiter.
  useEffect(() => {
    if (loadedFor !== address) return;
    const lineage = data?.lineage?.slug;
    const season = data?.series?.season_slug;
    if (lineage && season && (lineage !== lineageSlug || season !== seasonSlug)) {
      navigate(roundPath(lineage, season, roundNumber, params.get(SESSION_PARAM) || ""), { replace: true });
    }
  }, [data, loadedFor, address, lineageSlug, seasonSlug, roundNumber, params, navigate]);

  const current = data && loadedFor === address ? data : null;
  const session = useMemo(() => pickSession(current, params.get(SESSION_PARAM)), [current, params]);
  const cards = useMemo(() => (current ? summaryCards(current, session) : []), [current, session]);
  const title = seriesTitle(current);
  const { heading } = roundHeading(current?.round);
  const roundName = current ? [current.round?.code || `Runde ${current.round?.number}`, heading !== current.round?.code ? heading : ""].filter(Boolean).join(" ") : "";
  useDocumentTitle(current ? `${roundName} · ${title}` : "Runde", undefined, { robots: "noindex, follow", image: current?.series?.logo_url || undefined });

  const pick = useCallback((key) => {
    setParams((now) => {
      const next = new URLSearchParams(now);
      if (key === current?.main) next.delete(SESSION_PARAM);
      else next.set(SESSION_PARAM, key);
      return next;
    }, { replace: true, preventScrollReset: true });
  }, [setParams, current?.main]);

  if (missing) return <NotFoundPage />;
  const seriesPath = `/references/series/${lineageSlug}/${seasonSlug}`;
  // Abgespielt wird beim Öffnen der Runde und bei jedem Reiterwechsel - nicht beim Nachladen.
  const playKey = `${roundNumber}:${session?.key || ""}`;
  const panelId = "round-panel";
  return (
    <PublicLayout>
      <article className="tls-round max-w-[1160px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16 flex flex-col gap-6" data-testid="round-page">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Referenzen", to: "/references" }, { label: title || "Serie", to: seriesPath }, { label: roundName || "Runde" }]} />
        {!current ? <SkeletonLines lines={6} /> : (
          <>
            <RoundHead page={current} lineageSlug={lineageSlug} seasonSlug={seasonSlug} />
            {/* Saison abgebrochen (#1960): auch auf der Rundenseite, mit Tag und Grund. */}
            <SeasonNotice series={current.series} successor={null} />
            <RoundSummary cards={cards} playKey={playKey} />
            <SessionTabs sessions={current.sessions || []} current={session?.key} onPick={pick} panelId={panelId} />
            <section
              key={playKey}
              id={panelId}
              role={(current.sessions || []).length > 1 ? "tabpanel" : undefined}
              aria-labelledby={(current.sessions || []).length > 1 && session ? `round-tab-${session.key}` : undefined}
              aria-label={(current.sessions || []).length > 1 ? undefined : session?.label || "Ergebnis"}
              className="tls-round-panel"
              data-testid="round-panel"
              data-session={session?.key}
            >
              {/* #1960: Termin ohne Wertung mit Grund, umgekehrte Startaufstellung des Laufs. */}
              <SessionRuleNotes session={session} />
              {session?.has_result ? (
                <>
                  <ResultTable session={session} playKey={playKey} />
                  <ResultList session={session} playKey={playKey} />
                </>
              ) : (
                <p className="py-10 text-center text-sm text-white/60 border border-white/10 rounded-[10px]" data-testid="round-empty">{emptyText(session)}</p>
              )}
            </section>
            <footer className="flex flex-wrap justify-between gap-3 text-sm text-white/55">
              {current.own_teams?.length > 0 && session?.rows?.some((row) => row.own) && (
                <span data-testid="round-own-teams">Vereinsteams hervorgehoben: {current.own_teams.join(", ")}</span>
              )}
              {/* Original-Bilder des Veranstalters zu diesem Lauf (#1933) im Vollbild. */}
              <OriginalsButton items={session?.originals || []} title={[roundName, session?.label].filter(Boolean).join(" · ")} className="ml-auto" testId="round-original" />
            </footer>
          </>
        )}
      </article>
    </PublicLayout>
  );
}
