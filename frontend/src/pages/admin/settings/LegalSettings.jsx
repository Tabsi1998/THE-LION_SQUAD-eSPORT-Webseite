import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { Link } from "react-router-dom";
import { BrandField, LegalTextArea } from "./fields";

// Reiter Rechtliches (#223: aus AdminSettingsPage herausgelöst, Verhalten unverändert): Vereinsdaten
// für Impressum und Datenschutz, der Stand „Vereinsdaten aus Dolibarr“ (#326; der Schalter liegt seit
// #510 unter Dolibarr → Funktionen) und die Zusatztexte. Der Entwurf (`brand`) und das Speichern bleiben bei der Seite, weil Marke und
// Rechtliches denselben Datensatz teilen.

export function mergedLegacyText(primary, legacy) {
  const values = [primary, legacy].map((value) => String(value || "").trim()).filter(Boolean);
  return [...new Map(values.map((value) => [value.replace(/\s+/g, " ").toLocaleLowerCase(), value])).values()].join("\n\n");
}

// Statuten aus Dolibarr (#326 Teil 3) im Reiter Rechtliches: ein Satz, der sagt, was die Vorstandsseite zeigt.
function statutesDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

export function statutesSummary(statutes) {
  if (!statutes) return "";
  if (!statutes.state) return statutes.error ? `vom Modul nicht geliefert (${statutes.error}) – bleibt der Hinweis auf den Mitgliederbereich` : "noch nicht gelesen";
  if (statutes.state === "not_published") return "im Modul nicht für die Öffentlichkeit freigegeben (Dolibarr → Einrichtung → Statuten) – die Vorstandsseite zeigt keine";
  if (statutes.state === "in_force" && statutes.current) return `Fassung ${statutes.current.version} gilt seit ${statutesDay(statutes.current.valid_from)} (${statutes.versions} Fassungen)`;
  if (statutes.state === "ambiguous") return "welche Fassung gilt, ist im Modul nicht eindeutig";
  return `noch keine Fassung in Kraft (${statutes.versions} beschlossen)`;
}

