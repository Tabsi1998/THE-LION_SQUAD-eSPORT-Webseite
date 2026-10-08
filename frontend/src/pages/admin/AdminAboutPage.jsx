import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminFormPage, FormActions, FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { SkeletonDetailHeader, SkeletonLines } from "@/components/tls/Skeleton";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2 } from "lucide-react";
import { DEFAULT_SHOWN, NUMBER_KEYS, NUMBER_LABELS, moveShown, toggleShown } from "@/lib/clubNumbers";
import { viennaDate } from "@/lib/vienna";

// Über uns pflegen (#406): die Leitbild-Texte der Seite „Über den Verein“ - Hero, Werte, Spiele,
// Offline, Aufruf - als eigene Seite im Rahmen der Admin-Formulare. Was die Seite sonst zeigt
// (Zahlen, Spiele, Vorstand, Events, Vereinsdaten aus Dolibarr), steht rechts als Hinweis, damit
// niemand danach sucht. Seit #1253 dazu: das Vereinsfoto mit Fokuspunkt, der Zeitstrahl und die
// Werte mit Satz und Beispiel samt den Zielen (früher die feste Seite „Werte & Ziele“).

const ACCENT = "#29B6E8";
const TEXT_KEYS = ["hero_eyebrow", "hero_title", "hero_text", "values_title", "values_text", "games_title", "games_text", "offline_title", "offline_text", "cta_title", "cta_text", "purpose"];

export function textsToForm(texts) {
  const form = {};
  for (const key of TEXT_KEYS) form[key] = texts?.[key] || "";
  form.offline_items = (texts?.offline_items || []).join("\n");
  form.values = (texts?.values || []).map((value) => ({ title: value.title || "", text: value.text || "", example: value.example || "" }));
  form.goals = (texts?.goals || []).join("\n");
  form.timeline = (texts?.timeline || []).map((entry) => ({ year: entry.year || "", title: entry.title || "", text: entry.text || "", image_url: entry.image_url || "" }));
  const photo = texts?.club_photo || {};
  form.club_photo = { url: photo.url || "", focus_x: Number.isFinite(photo.focus_x) ? photo.focus_x : 50, focus_y: Number.isFinite(photo.focus_y) ? photo.focus_y : 50 };
  form.founded_year = texts?.founded_year ? String(texts.founded_year) : "";
  form.founded_on = texts?.founded_on || "";
  form.nonprofit = texts?.nonprofit === true;
  form.numbers_shown = Array.isArray(texts?.numbers_shown) && texts.numbers_shown.length ? texts.numbers_shown.filter((key) => NUMBER_LABELS[key]) : [...DEFAULT_SHOWN];
  return form;
}

export function formToPayload(form) {
  const payload = {};
  for (const key of TEXT_KEYS) payload[key] = form[key] || "";
  payload.offline_items = String(form.offline_items || "").split("\n").map((line) => line.trim()).filter(Boolean);
  payload.values = (form.values || []).map((value) => ({ title: value.title.trim(), text: value.text.trim(), example: value.example.trim() })).filter((value) => value.title);
  payload.goals = String(form.goals || "").split("\n").map((line) => line.trim()).filter(Boolean);
  payload.timeline = (form.timeline || []).map((entry) => ({ year: entry.year.trim(), title: entry.title.trim(), text: entry.text.trim(), image_url: entry.image_url || "" })).filter((entry) => entry.year && entry.title);
  payload.club_photo = form.club_photo?.url ? { url: form.club_photo.url, focus_x: Math.round(form.club_photo.focus_x), focus_y: Math.round(form.club_photo.focus_y) } : null;
  payload.founded_year = /^\d{4}$/.test(String(form.founded_year || "").trim()) ? Number(form.founded_year) : null;
  // Leer löscht den Gründungstag; steht einer da, folgt das Jahr daraus (Server).
  payload.founded_on = /^\d{4}-\d{2}-\d{2}$/.test(String(form.founded_on || "")) ? form.founded_on : "";
  payload.nonprofit = Boolean(form.nonprofit);
  payload.numbers_shown = (form.numbers_shown || []).filter((key) => NUMBER_LABELS[key]);
  return payload;
}

/** Ein Eintrag einer Liste nach oben (-1) oder unten (+1) schieben. */
export function moveRow(rows, index, direction) {
  const list = [...(rows || [])];
  const target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return list;
  [list[index], list[target]] = [list[target], list[index]];
  return list;
}

