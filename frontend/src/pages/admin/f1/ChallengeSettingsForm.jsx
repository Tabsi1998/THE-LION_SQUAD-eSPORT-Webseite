// Fast Lap (#223): das Formular der Challenge mit Preisen und Wertungsgewicht.
import { useEffect, useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { FormActions, FormColumns, FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, FieldLabel, SelectField, TextField } from "@/components/tls/FormFields";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { normalizeDateTimeFields, toDateTimeLocalInput } from "@/lib/datetime";
import { buildDirtyPayload, hasPayloadChanges } from "@/lib/dirtyPayload";
import { toast } from "sonner";

const F1_SEASON_WEIGHT_OPTIONS = [
  ["1", "Fast Lap Standard (x1.00)"],
  ["0.75", "Fun-Challenge (x0.75)"],
  ["0.5", "Event/Check-in Wertung (x0.50)"],
  ["1.25", "Mini-Wertung (x1.25)"],
  ["2", "Normal-Turnier nah (x2.00)"],
  ["0", "Keine Jahreswertung (x0.00)"],
];

export function ChallengeSettingsForm({ challenge, onSaved }) {
  const dt = toDateTimeLocalInput;
  const formFromChallenge = (source = challenge) => ({
    title: source.title || "",
    description: source.description || "",
    banner_url: source.banner_url || "",
    event_id: source.event_id || "",
    visibility: source.visibility || "public",
    vehicle: source.vehicle || "",
    weather: source.weather || "",
    assists_allowed: source.assists_allowed || "",
    controller_type: source.controller_type || "",
    platform: source.platform || "",
    registration_enabled: source.online_registration_enabled === true && source.registration_enabled === true,
    registration_open_from: dt(source.registration_open_from),
    registration_open_until: dt(source.registration_open_until),
    start_date: dt(source.start_date),
    end_date: dt(source.end_date),
    block_club_member_results: !!source.block_club_member_results,
    allow_club_reference_times: source.allow_club_reference_times !== false,
    show_club_reference_times: source.show_club_reference_times !== false,
    unlimited_attempts: source.unlimited_attempts !== false,
    max_attempts: source.max_attempts || 0,
    site_banner_enabled: !!source.site_banner_enabled,
    season_weight: source.season_weight ?? 1,
    prize_places: source.prize_places || [],
  });
  const [form, setForm] = useState(formFromChallenge());
  const [events, setEvents] = useState([]);
  const [creatingPrizes, setCreatingPrizes] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get("/events?include_drafts=true").then(({ data }) => setEvents(data || [])).catch(() => {});
  }, []);

  const save = async () => {
    try {
      const normalizePayload = (source) => {
        const payload = { ...source };
        if (payload.block_club_member_results) payload.allow_club_reference_times = true;
        if (!payload.event_id) payload.event_id = null;
        if (payload.unlimited_attempts) payload.max_attempts = null;
        if (!payload.registration_enabled) {
          payload.registration_open_from = null;
          payload.registration_open_until = null;
        }
        payload.season_weight = Number(payload.season_weight || 0);
        payload.prize_places = (payload.prize_places || [])
          .filter((p) => p.value && p.value.trim())
          .map((p) => ({ place: Number(p.place) || 0, label: p.label || `Platz ${p.place}`, value: p.value }));
        if (payload.prize_places.length === 0) payload.prize_places = null;
        normalizeDateTimeFields(payload, ["registration_open_from", "registration_open_until", "start_date", "end_date"]);
        return payload;
      };
      const payload = normalizePayload(form);
      const patch = buildDirtyPayload(payload, normalizePayload(formFromChallenge()));
      if (!hasPayloadChanges(patch)) {
        toast.info("Keine Änderungen zum Speichern.");
        return;
      }
      await api.patch(`/f1/challenges/${challenge.id}`, patch);
      toast.success("Challenge gespeichert.");
      onSaved();
    } catch (e) { toast.error(formatRequestError(e, "Challenge konnte nicht gespeichert werden.", { title: form.title })); }
  };

  const createPrizePickups = async () => {
    setCreatingPrizes(true);
    try {
      const { data } = await api.post(`/prizes/auto-create/fastlap/${challenge.id}`);
      toast.success(`${data.created || 0} Fast-Lap-Gewinne angelegt.`);
    } catch (e) {
      toast.error(formatRequestError(e, "Fast-Lap-Gewinne konnten nicht angelegt werden."));
    } finally {
      setCreatingPrizes(false);
    }
  };
  // Einstellungen im Formular-Rahmen (#434): links Challenge, Strecke und Regeln, Preise; rechts
  // Veröffentlichung, Zeitplan, Teilnahme und Jahreswertung; unten die feststehende Speichern-Leiste.
  return (
    <div className="mb-6 min-w-0" data-testid="f1-edit-settings">
      <FormColumns
        aside={(
          <>
            <FormSection title="Veröffentlichung und Zeitplan" hint="Live und Beendet werden anhand von Start/Ende automatisch geschaltet.">
              {events.length > 0 && (
                <SelectField label="Zugehöriges Event" value={form.event_id || ""} onChange={(v) => set("event_id", v)} options={[["", "— kein Event —"], ...events.map((e) => [e.id, e.name])]} testId="f1-edit-event" />
              )}
              <SelectField label="Sichtbarkeit" value={form.visibility} onChange={(v) => set("visibility", v)} options={[["public", "Öffentlich"], ["community", "Nur registrierte Community"], ["members", "Nur Vereinsmitglieder"], ["internal", "Nur intern"]]} testId="f1-edit-visibility" />
              <TextField label="Start Challenge/Event" type="datetime-local" value={form.start_date} onChange={(v)=>set("start_date", v)} testId="f1-edit-start" />
              <TextField label="Ende Challenge/Event" type="datetime-local" value={form.end_date} onChange={(v)=>set("end_date", v)} testId="f1-edit-end" />
              <CheckField label="Online-Einreichung öffentlich anzeigen" checked={form.registration_enabled} onChange={(v)=>set("registration_enabled", v)} testId="f1-edit-reg-enabled" />
              {form.registration_enabled && <TextField label="Online-Einreichung öffnet" type="datetime-local" value={form.registration_open_from} onChange={(v)=>set("registration_open_from", v)} />}
              {form.registration_enabled && <TextField label="Online-Einreichung endet" type="datetime-local" value={form.registration_open_until} onChange={(v)=>set("registration_open_until", v)} />}
              <CheckField label="Automatisches Fast-Lap-Hinweisbanner anzeigen" checked={form.site_banner_enabled} onChange={(v)=>set("site_banner_enabled", v)} accent="#FFD700" />
            </FormSection>
            <FormSection title="Teilnahme und Vereins-Referenzzeiten" accent="#FFD700" hint="Für externe Fast-Lap-Challenges kann die Vereinswertung sauber von Referenzzeiten getrennt werden.">
              <CheckField
                label="Vereinsmitglieder aus offizieller Wertung ausschließen"
                hint="Sie erscheinen nicht in Rangliste, Jahrespunkten oder Achievements dieser Challenge."
                checked={form.block_club_member_results}
                onChange={(checked) => setForm((f) => ({ ...f, block_club_member_results: checked, allow_club_reference_times: checked ? true : f.allow_club_reference_times }))}
              />
              <CheckField
                label="Vereins-Referenzzeiten erlauben"
                hint="Separater Bereich außer Wertung als Motivation/Zielzeit."
                checked={form.allow_club_reference_times}
                disabled={form.block_club_member_results}
                onChange={(v)=>set("allow_club_reference_times", v)}
              />
              <CheckField
                label="Referenzzeiten öffentlich anzeigen"
                hint="Wenn aus, bleiben Referenzzeiten nur im Admin sichtbar."
                checked={form.show_club_reference_times}
                disabled={!form.allow_club_reference_times}
                onChange={(v)=>set("show_club_reference_times", v)}
              />
            </FormSection>
            <FastLapSeasonWeightField value={form.season_weight} onChange={(v)=>set("season_weight", v)} />
          </>
        )}
      >
        <FormSection title="Die Challenge">
          <FormGrid>
            <TextField label="Titel" value={form.title} onChange={(v)=>set("title", v)} testId="f1-edit-title" />
            <TextField label="Plattform" value={form.platform} onChange={(v)=>set("platform", v)} />
          </FormGrid>
          <FieldLabel label="Beschreibung">
            <MarkdownEditor value={form.description} onChange={(v)=>set("description", v)} rows={5} testId="f1-edit-description" placeholder="Beschreibung" />
          </FieldLabel>
          <ImageUpload value={form.banner_url} onChange={(v)=>set("banner_url", v)} label="Challenge-Banner" testId="f1-edit-banner-upload" variant="wide" allowLibrary />
        </FormSection>

        <FormSection title="Strecke und Regeln" hint="Was die Teilnehmer wissen müssen, um vergleichbare Zeiten zu fahren.">
          <FormGrid cols={4}>
            <TextField label="Fahrzeug" value={form.vehicle} onChange={(v)=>set("vehicle", v)} />
            <TextField label="Wetter" value={form.weather} onChange={(v)=>set("weather", v)} />
            <TextField label="Fahrhilfen" value={form.assists_allowed} onChange={(v)=>set("assists_allowed", v)} />
            <TextField label="Controller-Typ" value={form.controller_type} onChange={(v)=>set("controller_type", v)} />
          </FormGrid>
          <CheckField label="Unbegrenzte Versuche" checked={form.unlimited_attempts} onChange={(v)=>set("unlimited_attempts", v)} />
          {!form.unlimited_attempts && <TextField label="Max Versuche" type="number" value={form.max_attempts} onChange={(v)=>set("max_attempts", Number(v))} className="md:max-w-xs" />}
        </FormSection>

        <FastLapPrizeEditor value={form.prize_places} onChange={(v)=>set("prize_places", v)} />
        {challenge.status === "results_published" && (
          <div className="border border-[#FFD700]/25 bg-[#FFD700]/5 rounded-sm p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700]">Gewinnabholung</div>
              <div className="text-xs text-white/55 mt-0.5">Erzeugt fehlende Gewinn-Einträge aus der aktuellen Fast-Lap-Wertung.</div>
            </div>
            <button type="button" disabled={creatingPrizes} onClick={createPrizePickups} className="px-4 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-50">
              {creatingPrizes ? "Erzeuge..." : "Gewinne erzeugen"}
            </button>
          </div>
        )}
      </FormColumns>
      <FormActions onSubmitClick={save} submitTestId="f1-edit-save" icon={null} />
    </div>
  );
}