export function LegalTab({ brand, setBrandField, setCanonicalLegalText, saveBrand, saving }) {
  // Vereinsdaten aus Dolibarr (#326): Stand, Fehler und was übernommen würde - geladen, sobald der Reiter offen ist.
  const [dolibarrPublic, setDolibarrPublic] = useState(null);
  const [dolibarrPublicBusy, setDolibarrPublicBusy] = useState(false);
  const loadDolibarrPublic = useCallback(() => {
    api.get("/admin/dolibarr/public").then(({ data }) => setDolibarrPublic(data)).catch(() => setDolibarrPublic({ unavailable: true }));
  }, []);
  useEffect(() => { loadDolibarrPublic(); }, [loadDolibarrPublic]);
  const refreshDolibarrPublic = async () => {
    setDolibarrPublicBusy(true);
    try {
      const { data } = await api.post("/admin/dolibarr/public/refresh");
      setDolibarrPublic(data.view || null);
      toast.success(data.ok ? "Vereinsdaten aus Dolibarr nachgelesen." : `Dolibarr nicht lesbar – alter Stand bleibt (${data.text || data.kind}).`);
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Nachlesen hat nicht geklappt.");
    } finally {
      setDolibarrPublicBusy(false);
    }
  };
  const legalFromDolibarr = Boolean(brand.legal_from_dolibarr);
  const dolibarrLegal = (field) => (legalFromDolibarr && dolibarrPublic?.overlay?.[field] ? { disabled: true, hint: "aus Dolibarr", value: dolibarrPublic.overlay[field] } : {});

  return (
    <div className="max-w-4xl space-y-4">
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-5">
        <div>
          <div className="font-heading font-bold uppercase">Vereinsdaten für Impressum und Datenschutz</div>
          <p className="text-xs text-white/50 mt-1">Dies ist die zentrale Datenquelle für /contact, /imprint und /privacy. ZVR, Adresse, Kontakt und vertretungsbefugte Person bitte ausschließlich hier mit den echten Vereinsdaten pflegen – oder aus Dolibarr übernehmen.</p>
        </div>
        {/* Vereinsdaten aus Dolibarr (#326): Name, ZVR, Behörde, Anschrift, Telefon, Obmann/Obfrau – Redaktionelles bleibt von Hand. */}
        <div className={`border rounded-sm p-4 space-y-2 ${legalFromDolibarr ? "border-[#29B6E8]/40 bg-[#29B6E8]/5" : "border-white/10"}`} data-testid="legal-dolibarr">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/80 font-bold">
            <span data-testid="legal-dolibarr-title">{legalFromDolibarr ? "Vereinsdaten kommen aus Dolibarr" : "Vereinsdaten von Hand"}</span>
            <Link to="/admin/dolibarr?tab=features" className="text-[11px] uppercase tracking-wider text-[#29B6E8] hover:underline font-bold" data-testid="legal-dolibarr-features">Schalter: Dolibarr → Funktionen →</Link>
          </div>
          <p className="text-xs text-white/50">Name, ZVR, Vereinsbehörde, Anschrift, Telefon und die vertretungsbefugte Person kommen dann aus dem Vereinsmodul (stündlich nachgelesen). Datenschutz-E-Mail, inhaltlich Verantwortlicher, Hosting, UID und Zusatztexte bleiben hier. Ändert sich der Obmann in Dolibarr, stimmt das Impressum von selbst – wenn die Person der Nennung zugestimmt hat; sonst bleibt der Eintrag von Hand.</p>
          <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="legal-dolibarr-state">
            {!dolibarrPublic ? <span className="text-white/40">Lade Stand …</span>
              : dolibarrPublic.unavailable ? <span className="text-[#FFD700]">Dolibarr-Stand nicht abrufbar (Anbindung fehlt oder kein Zugriff).</span>
              : !dolibarrPublic.has_data ? <span className="text-[#FFD700]">Noch nichts aus Dolibarr gelesen – „Jetzt nachlesen“ oder auf den stündlichen Abgleich warten.</span>
              : (
                <>
                  <span className="text-white/60">Stand {new Date(dolibarrPublic.fetched_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}: <span className="text-white">{dolibarrPublic.overlay?.legal_name}</span>, ZVR {dolibarrPublic.overlay?.zvr_number || "–"}</span>
                  <span className="text-white/60">Vertretung: {dolibarrPublic.representative ? <span className="text-white">{dolibarrPublic.representative.name} ({dolibarrPublic.representative.role})</span> : <span className="text-[#FFD700]">kein freigegebener Name – bleibt von Hand</span>}</span>
                  {dolibarrPublic.statutes && <span className="text-white/60" data-testid="legal-dolibarr-statutes">Statuten: <span className={dolibarrPublic.statutes.state === "in_force" ? "text-white" : "text-[#FFD700]"}>{statutesSummary(dolibarrPublic.statutes)}</span></span>}
                  {dolibarrPublic.error && <span className="text-[#FF3B30]">Letzter Abgleich fehlgeschlagen ({dolibarrPublic.error_text || dolibarrPublic.error}) – alter Stand bleibt.</span>}
                </>
              )}
            <button type="button" onClick={refreshDolibarrPublic} disabled={dolibarrPublicBusy || dolibarrPublic?.unavailable} data-testid="legal-dolibarr-refresh" className="px-3 py-1 border border-white/20 text-white/80 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">Jetzt nachlesen</button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <BrandField label="Rechtlicher Vereinsname" value={brand.legal_name} onChange={(v) => setBrandField("legal_name", v)} testId="legal-name" {...dolibarrLegal("legal_name")} />
          <BrandField label="ZVR-Zahl" value={brand.zvr_number} onChange={(v) => setBrandField("zvr_number", v)} testId="legal-zvr" {...dolibarrLegal("zvr_number")} />
          <BrandField label="Rechtsform" value={brand.legal_form} onChange={(v) => setBrandField("legal_form", v)} testId="legal-form" />
          <BrandField label="Vereinssitz" value={brand.registered_seat} onChange={(v) => setBrandField("registered_seat", v)} testId="legal-seat" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <BrandField label="Strasse und Hausnummer" value={brand.street_address} onChange={(v) => setBrandField("street_address", v)} testId="legal-street" {...dolibarrLegal("street_address")} />
          <BrandField label="Adresszusatz" value={brand.address_extra} onChange={(v) => setBrandField("address_extra", v)} testId="legal-address-extra" />
          <BrandField label="PLZ" value={brand.postal_code} onChange={(v) => setBrandField("postal_code", v)} testId="legal-postal" {...dolibarrLegal("postal_code")} />
          <BrandField label="Ort" value={brand.city} onChange={(v) => setBrandField("city", v)} testId="legal-city" {...dolibarrLegal("city")} />
          <BrandField label="Bundesland" value={brand.state} onChange={(v) => setBrandField("state", v)} testId="legal-state" />
          <BrandField label="Land" value={brand.country} onChange={(v) => setBrandField("country", v)} testId="legal-country" {...dolibarrLegal("country")} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <BrandField label="Vereinsbehoerde" value={brand.register_authority} onChange={(v) => setBrandField("register_authority", v)} testId="legal-authority" {...dolibarrLegal("register_authority")} />
          <BrandField label="Telefon" value={brand.phone} onChange={(v) => setBrandField("phone", v)} testId="legal-phone" {...dolibarrLegal("phone")} />
          <BrandField label="Vertretungsbefugte Person" value={brand.representative_name} onChange={(v) => setBrandField("representative_name", v)} testId="legal-representative" {...dolibarrLegal("representative_name")} />
          <BrandField label="Funktion" value={brand.representative_role} onChange={(v) => setBrandField("representative_role", v)} testId="legal-role" {...dolibarrLegal("representative_role")} />
          <BrandField label="Inhaltlich verantwortlich" value={brand.content_responsible} onChange={(v) => setBrandField("content_responsible", v)} testId="legal-content-responsible" />
          <BrandField label="Datenschutz E-Mail" value={brand.privacy_contact_email} onChange={(v) => setBrandField("privacy_contact_email", v)} testId="legal-privacy-email" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <BrandField label="Hosting / Betreiber" value={brand.hosting_provider} onChange={(v) => setBrandField("hosting_provider", v)} testId="legal-hosting" />
          <BrandField label="Hosting-Region" value={brand.hosting_country} onChange={(v) => setBrandField("hosting_country", v)} testId="legal-hosting-country" />
          <BrandField label="UID-Nummer falls vorhanden" value={brand.vat_number} onChange={(v) => setBrandField("vat_number", v)} testId="legal-vat" />
          <BrandField label="Turnierbedingungen URL" value={brand.tournament_terms_url} onChange={(v) => setBrandField("tournament_terms_url", v)} testId="legal-terms-url" />
        </div>
        <label className="flex items-start gap-2 text-sm text-white/75">
          <input type="checkbox" checked={!!brand.paid_tournaments_enabled} onChange={(e) => setBrandField("paid_tournaments_enabled", e.target.checked)} data-testid="legal-paid-tournaments" className="accent-[#29B6E8] mt-1" />
          <span>Preisturniere oder Turniere mit Startgeld können stattfinden.</span>
        </label>
        <LegalTextArea label="Zusätzliche rechtliche Hinweise (optional)" value={mergedLegacyText(brand.legal_extra, brand.imprint)} onChange={(v) => setCanonicalLegalText("legal_extra", "imprint", v)} testId="legal-extra" rows={5} />
        <LegalTextArea label="Zusätzliche Datenschutzhinweise (optional)" value={mergedLegacyText(brand.privacy_extra, brand.privacy_policy)} onChange={(v) => setCanonicalLegalText("privacy_extra", "privacy_policy", v)} testId="privacy-extra" rows={6} />
        <LegalTextArea label="Ergänzende Nutzungsbedingungen (optional)" value={brand.terms_of_use || ""} onChange={(v) => setBrandField("terms_of_use", v)} testId="terms-of-use" rows={8} />
        <button onClick={saveBrand} disabled={saving} data-testid="legal-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{saving ? "Speichere..." : "Rechtliches speichern"}</button>
      </div>
    </div>
  );
}
