import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminFormPage, FormActions, FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { SkeletonDetailHeader, SkeletonLines } from "@/components/tls/Skeleton";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";

// Über uns pflegen (#406): die Leitbild-Texte der Seite „Über den Verein“ - Hero, Werte, Spiele,
// Offline, Aufruf - als eigene Seite im Rahmen der Admin-Formulare. Was die Seite sonst zeigt
// (Zahlen, Spiele, Vorstand, Events, Vereinsdaten aus Dolibarr), steht rechts als Hinweis, damit
// niemand danach sucht.

const ACCENT = "#29B6E8";
const TEXT_KEYS = ["hero_eyebrow", "hero_title", "hero_text", "values_title", "values_text", "games_title", "games_text", "offline_title", "offline_text", "cta_title", "cta_text", "purpose"];

export function textsToForm(texts) {
  const form = {};
  for (const key of TEXT_KEYS) form[key] = texts?.[key] || "";
  form.pillars = (texts?.pillars || []).join("\n");
  form.offline_items = (texts?.offline_items || []).join("\n");
  form.founded_year = texts?.founded_year ? String(texts.founded_year) : "";
  form.nonprofit = texts?.nonprofit === true;
  return form;
}

export function formToPayload(form) {
  const payload = {};
  for (const key of TEXT_KEYS) payload[key] = form[key] || "";
  payload.pillars = String(form.pillars || "").split("\n").map((line) => line.trim()).filter(Boolean);
  payload.offline_items = String(form.offline_items || "").split("\n").map((line) => line.trim()).filter(Boolean);
  payload.founded_year = /^\d{4}$/.test(String(form.founded_year || "").trim()) ? Number(form.founded_year) : null;
  payload.nonprofit = Boolean(form.nonprofit);
  return payload;
}

