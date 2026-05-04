import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";

/** Resolves "current" to the active season's slug and redirects.
 *  Falls back to /seasons listing-style placeholder if no active season.
 */
export default function CurrentSeasonRedirect() {
  const nav = useNavigate();
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/seasons/active/featured");
        const s = data?.season;
        if (s?.slug) nav(`/seasons/${s.slug}`, { replace: true });
        else nav("/", { replace: true });
      } catch {
        nav("/", { replace: true });
      }
    })();
  }, [nav]);
  return (
    <PublicLayout>
      <div className="p-20 text-center text-white/40 font-display tracking-widest">LADE AKTUELLE SEASON …</div>
    </PublicLayout>
  );
}
