import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { BracketTree } from "@/components/tls/BracketTree";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatTournamentDisplay } from "@/lib/tournamentLabels";
import { seoTextPreview } from "@/lib/textPreview";
import { Tv } from "lucide-react";

export default function TournamentBracketPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const accessToken = searchParams.get("access") || "";
  const [data, setData] = useState(null);
  const tournament = data?.tournament;
  const seoDescription = seoTextPreview(tournament?.description, "Live-Turnierbaum von THE LION SQUAD eSports mit Runden, Matches und Ergebnissen.");
  useDocumentTitle(`${tournament?.title || "Turnier"} Turnierbaum`, seoDescription, {
    image: tournament?.banner_url,
    canonical: tournament?.slug ? `${window.location.origin}/tournaments/${tournament.slug}/bracket` : undefined,
  });
  useCanonicalSlugRedirect(slug, tournament?.slug, "/tournaments", "/bracket");

  const load = useCallback(async () => {
    const accessConfig = { params: accessToken ? { access: accessToken } : undefined };
    const { data: t } = await api.get(`/tournaments/${slug}`, accessConfig);
    const { data: br } = await api.get(`/tournaments/${t.id}/bracket`, accessConfig);
    setData(br);
  }, [slug, accessToken]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 7000);
    return () => clearInterval(iv);
  }, [load]);

  useApiInvalidation(load, ["tournaments", "matches"]);

  if (!data) return <PublicLayout><div className="p-20 text-center text-white/40 font-display tracking-widest">LADE TURNIERBAUM …</div></PublicLayout>;
  const t = data.tournament;

  return (
    <PublicLayout>
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <Link to={`/tournaments/${t.slug}${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ""}`} className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← Zurück zum Turnier</Link>
            <h1 className="mt-2 font-heading text-3xl md:text-5xl font-black uppercase">{t.title}</h1>
            <div className="mt-2 flex gap-2 items-center">
              <PhaseBadge phase={t.public_phase} status={t.status} />
              <span className="text-white/40 text-sm">{formatTournamentDisplay(t)}</span>
            </div>
          </div>
          {t.can_view_display && (
            <Link to={`/display/bracket/${t.id}`} target="_blank" data-testid="bracket-tv-link" className="inline-flex items-center gap-2 px-4 py-2.5 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm hover:bg-[#29B6E8]/10 text-sm">
              <Tv className="w-4 h-4" /> TV-/Beamer-Ansicht
            </Link>
          )}
        </div>
        {(data.matches?.length || 0) + (data.matches_v2?.length || 0) === 0 ? (
          <div className="border border-white/10 rounded-sm bg-[#121212] p-12 text-center">
            <div className="text-white/50 font-display tracking-widest">TURNIERBAUM WURDE NOCH NICHT GENERIERT</div>
          </div>
        ) : (
          <BracketTree data={data} />
        )}
      </div>
    </PublicLayout>
  );
}
