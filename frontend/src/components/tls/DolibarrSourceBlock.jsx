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

export function DolibarrSourceBlock({ source, onChange, onSynced, kind = "sponsors" }) {
  const [busy, setBusy] = useState(false);
  // Die Kategorienamen kommen aus dem Server-Stand; nur eine Eingabe des Admins liegt als Entwurf
  // darüber. So gibt es keinen Render, in dem leere Felder wie eine Änderung aussehen.
  const [draft, setDraft] = useState(null);
  if (!source || source.unavailable) return null;
  const categories = draft || { sponsor_category: source.sponsor_category || "", partner_category: source.partner_category || "" };
  const setCategories = (update) => setDraft((current) => update(current || { sponsor_category: source.sponsor_category || "", partner_category: source.partner_category || "" }));

  const enabled = Boolean(source.from_dolibarr);
  const save = async (patch, successText) => {
    setBusy(true);
    try {
      const { data } = await api.patch("/admin/dolibarr/sponsors", patch);
      onChange?.(data.view || null);
      setDraft(null);
      if (data.result && data.result.ok === false) toast.error(`Dolibarr nicht lesbar – alter Stand bleibt (${data.result.text || data.result.kind}).`);
      else toast.success(successText);
      if (data.result?.ok) onSynced?.();
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Speichern hat nicht geklappt.");
    } finally {
      setBusy(false);
    }
  };
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
  const categoriesChanged = draft !== null && (categories.sponsor_category !== (source.sponsor_category || "") || categories.partner_category !== (source.partner_category || ""));
  const found = source.categories || {};
  const stateOf = (key) => (found[key] ? (found[key].found ? `gefunden${found[key].sub?.length ? ` (${found[key].sub.join(", ")})` : ""}` : "nicht gefunden") : "noch nicht gelesen");

  return (
    <div className={`mb-6 border rounded-sm p-4 space-y-3 ${enabled ? "border-[#29B6E8]/40 bg-[#29B6E8]/5" : "border-white/10 bg-[#0A0A0A]"}`} data-testid="dolibarr-source">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-white/80 font-bold">
          <input type="checkbox" checked={enabled} disabled={busy || !source.connected} onChange={(e) => save({ from_dolibarr: e.target.checked }, e.target.checked ? "Sponsoren und Partner kommen jetzt aus Dolibarr." : "Schalter aus – die Listen sind wieder von Hand pflegbar.")} data-testid="dolibarr-source-switch" className="accent-[#29B6E8]" />
          Sponsoren und Partner aus Dolibarr übernehmen
        </label>
        {enabled && (
          <button type="button" onClick={refresh} disabled={busy} data-testid="dolibarr-source-refresh" className="px-3 py-1 border border-white/20 text-white/80 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">Jetzt nachlesen</button>
        )}
      </div>
      {!source.connected ? (
        <p className="text-xs text-[#FFD700]" data-testid="dolibarr-source-offline">Dolibarr ist nicht angebunden – einrichten unter <Link to="/admin/dolibarr" className="underline">Finanzen → Dolibarr-Anbindung</Link>. Bis dahin bleiben Sponsoren und Partner Handpflege.</p>
      ) : (
        <p className="text-xs text-white/50">
          In Dolibarr sind Sponsoren und Partner Geschäftspartner in der Kategorie „{source.sponsor_category}“ bzw. „{source.partner_category}“ (Kategorien für Kunden). Unterkategorien von „{source.sponsor_category}“ geben die Stufe (Hauptsponsor, Platin, Gold, Silber, Bronze), Unterkategorien von „{source.partner_category}“ die Art (Verein, Messe, Community …). Die Laufzeit kommt aus den Zusatzfeldern <code className="text-white/70">sponsor_start</code> / <code className="text-white/70">sponsor_end</code> (Datum) am Geschäftspartner, wenn es sie gibt. Name, Stufe bzw. Art, Laufzeit, E-Mail und Telefon kommen dann aus Dolibarr (stündlich nachgelesen); Logo, Link, Platzierungen, Reihenfolge, Beschreibung und Notizen bleiben hier. Ein Handeintrag mit demselben Namen wird übernommen, sein Logo bleibt. Fällt eine Firma aus der Kategorie, endet ihr Sponsoring zum Stichtag und sie steht bei den ehemaligen Unterstützern.
        </p>
      )}
      {source.connected && (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <label className="block text-[11px] font-bold uppercase tracking-widest text-white/65">
            Kategorie Sponsoren
            <input value={categories.sponsor_category} onChange={(e) => setCategories((c) => ({ ...c, sponsor_category: e.target.value }))} data-testid="dolibarr-source-sponsor-category" className="mt-1 w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white text-sm font-normal normal-case tracking-normal focus:outline-none" />
            <span className="block mt-1 text-[10px] font-normal normal-case tracking-normal text-white/40">{stateOf("sponsor")}</span>
          </label>
          <label className="block text-[11px] font-bold uppercase tracking-widest text-white/65">
            Kategorie Partner
            <input value={categories.partner_category} onChange={(e) => setCategories((c) => ({ ...c, partner_category: e.target.value }))} data-testid="dolibarr-source-partner-category" className="mt-1 w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white text-sm font-normal normal-case tracking-normal focus:outline-none" />
            <span className="block mt-1 text-[10px] font-normal normal-case tracking-normal text-white/40">{stateOf("partner")}</span>
          </label>
          <button type="button" onClick={() => save(categories, "Kategorien gespeichert.")} disabled={busy || !categoriesChanged} data-testid="dolibarr-source-save" className="mb-5 px-3 py-2 border border-[#29B6E8]/40 text-[#29B6E8] rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">Kategorien speichern</button>
        </div>
      )}
      {source.connected && enabled && (
        <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="dolibarr-source-state">
          {source.fetched_at ? (
            <span className="text-white/60">Stand {new Date(source.fetched_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}: <span className="text-white">{source.counts?.sponsors ?? 0} Sponsoren</span>, <span className="text-white">{source.counts?.partners ?? 0} Partner</span> aus Dolibarr</span>
          ) : (
            <span className="text-[#FFD700]">Noch nichts aus Dolibarr gelesen – „Jetzt nachlesen“ oder auf den stündlichen Abgleich warten.</span>
          )}
          {source.error && <span className="text-[#FF3B30]">Letzter Abgleich fehlgeschlagen ({source.error_text || source.error}) – alter Stand bleibt.</span>}
          {kind === "sponsors" && found.sponsor && !found.sponsor.found && <span className="text-[#FFD700]">Kategorie „{source.sponsor_category}“ gibt es in Dolibarr nicht – anlegen oder den Namen hier anpassen.</span>}
          {kind === "partners" && found.partner && !found.partner.found && <span className="text-[#FFD700]">Kategorie „{source.partner_category}“ gibt es in Dolibarr nicht – anlegen oder den Namen hier anpassen.</span>}
        </div>
      )}
    </div>
  );
}

export function dolibarrLocked(source, item, fields) {
  if (!source?.from_dolibarr || item?.source !== "dolibarr") return new Set();
  return new Set(fields);
}