export default function AdminAboutPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    api.get("/home/about/admin").then(({ data }) => { setData(data); setForm(textsToForm(data.texts)); }).catch((err) => toast.error(formatRequestError(err, "Über uns konnte nicht geladen werden.")));
  }, []);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form) return;
    setSaving(true);
    try {
      const { data: saved } = await api.put("/home/about/admin", formToPayload(form));
      setForm(textsToForm(saved.texts));
      toast.success("Über uns gespeichert.");
    } catch (err) {
      toast.error(formatRequestError(err, "Speichern hat nicht geklappt."));
    } finally {
      setSaving(false);
    }
  };

  if (!data || !form) {
    return <AdminLayout><div className="max-w-3xl"><SkeletonDetailHeader label="Lade Über uns" /><SkeletonLines lines={8} className="mt-8" label="Lade Über uns" /></div></AdminLayout>;
  }
  const fromDolibarr = data.organization?.source === "dolibarr";
  const numbers = data.numbers || {};

  return (
    <AdminLayout>
      <AdminFormPage
        eyebrow="Verein"
        accent={ACCENT}
        title="Über uns"
        intro="Die Texte der Seite „Über den Verein“. Zahlen, Spiele, Vorstand und Events zieht die Seite selbst aus den Daten."
        backTo="/admin"
        backLabel="Dashboard"
        onSubmit={submit}
        testId="about-form"
        headerExtra={<Link to="/about" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider font-bold text-white/60 hover:text-[#29B6E8] transition" data-testid="about-preview-link">Seite ansehen <ExternalLink className="w-3.5 h-3.5" /></Link>}
        aside={(
          <>
            <FormSection title="Vereinsdaten" accent={ACCENT} hint={fromDolibarr ? "Gründung, Zweck und gemeinnützig kommen aus Dolibarr (Schalter „Vereinsdaten aus Dolibarr“ in den Einstellungen). Die Felder hier sind nur der Rückfall." : "Solange die Vereinsdaten nicht aus Dolibarr kommen, gelten diese Felder."} testId="about-organization">
              {fromDolibarr && (
                <p className="text-xs text-[#29B6E8]" data-testid="about-organization-dolibarr">
                  Aus Dolibarr: {data.organization.founded_year ? `gegründet ${data.organization.founded_year}` : "kein Gründungsdatum"}{data.organization.nonprofit ? ", gemeinnützig" : ""}{data.organization.purpose ? ` – „${data.organization.purpose}“` : ""}
                </p>
              )}
              <FormGrid>
                <TextField label="Gründungsjahr" value={form.founded_year} onChange={(v) => set("founded_year", v)} placeholder="2019" maxLength={4} testId="about-founded-year" disabled={fromDolibarr} hint={fromDolibarr ? "aus Dolibarr" : undefined} />
                <CheckField label="Gemeinnützig" checked={form.nonprofit} onChange={(v) => set("nonprofit", v)} testId="about-nonprofit" disabled={fromDolibarr} hint={fromDolibarr ? "aus Dolibarr" : undefined} className="mt-6" />
              </FormGrid>
              <TextAreaField label="Vereinszweck" value={form.purpose} onChange={(v) => set("purpose", v)} rows={3} testId="about-purpose" hint={fromDolibarr ? "aus Dolibarr – wird dort gepflegt" : "Ein Satz, wie er in den Statuten steht."} />
              <p className="text-xs text-white/45">ZVR und Sitz kommen aus den Vereinsdaten (Einstellungen → Rechtliches).</p>
            </FormSection>
            <FormSection title="Was die Seite sonst zeigt" accent={ACCENT} plain testId="about-live-data">
              <ul className="text-xs text-white/60 space-y-1.5">
                <li><span className="text-white">{numbers.members ?? 0}</span> Mitglieder, <span className="text-white">{numbers.tournaments ?? 0}</span> Turniere, <span className="text-white">{numbers.events ?? 0}</span> Events, <span className="text-white">{numbers.participations ?? 0}</span> Turnierteilnahmen, <span className="text-white">{numbers.achievements ?? 0}</span> Auszeichnungen – gezählt, nicht getippt.</li>
                <li><span className="text-white">{data.games ?? 0}</span> Spiele aus <Link to="/admin/games" className="underline">Admin → Spiele</Link> mit der Zahl der Turniere je Spiel.</li>
                <li>Ansprechpartner aus dem <Link to="/admin/board" className="underline">Vorstand</Link> – nur freigegebene Namen.</li>
                <li><span className="text-white">{data.offline_events ?? 0}</span> vergangene Vereinsevents mit Bild als kleine Galerie (Typ Vereinsabend, LAN, Grillabend, Messe …).</li>
              </ul>
            </FormSection>
          </>
        )}
        actions={<FormActions accent={ACCENT} saving={saving} submitTestId="about-save" cancelTo="/admin" cancelLabel="Zurück" />}
      >
        <FormSection title="Hero" accent={ACCENT} testId="about-section-hero">
          <FormGrid>
            <TextField label="Kleine Zeile" value={form.hero_eyebrow} onChange={(v) => set("hero_eyebrow", v)} maxLength={60} testId="about-hero-eyebrow" />
            <TextAreaField label="Überschrift" value={form.hero_title} onChange={(v) => set("hero_title", v)} rows={2} testId="about-hero-title" hint="Zeilenumbruch = neue Zeile in der Überschrift." />
          </FormGrid>
          <TextAreaField label="Text" value={form.hero_text} onChange={(v) => set("hero_text", v)} rows={3} testId="about-hero-text" hint="**fett** hebt hervor, Leerzeile = neuer Absatz." />
        </FormSection>
        <FormSection title="Was uns ausmacht" accent={ACCENT} testId="about-section-values">
          <TextField label="Überschrift" value={form.values_title} onChange={(v) => set("values_title", v)} maxLength={120} testId="about-values-title" />
          <TextAreaField label="Text" value={form.values_text} onChange={(v) => set("values_text", v)} rows={6} testId="about-values-text" />
          <TextAreaField label="Werte (eine je Zeile)" value={form.pillars} onChange={(v) => set("pillars", v)} rows={4} testId="about-pillars" hint="Vier Kacheln passen am besten." />
        </FormSection>
        <FormSection title="Was wir spielen" accent={ACCENT} testId="about-section-games" hint="Die Spiele selbst kommen aus der Spiele-Verwaltung; hier steht nur der Text darüber.">
          <TextField label="Überschrift" value={form.games_title} onChange={(v) => set("games_title", v)} maxLength={120} testId="about-games-title" />
          <TextAreaField label="Text" value={form.games_text} onChange={(v) => set("games_text", v)} rows={4} testId="about-games-text" />
        </FormSection>
        <FormSection title="Auch offline" accent={ACCENT} testId="about-section-offline">
          <TextField label="Überschrift" value={form.offline_title} onChange={(v) => set("offline_title", v)} maxLength={120} testId="about-offline-title" />
          <TextAreaField label="Text" value={form.offline_text} onChange={(v) => set("offline_text", v)} rows={5} testId="about-offline-text" />
          <TextAreaField label="Aktivitäten (eine je Zeile)" value={form.offline_items} onChange={(v) => set("offline_items", v)} rows={5} testId="about-offline-items" />
        </FormSection>
        <FormSection title="Aufruf am Ende" accent={ACCENT} testId="about-section-cta">
          <TextField label="Überschrift" value={form.cta_title} onChange={(v) => set("cta_title", v)} maxLength={120} testId="about-cta-title" />
          <TextAreaField label="Text" value={form.cta_text} onChange={(v) => set("cta_text", v)} rows={2} testId="about-cta-text" />
        </FormSection>
      </AdminFormPage>
    </AdminLayout>
  );
}
