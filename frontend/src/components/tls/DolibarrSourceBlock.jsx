import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";

// Sponsoren und Partner aus Dolibarr (#405): ein Block über der Liste - Schalter, Kategorienamen,
// Stand und „Jetzt nachlesen“. Derselbe Block auf beiden Seiten, weil es ein Schalter für beide
// Listen ist. Ohne Anbindung erklärt er nur, wo sie eingerichtet wird.

export function useDolibarrSource() {
  const [source, setSource] = useState(null);
  const load = useCallback(() => {
    api.get("/admin/dolibarr/sponsors")
      .then(({ data }) => setSource(data && typeof data === "object" && !Array.isArray(data) ? data : { unavailable: true }))
      .catch(() => setSource({ unavailable: true }));
  }, []);
  useEffect(() => { load(); }, [load]);
  return [source, setSource, load];
}

// Seit #510 liegt der Schalter auf der Dolibarr-Seite (Funktionen); hier steht nur noch, was gilt.
export function DolibarrSourceBlock({ source, onChange, onSynced, kind = "sponsors" }) {
  const [busy, setBusy] = useState(false);
  if (!source || source.unavailable) return null;
  const enabled = Boolean(source.from_dolibarr);
  const refresh = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/admin/dolibarr/sponsors/refresh");
      onChange?.(data.view || null);
      if (data.ok) {
        toast.success(`Aus Dolibarr nachgelesen: ${data.sponsors?.total ?? 0} Sponsoren, ${data.partners?.total ?? 0} Partner.`);
        onSynced?.();
      } else {
        toast.error(`Dolibarr nicht lesbar – alter Stand bleibt (${data.text || data.kind}).`);
      }
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Nachlesen hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  };
  const category = kind === "partners" ? source.partner_category : source.sponsor_category;
  if (!enabled) {
    return (
      <p className="mb-4 text-xs text-white/45" data-testid="dolibarr-source-off">
        {kind === "partners" ? "Partner" : "Sponsoren"} aus Dolibarr übernehmen? Der Schalter liegt unter{" "}
        <Link to="/admin/dolibarr?tab=features" className="text-[#29B6E8] hover:underline" data-testid="dolibarr-source-features">Dolibarr → Funktionen</Link>.
      </p>
    );
  }
  return (
    <div className="mb-6 border border-[#29B6E8]/40 bg-[#29B6E8]/5 rounded-sm p-4 space-y-2" data-testid="dolibarr-source">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-white/80 font-bold">{kind === "partners" ? "Partner" : "Sponsoren"} kommen aus Dolibarr (Kategorie „{category}“)</div>
        <button type="button" onClick={refresh} disabled={busy} data-testid="dolibarr-source-refresh" className="px-3 py-1 border border-white/20 text-white/80 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">Jetzt nachlesen</button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="dolibarr-source-state">
        {source.fetched_at ? (
          <span className="text-white/60">Stand {new Date(source.fetched_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}: <span className="text-white">{source.counts?.sponsors ?? 0} Sponsoren, {source.counts?.partners ?? 0} Partner</span></span>
        ) : (
          <span className="text-[#FFD700]">Noch nichts aus Dolibarr gelesen – „Jetzt nachlesen“ oder auf den stündlichen Abgleich warten.</span>
        )}
        {source.error && <span className="text-[#FF3B30]">Letzter Abgleich fehlgeschlagen ({source.error_text || source.error}) – alter Stand bleibt.</span>}
        <span className="text-white/45">Schalter und Kategorien: <Link to="/admin/dolibarr?tab=features" className="text-[#29B6E8] hover:underline" data-testid="dolibarr-source-features">Dolibarr → Funktionen</Link>.</span>
      </div>
    </div>
  );
}

export function dolibarrLocked(source, item, fields) {
  if (!source?.from_dolibarr || item?.source !== "dolibarr") return new Set();
  return new Set(fields);
}
