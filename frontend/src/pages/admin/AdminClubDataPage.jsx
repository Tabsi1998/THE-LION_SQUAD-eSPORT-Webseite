import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { api, formatApiError } from "@/lib/api";
import { setCachedBranding } from "@/lib/brandingEvents";
import { buildDirtyPayload, hasPayloadChanges } from "@/lib/dirtyPayload";
import { LegalTab } from "./settings/LegalSettings";

// Vereinsdaten (#509): eine eigene Seite unter Verein - vorher hieß dieselbe Sache im Menü „Vereinsdaten“,
// als Reiter „Rechtliches“ und in der Überschrift „Vereinsdaten für Impressum und Datenschutz“ und lag
// unter System → Einstellungen. Gespeichert wird weiter im Branding-Dokument (`/settings/branding`), aber
// nur die Felder dieser Seite gehen als Änderung raus.
export const LEGAL_DEFAULTS = {
  legal_name: "", legal_form: "eingetragener Verein nach österreichischem Vereinsrecht", zvr_number: "",
  street_address: "", address_extra: "", postal_code: "", city: "", state: "Tirol", country: "Österreich",
  registered_seat: "", register_authority: "", representative_name: "", representative_role: "",
  content_responsible: "", phone: "", privacy_contact_email: "", hosting_provider: "", hosting_country: "Österreich/EU",
  vat_number: "", tournament_terms_url: "", paid_tournaments_enabled: false,
  imprint: "", privacy_policy: "", legal_extra: "", privacy_extra: "", terms_of_use: "", legal_from_dolibarr: false,
};

export function legalPayload(source = {}) {
  return Object.fromEntries(Object.keys(LEGAL_DEFAULTS).map((key) => [key, source[key] ?? LEGAL_DEFAULTS[key]]));
}

export default function AdminClubDataPage() {
  const [brand, setBrand] = useState(LEGAL_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const originalRef = useRef(LEGAL_DEFAULTS);

  useEffect(() => {
    api.get("/settings/branding").then(({ data }) => {
      const next = { ...LEGAL_DEFAULTS, ...(data || {}) };
      setBrand(next);
      originalRef.current = next;
    }).catch(() => toast.error("Vereinsdaten konnten nicht geladen werden.")).finally(() => setLoaded(true));
  }, []);

  const setBrandField = (key, value) => setBrand((prev) => ({ ...prev, [key]: value }));
  const setCanonicalLegalText = (key, legacyKey, value) => setBrand((prev) => ({ ...prev, [key]: value, [legacyKey]: "" }));

  const saveBrand = async () => {
    if (saving) return;
    const payload = buildDirtyPayload(legalPayload(brand), legalPayload(originalRef.current));
    if (!hasPayloadChanges(payload)) {
      toast.info("Keine Änderungen zum Speichern.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.put("/settings/branding", payload);
      const next = { ...brand, ...(data && !data.ok ? data : {}) };
      setBrand(next);
      originalRef.current = next;
      try {
        const pub = await api.get("/settings/public", { params: { _: Date.now() } });
        setCachedBranding(pub.data || {});
      } catch {
        /* Impressum liest beim nächsten Aufruf frisch */
      }
      toast.success("Vereinsdaten gespeichert.");
    } catch (err) {
      toast.error(formatApiError(err?.response?.data?.detail) || "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Verein</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-2" data-testid="club-data-title">Vereinsdaten</h1>
      <p className="text-sm text-white/55 mb-6 max-w-3xl">
        Name, ZVR, Anschrift, Vertretung und die Texte für Impressum, Datenschutz und Nutzungsbedingungen – die eine Stelle dafür.
        Kontakt, Impressum und Datenschutz auf der Website lesen von hier; mit Dolibarr-Anbindung kommen die Vereinsdaten wahlweise aus dem Vereinsmodul.
      </p>
      {loaded ? (
        <LegalTab brand={brand} setBrandField={setBrandField} setCanonicalLegalText={setCanonicalLegalText} saveBrand={saveBrand} saving={saving} />
      ) : (
        <div className="text-sm text-white/45" data-testid="club-data-loading">Lade Vereinsdaten …</div>
      )}
    </AdminLayout>
  );
}
