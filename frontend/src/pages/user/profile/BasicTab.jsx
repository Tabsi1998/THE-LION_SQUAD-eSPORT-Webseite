import { ImageUpload } from "@/components/tls/ImageUpload";
import { GermanDateField } from "@/components/tls/GermanDateField";
import { COUNTRY_OPTIONS, isCountryCode } from "@/lib/countries";
import { GENDER_OPTIONS } from "./constants";
import { Field, Input, Row, Section } from "./fields";

// Grunddaten (#258): ein Name statt zwei (der Nickname stand doppelt zum
// Anzeigenamen und wurde nirgends gelesen), Land als Auswahl statt Freitext,
// Bilder ohne Dateinamen. Google, Zwei-Faktor und Passkeys stehen im Reiter
// Sicherheit.
const selectClass = "w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-white";

export function BasicTab({ form, set }) {
  const rawCountry = form.country || "";
  const country = isCountryCode(rawCountry) ? rawCountry.toUpperCase() : rawCountry;
  const unknownCountry = country && !isCountryCode(country);
  return (
    <Section>
      <Field label="Anzeigename">
        <Input value={form.display_name} onChange={(v) => set("display_name", v)} testId="profile-display-name" />
        <p className="text-[11px] text-white/45 mt-1.5">So heißt du überall: im Profil, in Teams, Turnieren und Ranglisten.</p>
      </Field>
      <Row>
        <Field label="Vorname (privat)"><Input value={form.first_name} onChange={(v) => set("first_name", v)} /></Field>
        <Field label="Nachname (privat)"><Input value={form.last_name} onChange={(v) => set("last_name", v)} /></Field>
      </Row>
      <Field label="Bio">
        <textarea value={form.bio || ""} onChange={(e) => set("bio", e.target.value)} rows={4} data-testid="profile-bio" className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white" />
      </Field>
      <Row>
        <Field label="Geburtsdatum"><GermanDateField id="profile-birth-date" value={form.birth_date} onChange={(v) => set("birth_date", v)} testId="profile-birth-date" /></Field>
        <Field label="Geschlecht">
          <select value={form.gender || ""} onChange={(e) => set("gender", e.target.value)} className={selectClass}>
            {GENDER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      </Row>
      <Row>
        <Field label="Land">
          <select value={country} onChange={(e) => set("country", e.target.value)} data-testid="profile-country" className={selectClass}>
            <option value="">Keine Angabe</option>
            {unknownCountry ? <option value={country}>Bisher: {country}</option> : null}
            {COUNTRY_OPTIONS.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
          </select>
        </Field>
        <Field label="Stadt"><Input value={form.city} onChange={(v) => set("city", v)} /></Field>
      </Row>
      <Row>
        <Field label="Avatar"><ImageUpload value={form.avatar_url} onChange={(v) => set("avatar_url", v)} testId="profile-avatar" variant="square" allowLibrary /></Field>
        <Field label="Banner"><ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} testId="profile-banner" variant="wide" allowLibrary /></Field>
      </Row>
    </Section>
  );
}
