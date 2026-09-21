import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Link2, PlayCircle, RefreshCw, ShieldCheck, Unlink, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { CAPABILITY_LABELS, LINK_STATUS_LABELS, MODE_HINTS, MODE_LABELS, PREVIEW_STATE_LABELS, describeSync, formatDate } from "@/lib/dolibarr";

// Dolibarr (#316, #295, #297, #330). Wer was sieht: Verbindung und Schlüssel nur
// „System“, Zuordnungen und Umstellung die Vereinsverwaltung, die Freigabe
// „Funktion → Bereich“ nur der Superadmin. Der Schlüssel kommt nie zurück.

const TONES = { ok: "border-[#00FF88]/25", warn: "border-[#FFD700]/30", danger: "border-[#FF3B30]/40", plain: "border-white/10" };
const TYPE_LABELS = { ordinary: "Ordentlich", supporting: "Unterstützend", honorary: "Ehrenmitglied", youth: "Jugend", guest: "Gast", former: "Ehemalig" };

export default function AdminDolibarrPage() {
  const { can, isSuperAdmin } = useAuth();
  const confirm = useConfirm();
  const canSystem = can("system");
  const canClub = can("club");
  const tabs = [
    { key: "overview", label: "Stand" },
    ...(canClub ? [{ key: "links", label: "Zuordnungen" }, { key: "preview", label: "Umstellung" }] : []),
    { key: "policy", label: "Funktionen" },
    ...(canSystem ? [{ key: "connection", label: "Verbindung" }] : []),
  ];
  const [tab, setTab] = useState("overview");
  const [status, setStatus] = useState(null);
  const [links, setLinks] = useState([]);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({ base_url: "", api_key: "", instance: "", entity: 1, environment: "production" });
  const [testResult, setTestResult] = useState(null);
  const [webhookPath, setWebhookPath] = useState("");
  const [policyMap, setPolicyMap] = useState({});
  const [policyPreview, setPolicyPreview] = useState(null);
  // Ungespeicherte Häkchen dürfen nicht verschwinden, nur weil die Seite nachlädt.
  const policyDirtyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/dolibarr/status");
      setStatus(data);
      setForm((current) => ({ ...current, base_url: data.base_url || "", instance: data.instance || "", entity: data.entity || 1, environment: data.environment || "production" }));
      if (!policyDirtyRef.current) setPolicyMap(data.policy?.map || {});
      if (canClub) {
        const result = await api.get("/admin/dolibarr/links");
        setLinks(Array.isArray(result.data) ? result.data : []);
      }
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  }, [canClub]);

  useEffect(() => { load(); }, [load]);

  const run = async (key, action, success) => {
    if (busy) return;
    setBusy(key);
    try {
      const result = await action();
      if (success) toast.success(typeof success === "function" ? success(result) : success);
      await load();
      return result;
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      return null;
    } finally {
      setBusy("");
    }
  };

  const saveSettings = (payload, message = "Gespeichert.") => run("save", () => api.put("/admin/dolibarr/settings", payload), message);
  const syncNow = (full) => run("sync", () => api.post(`/admin/dolibarr/sync?full=${full ? "true" : "false"}`), ({ data }) => (
    data.ok ? `Abgleich fertig: ${data.seen} gelesen, ${data.applied} übernommen.` : `Abgleich ohne Ergebnis: ${data.text || data.skipped}`
  ));
  const loadPreview = async () => {
    const result = await run("preview", () => api.get("/admin/dolibarr/preview"));
    if (result) setPreview(result.data);
  };
  const confirmLink = async (row) => {
    const ok = await confirm({
      title: "Zuordnung bestätigen?",
      description: `${row.display_name || row.username} ist das Mitglied ${row.member_name || ""} (Nr. ${row.member_ref}). Im Live-Betrieb übernimmt das Konto sofort Status, Beitrag und Funktionen aus Dolibarr.`,
      confirmLabel: "Bestätigen", tone: "info",
    });
    if (!ok) return;
    const result = await run("link", () => api.post("/admin/dolibarr/links", { user_id: row.user_id, member_id: row.member_id }), "Zuordnung bestätigt.");
    if (result && preview) loadPreview();
  };
  const removeLink = async (link) => {
    const ok = await confirm({
      title: "Zuordnung lösen?",
      description: "Der zuletzt übernommene Stand bleibt stehen und wird wieder hier gepflegt. Rechte aus Vereinsfunktionen enden sofort.",
      confirmLabel: "Lösen",
    });
    if (ok) run("unlink", () => api.delete(`/admin/dolibarr/links/${link.user_id}`), "Zuordnung gelöst.");
  };
  const testConnection = async () => {
    const result = await run("test", () => api.post("/admin/dolibarr/test"));
    if (result) setTestResult(result.data);
  };
  const newWebhook = async () => {
    const result = await run("webhook", () => api.post("/admin/dolibarr/webhook-token"), "Neues Token erzeugt – die Adresse steht unten, sie wird nur jetzt gezeigt.");
    if (result) setWebhookPath(result.data.path);
  };
  const previewPolicy = async () => {
    const result = await run("policy", () => api.put("/admin/dolibarr/function-policy", { map: policyMap, confirm: false }));
    if (result) setPolicyPreview(result.data);
  };
  const approvePolicy = async () => {
    const ok = await confirm({
      title: "Freigabe gelten lassen?",
      description: "Ab jetzt bekommen Personen mit diesen Funktionen den Bereich von selbst und verlieren ihn mit dem Ende der Funktion. Lokale Vorstandsposten verleihen dann keine Rechte mehr.",
      confirmLabel: "Freigeben", tone: "info",
    });
    if (!ok) return;
    const result = await run("policy", () => api.put("/admin/dolibarr/function-policy", { map: policyMap, confirm: true }), "Freigabe gespeichert.");
    if (result) {
      policyDirtyRef.current = false;
      setPolicyPreview(null);
      load();
    }
  };

  const sync = describeSync(status?.sync, status?.mode);
  const functionCodes = preview?.function_codes || [];
  const knownCodes = [...new Set([...Object.keys(policyMap), ...functionCodes.map((fn) => fn.code)])].sort();

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Mitgliederverwaltung</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Dolibarr</h1>
          <p className="text-sm text-white/55 mt-2 max-w-2xl">
            Dolibarr mit dem Vereinsmodul führt Mitgliedschaft, Beiträge und Vereinsfunktionen – die Website übernimmt den Stand für
            bestätigt zugeordnete Konten. Der Abgleich löst keine Mails und keine Discord-Meldungen aus.
          </p>
        </div>
        <button type="button" onClick={() => syncNow(false)} disabled={!!busy || status?.mode === "off"} data-testid="dolibarr-sync"
          className="px-4 py-2 border border-[#29B6E8]/50 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-xs inline-flex items-center gap-2 disabled:opacity-40">
          <RefreshCw className={`w-3.5 h-3.5 ${busy === "sync" ? "animate-spin" : ""}`} /> Jetzt abgleichen
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Tile label="Modus" value={MODE_LABELS[status?.mode] || "–"} detail={MODE_HINTS[status?.mode]} tone={status?.mode === "live" ? "ok" : status?.mode === "preview" ? "warn" : "plain"} testId="dolibarr-mode" />
        <Tile label="Letzter Abgleich" value={sync.tone === "ok" ? "in Ordnung" : sync.tone === "danger" ? "liefert nichts" : "–"} detail={sync.text} tone={sync.tone} testId="dolibarr-sync-tile" />
        <Tile label="Bestätigte Zuordnungen" value={status?.links?.verified ?? 0} detail={`${status?.members_led_by_dolibarr ?? 0} Mitgliedschaften führt Dolibarr`} tone="plain" />
        <Tile label="Zu klären" value={(status?.open_links ?? 0) + (status?.unmapped_types ?? 0)} detail={`${status?.open_links ?? 0} offene Zuordnungen · ${status?.unmapped_types ?? 0} mit unbekannter Mitgliedsart`} tone={(status?.open_links || 0) + (status?.unmapped_types || 0) > 0 ? "warn" : "ok"} />
      </div>

      <div className="flex flex-wrap gap-2 mb-5" role="tablist">
        {tabs.map((entry) => (
          <button key={entry.key} type="button" role="tab" aria-selected={tab === entry.key} onClick={() => setTab(entry.key)} data-testid={`dolibarr-tab-${entry.key}`}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-sm border ${tab === entry.key ? "border-[#29B6E8] text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 text-white/60 hover:text-white"}`}>
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Panel title="Was das Vereinsmodul kann">
            <p className="text-xs text-white/45 mb-3">Modul {status?.sync?.module_version || "–"}, API-Version {status?.sync?.api_version ?? "–"}. Was fehlt, setzt die Website nicht voraus.</p>
            <ul className="space-y-1.5 text-sm">
              {Object.entries(CAPABILITY_LABELS).map(([key, label]) => {
                const has = status?.sync?.capabilities?.[key];
                return (
                  <li key={key} className="flex items-center gap-2">
                    {has ? <CheckCircle2 className="w-4 h-4 text-[#00FF88] shrink-0" /> : <XCircle className="w-4 h-4 text-white/25 shrink-0" />}
                    <span className={has ? "text-white/85" : "text-white/40"}>{label}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>
          <Panel title="So läuft die Umstellung">
            <ol className="list-decimal pl-5 space-y-2 text-sm text-white/75">
              <li><strong>Verbindung</strong> eintragen und testen (nur „System“).</li>
              <li>Modus <strong>Vorschau</strong>: Dolibarr wird gelesen, nichts wird übernommen.</li>
              <li>Unter <strong>Umstellung</strong> die Vorschau ansehen, Mitgliedsarten zuordnen, Konten bestätigen.</li>
              <li>Unter <strong>Funktionen</strong> legt der Superadmin fest, welche Funktion die Vereinsverwaltung öffnet.</li>
              <li>Modus <strong>Live</strong>. Zurück geht jederzeit: „Aus“ stoppt die Übernahme, der letzte Stand bleibt.</li>
            </ol>
          </Panel>
        </div>
      )}

      {tab === "links" && canClub && (
        <Panel title="Konto ↔ Mitglied">
          <p className="text-xs text-white/45 mb-3">Eine Zuordnung gilt erst, wenn sie bestätigt ist. E-Mail und Mitgliedsnummer finden Kandidaten, beweisen aber nichts. Bestätigen geht unter „Umstellung“.</p>
          {links.length === 0 ? <Empty text="Noch keine Zuordnungen." /> : (
            <div className="divide-y divide-white/5">
              {links.map((link) => (
                <div key={link.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 py-2.5" data-testid={`dolibarr-link-${link.username}`}>
                  <div className="sm:w-56 min-w-0">
                    <div className="font-bold truncate">{link.display_name || link.username}</div>
                    <div className="text-xs text-white/45">{link.member_ref ? `Mitglied Nr. ${link.member_ref}` : "ohne Mitglied"}</div>
                  </div>
                  <span className={`text-[10px] font-black uppercase tracking-widest ${link.status === "verified" ? "text-[#00FF88]" : link.status === "conflict" ? "text-[#FF3B30]" : "text-[#FFD700]"}`}>{LINK_STATUS_LABELS[link.status] || link.status}</span>
                  <div className="text-xs text-white/50 flex-1 min-w-0">{link.note || (link.verified_at ? `seit ${formatDate(link.verified_at)}` : "")}</div>
                  {link.status === "verified" && (
                    <button type="button" onClick={() => removeLink(link)} className="text-[10px] uppercase font-bold text-[#FF6B6B] inline-flex items-center gap-1"><Unlink className="w-3 h-3" /> Lösen</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {tab === "preview" && canClub && (
        <div className="space-y-4">
          <Panel title="Vorschau der Umstellung">
            <p className="text-xs text-white/45 mb-3">Trockenlauf: liest alle Mitglieder aus Dolibarr und sucht zu jedem Konto mit bestätigter E-Mail das Mitglied. Schreibt nichts.</p>
            <button type="button" onClick={loadPreview} disabled={!!busy || status?.mode === "off"} data-testid="dolibarr-preview-run"
              className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs inline-flex items-center gap-2 disabled:opacity-40">
              <PlayCircle className="w-4 h-4" /> {busy === "preview" ? "Lese …" : "Vorschau erstellen"}
            </button>
            {preview && (
              <div className="mt-4 text-sm text-white/70" data-testid="dolibarr-preview-summary">
                {preview.members_in_dolibarr} Mitglieder in Dolibarr · {preview.users_checked} Konten geprüft · {preview.rows.length} Zeilen · {preview.members_without_account.length} Mitglieder ohne Konto
              </div>
            )}
          </Panel>
          {preview && (
            <>
              <Panel title="Konten">
                {preview.rows.length === 0 ? <Empty text="Kein Konto passt zu einem Mitglied." /> : (
                  <div className="divide-y divide-white/5">
                    {preview.rows.map((row) => (
                      <div key={row.user_id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 py-2.5" data-testid={`dolibarr-preview-${row.username}`}>
                        <div className="sm:w-52 min-w-0">
                          <div className="font-bold truncate">{row.display_name || row.username}</div>
                          <div className="text-xs text-white/45">hier: {row.local_status}{row.requested_ref ? ` · gibt Nr. ${row.requested_ref} an` : ""}</div>
                        </div>
                        <div className="text-xs text-white/70 flex-1 min-w-0">
                          {PREVIEW_STATE_LABELS[row.state] || row.state}
                          {row.member_id ? ` → ${row.member_name} (Nr. ${row.member_ref}, ${row.dolibarr_status})` : ""}
                          {row.would_change_status && <span className="text-[#FFD700]"> · Status ändert sich</span>}
                        </div>
                        {row.state === "match" && (
                          <button type="button" onClick={() => confirmLink(row)} disabled={!!busy} className="px-3 py-1.5 border border-[#00FF88]/50 text-[#00FF88] text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 disabled:opacity-40">
                            <Link2 className="w-3 h-3" /> Bestätigen
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
              <Panel title="Mitgliedsarten zuordnen">
                <p className="text-xs text-white/45 mb-3">Eine Art ohne Zuordnung bleibt Mitglied, aber ohne Mitgliedsart – nie still „ordentlich“.{!canSystem && " Ändern kann das, wer „System“ hat."}</p>
                <div className="space-y-2">
                  {preview.types.map((type) => (
                    <label key={type.id} className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
                      <span className="sm:w-72">{type.label} <span className="text-white/40">({type.members})</span></span>
                      <select value={status?.type_map?.[String(type.id)] || ""} disabled={!canSystem || !!busy}
                        onChange={(e) => saveSettings({ type_map: { ...(status?.type_map || {}), [String(type.id)]: e.target.value } }, "Mitgliedsart zugeordnet.")}
                        className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm disabled:opacity-50">
                        <option value="">– nicht zugeordnet –</option>
                        {(status?.website_types || []).map((key) => <option key={key} value={key}>{TYPE_LABELS[key] || key}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              </Panel>
              {preview.members_without_account.length > 0 && (
                <Panel title="Mitglieder ohne Website-Konto">
                  <div className="text-sm text-white/70 columns-1 sm:columns-2 lg:columns-3">
                    {preview.members_without_account.map((entry) => <div key={entry.member_id}>{entry.name} <span className="text-white/35">Nr. {entry.ref}</span></div>)}
                  </div>
                </Panel>
              )}
            </>
          )}
        </div>
      )}

      {tab === "policy" && (
        <Panel title="Funktion → Bereich">
          <p className="text-xs text-white/45 mb-3">
            Einmal festlegen, danach läuft es von selbst: Beginnt eine Funktion in Dolibarr, öffnet sich der Bereich; endet sie, ist er weg.
            Ableitbar ist nur die Vereinsverwaltung – nie System, Moderation, Rollenvergabe oder Geldfreigaben. Zwei-Faktor bleibt Pflicht.
            {status?.policy?.active ? ` Gültig: Fassung ${status.policy.version} vom ${formatDate(status.policy.approved_at)}.` : " Noch keine gültige Freigabe – bis dahin zählt der lokale Vorstandsposten."}
          </p>
          {knownCodes.length === 0 ? <Empty text="Noch keine Funktionscodes bekannt – zuerst unter „Umstellung“ die Vorschau erstellen." /> : (
            <div className="space-y-2">
              {knownCodes.map((code) => {
                const info = functionCodes.find((fn) => fn.code === code);
                const checked = (policyMap[code] || []).includes("club");
                return (
                  <label key={code} className="flex items-center gap-3 text-sm" data-testid={`dolibarr-policy-${code}`}>
                    <input type="checkbox" checked={checked} disabled={!isSuperAdmin} className="accent-[#29B6E8]"
                      onChange={(e) => { policyDirtyRef.current = true; setPolicyPreview(null); setPolicyMap((current) => ({ ...current, [code]: e.target.checked ? ["club"] : [] })); }} />
                    <span className="font-mono text-xs text-white/50 w-44 truncate">{code}</span>
                    <span>{info?.label || code}{info ? <span className="text-white/40"> ({info.holders})</span> : null}</span>
                    <span className="text-xs text-white/45">{checked ? "öffnet die Vereinsverwaltung" : "öffnet nichts"}</span>
                  </label>
                );
              })}
            </div>
          )}
          {isSuperAdmin ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={previewPolicy} disabled={!!busy} data-testid="dolibarr-policy-preview" className="px-4 py-2 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40">Wer bekäme was?</button>
              <button type="button" onClick={approvePolicy} disabled={!!busy || !policyPreview} data-testid="dolibarr-policy-approve" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs inline-flex items-center gap-2 disabled:opacity-40">
                <ShieldCheck className="w-4 h-4" /> Freigeben
              </button>
            </div>
          ) : <p className="mt-4 text-xs text-white/45">Ändern und freigeben kann nur der Superadmin, weil die Freigabe Rechte vergibt.</p>}
          {policyPreview && (
            <div className="mt-4 border border-white/10 rounded-sm p-3 text-sm" data-testid="dolibarr-policy-affected">
              {policyPreview.affected.length === 0 ? "Mit dieser Fassung bekäme im Moment niemand einen Bereich." : (
                <ul className="space-y-1">
                  {policyPreview.affected.map((row) => (
                    <li key={row.user_id}><strong>{row.display_name || row.username}</strong>: {row.grants.map((grant) => `Vereinsverwaltung (als ${grant.function_label})`).join(", ")}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Panel>
      )}

      {tab === "connection" && canSystem && (
        <div className="grid lg:grid-cols-2 gap-4">
          <Panel title="Verbindung">
            <div className="space-y-3">
              <Field label="Adresse von Dolibarr (https)" value={form.base_url} onChange={(v) => setForm({ ...form, base_url: v })} placeholder="https://erp.example.org" testId="dolibarr-base-url" />
              <Field label={`API-Schlüssel des Website-Benutzers${status?.api_key_configured ? " (gespeichert – leer lassen, um ihn zu behalten)" : ""}`} value={form.api_key} onChange={(v) => setForm({ ...form, api_key: v })} type="password" testId="dolibarr-api-key" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Kennung der Installation" value={form.instance} onChange={(v) => setForm({ ...form, instance: v })} placeholder="verein" testId="dolibarr-instance" />
                <label className="block">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Umgebung</div>
                  <select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                    <option value="production">Produktion (nur https)</option>
                    <option value="test">Test</option>
                  </select>
                </label>
              </div>
              <p className="text-xs text-white/40">In Dolibarr einen eigenen Benutzer „website“ anlegen, der nur „Vereinsübersicht lesen“ und „Mitglieder-Zusammenfassung für die Website“ darf. Der Schlüssel wird verschlüsselt gespeichert und nie wieder angezeigt.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!!busy} data-testid="dolibarr-save" onClick={() => saveSettings({ base_url: form.base_url, instance: form.instance, environment: form.environment, ...(form.api_key ? { api_key: form.api_key } : {}) }).then(() => setForm((current) => ({ ...current, api_key: "" })))}
                  className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40">Speichern</button>
                <button type="button" disabled={!!busy || !status?.api_key_configured} onClick={testConnection} data-testid="dolibarr-test" className="px-4 py-2 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40">Verbindung testen</button>
              </div>
              {testResult && (
                <div className={`text-sm ${testResult.ok ? "text-[#00FF88]" : "text-[#FF6B6B]"}`} data-testid="dolibarr-test-result">
                  {testResult.ok ? `Verbunden: Modul ${testResult.module_version}, API-Version ${testResult.api_version}.` : `Keine Verbindung: ${testResult.text}`}
                </div>
              )}
            </div>
          </Panel>
          <div className="space-y-4">
            <Panel title="Modus">
              <div className="space-y-2">
                {Object.keys(MODE_LABELS).map((mode) => (
                  <div key={mode} className="flex items-start gap-3 text-sm">
                    <input type="radio" id={`dolibarr-mode-${mode}`} name="dolibarr-mode" checked={status?.mode === mode} disabled={!!busy} onChange={() => saveSettings({ mode }, `Modus: ${MODE_LABELS[mode]}.`)} className="mt-1 accent-[#29B6E8]" data-testid={`dolibarr-mode-${mode}`} />
                    <div>
                      <label htmlFor={`dolibarr-mode-${mode}`} className="font-bold">{MODE_LABELS[mode]}</label>
                      <div className="text-xs text-white/45">{MODE_HINTS[mode]}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-start gap-3 text-sm">
                <input type="checkbox" id="dolibarr-auto-link" checked={!!status?.auto_link_verified_email} disabled={!!busy} onChange={(e) => saveSettings({ auto_link_verified_email: e.target.checked })} className="mt-1 accent-[#29B6E8]" data-testid="dolibarr-auto-link" />
                <div>
                  <label htmlFor="dolibarr-auto-link" className="font-bold">Konten über die bestätigte E-Mail von selbst zuordnen</label>
                  <div className="text-xs text-white/45">Nur bei genau einem Treffer und wenn das Mitglied noch keinem Konto gehört. Aus heißt: Jede Zuordnung bestätigt die Vereinsverwaltung.</div>
                </div>
              </div>
            </Panel>
            <Panel title="Benachrichtigung aus Dolibarr (Webhook)">
              <p className="text-xs text-white/45 mb-3">Optional. Dolibarr meldet, dass sich ein Mitglied geändert hat; die Website liest dann nach. Ohne Webhook holt der Abgleich alle 10 Minuten auf. {status?.webhook_configured ? "Ein Token ist eingerichtet." : "Noch kein Token."}</p>
              <button type="button" onClick={newWebhook} disabled={!!busy} className="px-4 py-2 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40">Neue Adresse erzeugen</button>
              {webhookPath && <div className="mt-3 text-xs font-mono break-all border border-[#FFD700]/30 rounded-sm p-2" data-testid="dolibarr-webhook-path">{window.location.origin}{webhookPath}</div>}
            </Panel>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

function Tile({ label, value, detail, tone = "plain", testId }) {
  return (
    <div className={`border rounded-sm bg-[#121212] p-4 ${TONES[tone] || TONES.plain}`} data-testid={testId}>
      <div className="text-[10px] uppercase tracking-widest text-white/50 font-bold">{label}</div>
      <div className="mt-1 font-heading text-xl font-black">{value}</div>
      {detail && <div className="mt-1 text-xs text-white/50 break-words">{detail}</div>}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <section className="border border-white/10 bg-[#121212] rounded-sm p-5">
      <h2 className="font-heading font-bold uppercase mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ text }) {
  return <div className="text-sm text-white/40 py-4">{text}</div>;
}

function Field({ label, value, onChange, placeholder = "", type = "text", testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} data-testid={testId} autoComplete="off"
        className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
    </label>
  );
}
