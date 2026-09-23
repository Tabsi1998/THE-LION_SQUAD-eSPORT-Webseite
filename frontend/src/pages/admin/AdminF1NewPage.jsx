import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminFormPage, FormActions, FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, FieldLabel, INPUT_CLASS, SelectField, TextField } from "@/components/tls/FormFields";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { normalizeDateTimeFields } from "@/lib/datetime";
import { toast } from "sonner";

const CREATE_STATUS_OPTIONS = [
  ["draft", "Entwurf"],
  ["scheduled", "Angekündigt"],
];

const VISIBILITY_OPTIONS = [
  ["public", "Öffentlich"],
  ["community", "Nur registrierte Community"],
  ["members", "Nur Vereinsmitglieder"],
  ["internal", "Nur intern"],
];

const F1_SEASON_WEIGHT_OPTIONS = [
  ["1", "Fast Lap Standard (x1.00)"],
  ["0.75", "Fun-Challenge (x0.75)"],
  ["0.5", "Event/Check-in Wertung (x0.50)"],
  ["1.25", "Mini-Wertung (x1.25)"],
  ["2", "Normal-Turnier nah (x2.00)"],
  ["0", "Keine Jahreswertung (x0.00)"],
];

// Challenge anlegen (#434): links die Challenge, Strecke, Preise und Streaming, rechts
// Veröffentlichung, Zeitplan, Teilnahme und Jahreswertung - vorher alles untereinander in einer
// 672-px-Spalte.
export default function AdminF1NewPage() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    title: "", slug: "", description: "",
    event_id: "",
    visibility: "public",
    vehicle: "", weather: "", assists_allowed: "",
    controller_type: "", platform: "", banner_url: "",
    unlimited_attempts: true, max_attempts: 0,
    registration_enabled: false, registration_open_from: "", registration_open_until: "",
    block_club_member_results: false, allow_club_reference_times: true, show_club_reference_times: true,
    start_date: "", end_date: "", status: "draft",
    site_banner_enabled: false,
    is_championship: false,
    season_weight: 1,
    twitch_channel: "", twitch_enabled: false,
    prize_places: [],
  });
  const [events, setEvents] = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const updatePrize = (index, patch) => {
    const next = [...form.prize_places];
    next[index] = { ...next[index], ...patch };
    set("prize_places", next);
  };

  useEffect(() => {
    api.get("/events?include_drafts=true").then(({ data }) => setEvents(data || [])).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (payload.block_club_member_results) payload.allow_club_reference_times = true;
      if (!payload.event_id) payload.event_id = null;
      if (payload.unlimited_attempts) payload.max_attempts = null;
      payload.season_weight = Number(payload.season_weight || 0);
      normalizeDateTimeFields(payload, ["registration_open_from", "registration_open_until", "start_date", "end_date"]);
      payload.prize_places = (payload.prize_places || [])
        .filter((p) => p.value && p.value.trim())
        .map((p) => ({ place: Number(p.place) || 0, label: p.label || `Platz ${p.place}`, value: p.value }));
      if (payload.prize_places.length === 0) payload.prize_places = null;
      const { data } = await api.post("/f1/challenges", payload);
      toast.success("Challenge erstellt.");
      nav(`/admin/f1/${data.id}`);
    } catch (err) { toast.error(formatRequestError(err, "Challenge konnte nicht erstellt werden.", { slug: form.slug, title: form.title })); }
    setSaving(false);
  };

  const autoSlug = (t) => (t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);

  return (
    <AdminLayout>
      <AdminFormPage
        eyebrow="Fast Lap"
        title="Neue Challenge"
        intro="Titel und Slug genügen zum Anlegen. Zeiten, Wertung und Preise lassen sich danach jederzeit anpassen — die Challenge startet als Entwurf."
        backTo="/admin/f1"
        backLabel="Fast Lap"
        onSubmit={submit}
        testId="f1-new-form"
        aside={(
          <>
            <FormSection title="Veröffentlichung und Zeitplan" hint="Live und Beendet werden anhand von Start/Ende automatisch geschaltet.">
              {events.length > 0 && (
                <SelectField
                  label="Zugehöriges Event"
                  value={form.event_id || ""}
                  onChange={(v) => set("event_id", v)}
                  options={[["", "— kein Event —"], ...events.map((e) => [e.id, e.name])]}
                  testId="f1-new-event"
                />
              )}
              <SelectField label="Sichtbarkeit" value={form.visibility} onChange={(v) => set("visibility", v)} options={VISIBILITY_OPTIONS} testId="f1-new-visibility" />
              <SelectField label="Veröffentlichung" value={form.status} onChange={(v) => set("status", v)} options={CREATE_STATUS_OPTIONS} testId="f1-new-status" />
              <TextField label="Start Challenge/Event" type="datetime-local" value={form.start_date} onChange={(v) => set("start_date", v)} testId="f1-new-start" />
              <TextField label="Ende Challenge/Event" type="datetime-local" value={form.end_date} onChange={(v) => set("end_date", v)} testId="f1-new-end" />
              <CheckField label="Online-Einreichung auf der öffentlichen Seite anzeigen" hint="Optional - lokale Zeiten können Moderatoren immer im Admin eintragen." checked={form.registration_enabled} onChange={(v) => set("registration_enabled", v)} testId="f1-new-reg-enabled" />
              {form.registration_enabled && <TextField label="Online-Einreichung öffnet" type="datetime-local" value={form.registration_open_from} onChange={(v) => set("registration_open_from", v)} testId="f1-new-reg-from" />}
              {form.registration_enabled && <TextField label="Online-Einreichung endet" type="datetime-local" value={form.registration_open_until} onChange={(v) => set("registration_open_until", v)} testId="f1-new-reg-until" />}
              <CheckField label="Automatisches Fast-Lap-Hinweisbanner für diese Challenge anzeigen" checked={form.site_banner_enabled} onChange={(v) => set("site_banner_enabled", v)} testId="f1-new-site-banner" accent="#FFD700" />
            </FormSection>

            <FormSection title="Teilnahme und Vereins-Referenzzeiten" accent="#FFD700" hint="Für Challenges, die wir für externe Teilnehmer veranstalten: Vereinsmitglieder können dann nicht in die offizielle Wertung, aber optional Referenzzeiten außer Wertung setzen.">
              <CheckField
                label="Vereinsmitglieder aus offizieller Wertung ausschließen"
                hint="Wie bei externen Turnieren: Sie können nicht offiziell mitmachen."
                checked={form.block_club_member_results}
                onChange={(checked) => setForm((f) => ({ ...f, block_club_member_results: checked, allow_club_reference_times: checked ? true : f.allow_club_reference_times }))}
                testId="f1-new-club-reference-only"
              />
              <CheckField
                label="Vereins-Referenzzeiten erlauben"
                hint="Separater Bereich ohne Punkte, ohne Jahreswertung und ohne Achievements."
                checked={form.allow_club_reference_times}
                disabled={form.block_club_member_results}
                onChange={(v) => set("allow_club_reference_times", v)}
                testId="f1-new-allow-club-reference"
              />
              <CheckField
                label="Referenzzeiten öffentlich anzeigen"
                hint="Zeigt die Top 3 Referenzzeiten öffentlich als Zielzeit zum Schlagen."
                checked={form.show_club_reference_times}
                disabled={!form.allow_club_reference_times}
                onChange={(v) => set("show_club_reference_times", v)}
                testId="f1-new-show-club-reference"
              />
            </FormSection>

            <FastLapSeasonWeightField value={form.season_weight} onChange={(v) => set("season_weight", v)} />
          </>
        )}
        actions={<FormActions submitLabel="Challenge erstellen" savingLabel="Erstelle …" saving={saving} submitTestId="f1-new-submit" cancelTo="/admin/f1" icon={null} />}
      >
        <FormSection title="Die Challenge">
          <FormGrid>
            <TextField label="Titel" value={form.title} onChange={(v) => { set("title", v); if (!form.slug) set("slug", autoSlug(v)); }} required testId="f1-new-title" />
            <TextField label="Slug (URL)" value={form.slug} onChange={(v) => set("slug", autoSlug(v))} required testId="f1-new-slug" />
          </FormGrid>
          <FieldLabel label="Beschreibung">
            <MarkdownEditor value={form.description || ""} onChange={(v) => set("description", v)} rows={5} testId="f1-new-description" />
          </FieldLabel>
          <ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} label="Challenge-Banner" testId="f1-new-banner-upload" variant="wide" allowLibrary />
        </FormSection>

        <FormSection title="Strecke und Regeln" hint="Was die Teilnehmer wissen müssen, um vergleichbare Zeiten zu fahren.">
          <FormGrid cols={3}>
            <TextField label="Fahrzeug" value={form.vehicle} onChange={(v) => set("vehicle", v)} testId="f1-new-vehicle" />
            <TextField label="Wetter" value={form.weather} onChange={(v) => set("weather", v)} testId="f1-new-weather" />
            <TextField label="Fahrhilfen" value={form.assists_allowed} onChange={(v) => set("assists_allowed", v)} testId="f1-new-assists" />
            <TextField label="Controller-Typ" value={form.controller_type} onChange={(v) => set("controller_type", v)} testId="f1-new-controller" />
            <TextField label="Plattform" value={form.platform} onChange={(v) => set("platform", v)} testId="f1-new-platform" />
          </FormGrid>
          <CheckField label="Championship (mehrere Strecken + Punkte pro Platz)" checked={form.is_championship} onChange={(v) => set("is_championship", v)} testId="f1-new-championship" />
          <CheckField label="Unbegrenzte Versuche" checked={form.unlimited_attempts} onChange={(v) => set("unlimited_attempts", v)} testId="f1-new-unlimited" />
          {!form.unlimited_attempts && <TextField label="Max Versuche" type="number" value={form.max_attempts} onChange={(v) => set("max_attempts", Number(v))} testId="f1-new-max-attempts" className="md:max-w-xs" />}
        </FormSection>

        <FormSection title="Preise (strukturiert)" accent="#FFD700" hint="Wird bei Ergebnisveröffentlichung als Gewinnabholung angelegt.">
          <div className="flex justify-end">
            <button type="button" onClick={() => set("prize_places", [...(form.prize_places || []), { place: (form.prize_places?.length || 0) + 1, label: "", value: "" }])} data-testid="f1-new-prize-add" className="text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">+ Platz hinzufügen</button>
          </div>
          {(form.prize_places || []).map((p, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input type="number" min="1" value={p.place} onChange={(e) => updatePrize(i, { place: Number(e.target.value) || 1 })} data-testid={`f1-new-prize-place-${i}`} className="col-span-2 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm tabular-nums" placeholder="#" />
              <input value={p.label || ""} onChange={(e) => updatePrize(i, { label: e.target.value })} data-testid={`f1-new-prize-label-${i}`} className="col-span-4 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Label" />
              <input value={p.value || ""} onChange={(e) => updatePrize(i, { value: e.target.value })} data-testid={`f1-new-prize-value-${i}`} className="col-span-5 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Preis" />
              <button type="button" onClick={() => set("prize_places", form.prize_places.filter((_, j) => j !== i))} data-testid={`f1-new-prize-remove-${i}`} className="col-span-1 text-white/40 hover:text-[#FF3B30] text-center py-2">✕</button>
            </div>
          ))}
          {(form.prize_places || []).length === 0 && <div className="text-xs text-white/40">Noch keine Preise - „Platz hinzufügen“ legt die erste Zeile an.</div>}
        </FormSection>

        <FormSection title="Streaming" accent="#9146FF">
          <TextField label="Twitch Channel" value={form.twitch_channel} onChange={(v) => set("twitch_channel", v)} testId="f1-new-twitch" className="md:max-w-md" />
          <CheckField label="Twitch-Player auf F1-Seite einbetten" checked={form.twitch_enabled} onChange={(v) => set("twitch_enabled", v)} testId="f1-new-twitch-enabled" accent="#9146FF" />
        </FormSection>
      </AdminFormPage>
    </AdminLayout>
  );
}

function FastLapSeasonWeightField({ value, onChange }) {
  const normalized = String(value ?? "1");
  const isPreset = F1_SEASON_WEIGHT_OPTIONS.some(([optionValue]) => optionValue === normalized);
  return (
    <label className="block border border-[#29B6E8]/20 bg-[#29B6E8]/5 rounded-sm p-4">
      <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8] mb-1.5">Jahreswertung</div>
      <div className="grid sm:grid-cols-[1fr_120px] gap-2">
        <select value={isPreset ? normalized : "__custom"} onChange={(e) => onChange(e.target.value === "__custom" ? value : e.target.value)} className={INPUT_CLASS}>
          {F1_SEASON_WEIGHT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          <option value="__custom">Eigener Faktor</option>
        </select>
        <input type="number" step="0.05" min="0" value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={INPUT_CLASS} aria-label="Jahreswertungs-Faktor" />
      </div>
      <div className="text-[11px] text-white/45 mt-1.5">
        Bestimmt, wie stark diese Fast-Lap Challenge in die Jahreswertung eingeht. 0 bedeutet: keine Jahrespunkte.
      </div>
    </label>
  );
}
