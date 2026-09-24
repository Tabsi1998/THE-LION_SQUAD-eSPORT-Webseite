import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useDolibarrSource } from "@/components/tls/DolibarrSourceBlock";
import { Empty, Panel } from "./parts";

// Reiter Funktionen (#510): jede „aus Dolibarr“-Funktion als Zeile mit echtem Schalter, Zustand, Voraussetzung und
// der Auswahl, die dazugehört. Die Werte liegen weiter dort, wo sie immer lagen (Branding, Sponsorenquelle,
// Dolibarr-Einstellungen) - PUT /admin/dolibarr/features setzt sie nur an einem Ort.

const FIELD_COLUMNS = [["gamertag", "Gamertag"], ["bio", "Kurztext"], ["games", "Spiele"], ["platforms", "Plattformen"]];

function FeatureTitle({ feature }) {
  return (
    <span>
      <span className="font-bold text-sm">{feature.label}</span>
      <span className={`block text-xs ${feature.enabled ? "text-[#00FF88]" : "text-[#FFD700]"}`}>{feature.state}</span>
    </span>
  );
}

export function FeaturesTab({ status, busy, run, consentTexts = [], canSystem = false }) {
  const features = status?.features || [];
  const [source, setSource, reloadSource] = useDolibarrSource();
  const [categories, setCategories] = useState(null);
  useEffect(() => { setCategories(null); }, [source?.sponsor_category, source?.partner_category]);
  const draft = categories || { sponsor_category: source?.sponsor_category || "", partner_category: source?.partner_category || "" };
  const categoriesChanged = categories !== null && (draft.sponsor_category !== (source?.sponsor_category || "") || draft.partner_category !== (source?.partner_category || ""));

  const setFeature = (key, payload, message) => run("feature", () => api.put("/admin/dolibarr/features", { key, ...payload }), message);
  const refreshFacts = () => run("facts", () => api.post("/admin/dolibarr/public/refresh"), ({ data }) => (data.ok ? "Vereinsdaten aus Dolibarr nachgelesen." : `Dolibarr nicht lesbar – alter Stand bleibt (${data.text || data.kind}).`));
  const refreshSponsors = async () => {
    const result = await run("sponsors", () => api.post("/admin/dolibarr/sponsors/refresh"));
    if (result?.data?.view) setSource(result.data.view);
    if (result?.data?.ok) toast.success(`Aus Dolibarr nachgelesen: ${result.data.sponsors?.total ?? 0} Sponsoren, ${result.data.partners?.total ?? 0} Partner.`);
    else if (result?.data) toast.error(`Dolibarr nicht lesbar – alter Stand bleibt (${result.data.text || result.data.kind}).`);
  };
  const saveCategories = async () => {
    const result = await setFeature("sponsors", { options: draft }, "Kategorien gespeichert.");
    if (result) { setCategories(null); reloadSource(); }
  };
  const toggle = async (feature, on) => {
    const result = await setFeature(feature.key, { on }, on ? `${feature.label}: an.` : `${feature.label}: aus.`);
    if (result && feature.key === "sponsors") reloadSource();
  };

  if (!features.length) return <Panel title="Funktionen"><Empty text="Noch kein Stand geladen." /></Panel>;
  const found = source?.categories || {};
  const stateOf = (key) => (found[key] ? (found[key].found ? `gefunden${found[key].sub?.length ? ` (${found[key].sub.join(", ")})` : ""}` : "nicht gefunden") : "noch nicht gelesen");
  const known = status?.website_profile_fields || [];

  return (
    <Panel title="Funktionen – ein Ort für alle Dolibarr-Schalter">
      <p className="text-xs text-white/45 mb-3">Was an ist, kommt aus dem Vereinsmodul; was aus ist, pflegt die Website selbst. Der Modus (aus, Vorschau, Live) und die Verbindung stehen unter „Verbindung“.</p>
      <ul className="divide-y divide-white/5" data-testid="dolibarr-feature-rows">
        {features.map((feature) => {
          const sw = feature.switch;
          const canSwitch = Boolean(sw) && sw.kind !== "select" && (!sw.system_only || canSystem);
          return (
            <li key={feature.key} className="py-3 space-y-2" data-testid={`dolibarr-row-${feature.key}`}>
              <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                {sw && sw.kind !== "select" ? (
                  <label className={`flex flex-wrap items-start gap-x-2 sm:w-96 shrink-0 ${canSwitch ? "cursor-pointer" : ""}`}>
                    <input type="checkbox" checked={Boolean(sw.on)} disabled={!!busy || !canSwitch} onChange={(e) => toggle(feature, e.target.checked)}
                      data-testid={`dolibarr-switch-${feature.key}`} className="accent-[#29B6E8] mt-0.5" />
                    <span className="font-bold text-sm">{feature.label}</span>
                    <span className={`basis-full pl-6 text-xs ${feature.enabled ? "text-[#00FF88]" : "text-[#FFD700]"}`}>{feature.state}</span>
                  </label>
                ) : (
                  <div className="flex items-start gap-2 sm:w-96 shrink-0">
                    {feature.enabled ? <CheckCircle2 className="w-4 h-4 text-[#00FF88] shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-[#FFD700] shrink-0 mt-0.5" />}
                    <FeatureTitle feature={feature} />
                  </div>
                )}
                <div className="flex-1 min-w-0 text-xs text-white/55">
                  {feature.hint}
                  {sw?.system_only && !canSystem ? <span className="block text-white/40 mt-1">Schaltet nur „System“ (Schlüssel und Geld).</span> : null}
                  {!sw && feature.where ? <Link to={feature.where} className="block mt-1 text-[#29B6E8] hover:text-white">{feature.where_label} →</Link> : null}
                </div>
              </div>

              {feature.key === "members" && (
                <label className="ml-6 flex flex-wrap items-start gap-x-2 text-sm" data-testid="dolibarr-auto-link-row">
                  <input type="checkbox" id="dolibarr-auto-link" checked={!!status?.auto_link_verified_email} disabled={!!busy} className="accent-[#29B6E8] mt-0.5"
                    onChange={(e) => setFeature("members", { options: { auto_link_verified_email: e.target.checked } }, e.target.checked ? "Konten werden über die bestätigte E-Mail zugeordnet." : "Zuordnungen bestätigt jetzt die Vereinsverwaltung.")} data-testid="dolibarr-auto-link" />
                  <span className="font-bold">Konten über die bestätigte E-Mail von selbst zuordnen</span>
                  <span className="basis-full pl-6 text-xs text-white/45">Nur bei genau einem Treffer und wenn das Mitglied noch keinem Konto gehört. Aus heißt: Jede Zuordnung bestätigt die Vereinsverwaltung.</span>
                </label>
              )}

              {feature.key === "club_facts" && feature.enabled && (
                <div className="ml-6">
                  <button type="button" onClick={refreshFacts} disabled={!!busy} data-testid="dolibarr-facts-refresh" className="px-3 py-1 border border-white/20 text-white/80 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1 disabled:opacity-40">
                    <RefreshCw className={`w-3 h-3 ${busy === "facts" ? "animate-spin" : ""}`} /> Jetzt nachlesen
                  </button>
                </div>
              )}

              {feature.key === "sponsors" && source && !source.unavailable && (
                <div className="ml-6 space-y-2" data-testid="dolibarr-sponsor-source">
                  <p className="text-xs text-white/50">Sponsoren und Partner sind in Dolibarr Geschäftspartner in diesen Kategorien (Kategorien für Kunden); Unterkategorien sind die Stufe.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end max-w-2xl">
                    {[["sponsor_category", "Kategorie Sponsoren", "sponsor"], ["partner_category", "Kategorie Partner", "partner"]].map(([name, label, stateKey]) => (
                      <label key={name} className="block text-[11px] font-bold uppercase tracking-widest text-white/65">
                        {label}
                        <input value={draft[name]} onChange={(e) => setCategories({ ...draft, [name]: e.target.value })} data-testid={`dolibarr-source-${stateKey}-category`}
                          className="mt-1 w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-normal normal-case tracking-normal text-white" />
                        <span className="block mt-1 text-[10px] font-normal normal-case tracking-normal text-white/40">{stateOf(stateKey)}</span>
                      </label>
                    ))}
                    <button type="button" onClick={saveCategories} disabled={!!busy || !categoriesChanged} data-testid="dolibarr-source-save" className="mb-5 px-3 py-2 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">Speichern</button>
                  </div>
                  {feature.enabled && (
                    <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="dolibarr-source-state">
                      {source.fetched_at ? <span className="text-white/60">Stand {new Date(source.fetched_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}: <span className="text-white">{source.counts?.sponsors ?? 0} Sponsoren, {source.counts?.partners ?? 0} Partner</span></span>
                        : <span className="text-[#FFD700]">Noch nichts aus Dolibarr gelesen.</span>}
                      {source.error && <span className="text-[#FF3B30]">Letzter Abgleich fehlgeschlagen ({source.error_text || source.error}) – alter Stand bleibt.</span>}
                      <button type="button" onClick={refreshSponsors} disabled={!!busy} data-testid="dolibarr-source-refresh" className="px-3 py-1 border border-white/20 text-white/80 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1 disabled:opacity-40">
                        <RefreshCw className={`w-3 h-3 ${busy === "sponsors" ? "animate-spin" : ""}`} /> Jetzt nachlesen
                      </button>
                    </div>
                  )}
                </div>
              )}

              {feature.key === "directory" && (
                <div className="ml-6 space-y-3 text-sm" data-testid="dolibarr-directory">
                  <div>
                    <div className="text-xs text-white/45 max-w-2xl">Hat ein Mitglied in Dolibarr dieser Einwilligung zugestimmt, legt der Abgleich seinen Eintrag im Mitgliederverzeichnis an – Name, Foto und Website-Profil aus der Mitgliedskarte.</div>
                    <select value={status?.directory_consent_code || ""} disabled={!!busy} data-testid="dolibarr-directory-consent"
                      onChange={(e) => setFeature("directory", { options: { directory_consent_code: e.target.value } }, e.target.value ? "Das Verzeichnis folgt jetzt dieser Einwilligung." : "Das Verzeichnis folgt keiner Einwilligung mehr.")}
                      className="mt-2 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm disabled:opacity-50">
                      <option value="">– keine (aus) –</option>
                      {consentTexts.map((text) => <option key={text.code} value={text.code}>{text.label} ({text.code})</option>)}
                      {status?.directory_consent_code && !consentTexts.some((text) => text.code === status.directory_consent_code) && (
                        <option value={status.directory_consent_code}>{status.directory_consent_code} (im Modul nicht mehr gefunden)</option>
                      )}
                    </select>
                    {!consentTexts.length && <div className="text-xs text-[#FFD700] mt-1">Keine Einwilligungstexte gelesen – im Modul unter Einrichtung → Vereine → Einwilligungen anlegen.</div>}
                  </div>
                  <div data-testid="dolibarr-directory-fields">
                    <div className="font-bold text-xs">Felder des Website-Profils → Spalten des Verzeichnisses</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-w-2xl">
                      {FIELD_COLUMNS.map(([column, label]) => {
                        const current = status?.directory_field_map?.[column] ?? column;
                        return (
                          <label key={column} className="text-xs">
                            <span className="block text-white/60 mb-1">{label}</span>
                            <select value={current} disabled={!!busy} data-testid={`dolibarr-directory-field-${column}`}
                              onChange={(e) => setFeature("directory", { options: { directory_field_map: { [column]: e.target.value } } }, "Zuordnung gespeichert – gilt ab dem nächsten Abgleich.")}
                              className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm disabled:opacity-50">
                              <option value="">– nicht übernehmen –</option>
                              {known.map((field) => <option key={field.code} value={field.code}>{field.label} ({field.code})</option>)}
                              {current && !known.some((field) => field.code === current) && <option value={current}>{current}</option>}
                            </select>
                          </label>
                        );
                      })}
                    </div>
                    {!known.length && <div className="text-xs text-white/40 mt-1">Noch keine Felder aus dem Modul gelesen – sie erscheinen nach dem nächsten Abgleich (Vereine ab 1.2).</div>}
                  </div>
                </div>
              )}

              {feature.key === "invoices" && canSystem && (
                <p className="ml-6 text-xs text-white/45">Steuersätze, Konditionen und der optionale zweite Schlüssel: <Link to="/admin/dolibarr?tab=connection" className="text-[#29B6E8] hover:text-white" data-testid="dolibarr-invoices-to-connection">Verbindung → Schreibzugriff</Link>.</p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-white/35 mt-3">Ausschalten stoppt die Übernahme; der zuletzt übernommene Stand bleibt stehen.</p>
    </Panel>
  );
}
