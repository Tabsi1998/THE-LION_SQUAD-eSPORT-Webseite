import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { API, api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { seoTextPreview } from "@/lib/textPreview";
import { Award, FileDown } from "lucide-react";

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
    const iv = setInterval(load, 7000);
    return () => clearInterval(iv);
  }, [load]);

  useApiInvalidation(load, ["tournaments", "matches"]);
  const tournamentUrl = t ? `/tournaments/${t.slug || t.id}${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ""}` : "/tournaments";
  const resultPdfUrl = t ? `${API}/exports/tournaments/${t.slug || t.id}/standings.pdf${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ""}` : "";
  const certificatePdfUrl = t ? `${API}/exports/tournaments/${t.slug || t.id}/certificates.pdf${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ""}` : "";

  if (!t) return <PublicLayout><PublicLoadingState label="Lade Rangliste" /></PublicLayout>;

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
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-heading text-3xl md:text-5xl font-black uppercase">Rangliste</h1>
          {PUBLIC_RESULT_STATUSES.has(t.status) && (
            <div className="flex flex-wrap gap-2">
              <a href={resultPdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 border border-[#29B6E8]/45 text-[#29B6E8] rounded-sm text-xs font-bold uppercase tracking-wider hover:bg-[#29B6E8]/10">
                <FileDown className="w-3.5 h-3.5" /> Ergebnis-PDF
              </a>
              <a href={certificatePdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 border border-[#FFD700]/45 text-[#FFD700] rounded-sm text-xs font-bold uppercase tracking-wider hover:bg-[#FFD700]/10">
                <Award className="w-3.5 h-3.5" /> Urkunden
              </a>
            </div>
          )}
        </div>
        <div className="mt-8 border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3 w-14">#</th>
                <th className="text-left px-4 py-3">Spieler</th>
                <th className="text-right px-4 py-3">S</th>
                <th className="text-right px-4 py-3">N</th>
                <th className="text-right px-4 py-3">Punkte</th>
                {PUBLIC_RESULT_STATUSES.has(t.status) && <th className="text-right px-4 py-3">Urkunde</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r) => (
                <tr key={r.registration_id} className={r.rank <= 3 ? "bg-[#29B6E8]/5" : ""}>
                  <td className="px-4 py-3 font-display font-bold text-[#29B6E8]">{r.rank}</td>
                  <td className="px-4 py-3 text-white">{r.display_name}</td>
                  <td className="px-4 py-3 text-right text-white/80">{r.won ?? r.wins ?? 0}</td>
                  <td className="px-4 py-3 text-right text-white/80">{r.lost ?? r.losses ?? 0}</td>
                  <td className="px-4 py-3 text-right font-display font-bold text-white">{r.points ?? r.furthest_round ?? 0}</td>
                  {PUBLIC_RESULT_STATUSES.has(t.status) && (
                    <td className="px-4 py-3 text-right">
                      {r.rank <= 4 ? (
                        <a href={`${API}/exports/tournaments/${t.slug || t.id}/certificates/${r.registration_id}.pdf${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ""}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#FFD700] hover:text-white">
                          <Award className="w-3 h-3" /> PDF
                        </a>
                      ) : <span className="text-white/25">—</span>}
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={PUBLIC_RESULT_STATUSES.has(t.status) ? 6 : 5} className="text-center py-8 text-white/40">Noch keine Ergebnisse</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </PublicLayout>
  );
}