function RowTools({ index, count, onMove, onRemove, label }) {
  return (
    <span className="inline-flex gap-1 shrink-0">
      <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0} aria-label={`${label} nach oben`} className="p-1 border border-white/10 rounded-sm disabled:opacity-30"><ArrowUp className="w-3 h-3" /></button>
      <button type="button" onClick={() => onMove(index, 1)} disabled={index === count - 1} aria-label={`${label} nach unten`} className="p-1 border border-white/10 rounded-sm disabled:opacity-30"><ArrowDown className="w-3 h-3" /></button>
      <button type="button" onClick={() => onRemove(index)} aria-label={`${label} entfernen`} className="p-1 border border-[#FF3B30]/30 text-[#FF6B6B] rounded-sm"><Trash2 className="w-3 h-3" /></button>
    </span>
  );
}

/** Das Vereinsfoto (#1253): ein Bild für „Über uns“ (später auch Anmelden und Startseite), Fokuspunkt per Klick ins Bild. */
function ClubPhotoField({ value, onChange }) {
  const pick = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    onChange({ ...value, focus_x: Math.round(((event.clientX - box.left) / box.width) * 100), focus_y: Math.round(((event.clientY - box.top) / box.height) * 100) });
  };
  return (
    <div className="space-y-3" data-testid="about-club-photo">
      <ImageUpload value={value.url} onChange={(url) => onChange({ ...value, url })} label="Vereinsfoto" testId="about-club-photo-upload" variant="wide" allowLibrary />
      <p className="text-xs text-[#FFD700]/80">Nur ein Foto, mit dem alle Abgebildeten einverstanden sind.</p>
      {value.url ? (
        <div>
          <div className="text-xs text-white/55 mb-1">Fokuspunkt: ins Bild klicken – dieser Punkt bleibt beim Zuschneiden immer sichtbar ({value.focus_x} % / {value.focus_y} %).</div>
          <button type="button" onClick={pick} className="relative block w-full max-w-md overflow-hidden rounded-sm border border-white/10 cursor-crosshair" data-testid="about-club-photo-focus" aria-label="Fokuspunkt setzen">
            <img src={resolveMediaUrl(value.url)} alt="" className="block w-full h-auto" />
            <span className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white bg-[#29B6E8]/70 pointer-events-none" style={{ left: `${value.focus_x}%`, top: `${value.focus_y}%` }} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

// Der Verein in Zahlen (#621): Häkchen je Zähler mit dem echten Stand, Reihenfolge per Pfeil.
/** Ein Gründungstag zum Lesen: „1. März 2019“. */
export function foundedLabel(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return "";
  return viennaDate(`${day}T12:00:00`, { day: "numeric", month: "long", year: "numeric" });
}

export function numberValueText(key, numbers) {
  const value = Number(numbers?.[key] || 0);
  if (key === "prizes" && Number(numbers?.prize_money_eur || 0) > 0) return `${value} (${Number(numbers.prize_money_eur).toLocaleString("de-AT")} € Preisgeld)`;
  if (key === "years_active" && !value) return "0 – Gründungsjahr fehlt";
  return String(value);
}

function NumbersPicker({ shown, numbers, onChange }) {
  const order = [...shown, ...NUMBER_KEYS.filter((key) => !shown.includes(key))];
  return (
    <ul className="space-y-1.5" data-testid="about-numbers-picker">
      {order.map((key) => {
        const active = shown.includes(key);
        const position = shown.indexOf(key);
        return (
          <li key={key} className="flex items-center gap-2 text-sm" data-testid={`about-number-${key}`}>
            <input type="checkbox" checked={active} onChange={() => onChange(toggleShown(shown, key))} className="accent-[#29B6E8]" data-testid={`about-number-${key}-toggle`} aria-label={NUMBER_LABELS[key][0]} />
            <span className={active ? "text-white" : "text-white/50"}>{NUMBER_LABELS[key][0]}</span>
            <span className="text-xs text-white/45">{numberValueText(key, numbers)}</span>
            {active && (
              <span className="ml-auto inline-flex gap-1">
                <button type="button" onClick={() => onChange(moveShown(shown, key, -1))} disabled={position === 0} aria-label={`${NUMBER_LABELS[key][0]} nach oben`} data-testid={`about-number-${key}-up`} className="p-1 border border-white/10 rounded-sm disabled:opacity-30"><ArrowUp className="w-3 h-3" /></button>
                <button type="button" onClick={() => onChange(moveShown(shown, key, 1))} disabled={position === shown.length - 1} aria-label={`${NUMBER_LABELS[key][0]} nach unten`} data-testid={`about-number-${key}-down`} className="p-1 border border-white/10 rounded-sm disabled:opacity-30"><ArrowDown className="w-3 h-3" /></button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function AdminAboutPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setRow = (key, index, patch) => setForm((f) => ({ ...f, [key]: f[key].map((row, i) => (i === index ? { ...row, ...patch } : row)) }));
  const moveIn = (key) => (index, direction) => setForm((f) => ({ ...f, [key]: moveRow(f[key], index, direction) }));
  const removeIn = (key) => (index) => setForm((f) => ({ ...f, [key]: f[key].filter((_, i) => i !== index) }));

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
                  Aus Dolibarr: {data.organization.founded_on ? `gegründet am ${foundedLabel(data.organization.founded_on)}` : data.organization.founded_year ? `gegründet ${data.organization.founded_year}` : "kein Gründungsdatum"}{data.organization.nonprofit ? ", gemeinnützig" : ""}{data.organization.purpose ? ` – „${data.organization.purpose}“` : ""}
                </p>
              )}
              <FormGrid>
                <TextField label="Gründungsdatum" type="date" value={form.founded_on} onChange={(v) => set("founded_on", v)} max={new Date().toISOString().slice(0, 10)} testId="about-founded-on" disabled={fromDolibarr} hint={fromDolibarr ? "aus Dolibarr" : "An diesem Tag feiern Web und App jedes Jahr Vereinsgeburtstag – Torte mit Kerzen nach Jahren."} />
                <TextField label="Gründungsjahr" value={form.founded_on ? form.founded_on.slice(0, 4) : form.founded_year} onChange={(v) => set("founded_year", v)} placeholder="2019" maxLength={4} testId="about-founded-year" disabled={fromDolibarr || Boolean(form.founded_on)} hint={fromDolibarr ? "aus Dolibarr" : form.founded_on ? "aus dem Gründungsdatum" : "Reicht für „Jahre aktiv“ – für den Vereinsgeburtstag braucht es den Tag."} />
                <CheckField label="Gemeinnützig" checked={form.nonprofit} onChange={(v) => set("nonprofit", v)} testId="about-nonprofit" disabled={fromDolibarr} hint={fromDolibarr ? "aus Dolibarr" : undefined} className="mt-6" />
              </FormGrid>
              <TextAreaField label="Vereinszweck" value={form.purpose} onChange={(v) => set("purpose", v)} rows={3} testId="about-purpose" hint={fromDolibarr ? "aus Dolibarr – wird dort gepflegt" : "Ein Satz, wie er in den Statuten steht."} />
              <p className="text-xs text-white/45">ZVR und Sitz kommen aus den Vereinsdaten (Einstellungen → Rechtliches).</p>
            </FormSection>
            <FormSection title="Der Verein in Zahlen" accent={ACCENT} testId="about-numbers">
              <p className="text-xs text-white/50">Gezählt, nicht getippt. Häkchen zeigen die Kachel auf „Über uns“ und der Startseite, die Pfeile bestimmen die Reihenfolge. Zähler mit null bleiben von selbst weg.</p>
              <NumbersPicker shown={form.numbers_shown || []} numbers={numbers} onChange={(next) => set("numbers_shown", next)} />
            </FormSection>
            <FormSection title="Was die Seite sonst zeigt" accent={ACCENT} plain testId="about-live-data">
              <ul className="text-xs text-white/60 space-y-1.5">
                <li><span className="text-white">{data.games ?? 0}</span> Spiele aus <Link to="/admin/games" className="underline">Admin → Spiele</Link> mit der Zahl der Turniere je Spiel.</li>
                <li>Ansprechpartner aus dem <Link to="/admin/board" className="underline">Vorstand</Link> – nur freigegebene Namen.</li>
                <li><span className="text-white">{data.offline_events ?? 0}</span> vergangene Vereinsevents mit Bild als kleine Galerie (Typ Vereinsabend, LAN, Grillabend, Messe …).</li>
              </ul>
            </FormSection>
          </>
        )}
        actions={<FormActions accent={ACCENT} saving={saving} submitTestId="about-save" cancelTo="/admin" cancelLabel="Zurück" />}
      >
        <FormSection title="Kopf" accent={ACCENT} testId="about-section-hero" hint="Ein eigener Satz für „Über uns“ – nicht derselbe wie auf der Startseite.">
          <FormGrid>
            <TextField label="Kleine Zeile" value={form.hero_eyebrow} onChange={(v) => set("hero_eyebrow", v)} maxLength={60} testId="about-hero-eyebrow" />
            <TextAreaField label="Überschrift" value={form.hero_title} onChange={(v) => set("hero_title", v)} rows={2} testId="about-hero-title" hint="Leer: „Seit <Gründungsjahr> ein Rudel“. Zeilenumbruch = neue Zeile." />
          </FormGrid>
          <TextAreaField label="Text" value={form.hero_text} onChange={(v) => set("hero_text", v)} rows={3} testId="about-hero-text" hint="**fett** hebt hervor, Leerzeile = neuer Absatz." />
        </FormSection>
        <FormSection title="Vereinsfoto" accent={ACCENT} testId="about-section-photo" hint="Steht im Kopf von „Über uns“ – ein Foto für den ganzen Verein.">
          <ClubPhotoField value={form.club_photo} onChange={(v) => set("club_photo", v)} />
        </FormSection>
        <FormSection title="Zeitstrahl: So sind wir gewachsen" accent={ACCENT} testId="about-section-timeline" hint="Je Eintrag Jahr, ein Satz und auf Wunsch ein Bild – Gründung, erste LAN, erster Podestplatz …">
          <ol className="space-y-3" data-testid="about-timeline-rows">
            {form.timeline.map((entry, index) => (
              <li key={index} className="border border-white/10 rounded-sm p-3 space-y-2" data-testid={`about-timeline-row-${index}`}>
                <div className="flex items-start gap-2">
                  <div className="grid grid-cols-[6rem_1fr] gap-2 flex-1 min-w-0">
                    <TextField label="Jahr" value={entry.year} onChange={(v) => setRow("timeline", index, { year: v })} maxLength={20} testId={`about-timeline-year-${index}`} />
                    <TextField label="Was war" value={entry.title} onChange={(v) => setRow("timeline", index, { title: v })} maxLength={120} testId={`about-timeline-title-${index}`} placeholder="Erste LAN" />
                  </div>
                  <RowTools index={index} count={form.timeline.length} onMove={moveIn("timeline")} onRemove={removeIn("timeline")} label={`Eintrag ${index + 1}`} />
                </div>
                <TextField label="Satz dazu (optional)" value={entry.text} onChange={(v) => setRow("timeline", index, { text: v })} maxLength={400} testId={`about-timeline-text-${index}`} placeholder="42 Gäste, zwei Turniere." />
                <ImageUpload value={entry.image_url} onChange={(url) => setRow("timeline", index, { image_url: url })} label="Bild (optional)" testId={`about-timeline-image-${index}`} variant="wide" allowLibrary />
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => set("timeline", [...form.timeline, { year: "", title: "", text: "", image_url: "" }])} data-testid="about-timeline-add" className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white"><Plus className="w-3.5 h-3.5" /> Eintrag</button>
        </FormSection>
        <FormSection title="Werte & Ziele" accent={ACCENT} testId="about-section-values" hint="Der Abschnitt „Werte & Ziele“ auf „Über uns“ – die alte Seite /values leitet dorthin.">
          <TextField label="Überschrift" value={form.values_title} onChange={(v) => set("values_title", v)} maxLength={120} testId="about-values-title" />
          <TextAreaField label="Text" value={form.values_text} onChange={(v) => set("values_text", v)} rows={4} testId="about-values-text" />
          <ol className="space-y-3" data-testid="about-value-rows">
            {form.values.map((value, index) => (
              <li key={index} className="border border-white/10 rounded-sm p-3 space-y-2" data-testid={`about-value-row-${index}`}>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0"><TextField label="Wert" value={value.title} onChange={(v) => setRow("values", index, { title: v })} maxLength={60} testId={`about-value-title-${index}`} placeholder="Fairplay" /></div>
                  <RowTools index={index} count={form.values.length} onMove={moveIn("values")} onRemove={removeIn("values")} label={`Wert ${index + 1}`} />
                </div>
                <TextField label="Ein Satz" value={value.text} onChange={(v) => setRow("values", index, { text: v })} maxLength={400} testId={`about-value-text-${index}`} placeholder="Wir gratulieren auch, wenn wir verlieren." />
                <TextField label="Beispiel" value={value.example} onChange={(v) => setRow("values", index, { example: v })} maxLength={300} testId={`about-value-example-${index}`} placeholder="Nach jedem Match ein „GG“ – im Spiel und im Chat." />
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => set("values", [...form.values, { title: "", text: "", example: "" }])} data-testid="about-value-add" className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white"><Plus className="w-3.5 h-3.5" /> Wert</button>
          <TextAreaField label="Unsere Ziele (eines je Zeile)" value={form.goals} onChange={(v) => set("goals", v)} rows={5} testId="about-goals" hint="**fett** hebt den Anfang hervor." />
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