function FastLapPrizeEditor({ value, onChange }) {
  const prizes = value || [];
  const update = (index, patch) => {
    const next = [...prizes];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  return (
    <div className="border border-[#FFD700]/20 bg-[#FFD700]/5 rounded-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700]">Preise</div>
          <div className="text-xs text-white/50 mt-0.5">Wird bei Ergebnisveröffentlichung als Gewinnabholung angelegt.</div>
        </div>
        <button
          type="button"
          onClick={() => onChange([...prizes, { place: prizes.length + 1, label: "", value: "" }])}
          data-testid="f1-edit-prize-add"
          className="text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white"
        >
          + Platz hinzufügen
        </button>
      </div>
      {prizes.map((p, i) => (
        <div key={i} className="grid grid-cols-12 gap-2">
          <input
            type="number"
            min="1"
            value={p.place}
            onChange={(e) => update(i, { place: Number(e.target.value) || 1 })}
            data-testid={`f1-edit-prize-place-${i}`}
            className="col-span-2 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm tabular-nums"
            placeholder="#"
          />
          <input
            value={p.label || ""}
            onChange={(e) => update(i, { label: e.target.value })}
            data-testid={`f1-edit-prize-label-${i}`}
            className="col-span-4 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm"
            placeholder="Label"
          />
          <input
            value={p.value || ""}
            onChange={(e) => update(i, { value: e.target.value })}
            data-testid={`f1-edit-prize-value-${i}`}
            className="col-span-5 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm"
            placeholder="Preis"
          />
          <button
            type="button"
            onClick={() => onChange(prizes.filter((_, j) => j !== i))}
            data-testid={`f1-edit-prize-remove-${i}`}
            className="col-span-1 text-white/40 hover:text-[#FF3B30] text-center py-2"
          >
            x
          </button>
        </div>
      ))}
      {prizes.length === 0 && <div className="text-xs text-white/40">Noch keine Preise hinterlegt.</div>}
    </div>
  );
}

function FastLapSeasonWeightField({ value, onChange }) {
  const normalized = String(value ?? "1");
  const isPreset = F1_SEASON_WEIGHT_OPTIONS.some(([optionValue]) => optionValue === normalized);
  return (
    <label className="block border border-[#29B6E8]/20 bg-[#29B6E8]/5 rounded-sm p-3">
      <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8] mb-1.5">Jahreswertung</div>
      <div className="grid sm:grid-cols-[1fr_120px] gap-2">
        <select value={isPreset ? normalized : "__custom"} onChange={(e)=>onChange(e.target.value === "__custom" ? value : e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
          {F1_SEASON_WEIGHT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          <option value="__custom">Eigener Faktor</option>
        </select>
        <input type="number" step="0.05" min="0" value={value ?? ""} onChange={(e)=>onChange(e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" aria-label="Jahreswertungs-Faktor" />
      </div>
      <div className="text-[11px] text-white/45 mt-1.5">
        Bestimmt, wie stark diese Fast-Lap Challenge in die Jahreswertung eingeht. 0 bedeutet: keine Jahrespunkte.
      </div>
    </label>
  );
}
