import { useEffect, useState } from "react";
import { FeedbackReport } from "@/pages/admin/feedback/FeedbackReport";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminFormPage, FormActions, FormGrid, FormSection } from "@/components/tls/AdminForm";
import { PartnerPicker } from "@/components/tls/PartnerPicker";
import { CheckField, FieldLabel, SelectField, TextField } from "@/components/tls/FormFields";
import { DiscordPreview } from "@/components/tls/DiscordPreview";
import { DistributeBox } from "@/components/tls/DistributeBox";
import { SharePreviewToggle } from "@/components/tls/SharePreviewToggle";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { AccessLinksPanel } from "@/components/tls/AccessLinksPanel";
import { EventBillingSection } from "@/components/tls/EventBillingSection";
import { EventLocationsSection, formToLocations, locationsFormError, locationsToForm } from "@/components/tls/EventLocationsSection";
import { EventDaysSection, daysFormError, daysToForm, formToDays } from "@/components/tls/EventDaysSection";
import { EventBannerFields, EventFactsSection, bringToText, formToHighlights, highlightsToForm, textToBring } from "@/components/tls/EventFactsSection";
import { descriptionEchoesTitle } from "@/lib/eventPage";
import { SkeletonDetailHeader, SkeletonLines } from "@/components/tls/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { billingFormError, formToBilling, positionsToForm } from "@/lib/pricing";
import { appendEmbedToken } from "@/components/tls/RichContent";
import { normalizeDateTimeFields, toDateTimeLocalInput } from "@/lib/datetime";
import { buildDirtyPayload, hasPayloadChanges } from "@/lib/dirtyPayload";
import { EventProgramPanel, useEventProgram } from "@/pages/admin/event/EventProgramPanel";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { affectedRegistrations, cancelConfirmText, savedEventMessage, touchesScheduleOrPlace } from "@/lib/eventAdmin";
import { toast } from "sonner";

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
  const [partners, setPartners] = useState([]);

  useEffect(() => {
    api.get("/events/meta").then(({ data }) => setMeta(data)).catch(() => {});
    // Turniere, Fast Laps und Sponsoren kommen seit #1371 aus dem Programm des Events (useEventProgram).
    api.get("/partners").then(({ data }) => setPartners(Array.isArray(data) ? data : [])).catch(() => {});
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
      <EventForm key={event.id || "new"} event={event} meta={meta} partners={partners} onDone={() => navigate("/admin/events")} />
    </AdminLayout>
  );
}

