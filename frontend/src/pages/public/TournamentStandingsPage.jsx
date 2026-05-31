import { useCallback, useEffect, useState } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { seoTextPreview } from "@/lib/textPreview";

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

  if (!t) return <PublicLayout><div className="p-20 text-center text-white/40 font-display tracking-widest">LADE …</div></PublicLayout>;

  return (
    <PublicLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link to={`/tournaments/${t.slug}${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ""}`} className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← {t.title}</Link>
        <h1 className="mt-2 font-heading text-3xl md:text-5xl font-black uppercase">Rangliste</h1>
        <div className="mt-8 border border-white/10 rounded-sm bg-[#121212] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3 w-14">#</th>
                <th className="text-left px-4 py-3">Spieler</th>
                <th className="text-right px-4 py-3">S</th>
                <th className="text-right px-4 py-3">N</th>
                <th className="text-right px-4 py-3">Punkte</th>
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
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="5" className="text-center py-8 text-white/40">Noch keine Ergebnisse</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </PublicLayout>
  );
}
