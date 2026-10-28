import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { API, api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { TournamentTabs } from "@/components/tls/tournament/TournamentTabs";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { SkeletonDetailHeader, SkeletonTable } from "@/components/tls/Skeleton";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useChangedKeys, useFlipRows } from "@/hooks/useLiveChanges";
import { standingSignature } from "@/lib/liveChanges";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { seoTextPreview } from "@/lib/textPreview";
import { Award, FileDown } from "lucide-react";
import { StandingsTable, standingKey } from "@/components/tls/tournament/StandingsTable";
import { nameHead, standingSections, tableKind } from "@/lib/standingsTable";
import { isHeatSchedule } from "@/lib/tournamentLabels";
import { PrintLink } from "@/components/tls/print/PrintLink";

const PUBLIC_RESULT_STATUSES = new Set(["completed", "results_published", "archived"]);

export default function TournamentStandingsPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const accessToken = searchParams.get("access") || "";
  const [t, setT] = useState(null);
  const [rows, setRows] = useState([]);
  const seoDescription = seoTextPreview(t?.description, "Rangliste und Ergebnisse des eSports Turniers von THE LION SQUAD.");
  useDocumentTitle(`${t?.title || "Turnier"} Rangliste`, seoDescription, {
    image: t?.banner_url,
    canonical: t?.slug ? `${window.location.origin}/tournaments/${t.slug}/standings` : undefined,
  });
  useCanonicalSlugRedirect(slug, t?.slug, "/tournaments", "/standings");

  const load = useCallback(async () => {
    const accessConfig = { params: accessToken ? { access: accessToken } : undefined };
    const { data: tr } = await api.get(`/tournaments/${slug}`, accessConfig);
    setT(tr);
    const { data } = await api.get(`/tournaments/${tr.id}/standings`, accessConfig);
    setRows(data);
  }, [slug, accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  // Nur Änderungen dieses Turniers (#1801) - bis es geladen ist, jede.
  useLiveRefresh(load, ["tournaments", "matches"], { fallbackMs: 7000, tournamentId: t?.id });
  // Gruppen kommen als [{group, standings}] (#1562): je Gruppe eine Tabelle. Live-Rahmen und Gleiten über alle Zeilen.
  const sections = useMemo(() => standingSections(rows), [rows]);
  const flatRows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  // Kommt ein Ergebnis, gleiten die Zeilen auf ihren neuen Platz und die geänderte leuchtet kurz (#225).
  const changed = useChangedKeys(flatRows, standingKey, standingSignature);
  const registerRow = useFlipRows(flatRows, standingKey);
  const tournamentUrl = t ? `/tournaments/${t.slug || t.id}${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ""}` : "/tournaments";
  const resultPdfUrl = t ? `${API}/exports/tournaments/${t.slug || t.id}/standings.pdf${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ""}` : "";
  const certificatePdfUrl = t ? `${API}/exports/tournaments/${t.slug || t.id}/certificates.pdf${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ""}` : "";
  // Urkunden gibt es für die ersten vier Plätze einer Rangliste (#2121) - Gruppen haben keinen Endstand, ohne Platz 1-4
  // führte der Knopf auf eine rohe Fehlermeldung.
  const grouped = sections.some((section) => section.label);
  const hasCertificates = !grouped && flatRows.some((row) => Number(row?.rank) >= 1 && Number(row?.rank) <= 4);
  const heats = isHeatSchedule(t);
  const certificateHref = (row) => `${API}/exports/tournaments/${t.slug || t.id}/certificates/${row.registration_id}.pdf${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ""}`;

  if (!t) {
    return (
      <PublicLayout>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
          <SkeletonDetailHeader label="Lade Rangliste" />
          <SkeletonTable rows={8} columns={5} label="Lade Rangliste" />
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs
          items={[
            { label: "Home", to: "/" },
            { label: "Turniere", to: "/tournaments" },
            { label: t.title, to: tournamentUrl },
            { label: "Rangliste" },
          ]}
          className="mb-3"
        />
        <Link to={tournamentUrl} className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← {t.title}</Link>
        <TournamentTabs tournament={t} accessToken={accessToken} className="mt-3 mb-4" />
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-heading text-3xl md:text-5xl font-black uppercase">Rangliste</h1>
          <div className="flex flex-wrap gap-2">
            <PrintLink slug={t.slug || t.id} parts="tabelle" from="rangliste" accessToken={accessToken} testId="standings-print-link" className="!text-xs !py-2" />
            {PUBLIC_RESULT_STATUSES.has(t.status) && (
              <>
                <a href={resultPdfUrl} target="_blank" rel="noreferrer" className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
                  <FileDown className="w-3.5 h-3.5" /> Ergebnis-PDF
                </a>
                {hasCertificates && (
                  <a href={certificatePdfUrl} target="_blank" rel="noreferrer" data-testid="standings-certificates" className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
                    <Award className="w-3.5 h-3.5" /> Urkunden
                  </a>
                )}
              </>
            )}
          </div>
        </div>
        {sections.length > 2 && (
          <nav className="mt-6 flex flex-wrap gap-2" aria-label="Gruppen" data-testid="standings-group-nav">
            {sections.map((section) => (
              <a key={section.key} href={`#gruppe-${section.key}`} className={`tls-btn ${section.mine ? "tls-btn--secondary" : "tls-btn--quiet"} px-3 py-1.5 rounded-sm text-xs font-bold uppercase tracking-wider`}>
                {section.label}
              </a>
            ))}
          </nav>
        )}
        <div className="mt-8 space-y-10">
          {sections.map((section) => (
            <section key={section.key} id={section.label ? `gruppe-${section.key}` : undefined} aria-labelledby={section.label ? `gruppe-${section.key}-titel` : undefined} className="scroll-mt-24">
              {section.label && (
                <h2 id={`gruppe-${section.key}-titel`} className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-heading text-xl md:text-2xl font-black uppercase">
                  {section.label}
                  {section.mine && <span className="tls-standing-me text-[11px] font-body normal-case tracking-normal">Deine Gruppe</span>}
                </h2>
              )}
              <StandingsTable
                rows={section.rows}
                kind={tableKind(section.rows, { heats })}
                nameLabel={nameHead(t)}
                changed={changed}
                registerRow={registerRow}
                label={section.label ? `Tabelle ${section.label}` : "Rangliste"}
                certificateHref={PUBLIC_RESULT_STATUSES.has(t.status) && hasCertificates ? certificateHref : null}
              />
            </section>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}
