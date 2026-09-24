import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminFormPage, FormActions, FormGrid, FormSection } from "@/components/tls/AdminForm";
import { PartnerPicker } from "@/components/tls/PartnerPicker";
import { CheckField, FieldLabel, SelectField, TextField } from "@/components/tls/FormFields";
import { DiscordPreview } from "@/components/tls/DiscordPreview";
import { SharePreviewToggle } from "@/components/tls/SharePreviewToggle";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { AccessLinksPanel } from "@/components/tls/AccessLinksPanel";
import { EventBillingSection } from "@/components/tls/EventBillingSection";
import { EventLocationsSection, formToLocations, locationsFormError, locationsToForm } from "@/components/tls/EventLocationsSection";
import { SkeletonDetailHeader, SkeletonLines } from "@/components/tls/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { billingFormError, formToBilling, positionsToForm } from "@/lib/pricing";
import { appendEmbedToken } from "@/components/tls/RichContent";
import { normalizeDateTimeFields, toDateTimeLocalInput } from "@/lib/datetime";
import { buildDirtyPayload, hasPayloadChanges } from "@/lib/dirtyPayload";
import { toast } from "sonner";
import { Flag, Trophy } from "lucide-react";

const ACCENT = "#9F7AEA";
const CREATE_STATUS_OPTIONS = [
  ["draft", "Entwurf"],
  ["scheduled", "Angekündigt"],
];
const STREAM_PLATFORM_OPTIONS = [["", "Plattform —"], ["twitch", "Twitch"], ["youtube", "YouTube"], ["kick", "Kick"], ["custom", "Eigenes Format"]];

