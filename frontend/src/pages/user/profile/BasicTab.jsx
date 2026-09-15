import { ImageUpload } from "@/components/tls/ImageUpload";
import { GermanDateField } from "@/components/tls/GermanDateField";
import { GoogleAuthButton } from "@/components/tls/GoogleAuthButton";
import { MfaSetupPanel } from "@/components/tls/MfaSetupPanel";
import { PasskeysPanel } from "@/components/tls/PasskeysPanel";
import { GENDER_OPTIONS } from "./constants";
import { Field, Input, Row, Section } from "./fields";

export function BasicTab({ form, set, user, refresh, siteSettings, googleLinked, googleOnly, unlinkGoogle }) {
  return (
    <>
                <Section>
                  <Row>
                    <Field label="Display Name"><Input value={form.display_name} onChange={(v) => set("display_name", v)} testId="profile-display-name" /></Field>
                    <Field label="Nickname"><Input value={form.nickname} onChange={(v) => set("nickname", v)} /></Field>
                  </Row>
                  <Row>
                    <Field label="Vorname (privat)"><Input value={form.first_name} onChange={(v) => set("first_name", v)} /></Field>
                    <Field label="Nachname (privat)"><Input value={form.last_name} onChange={(v) => set("last_name", v)} /></Field>
                  </Row>
                  <Field label="Bio">
                    <textarea value={form.bio || ""} onChange={(e) => set("bio", e.target.value)} rows={4} data-testid="profile-bio" className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white" />
                  </Field>
                  <Row>
                    <Field label="Geburtsdatum"><GermanDateField id="profile-birth-date" value={form.birth_date} onChange={(v) => set("birth_date", v)} testId="profile-birth-date" /></Field>
                    <Field label="Geschlecht"><select value={form.gender || ""} onChange={(e) => set("gender", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-white">
                      {GENDER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select></Field>
                  </Row>
                  <Row>
                    <Field label="Land"><Input value={form.country} onChange={(v) => set("country", v)} placeholder="AT, DE, CH" /></Field>
                    <Field label="Stadt"><Input value={form.city} onChange={(v) => set("city", v)} /></Field>
                  </Row>
                  <Row>
                    <Field label="Avatar"><ImageUpload value={form.avatar_url} onChange={(v) => set("avatar_url", v)} testId="profile-avatar" variant="square" allowLibrary /></Field>
                    <Field label="Banner"><ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} testId="profile-banner" variant="wide" allowLibrary /></Field>
                  </Row>

                  {siteSettings.google_linking_enabled !== false && (
                    <div className="border border-white/10 rounded-sm p-5 bg-[#0A0A0A]" data-testid="profile-google-link">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <svg className="w-6 h-6 mt-0.5 shrink-0" viewBox="0 0 24 24" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.66 4.1-5.5 4.1-3.3 0-6-2.73-6-6.1s2.7-6.1 6-6.1c1.88 0 3.14.8 3.86 1.49l2.63-2.53C16.86 3.1 14.66 2.1 12 2.1 6.98 2.1 2.9 6.18 2.9 11.2S6.98 20.3 12 20.3c5.78 0 9.6-4.06 9.6-9.78 0-.66-.07-1.16-.16-1.66H12z"/></svg>
                          <div>
                            <h3 className="font-heading font-black uppercase mb-1">Google-Konto</h3>
                            {googleLinked ? (
                              <p className="text-xs text-[#00FF88]" data-testid="profile-google-status">Verknüpft{user?.google_email ? ` · ${user.google_email}` : ""} · schneller Login mit einem Klick.</p>
                            ) : (
                              <p className="text-xs text-white/50" data-testid="profile-google-status">Verbinde dein Google-Konto, um dich künftig mit einem Klick anzumelden.</p>
                            )}
                          </div>
                        </div>
                        {googleLinked ? (
                          <button
                            type="button"
                            onClick={unlinkGoogle}
                            disabled={googleOnly}
                            title={googleOnly ? "Setze zuerst ein Passwort, dann kannst du Google trennen." : undefined}
                            data-testid="profile-google-unlink"
                            className="px-4 py-2.5 rounded-sm border border-[#FF3B30]/40 text-[#FF3B30] text-xs font-bold uppercase tracking-wider hover:bg-[#FF3B30]/10 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                          >
                            Trennen
                          </button>
                        ) : <div data-testid="profile-google-link-button"><GoogleAuthButton label="Google verknüpfen" intent="link" onSuccess={refresh} /></div>}
                      </div>
                    </div>
                  )}
                  <MfaSetupPanel user={user} onChanged={refresh} />
                  <PasskeysPanel />
                </Section>
    </>
  );
}
