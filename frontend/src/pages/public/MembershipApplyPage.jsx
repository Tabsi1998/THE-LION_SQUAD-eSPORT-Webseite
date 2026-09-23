/**
 * Mitglied werden (#328): Mit Dolibarr-Anbindung fragt die Seite genau das, was der Verein im
 * gedruckten Antrag verlangt (Pflichtfelder, eigene Felder), zeigt die Mitgliedsarten mit Beitrag
 * und die aktuellen Einwilligungstexte - und schickt den Antrag in die Mitgliederverwaltung.
 * Entschieden wird dort; die Seite zeigt den Stand. Ohne Anbindung bleibt der Website-Antrag mit
 * Motivation und Beitragswunsch, den der Vorstand im Admin entscheidet.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { GermanDateField } from "@/components/tls/GermanDateField";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { SkeletonLines } from "@/components/tls/Skeleton";
import { toast } from "sonner";
import { Crown, FileText, Mail, Clock, Send, Undo2, AlertTriangle } from "lucide-react";

const CONTRIB_OPTIONS = [
  { value: "full", label: "Vollmitgliedschaft" },
  { value: "supporter", label: "Unterstützer-Mitgliedschaft" },
  { value: "youth", label: "Jugend-Mitgliedschaft" },
  { value: "honorary", label: "Ehrenmitgliedschaft (auf Einladung)" },
];
const COUNTRIES = [["AT", "Österreich"], ["DE", "Deutschland"], ["CH", "Schweiz"], ["IT", "Italien"], ["LI", "Liechtenstein"]];
const PERSON_FIELDS = [
  ["firstname", "Vorname", "text"], ["lastname", "Nachname", "text"], ["phone", "Telefon", "tel"],
  ["address", "Straße und Hausnummer", "text"], ["zip", "PLZ", "text"], ["town", "Ort", "text"],
];
const INPUT = "w-full bg-[#0A0A0A] border border-white/10 focus:border-[#FFD700] px-3 py-2.5 rounded-sm text-sm text-white focus:outline-none";

export function formatMoney(value, currency = "EUR") {
  const number = Number(value || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${number} ${currency === "EUR" ? "€" : currency}`;
}

export function feeLine(fee) {
  if (!fee.subscription_required || fee.amount === null || fee.amount === undefined) return "Ohne Beitrag";
  const parts = [`${formatMoney(fee.amount, fee.currency)} ${fee.period_label || "je Jahr"}`];
  if (fee.admission_fee) parts.push(`einmalig ${formatMoney(fee.admission_fee, fee.currency)} Aufnahme`);
  if (fee.prorated) parts.push("Eintritt unterm Jahr anteilig");
  return parts.join(" · ");
}

export function splitDisplayName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { firstname: "", lastname: "" };
  return { firstname: parts.slice(0, -1).join(" "), lastname: parts[parts.length - 1] };
}

export default function MembershipApplyPage() {
  useDocumentTitle(
    "Mitgliedschaft beantragen",
    "Online Mitgliedschaft bei THE LION SQUAD eSports beantragen und Teil der Gaming Community in Tirol werden.",
    { robots: "noindex, follow" }
  );

  const { user } = useAuth();
  const nav = useNavigate();
  const confirm = useConfirm();
  const [existing, setExisting] = useState(null);
  const [setup, setSetup] = useState({ coupled: false, contribution_options: CONTRIB_OPTIONS });
  const [loading, setLoading] = useState(true);
  const [renew, setRenew] = useState(false);
  const [form, setForm] = useState({
    motivation: "", contribution_pref: "full", accept_statutes: false, accept_privacy: false, notes: "",
    type_id: null, firstname: "", lastname: "", phone: "", birth: "", address: "", zip: "", town: "", country_code: "AT", fields: {}, consents: {},
  });
  const { submitting, submitOnce } = useSubmissionGuard();
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState("");

  const loadExisting = useCallback(() => {
    if (user === undefined) return;
    if (!user) { nav("/login?next=/membership/apply"); return; }
    setLoading(true);
    // Was die Seite fragt, kommt vom Server (mit Dolibarr aus der Mitgliederverwaltung); ohne Antwort bleibt der Website-Antrag.
    api.get("/membership/apply/form").then(({ data }) => {
      if (data && typeof data === "object") {
        setSetup(data);
        if (data.coupled && data.available) {
          setForm((current) => ({ ...current, ...(current.firstname || current.lastname ? {} : splitDisplayName(data.account?.display_name)), type_id: current.type_id || (data.fees?.[0]?.id ?? null) }));
        }
      }
    }).catch(() => {});
    return api.get("/membership/apply/me").then(({ data }) => { setExisting(data); setLoading(false); }).catch(() => setLoading(false));
  }, [user, nav]);
  useEffect(() => { loadExisting(); }, [loadExisting]);
  useApiInvalidation(loadExisting, ["membership"]);

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    setSubmitError("");
  };
  const coupled = Boolean(setup.coupled && setup.available);
  const requiredPerson = new Set([...(setup.form?.required || []), "firstname", "lastname"]);

  const validate = () => {
    const errors = {};
    if (coupled) {
      for (const [key, label] of PERSON_FIELDS) if (requiredPerson.has(key) && !String(form[key] || "").trim()) errors[key] = `${label} fehlt.`;
      if (requiredPerson.has("birth") && !form.birth) errors.birth = "Geburtsdatum fehlt.";
      if (!form.type_id) errors.type_id = "Bitte eine Mitgliedsart wählen.";
      for (const field of setup.form?.fields || []) if (field.required && !String(form.fields[field.code] || "").trim()) errors[`field:${field.code}`] = `${field.label} fehlt.`;
    } else if (form.motivation.trim().length < 20) {
      errors.motivation = "Bitte beschreibe deine Motivation mit mindestens 20 Zeichen.";
    }
    if (!form.accept_statutes) errors.accept_statutes = "Bitte akzeptiere die Vereinsstatuten.";
    if (!form.accept_privacy) errors.accept_privacy = "Bitte akzeptiere die Datenschutzerklärung.";
    setFieldErrors(errors);
    const first = Object.keys(errors)[0];
    if (first) document.getElementById(`apply-${first.replace("accept_", "").replace("field:", "field-")}`)?.focus();
    return Object.keys(errors).length === 0;
  };

  const payloadFor = () => {
    if (!coupled) return { motivation: form.motivation.trim(), contribution_pref: form.contribution_pref, notes: form.notes.trim() || null, accept_statutes: form.accept_statutes, accept_privacy: form.accept_privacy };
    return {
      accept_statutes: form.accept_statutes, accept_privacy: form.accept_privacy, type_id: form.type_id,
      firstname: form.firstname.trim(), lastname: form.lastname.trim(), phone: form.phone.trim() || null, birth: form.birth || null,
      address: form.address.trim() || null, zip: form.zip.trim() || null, town: form.town.trim() || null, country_code: form.country_code,
      motivation: null, notes: form.motivation.trim() || null,
      fields: Object.fromEntries(Object.entries(form.fields).filter(([, value]) => String(value || "").trim())),
      consents: (setup.consents || []).filter((consent) => form.consents[consent.code]).map((consent) => ({ code: consent.code, version: consent.version })),
    };
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitError("");
    const attempt = await submitOnce(() => api.post("/membership/apply", payloadFor()));
    if (!attempt.started) return;
    if (!attempt.error) {
      setExisting(attempt.value.data);
      setRenew(false);
      toast.success(attempt.value.data?.status === "submitting" ? "Antrag gespeichert – er wird gerade übermittelt." : coupled ? "Antrag eingereicht! Der Verein prüft ihn in der Mitgliederverwaltung." : "Bewerbung eingereicht! Wir melden uns per Mail.");
    } else {
      const err = attempt.error;
      const message = formatApiError(err.response?.data?.detail) || "Bewerbung konnte nicht gesendet werden.";
      setSubmitError(message);
      toast.error(message);
    }
  };

  const withdraw = async () => {
    if (!await confirm({ title: "Antrag zurückziehen?", description: "Der Verein sieht den Antrag dann nicht mehr. Du kannst später einen neuen stellen.", confirmLabel: "Zurückziehen" })) return;
    try {
      const { data } = await api.post("/membership/apply/withdraw");
      setExisting(data);
      toast.success("Antrag zurückgezogen.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Zurückziehen hat nicht geklappt.");
      loadExisting();
    }
  };

  const status = existing?.status;
  const showForm = !existing || renew || !["pending", "submitting", "approved", "rejected", "failed", "withdrawn"].includes(status) || (renew && ["rejected", "failed", "withdrawn"].includes(status));

  return (
    <PublicLayout>
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Mitgliedschaft</span>
        <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">Mitglied werden</h1>
        <p className="mt-3 text-white/60 max-w-2xl">Werde offiziell Teil von THE LION SQUAD — eSPORTS. Stimmrecht bei Generalversammlungen, Member-Bereiche, Vereinslogo auf deinem Trikot. Ein Antrag pro Konto.</p>

        {loading ? (
          <SkeletonLines lines={4} className="mt-8" label="Lade Antrag" />
        ) : setup.coupled && setup.available === false ? (
          <StatusCard testId="apply-unavailable" icon={AlertTriangle} color="#FFD700" title="Gerade nicht möglich" body="Die Mitgliederverwaltung ist im Moment nicht erreichbar. Bitte in ein paar Minuten noch einmal versuchen – nichts ist verloren." />
        ) : !showForm && status === "submitting" ? (
          <StatusCard testId="apply-submitting" icon={Send} color="#29B6E8" title="Antrag wird übermittelt" body="Dein Antrag ist gespeichert und geht gerade an die Mitgliederverwaltung. Klappt das nicht sofort, versuchen wir es automatisch weiter – du musst nichts tun." action={<button type="button" onClick={withdraw} data-testid="apply-withdraw" className="text-xs uppercase tracking-wider font-bold text-white/50 hover:text-[#FF3B30] inline-flex items-center gap-1"><Undo2 className="w-3.5 h-3.5" /> Zurückziehen</button>} />
        ) : !showForm && status === "pending" ? (
          <StatusCard testId="apply-pending" icon={existing.dolibarr?.application_status === "in_review" ? Clock : Mail} color="#29B6E8"
            title={existing.dolibarr?.application_status === "in_review" ? "Antrag in Prüfung" : existing.coupled ? "Antrag eingegangen" : "Bewerbung eingegangen"}
            body={`Eingereicht am ${new Date(existing.created_at).toLocaleDateString("de-DE")}. ${existing.coupled ? "Der Verein prüft den Antrag in der Mitgliederverwaltung; du erhältst eine E-Mail, sobald entschieden ist." : "Du erhältst eine E-Mail sobald entschieden wurde."}`}
            action={existing.coupled ? <button type="button" onClick={withdraw} data-testid="apply-withdraw" className="text-xs uppercase tracking-wider font-bold text-white/50 hover:text-[#FF3B30] inline-flex items-center gap-1"><Undo2 className="w-3.5 h-3.5" /> Antrag zurückziehen</button> : null} />
        ) : !showForm && status === "approved" ? (
          <StatusCard testId="apply-approved" icon={Crown} color="#FFD700" title="Du bist Mitglied 🦁" body="Willkommen im Rudel! Schau in den Mitgliederbereich für Benefits und Dokumente." />
        ) : !showForm && status === "rejected" ? (
          <StatusCard testId="apply-rejected" icon={FileText} color="#FF3B30" title={existing.coupled ? "Antrag abgelehnt" : "Bewerbung abgelehnt"} body={existing.decision_note || "Du kannst zu einem späteren Zeitpunkt erneut versuchen."} action={<RenewButton onClick={() => setRenew(true)} />} />
        ) : !showForm && status === "failed" ? (
          <StatusCard testId="apply-failed" icon={AlertTriangle} color="#FF3B30" title="Antrag nicht angenommen" body={`Die Mitgliederverwaltung hat den Antrag nicht angenommen${existing.dolibarr?.error_text ? ` (${existing.dolibarr.error_text})` : ""}. Bitte die Angaben prüfen und den Antrag neu stellen.`} action={<RenewButton onClick={() => setRenew(true)} />} />
        ) : !showForm && status === "withdrawn" ? (
          <StatusCard testId="apply-withdrawn" icon={Undo2} color="#FFD700" title="Antrag zurückgezogen" body="Du hast deinen Antrag zurückgezogen. Wenn du magst, stell jederzeit einen neuen." action={<RenewButton onClick={() => setRenew(true)} />} />
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-5 border border-white/10 bg-[#121212] rounded-sm p-6" data-testid="apply-form" noValidate>
            {coupled ? (
              <CoupledFields setup={setup} form={form} updateField={updateField} fieldErrors={fieldErrors} requiredPerson={requiredPerson} />
            ) : (
              <>
                <Field id="apply-contribution" label="Beitragsart">
                  <select id="apply-contribution" className={INPUT} value={form.contribution_pref} onChange={(e) => updateField("contribution_pref", e.target.value)} data-testid="apply-contribution">
                    {(setup.contribution_options || CONTRIB_OPTIONS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field id="apply-motivation" label={`Motivation (${form.motivation.length}/2000)`} error={fieldErrors.motivation}>
                  <textarea id="apply-motivation" required minLength={20} maxLength={2000} rows={6} value={form.motivation} onChange={(e) => updateField("motivation", e.target.value)} placeholder="Warum möchtest du Mitglied werden? Welche Spiele/Plattformen? Wie viel Zeit kannst du einbringen?" className={INPUT} data-testid="apply-motivation" aria-invalid={!!fieldErrors.motivation} aria-describedby={fieldErrors.motivation ? "apply-motivation-error" : undefined} />
                </Field>
                <Field id="apply-notes" label="Anmerkungen (optional)">
                  <textarea id="apply-notes" rows={2} maxLength={2000} value={form.notes} onChange={(e) => updateField("notes", e.target.value)} className={INPUT} />
                </Field>
              </>
            )}
            <div className="space-y-2 pt-2 border-t border-white/5">
              <label className="flex items-start gap-2 cursor-pointer">
                <input id="apply-statutes" type="checkbox" required checked={form.accept_statutes} onChange={(e) => updateField("accept_statutes", e.target.checked)} data-testid="apply-statutes" aria-invalid={!!fieldErrors.accept_statutes} aria-describedby={fieldErrors.accept_statutes ? "apply-statutes-error" : undefined} className="mt-1 accent-[#FFD700]" />
                <span className="text-sm text-white/70">Ich habe die <a href="/imprint" className="text-[#29B6E8] underline">Vereinsstatuten</a> gelesen und akzeptiere sie.{fieldErrors.accept_statutes && <span id="apply-statutes-error" role="alert" className="block mt-1 text-xs text-[#FF8A80]">{fieldErrors.accept_statutes}</span>}</span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input id="apply-privacy" type="checkbox" required checked={form.accept_privacy} onChange={(e) => updateField("accept_privacy", e.target.checked)} data-testid="apply-privacy" aria-invalid={!!fieldErrors.accept_privacy} aria-describedby={fieldErrors.accept_privacy ? "apply-privacy-error" : undefined} className="mt-1 accent-[#FFD700]" />
                <span className="text-sm text-white/70">Ich akzeptiere die <a href="/privacy" className="text-[#29B6E8] underline">Datenschutzerklärung</a>.{fieldErrors.accept_privacy && <span id="apply-privacy-error" role="alert" className="block mt-1 text-xs text-[#FF8A80]">{fieldErrors.accept_privacy}</span>}</span>
              </label>
            </div>
            {submitError && <AuthFormAlert id="apply-submit-error">{submitError}</AuthFormAlert>}
            <button type="submit" disabled={submitting} data-testid="apply-submit" className="w-full px-6 py-3 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
              <Crown className="w-4 h-4" /> {submitting ? "Sende …" : coupled ? "Antrag einreichen" : "Bewerbung einreichen"}
            </button>
            {coupled && <p className="text-[11px] text-white/40">Der Antrag geht direkt in die Mitgliederverwaltung des Vereins. Aufgenommen wird dort; du siehst hier den Stand und bekommst eine E-Mail.</p>}
          </form>
        )}
      </section>
    </PublicLayout>
  );
}

// Der Antrag, wie ihn Dolibarr verlangt: Person, Mitgliedsart, eigene Felder, Nachricht, Einwilligungen.
function CoupledFields({ setup, form, updateField, fieldErrors, requiredPerson }) {
  const setPerson = (key, value) => updateField(key, value);
  const setExtra = (code, value) => updateField("fields", { ...form.fields, [code]: value });
  const setConsent = (code, checked) => updateField("consents", { ...form.consents, [code]: checked });
  return (
    <>
      <div>
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700] mb-3">Mitgliedsart</div>
        <div className="grid sm:grid-cols-2 gap-2" data-testid="apply-fees">
          {(setup.fees || []).map((fee) => (
            <label key={fee.id} className={`flex items-start gap-2 border rounded-sm p-3 cursor-pointer transition ${form.type_id === fee.id ? "border-[#FFD700] bg-[#FFD700]/5" : "border-white/10 hover:border-white/25"}`}>
              <input type="radio" name="apply-fee" value={fee.id} checked={form.type_id === fee.id} onChange={() => updateField("type_id", fee.id)} data-testid={`apply-fee-${fee.id}`} className="mt-1 accent-[#FFD700]" />
              <span className="min-w-0">
                <span className="block font-bold text-white">{fee.label}</span>
                <span className="block text-xs text-[#FFD700]/90">{feeLine(fee)}</span>
                {fee.description && <span className="block mt-1 text-xs text-white/50">{fee.description}</span>}
              </span>
            </label>
          ))}
        </div>
        {fieldErrors.type_id && <div id="apply-type_id" tabIndex={-1} role="alert" className="mt-1 text-xs text-[#FF8A80]">{fieldErrors.type_id}</div>}
      </div>

      <div>
        <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700] mb-3">Deine Angaben</div>
        <div className="grid sm:grid-cols-2 gap-3">
          {PERSON_FIELDS.map(([key, label, type]) => (
            (requiredPerson.has(key) || ["firstname", "lastname", "address", "zip", "town"].includes(key) || key === "phone") && (
              <Field key={key} id={`apply-${key}`} label={`${label}${requiredPerson.has(key) ? "" : " (optional)"}`} error={fieldErrors[key]} className={key === "address" ? "sm:col-span-2" : ""}>
                <input id={`apply-${key}`} type={type} value={form[key]} onChange={(e) => setPerson(key, e.target.value)} className={INPUT} data-testid={`apply-${key}`} aria-invalid={!!fieldErrors[key]} autoComplete={{ firstname: "given-name", lastname: "family-name", phone: "tel", address: "street-address", zip: "postal-code", town: "address-level2" }[key]} />
              </Field>
            )
          ))}
          <Field id="apply-email" label="E-Mail (dein Konto)">
            <input id="apply-email" type="email" value={setup.account?.email || ""} readOnly className={`${INPUT} opacity-70`} data-testid="apply-email" />
          </Field>
          <Field id="apply-country" label="Land">
            <select id="apply-country" value={form.country_code} onChange={(e) => setPerson("country_code", e.target.value)} className={INPUT} data-testid="apply-country">
              {COUNTRIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </Field>
          <div className={requiredPerson.has("birth") ? "" : "opacity-90"}>
            <GermanDateField id="apply-birth" label={`Geburtsdatum${requiredPerson.has("birth") ? "" : " (optional)"}`} value={form.birth} onChange={(v) => setPerson("birth", v)} testId="apply-birth" error={fieldErrors.birth} description={requiredPerson.has("birth") ? undefined : "Nur nötig für Ermäßigungen nach Alter."} />
          </div>
          {(setup.form?.fields || []).map((field) => (
            <Field key={field.code} id={`apply-field-${field.code}`} label={`${field.label}${field.required ? "" : " (optional)"}`} error={fieldErrors[`field:${field.code}`]}>
              <input id={`apply-field-${field.code}`} type="text" maxLength={255} value={form.fields[field.code] || ""} onChange={(e) => setExtra(field.code, e.target.value)} className={INPUT} data-testid={`apply-field-${field.code}`} />
            </Field>
          ))}
        </div>
      </div>

      <Field id="apply-motivation" label={`Nachricht an den Verein (optional, ${form.motivation.length}/2000)`}>
        <textarea id="apply-motivation" maxLength={2000} rows={4} value={form.motivation} onChange={(e) => updateField("motivation", e.target.value)} placeholder="Warum möchtest du Mitglied werden? Welche Spiele/Plattformen?" className={INPUT} data-testid="apply-motivation" />
      </Field>

      {(setup.consents || []).length > 0 && (
        <div className="space-y-2 pt-2 border-t border-white/5" data-testid="apply-consents">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Freiwillige Einwilligungen</div>
          {setup.consents.map((consent) => (
            <label key={consent.code} className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.consents[consent.code]} onChange={(e) => setConsent(consent.code, e.target.checked)} data-testid={`apply-consent-${consent.code}`} className="mt-1 accent-[#FFD700]" />
              <span className="text-sm text-white/70"><span className="text-white font-bold">{consent.label}:</span> {consent.text}</span>
            </label>
          ))}
          <p className="text-[11px] text-white/40">Nichts davon ist Pflicht. Du kannst jede Einwilligung später widerrufen.</p>
        </div>
      )}
    </>
  );
}

function RenewButton({ onClick }) {
  return <button type="button" onClick={onClick} data-testid="apply-renew" className="text-xs uppercase tracking-wider font-bold text-[#FFD700] hover:underline">Neuen Antrag stellen</button>;
}

function Field({ id, label, error, className = "", children }) {
  return (
    <label htmlFor={id} className={`block ${className}`}>
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      {children}
      {error && <div id={`${id}-error`} role="alert" className="mt-1 text-xs text-[#FF8A80]">{error}</div>}
    </label>
  );
}

function StatusCard({ icon: Icon, color, title, body, testId, action }) {
  return (
    <div className="mt-8 border border-white/10 bg-[#121212] rounded-sm p-6 flex items-start gap-4" data-testid={testId}>
      <Icon className="w-6 h-6 shrink-0" style={{ color }} />
      <div className="min-w-0">
        <h3 className="font-heading text-xl font-black uppercase">{title}</h3>
        <p className="mt-1 text-white/60">{body}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}