// Event anlegen und bearbeiten als eigene Seite (#434) - vorher ein Fenster über der Liste, das
// am PC 768 px breit war und am Handy kaum bedienbar. Links das Event, Ort, Anmeldung, Programm,
// Stream und Darstellung; rechts Veröffentlichung, Zeiten, Discord- und Teilen-Vorschau.
export default function AdminEventEditPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [event, setEvent] = useState(isNew ? {} : null);
  const [missing, setMissing] = useState(false);
  const [meta, setMeta] = useState({ types: [], statuses: [], visibilities: [] });
  const [sponsors, setSponsors] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [f1Challenges, setF1Challenges] = useState([]);
  const [partners, setPartners] = useState([]);

  useEffect(() => {
    api.get("/events/meta").then(({ data }) => setMeta(data)).catch(() => {});
    Promise.allSettled([
      api.get("/sponsors/admin"),
      api.get("/tournaments?include_drafts=true"),
      api.get("/f1/challenges?include_drafts=true"),
      api.get("/partners"),
    ]).then(([s, t, f, p]) => {
      if (s.status === "fulfilled") setSponsors(s.value.data || []);
      if (t.status === "fulfilled") setTournaments(t.value.data || []);
      if (f.status === "fulfilled") setF1Challenges(f.value.data || []);
      if (p.status === "fulfilled") setPartners(Array.isArray(p.value.data) ? p.value.data : []);
    });
  }, []);

  useEffect(() => {
    if (isNew) {
      setEvent({});
      setMissing(false);
      return undefined;
    }
    let cancelled = false;
    setEvent(null);
    setMissing(false);
    // Dieselben Daten wie die Liste - so ist das Formular mit dem Stand in der Übersicht identisch.
    api.get("/events?include_drafts=true").then(({ data }) => {
      if (cancelled) return;
      const found = (data || []).find((item) => item.id === id);
      if (found) setEvent(found);
      else setMissing(true);
    }).catch(() => { if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, [id, isNew]);

  if (missing) {
    return (
      <AdminLayout>
        <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50" data-testid="event-missing">
          <div className="font-heading font-bold text-white">Event nicht gefunden</div>
          <p className="mt-2 text-sm">Vielleicht wurde es gelöscht. <Link to="/admin/events" className="text-[#9F7AEA] hover:underline">Zurück zur Liste</Link></p>
        </div>
      </AdminLayout>
    );
  }
  if (!event) {
    return (
      <AdminLayout>
        <div className="max-w-3xl"><SkeletonDetailHeader label="Lade Event" /><SkeletonLines lines={8} className="mt-8" label="Lade Event" /></div>
      </AdminLayout>
    );
  }
  return (
    <AdminLayout>
      <EventForm key={event.id || "new"} event={event} meta={meta} sponsors={sponsors} tournaments={tournaments} f1Challenges={f1Challenges} partners={partners} onDone={() => navigate("/admin/events")} />
    </AdminLayout>
  );
}

function EventForm({ event, meta, sponsors = [], tournaments = [], f1Challenges = [], partners = [], onDone }) {
  const isNew = !event?.id;
  // Kosten und Abrechnung (#315, #322): eigener Zustand, nur für den Bereich Finanzen sichtbar
  // und nur dann Teil des Speicherns - der Server lehnt es sonst mit 403 ab.
  const { can } = useAuth();
  const canFinance = can("finance");
  const [billingForm, setBillingForm] = useState(() => ({
    enabled: Boolean(event?.billing?.enabled),
    positions: positionsToForm(event?.billing),
    invoice_timing: event?.billing?.invoice_timing || "on_confirm",
  }));
  const billingDirty = JSON.stringify(billingForm) !== JSON.stringify({
    enabled: Boolean(event?.billing?.enabled), positions: positionsToForm(event?.billing), invoice_timing: event?.billing?.invoice_timing || "on_confirm",
  });
  // Standorte (#203): eigener Zustand; die Liste wird nur gesendet, wenn sie sich geändert hat.
  // Bei mehreren Standorten sind die Ortsfelder ausgeblendet - der Server spiegelt den ersten hinein.
  const [locationsForm, setLocationsForm] = useState(() => locationsToForm(event?.locations));
  const locationsDirty = JSON.stringify(locationsForm) !== JSON.stringify(locationsToForm(event?.locations));
  const usesLocationList = locationsForm.length > 0;
  const slugFrom = (txt) => (txt || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const formFromEvent = (source, forNew) => ({
    name: source.name || "",
    slug: source.slug || "",
    description: source.description || "",
    event_type: source.event_type || "general",
    visibility: source.visibility || "public",
    discord_skip: source.discord_skip ?? false,
    share_preview: source.share_preview ?? false,
    start_date: toDateTimeLocalInput(source.start_date),
    end_date: toDateTimeLocalInput(source.end_date),
    door_time: toDateTimeLocalInput(source.door_time),
    registration_opens_at: toDateTimeLocalInput(source.registration_opens_at),
    registration_closes_at: toDateTimeLocalInput(source.registration_closes_at),
    has_registration: source.has_registration ?? false,
    registration_url: source.registration_url || "",
    allow_companions: source.allow_companions ?? false,
    max_companions_per_registration: source.max_companions_per_registration ?? 0,
    location: source.location || "",
    address: source.address || "",
    postal_code: source.postal_code || "",
    city: source.city || "",
    country: source.country || "Österreich",
    show_map: source.show_map ?? true,
    organizer_name: source.organizer_name || (forNew ? "THE LION SQUAD - eSports" : ""),
    organizer_url: source.organizer_url || "",
    owned_by_club: source.owned_by_club ?? true,
    show_sponsors: source.show_sponsors ?? true,
    sponsor_ids: source.sponsor_ids || [],
    partner_ids: source.partner_ids || [],
    is_online: source.is_online ?? false,
    is_hybrid: source.is_hybrid ?? false,
    banner_url: source.banner_url || "",
    contact: source.contact || "",
    max_participants: source.max_participants || "",
    show_participants: source.show_participants ?? true,
    program: source.program || "",
    has_live_stream: source.has_live_stream ?? false,
    stream_platform: source.stream_platform || "",
    stream_url: source.stream_url || "",
    status: source.status || "draft",
  });
  const [form, setForm] = useState(() => formFromEvent(event, isNew));
  const [saving, setSaving] = useState(false);
  const [relatedTournamentIds, setRelatedTournamentIds] = useState([]);
  const [relatedF1Ids, setRelatedF1Ids] = useState([]);
  const eventTypes = (meta.types || []).filter((t) => !meta.primary_types || meta.primary_types.includes(t.k) || t.k === form.event_type);

  useEffect(() => {
    if (!event?.id) {
      setRelatedTournamentIds([]);
      setRelatedF1Ids([]);
      return;
    }
    setRelatedTournamentIds(tournaments.filter((t) => t.event_id === event.id).map((t) => t.id));
    setRelatedF1Ids(f1Challenges.filter((c) => c.event_id === event.id).map((c) => c.id));
  }, [event?.id, tournaments, f1Challenges]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const eventSponsorOptions = sponsors.filter((s) => s.is_active !== false && s.show_on_events === true);
  const insertProgramEmbed = (kind, item) => {
    setForm((f) => ({ ...f, program: appendEmbedToken(f.program, kind, item) }));
    if (kind === "tournament" && !relatedTournamentIds.includes(item.id)) setRelatedTournamentIds((ids) => [...ids, item.id]);
    if (kind === "fastlap" && !relatedF1Ids.includes(item.id)) setRelatedF1Ids((ids) => [...ids, item.id]);
  };

  const normalizeEventPayload = (source) => {
    const payload = { ...source };
    Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
    normalizeDateTimeFields(payload, ["start_date", "end_date", "door_time", "registration_opens_at", "registration_closes_at"]);
    if (payload.max_participants) payload.max_participants = parseInt(payload.max_participants);
    if (payload.allow_companions) payload.max_companions_per_registration = parseInt(payload.max_companions_per_registration || 1);
    else payload.max_companions_per_registration = 0;
    payload.sponsor_ids = payload.owned_by_club && payload.show_sponsors ? (payload.sponsor_ids || []) : [];
    return payload;
  };

  const originalEventPayload = () => normalizeEventPayload(formFromEvent(event, false));

  const syncRelatedItems = async (eventId) => {
    const jobs = [];
    tournaments.forEach((t) => {
      const selected = relatedTournamentIds.includes(t.id);
      if (selected && t.event_id !== eventId) jobs.push(api.patch(`/tournaments/${t.id}`, { event_id: eventId }));
      if (!selected && t.event_id === eventId) jobs.push(api.patch(`/tournaments/${t.id}`, { event_id: null }));
    });
    f1Challenges.forEach((c) => {
      const selected = relatedF1Ids.includes(c.id);
      if (selected && c.event_id !== eventId) jobs.push(api.patch(`/f1/challenges/${c.id}`, { event_id: eventId }));
      if (!selected && c.event_id === eventId) jobs.push(api.patch(`/f1/challenges/${c.id}`, { event_id: null }));
    });
    if (jobs.length) await Promise.all(jobs);
  };

  const submit = async (ev) => {
    ev.preventDefault();
    const billingProblem = canFinance && billingDirty ? billingFormError(billingForm) : "";
    if (billingProblem) {
      toast.error(billingProblem);
      return;
    }
    const locationsProblem = locationsDirty ? locationsFormError(locationsForm) : "";
    if (locationsProblem) {
      toast.error(locationsProblem);
      return;
    }
    setSaving(true);
    try {
      const payload = normalizeEventPayload(form);
      if (canFinance && billingDirty) payload.billing = formToBilling(billingForm);
      if (locationsDirty) payload.locations = formToLocations(locationsForm);
      let savedEvent;
      if (isNew) {
        const { data } = await api.post("/events", payload);
        savedEvent = data;
      } else {
        const patch = buildDirtyPayload(payload, originalEventPayload());
        if (canFinance && billingDirty) patch.billing = formToBilling(billingForm);
        if (locationsDirty) patch.locations = formToLocations(locationsForm);
        const relatedChanged = tournaments.some((t) => relatedTournamentIds.includes(t.id) !== (t.event_id === event.id))
          || f1Challenges.some((c) => relatedF1Ids.includes(c.id) !== (c.event_id === event.id));
        if (!hasPayloadChanges(patch) && !relatedChanged) {
          toast.info("Keine Änderungen zum Speichern.");
          setSaving(false);
          return;
        }
        if (hasPayloadChanges(patch)) {
          const { data } = await api.patch(`/events/${event.id}`, patch);
          savedEvent = data;
        } else {
          savedEvent = event;
        }
      }
      await syncRelatedItems(savedEvent.id);
      toast.success("Gespeichert.");
      onDone();
    } catch (err) {
      toast.error(formatRequestError(err, "Event konnte nicht gespeichert werden.", { slug: form.slug, name: form.name }));
    }
    setSaving(false);
  };

  return (
    <AdminFormPage
      eyebrow="Events"
      accent={ACCENT}
      title={isNew ? "Neues Event" : "Event bearbeiten"}
      intro={isNew ? "Name und Slug genügen zum Anlegen — das Event startet als Entwurf und ist noch nicht öffentlich." : event.name}
      backTo="/admin/events"
      backLabel="Events"
      onSubmit={submit}
      testId="event-form"
      aside={(
        <>
          <FormSection title="Veröffentlichung" accent={ACCENT} hint="Für neue Inhalte reicht normalerweise Entwurf oder Angekündigt. Anmeldung, Live und Beendet werden über die Datumsfelder automatisch berechnet.">
            <SelectField label="Typ" value={form.event_type} onChange={(v) => set("event_type", v)} options={eventTypes} testId="event-type" />
            <SelectField label="Sichtbarkeit" value={form.visibility} onChange={(v) => set("visibility", v)} options={meta.visibilities || []} testId="event-visibility" />
            <SelectField label={isNew ? "Veröffentlichung" : "Status"} value={form.status} onChange={(v) => set("status", v)} options={isNew ? CREATE_STATUS_OPTIONS : (meta.statuses || [])} testId="event-status" />
          </FormSection>
          <FormSection title="Zeiten und Plätze" accent={ACCENT}>
            <TextField label="Start" type="datetime-local" value={form.start_date} onChange={(v) => set("start_date", v)} testId="event-start" />
            <TextField label="Ende" type="datetime-local" value={form.end_date} onChange={(v) => set("end_date", v)} testId="event-end" />
            <TextField label="Einlass / Türöffnung" type="datetime-local" value={form.door_time} onChange={(v) => set("door_time", v)} testId="event-door-time" />
            <TextField label="Max. Teilnehmer" type="number" value={form.max_participants} onChange={(v) => set("max_participants", v)} testId="event-max-participants" />
          </FormSection>
          <DiscordPreview kind="event" item={form} skip={form.discord_skip} onSkipChange={(value) => set("discord_skip", value)} />
          <SharePreviewToggle visibility={form.visibility} checked={form.share_preview} onChange={(value) => set("share_preview", value)} />
          {!isNew && (
            <AccessLinksPanel targetType="event" targetId={event.id} allowRegister={form.has_registration} />
          )}
        </>
      )}
      actions={<FormActions accent={ACCENT} saving={saving} submitTestId="event-save" cancelTo="/admin/events" />}
    >
      <FormSection title="Das Event" accent={ACCENT}>
        <FormGrid>
          <TextField label="Name" value={form.name} onChange={(v) => { set("name", v); if (isNew && !form.slug) set("slug", slugFrom(v)); }} testId="event-name" required />
          <TextField label="Slug" value={form.slug} onChange={(v) => set("slug", slugFrom(v))} testId="event-slug" required />
        </FormGrid>
        <FieldLabel label="Beschreibung">
          <MarkdownEditor value={form.description} onChange={(v) => set("description", v)} rows={5} testId="event-description" />
        </FieldLabel>
        <FieldLabel label="Banner-Bild">
          <ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} testId="event-banner" variant="wide" allowLibrary />
        </FieldLabel>
      </FormSection>

      <FormSection title="Ort und Veranstalter" accent={ACCENT}>
        <EventLocationsSection value={locationsForm} onChange={setLocationsForm} />
        {/* „Ort“ hieß bisher zweideutig; es ist der Name des Veranstaltungsorts. Die Karte sucht die Adresse (#204). */}
        {!usesLocationList && (
          <FormGrid>
            <TextField label="Veranstaltungsort (Name, optional)" value={form.location} onChange={(v) => set("location", v)} placeholder="Vereinsheim, Gemeindesaal Telfs" testId="event-location-name" />
            <TextField label="Adresse" value={form.address} onChange={(v) => set("address", v)} placeholder="Maria-Theresien-Str. 1" />
          </FormGrid>
        )}
        {!usesLocationList && (
          <FormGrid cols={3}>
            <TextField label="PLZ" value={form.postal_code} onChange={(v) => set("postal_code", v)} placeholder="6020" />
            <TextField label="Stadt" value={form.city} onChange={(v) => set("city", v)} placeholder="Innsbruck" />
            <TextField label="Land" value={form.country} onChange={(v) => set("country", v)} placeholder="Österreich" />
          </FormGrid>
        )}
        <FormGrid cols={3}>
          <TextField label="Veranstalter" value={form.organizer_name} onChange={(v) => set("organizer_name", v)} placeholder="THE LION SQUAD oder extern" />
          <TextField label="Veranstalter-Link" value={form.organizer_url} onChange={(v) => set("organizer_url", v)} placeholder="https://…" />
          <TextField label="Kontakt" value={form.contact} onChange={(v) => set("contact", v)} placeholder="Name oder E-Mail" />
        </FormGrid>
        <CheckField label="Karte anzeigen" checked={form.show_map} onChange={(v) => set("show_map", v)} accent={ACCENT} />
      </FormSection>

      <FormSection title="Anmeldung" accent={ACCENT}>
        <CheckField label="Registrierung/Anmeldung für dieses Event anzeigen" checked={form.has_registration} onChange={(v) => set("has_registration", v)} accent={ACCENT} testId="event-has-registration" />
        {form.has_registration && (
          <FormGrid>
            <TextField label="Anmeldung öffnet" type="datetime-local" value={form.registration_opens_at} onChange={(v) => set("registration_opens_at", v)} />
            <TextField label="Anmeldung schließt" type="datetime-local" value={form.registration_closes_at} onChange={(v) => set("registration_closes_at", v)} />
            <TextField label="Externer Anmeldelink" value={form.registration_url} onChange={(v) => set("registration_url", v)} placeholder="https://…" />
            <div className="space-y-3 self-end">
              <CheckField label="Begleitpersonen erlauben" checked={form.allow_companions} onChange={(v) => set("allow_companions", v)} accent={ACCENT} />
              {form.allow_companions && (
                <TextField label="Max. Begleitpersonen pro Anmeldung" type="number" min="0" max="20" value={form.max_companions_per_registration} onChange={(v) => set("max_companions_per_registration", v)} />
              )}
            </div>
          </FormGrid>
        )}
        {form.has_registration && !form.registration_url && (
          <EventBillingSection value={billingForm} onChange={setBillingForm} canEdit={canFinance} dolibarrConnected={Boolean(meta?.dolibarr_connected)} />
        )}
      </FormSection>

      <FormSection title="Programm und eSports-Inhalte" accent={ACCENT}>
        <FieldLabel label="Programm / Tagesablauf">
          <MarkdownEditor
            value={form.program}
            onChange={(v) => set("program", v)}
            rows={8}
            testId="event-program"
            placeholder={"17:00 Einlass\n18:00 LAN-Setup\n19:30 Eröffnungsturnier"}
            helperText="Markdown plus Turnier-/Fast-Lap-Karten. HTML wird nicht roh gerendert."
          />
        </FieldLabel>
        {(tournaments.length > 0 || f1Challenges.length > 0) && (
          <div className="border border-white/10 p-3 rounded-sm bg-[#0A0A0A] space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-widest font-bold text-white/60">Verknüpfte eSports-Inhalte</div>
              <p className="mt-1 text-xs text-white/45">Diese Zuordnung erscheint direkt auf der Eventseite.</p>
            </div>
            {tournaments.length > 0 && (
              <RelationSelect
                icon={Trophy}
                label="Turniere"
                options={tournaments}
                selected={relatedTournamentIds}
                onChange={setRelatedTournamentIds}
                labelKey="title"
                accent="text-[#FFD700]"
                onEmbed={(item) => insertProgramEmbed("tournament", item)}
              />
            )}
            {f1Challenges.length > 0 && (
              <RelationSelect
                icon={Flag}
                label="Fast-Lap Challenges"
                options={f1Challenges}
                selected={relatedF1Ids}
                onChange={setRelatedF1Ids}
                labelKey="title"
                accent="text-[#29B6E8]"
                onEmbed={(item) => insertProgramEmbed("fastlap", item)}
              />
            )}
          </div>
        )}
      </FormSection>

      <FormSection title="Live-Stream (optional)" accent="#FF3B30">
        <CheckField label="Live Stream hinterlegt" checked={form.has_live_stream} onChange={(v) => set("has_live_stream", v)} accent="#FF3B30" />
        {form.has_live_stream && (
          <FormGrid>
            <SelectField label="Plattform" value={form.stream_platform || ""} onChange={(v) => set("stream_platform", v)} options={STREAM_PLATFORM_OPTIONS} />
            <TextField label="Stream URL / Channel" value={form.stream_url} onChange={(v) => set("stream_url", v)} placeholder="https://…" />
          </FormGrid>
        )}
      </FormSection>

      <FormSection title="Darstellung und Sponsoren" accent={ACCENT}>
        <FormGrid cols={3}>
          <CheckField label="Nur Online" checked={form.is_online} onChange={(v) => set("is_online", v)} accent={ACCENT} />
          <CheckField label="Hybrid (offline + online)" checked={form.is_hybrid} onChange={(v) => set("is_hybrid", v)} accent={ACCENT} />
          <CheckField label="Teilnehmer öffentlich anzeigen" checked={form.show_participants} onChange={(v) => set("show_participants", v)} accent={ACCENT} />
          <CheckField label="Event von uns" checked={form.owned_by_club} onChange={(v) => set("owned_by_club", v)} accent={ACCENT} />
          <CheckField label="Sponsoren beim Event anzeigen" checked={form.show_sponsors} onChange={(v) => set("show_sponsors", v)} disabled={!form.owned_by_club} accent={ACCENT} />
        </FormGrid>
        {form.owned_by_club && form.show_sponsors && eventSponsorOptions.length > 0 && (
          <div className="border border-white/10 p-3 rounded-sm bg-[#0A0A0A]">
            <div className="text-[11px] uppercase tracking-widest font-bold text-white/60 mb-3">Event-Sponsoren</div>
            <FormGrid cols={3}>
              {eventSponsorOptions.map((s) => (
                <CheckField
                  key={s.id}
                  label={s.name}
                  checked={(form.sponsor_ids || []).includes(s.id)}
                  onChange={(checked) => set("sponsor_ids", checked ? [...(form.sponsor_ids || []), s.id] : (form.sponsor_ids || []).filter((id) => id !== s.id))}
                  accent="#FFD700"
                />
              ))}
            </FormGrid>
            <p className="mt-2 text-[11px] text-white/40">Hier erscheinen nur Sponsoren mit aktivem Events-Haken. Leer lassen = alle Event-Sponsoren ohne Event-Einschränkung.</p>
          </div>
        )}
        <PartnerPicker partners={partners} value={form.partner_ids} onChange={(v) => set("partner_ids", v)} testPrefix="event-partner" hint="Das Event erscheint auf der Partnerseite unter „Gemeinsam“, und die Eventseite nennt den Partner." />
      </FormSection>
    </AdminFormPage>
  );
}

function RelationSelect({ icon: Icon, label, options, selected, onChange, labelKey, accent, onEmbed }) {
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest font-bold text-white/50 mb-2">{label}</div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2 max-h-40 overflow-y-auto pr-1">
        {options.map((item) => (
          <div key={item.id} className="flex items-center gap-2 text-sm text-white/75 border border-white/5 hover:border-white/15 rounded-sm px-2 py-2">
            <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
              <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} className="accent-[#9F7AEA]" />
              <Icon className={`w-3.5 h-3.5 ${accent} shrink-0`} />
              <span className="truncate">{item[labelKey] || item.name}</span>
            </label>
            {onEmbed && (
              <button type="button" onClick={() => onEmbed(item)} className="shrink-0 text-[10px] uppercase tracking-wider font-bold text-[#29B6E8] hover:text-white">
                Ins Programm
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