function EventForm({ event, meta, partners = [], onDone }) {
  const isNew = !event?.id;
  // Programm (#1371): Turniere und Fast Laps des Events, Vorbelegung und die Sponsoren, die beim Event erscheinen.
  const { program, failed: programFailed, reload: reloadProgram } = useEventProgram(event?.id);
  // Eine alte eigene Sponsoren-Auswahl am Event gilt, bis sie hier aufgehoben wird (#1371).
  const [clearOwnSponsors, setClearOwnSponsors] = useState(false);
  // Kosten und Abrechnung (#315, #322): eigener Zustand, nur für den Bereich Finanzen sichtbar
  // und nur dann Teil des Speicherns - der Server lehnt es sonst mit 403 ab.
  const { can } = useAuth();
  const canFinance = can("finance");
  const confirm = useConfirm();
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
  // Mehrtägig (#884): die Tage ersetzen Start, Ende und Einlass; die Liste geht nur mit, wenn sie sich geändert hat.
  const [daysForm, setDaysForm] = useState(() => daysToForm(event?.days));
  const daysDirty = JSON.stringify(daysForm) !== JSON.stringify(daysToForm(event?.days));
  const usesDays = daysForm.length > 0;
  // Highlights (#1346): eigene Liste; sie geht nur mit, wenn sie sich geändert hat.
  const [highlightsForm, setHighlightsForm] = useState(() => highlightsToForm(event?.highlights));
  const highlightsDirty = JSON.stringify(formToHighlights(highlightsForm)) !== JSON.stringify(formToHighlights(highlightsToForm(event?.highlights)));
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
    discord_registration: source.discord_registration !== false,
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
    partner_ids: source.partner_ids || [],
    is_online: source.is_online ?? false,
    is_hybrid: source.is_hybrid ?? false,
    banner_url: source.banner_url || "",
    // Kopfbild (#1273) und „Mitbringen“ (#1346).
    banner_style: source.banner_style || "auto",
    banner_focus_x: source.banner_focus_x ?? 50,
    banner_focus_y: source.banner_focus_y ?? 50,
    bring_along_text: bringToText(source.bring_along),
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
  const eventTypes = (meta.types || []).filter((t) => !meta.primary_types || meta.primary_types.includes(t.k) || t.k === form.event_type);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // Zurück auf einen Tag: Start und Ende aus dem ersten und letzten Tag übernehmen, damit nichts leer steht.
  const changeDays = (next) => {
    if (!next.length && daysForm.length) {
      const first = daysForm[0];
      const last = daysForm[daysForm.length - 1];
      setForm((f) => ({
        ...f,
        start_date: first.date && first.start ? `${first.date}T${first.start}` : f.start_date,
        end_date: last.date && last.end ? `${last.date}T${last.end}` : f.end_date,
        door_time: first.date && first.door ? `${first.date}T${first.door}` : "",
      }));
    }
    setDaysForm(next);
  };
  const insertProgramEmbed = (kind, item) => {
    setForm((f) => ({ ...f, program: appendEmbedToken(f.program, kind, item) }));
  };

  const normalizeEventPayload = (source) => {
    const payload = { ...source };
    Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
    normalizeDateTimeFields(payload, ["start_date", "end_date", "door_time", "registration_opens_at", "registration_closes_at"]);
    if (payload.max_participants) payload.max_participants = parseInt(payload.max_participants);
    if (payload.allow_companions) payload.max_companions_per_registration = parseInt(payload.max_companions_per_registration || 1);
    else payload.max_companions_per_registration = 0;
    payload.bring_along = textToBring(payload.bring_along_text);
    delete payload.bring_along_text;
    payload.banner_style = payload.banner_style || "auto";
    return payload;
  };

  const originalEventPayload = () => normalizeEventPayload(formFromEvent(event, false));

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
    const daysProblem = daysDirty ? daysFormError(daysForm) : "";
    if (daysProblem) {
      toast.error(daysProblem);
      return;
    }
    // Beginnt die Beschreibung mit dem Titel (#1273), stünde er auf der Seite doppelt - die Verwaltung warnt, speichert aber.
    if (descriptionEchoesTitle(form.name, form.description)) {
      toast.warning("Die Beschreibung beginnt mit dem Titel – auf der Event-Seite steht er dann doppelt. Am besten die erste Zeile löschen.");
    }
    setSaving(true);
    try {
      const payload = normalizeEventPayload(form);
      payload.highlights = formToHighlights(highlightsForm);
      if (canFinance && billingDirty) payload.billing = formToBilling(billingForm);
      if (locationsDirty) payload.locations = formToLocations(locationsForm);
      if (daysDirty) payload.days = formToDays(daysForm);
      if (isNew) {
        await api.post("/events", payload);
      } else {
        const { highlights, ...rest } = payload;
        const patch = buildDirtyPayload(rest, originalEventPayload());
        if (highlightsDirty) patch.highlights = highlights;
        if (canFinance && billingDirty) patch.billing = formToBilling(billingForm);
        if (locationsDirty) patch.locations = formToLocations(locationsForm);
        if (daysDirty) patch.days = formToDays(daysForm);
        if (clearOwnSponsors) patch.sponsor_ids = [];
        if (!hasPayloadChanges(patch)) {
          toast.info("Keine Änderungen zum Speichern.");
          setSaving(false);
          return;
        }
        // Absagen und Verschieben (#2118): Rückfrage mit der Zahl der Betroffenen, bevor der Server sie informiert.
        const affected = affectedRegistrations(event);
        const cancelling = patch.status === "cancelled" && event.status !== "cancelled";
        if (cancelling && !await confirm({
          title: "Event absagen?",
          description: cancelConfirmText(affected),
          confirmLabel: "Absagen",
          cancelLabel: "Zurück",
        })) {
          setSaving(false);
          return;
        }
        if (!cancelling && affected && touchesScheduleOrPlace(patch) && !["draft", "archived", "cancelled"].includes(patch.status || event.status)) {
          patch.notify_registrants = await confirm({
            title: "Angemeldete informieren?",
            description: `Termin oder Ort ändern sich. Sollen ${affected === 1 ? "die 1 angemeldete Person" : `die ${affected} Angemeldeten`} (samt Warteliste) eine Nachricht bekommen?`,
            confirmLabel: "Informieren",
            cancelLabel: "Ohne Nachricht speichern",
            tone: "info",
          });
        }
        const { data } = await api.patch(`/events/${event.id}`, patch);
        toast.success(savedEventMessage(data));
        onDone();
        setSaving(false);
        return;
      }
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
            {!usesDays && (
              <>
                <TextField label="Start" type="datetime-local" value={form.start_date} onChange={(v) => set("start_date", v)} testId="event-start" />
                <TextField label="Ende" type="datetime-local" value={form.end_date} onChange={(v) => set("end_date", v)} testId="event-end" />
                <TextField label="Einlass / Türöffnung" type="datetime-local" value={form.door_time} onChange={(v) => set("door_time", v)} testId="event-door-time" />
              </>
            )}
            <EventDaysSection value={daysForm} onChange={changeDays} locations={locationsForm} startDate={form.start_date} endDate={form.end_date} accent={ACCENT} />
            <TextField label="Max. Teilnehmer" type="number" min={1} value={form.max_participants} onChange={(v) => set("max_participants", v)} hint="Leer = unbegrenzt." testId="event-max-participants" />
          </FormSection>
          <DistributeBox kind="event" itemId={event?.id} title={event?.name}>
            <DiscordPreview kind="event" item={usesDays ? { ...form, days: formToDays(daysForm) } : form} skip={form.discord_skip} onSkipChange={(value) => set("discord_skip", value)} />
          </DistributeBox>
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
        {descriptionEchoesTitle(form.name, form.description) ? (
          <p className="text-xs text-[#FF9F43]" data-testid="event-description-echo">
            Die Beschreibung beginnt mit dem Titel. Auf der Event-Seite steht der Titel schon groß im Kopf – die erste Zeile kann weg.
          </p>
        ) : null}
        <FieldLabel label="Kopfbild (Banner)">
          <ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} testId="event-banner" variant="wide" allowLibrary />
        </FieldLabel>
        <EventBannerFields url={form.banner_url} style={form.banner_style} focusX={form.banner_focus_x} focusY={form.banner_focus_y}
          onChange={(patch) => setForm((current) => ({ ...current, ...patch }))} />
      </FormSection>

      <FormSection title="Fakten-Kasten und Highlights" accent={ACCENT} hint="Steht oben auf der Event-Seite: Wann, Wo und Eintritt kommen aus den Feldern hier; „Mitbringen“ und die Highlights pflegst du hier.">
        <EventFactsSection bringText={form.bring_along_text} onBringText={(v) => set("bring_along_text", v)} highlights={highlightsForm} onHighlights={setHighlightsForm} />
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
        {/* Anmeldung im Discord (#885): Vorgabe an; mit externem Link oder Begleitpersonen geht sie nur auf der Website. */}
        {form.has_registration && (
          <CheckField
            label="Anmeldung über Discord erlauben"
            hint={form.registration_url || form.allow_companions
              ? "Gerade ohne Wirkung: mit externem Anmeldelink oder Begleitpersonen geht die Anmeldung nur auf der Website."
              : "Mit verknüpftem Konto über /anmelden oder den Knopf „Anmelden“ unter der Ankündigung – privat, mit denselben Regeln."}
            checked={form.discord_registration}
            onChange={(v) => set("discord_registration", v)}
            accent="#5865F2"
            testId="event-discord-registration"
          />
        )}
        {form.has_registration && !form.registration_url && (
          <EventBillingSection value={billingForm} onChange={setBillingForm} canEdit={canFinance} dolibarrConnected={Boolean(meta?.dolibarr_connected)} />
        )}
      </FormSection>

      <FormSection title="Programm" accent={ACCENT}>
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
        {/* Event als Klammer (#1371): Turniere und Fast Laps werden hier angelegt oder hinzugefügt - nur hier. */}
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-widest font-bold text-white/60">Turniere und Fast Laps</div>
          <EventProgramPanel eventId={event?.id} program={program} failed={programFailed} reload={reloadProgram} onEmbed={insertProgramEmbed} />
        </div>
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
        {/* Event-Sponsoren (#1371): festgelegt beim Sponsor (Redaktion: bei allen oder bei ausgewählten Events) - hier nur angezeigt. */}
        {form.owned_by_club && form.show_sponsors && (
          <EventSponsorsInfo isNew={isNew} sponsors={program?.sponsors} clearOwn={clearOwnSponsors} onClearOwn={setClearOwnSponsors} />
        )}
        <PartnerPicker partners={partners} value={form.partner_ids} onChange={(v) => set("partner_ids", v)} testPrefix="event-partner" hint="Das Event erscheint auf der Partnerseite unter „Gemeinsam“, und die Eventseite nennt den Partner." />
      </FormSection>

      {/* Rückmeldungen (#1196): was die Eingecheckten nach dem Event sagen - ohne Namen. */}
      {!isNew && event?.id ? (
        <FormSection title="Rückmeldungen" accent={ACCENT}>
          <FeedbackReport kind="event" targetId={event.id} />
        </FormSection>
      ) : null}
    </AdminFormPage>
  );
}

function EventSponsorsInfo({ isNew, sponsors, clearOwn, onClearOwn }) {
  const names = (sponsors?.items || []).map((item) => item.name).filter(Boolean);
  return (
    <div className="border border-white/10 p-3 rounded-sm bg-[#0A0A0A] space-y-2" data-testid="event-sponsors">
      <div className="text-[11px] uppercase tracking-widest font-bold text-white/60">Event-Sponsoren</div>
      {!isNew && sponsors && (
        <p className="text-sm text-white/75" data-testid="event-sponsors-list">
          {names.length ? `Erscheinen beim Event: ${names.join(", ")}.` : "Beim Event erscheinen gerade keine Sponsoren."}
        </p>
      )}
      {sponsors?.own_choice && (
        <CheckField
          label="Alte eigene Auswahl dieses Events aufheben – dann gilt, was beim Sponsor steht"
          checked={clearOwn}
          onChange={onClearOwn}
          accent={ACCENT}
          testId="event-sponsors-clear-own"
        />
      )}
      <p className="text-[11px] text-white/45">
        Welche Sponsoren bei welchem Event erscheinen, legt die Redaktion beim Sponsor fest: bei allen Events oder bei ausgewählten.
      </p>
    </div>
  );
}
