// Einstellungen → Spamschutz (#2067): Schwellen der eigenen Stufen und das optionale Cloudflare Turnstile.
// Nur der Superadmin; jede Änderung braucht einen Grund und steht im Protokoll. Der Secret Key geht nur hinein.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";

const NUMBER_FIELDS = [
  ["min_seconds", "Mindestzeit bis zum Absenden (Sekunden)"],
  ["max_age_minutes", "Höchstalter des Formular-Tokens (Minuten)"],
  ["token_max_uses", "Versuche je Token"],
  ["suspect_score", "Punkte ab „verdächtig“"],
  ["random_min_length", "Zufallszeichen ab Länge"],
  ["gmail_dots_min", "Gmail-Punkte ab"],
  ["links_min", "Links ab"],
  ["peak_per_hour", "Spitze ab (je Stunde, Betriebs-Check)"],
  // Registrierung aus der App: ohne Formular-Token, darum enger begrenzt (je Stunde).
  ["app_register_ip_per_hour", "App-Registrierungen je IP und Stunde"],
  ["app_register_global_per_hour", "App-Registrierungen insgesamt je Stunde"],
  ["app_register_peak_per_hour", "App-Spitze ab (je Stunde, Betriebs-Check)"],
];
const WEIGHT_FIELDS = [
  ["random_text", "Zufallszeichen in allen Feldern"],
  ["gmail_dots", "Gmail mit Punkt-Trick"],
  ["links", "Viele Links"],
  ["spam_words", "Spam-Wörter"],
  ["word_filter_hold", "Wortfilter „zurückhalten“"],
  ["word_filter_flag", "Wortfilter „markieren“"],
];
const LIMIT_FIELDS = [
  ["ip_limit", "je IP"],
  ["ip_window_minutes", "IP-Fenster (Min.)"],
  ["email_limit", "je E-Mail"],
  ["email_window_minutes", "E-Mail-Fenster (Min.)"],
];
const SECRET_STATE = { ok: "hinterlegt", missing: "fehlt", unreadable: "nicht lesbar" };

function NumberField({ label, value, onChange, range, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}{range ? ` (${range.min}–${range.max})` : ""}</div>
      <input type="number" min={range?.min} max={range?.max} value={value ?? ""} data-testid={testId}
        onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
        className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
    </label>
  );
}

function ReasonField({ value, onChange, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Grund (Pflicht, steht im Protokoll)</div>
      <input value={value} onChange={(event) => onChange(event.target.value)} maxLength={500} data-testid={testId}
        className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
    </label>
  );
}

function wordsFromText(text) {
  return String(text || "").split("\n").map((word) => word.trim()).filter(Boolean);
}

function changedFields(config, draft) {
  const changes = {};
  for (const key of ["enabled", ...NUMBER_FIELDS.map(([name]) => name)]) {
    if (draft[key] !== config[key]) changes[key] = draft[key];
  }
  if (JSON.stringify(draft.weights) !== JSON.stringify(config.weights)) changes.weights = draft.weights;
  if (JSON.stringify(draft.limits) !== JSON.stringify(config.limits)) changes.limits = draft.limits;
  const words = wordsFromText(draft.spam_words_text);
  if (JSON.stringify(words) !== JSON.stringify(config.spam_words)) changes.spam_words = words;
  return changes;
}

export function SpamGuardSection() {
  const [view, setView] = useState(null);
  const [stats, setStats] = useState(null);
  const [draft, setDraft] = useState(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [turnstileDraft, setTurnstileDraft] = useState(null);
  const [turnstileReason, setTurnstileReason] = useState("");
  const [secret, setSecret] = useState("");
  const [testResult, setTestResult] = useState(null);

  const apply = useCallback((data) => {
    setView(data);
    setDraft({ ...data.config, spam_words_text: (data.config.spam_words || []).join("\n") });
    setTurnstileDraft({ enabled: data.turnstile.enabled, site_key: data.turnstile.site_key || "", mode: data.turnstile.mode, forms: { ...data.turnstile.forms },
      sample_percent: data.turnstile.sample_percent ?? 10 });
  }, []);

  const load = useCallback(async () => {
    try {
      const [{ data }, statsResponse] = await Promise.all([api.get("/spam-guard/settings"), api.get("/spam-guard/stats").catch(() => null)]);
      apply(data);
      if (statsResponse) setStats(statsResponse.data);
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail) || "Spamschutz-Einstellungen konnten nicht geladen werden.");
    }
  }, [apply]);
  useEffect(() => { load(); }, [load]);

  const changes = useMemo(() => (view && draft ? changedFields(view.config, draft) : {}), [view, draft]);
  const dirty = Object.keys(changes).length > 0;

  const run = async (task, success) => {
    if (saving) return;
    setSaving(true);
    try {
      const { data } = await task();
      if (data?.config) apply(data);
      toast.success(success);
      return data;
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail) || "Speichern fehlgeschlagen.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!dirty) return toast.info("Keine Änderungen zum Speichern.");
    if (reason.trim().length < 3) return toast.error("Bitte einen Grund angeben.");
    if (await run(() => api.put("/spam-guard/settings", { changes, reason: reason.trim() }), "Spamschutz gespeichert.")) setReason("");
  };

  const turnstileChanges = () => {
    if (!view || !turnstileDraft) return {};
    const current = view.turnstile;
    const out = {};
    if (turnstileDraft.enabled !== current.enabled) out.enabled = turnstileDraft.enabled;
    if (turnstileDraft.site_key.trim() && turnstileDraft.site_key.trim() !== (current.site_key || "")) out.site_key = turnstileDraft.site_key.trim();
    if (turnstileDraft.mode !== current.mode) out.mode = turnstileDraft.mode;
    if (turnstileDraft.sample_percent !== current.sample_percent) out.sample_percent = turnstileDraft.sample_percent;
    if (JSON.stringify(turnstileDraft.forms) !== JSON.stringify(current.forms)) out.forms = turnstileDraft.forms;
    return out;
  };

  const saveTurnstile = async () => {
    const out = turnstileChanges();
    if (!Object.keys(out).length && !secret.trim()) return toast.info("Keine Änderungen zum Speichern.");
    if (turnstileReason.trim().length < 3) return toast.error("Bitte einen Grund angeben.");
    // Erst den Secret Key (falls neu), dann Schalter und Site Key - einschalten geht nur mit beidem.
    if (secret.trim()) {
      const saved = await run(() => api.put("/spam-guard/turnstile/secret", { secret: secret.trim(), reason: turnstileReason.trim() }), "Secret Key verschlüsselt gespeichert.");
      if (!saved) return;
      setSecret("");
    }
    if (Object.keys(out).length && !(await run(() => api.put("/spam-guard/turnstile", { ...out, reason: turnstileReason.trim() }), "Turnstile gespeichert."))) return;
    setTurnstileReason("");
  };

  const removeSecret = async () => {
    if (turnstileReason.trim().length < 3) return toast.error("Bitte einen Grund angeben.");
    if (await run(() => api.post("/spam-guard/turnstile/secret/remove", { reason: turnstileReason.trim() }), "Secret Key entfernt – Turnstile ist aus.")) setTurnstileReason("");
  };

  const testTurnstile = async () => {
    try {
      const { data } = await api.post("/spam-guard/turnstile/test");
      setTestResult(data);
      (data?.ok ? toast.success : toast.error)(data?.detail || "Test beendet.");
      load();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail) || "Test fehlgeschlagen.");
    }
  };

  if (!view || !draft || !turnstileDraft) return <p className="text-sm text-white/50">Lade Spamschutz …</p>;
  const bounds = view.bounds || {};
  const setField = (key) => (value) => setDraft((current) => ({ ...current, [key]: value }));
  const setWeight = (key) => (value) => setDraft((current) => ({ ...current, weights: { ...current.weights, [key]: value } }));
  const setLimit = (form, key) => (value) => setDraft((current) => ({ ...current, limits: { ...current.limits, [form]: { ...current.limits[form], [key]: value } } }));
  const limitForms = (view.forms || []).filter((form) => form.limits);
  const turnstileForms = (view.forms || []).filter((form) => form.turnstile);
  const secretState = view.turnstile.secret?.state || "missing";

  return (
    <div className="space-y-6" data-testid="spam-guard-section">
      <p className="text-sm text-white/60 max-w-3xl">
        Schützt Kontaktformular, Registrierung, „Passwort vergessen“ und „Bestätigung erneut senden“ ohne externen Dienst: unsichtbares Feld,
        signiertes Formular-Token mit Mindestzeit, Limits je IP und E-Mail (nur als Hash gezählt) und eine Bewertung des Inhalts.
        Sicher erkannter Spam wird still verworfen und nur gezählt; nur verdächtige Kontaktnachrichten landen als „Spam“ in der Kontakt-Inbox, ohne Mail.
      </p>

      {stats && (
        <div className="border border-white/10 bg-[#121212] rounded-sm p-5 text-sm text-white/80" data-testid="spam-guard-stats">
          <strong>{stats.today?.caught || 0}</strong> abgefangen heute · <strong>{stats.week?.caught || 0}</strong> in 7 Tagen
          {stats.quote_week != null && <> · Quote {String(stats.quote_week).replace(".", ",")} %</>}
          {stats.peak_24h?.count > 0 && <> · stärkste Stunde (24 h): {stats.peak_24h.count}</>}
        </div>
      )}

      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-heading font-bold uppercase text-sm" id="spam-guard-enabled-label">Spamschutz an</div>
            <p className="text-xs text-white/50 mt-1">Aus heißt: nur die Limits wirken. Vorgabe: an.</p>
          </div>
          <button type="button" role="switch" aria-checked={!!draft.enabled} aria-labelledby="spam-guard-enabled-label" onClick={() => setField("enabled")(!draft.enabled)} data-testid="spam-guard-enabled"
            className={`relative w-12 h-6 rounded-full shrink-0 transition-colors ${draft.enabled ? "bg-[#29B6E8]" : "bg-white/15"}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${draft.enabled ? "translate-x-6" : ""}`} />
          </button>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {NUMBER_FIELDS.map(([key, label]) => (
            <NumberField key={key} label={label} value={draft[key]} onChange={setField(key)} range={bounds.numbers?.[key]} testId={`spam-guard-${key}`} />
          ))}
        </div>
        <div>
          <div className="font-heading font-bold uppercase text-sm mb-2">Punkte je Merkmal</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {WEIGHT_FIELDS.map(([key, label]) => (
              <NumberField key={key} label={label} value={draft.weights?.[key]} onChange={setWeight(key)} range={bounds.weights} testId={`spam-guard-weight-${key}`} />
            ))}
          </div>
        </div>
        <div>
          <div className="font-heading font-bold uppercase text-sm mb-2">Limits</div>
          <div className="space-y-3">
            {limitForms.map((form) => (
              <div key={form.key}>
                <div className="text-xs text-white/70 mb-1">{form.label}</div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {LIMIT_FIELDS.map(([key, label]) => (
                    <NumberField key={key} label={label} value={draft.limits?.[form.key]?.[key]} onChange={setLimit(form.key, key)} range={bounds.limits?.[key]} testId={`spam-guard-limit-${form.key}-${key}`} />
                  ))}
                </div>
              </div>
            ))}
            <p className="text-xs text-white/50">Die Registrierung begrenzt „Zugang“ → „Grenze je Netz“.</p>
          </div>
        </div>
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Spam-Wörter (eines je Zeile, ganze Wörter)</div>
          <textarea rows={5} value={draft.spam_words_text} onChange={(event) => setField("spam_words_text")(event.target.value)} data-testid="spam-guard-words"
            className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
        </label>
        <ReasonField value={reason} onChange={setReason} testId="spam-guard-reason" />
        <button type="button" onClick={save} disabled={saving || !dirty} data-testid="spam-guard-save"
          className="px-4 py-2 bg-[#29B6E8] text-black text-xs font-bold uppercase rounded-sm disabled:opacity-50">Spamschutz speichern</button>
      </div>

      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4" data-testid="spam-guard-turnstile">
        <div>
          <div className="font-heading font-bold uppercase text-sm">Cloudflare Turnstile (optional)</div>
          <p className="text-xs text-white/50 mt-1">
            Eine zusätzliche Stufe, Vorgabe aus. Ist Cloudflare nicht erreichbar, entscheiden die eigenen Stufen allein – niemand wird ausgesperrt.
            In der App gilt Turnstile nicht. Datenschutz: Turnstile überträgt IP-Adresse und Browsermerkmale an Cloudflare (USA); die
            Datenschutzerklärung nennt das automatisch, sobald Turnstile an ist und für ein Formular gilt.
          </p>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm" id="turnstile-enabled-label">Turnstile an</span>
          <button type="button" role="switch" aria-checked={!!turnstileDraft.enabled} aria-labelledby="turnstile-enabled-label" data-testid="turnstile-enabled"
            onClick={() => setTurnstileDraft((current) => ({ ...current, enabled: !current.enabled }))}
            className={`relative w-12 h-6 rounded-full shrink-0 transition-colors ${turnstileDraft.enabled ? "bg-[#29B6E8]" : "bg-white/15"}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${turnstileDraft.enabled ? "translate-x-6" : ""}`} />
          </button>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Site Key (öffentlich)</div>
            <input value={turnstileDraft.site_key} onChange={(event) => setTurnstileDraft((current) => ({ ...current, site_key: event.target.value }))} data-testid="turnstile-site-key"
              className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
          </label>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Secret Key – {SECRET_STATE[secretState] || secretState}</div>
            <input type="password" autoComplete="new-password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={secretState === "ok" ? "hinterlegt – nur zum Ersetzen ausfüllen" : "Secret Key eintragen"}
              data-testid="turnstile-secret" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
            {view.turnstile.secret?.detail && <p className="mt-1 text-xs text-[#FF8A80]">{view.turnstile.secret.detail}</p>}
          </label>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Modus</div>
            <select value={turnstileDraft.mode} onChange={(event) => setTurnstileDraft((current) => ({ ...current, mode: event.target.value }))} data-testid="turnstile-mode"
              className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
              {(view.turnstile.modes || []).map((mode) => <option key={mode.key} value={mode.key}>{mode.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-white/50">„Nur bei Verdacht“: das Formular zeigt das Widget erst, wenn der Inhalt verdächtig ist.</p>
            {turnstileDraft.mode === "suspect" && (
              <p className="mt-1 text-xs text-warn" data-testid="turnstile-suspect-warning">
                Achtung: Bots können an der nachträglichen Rückfrage lernen, dass sie aufgefallen sind. Darum fragt der Server zusätzlich einen
                Zufallsanteil unauffälliger Anfragen. Sicherer ist „Immer“.
              </p>
            )}
          </label>
          {turnstileDraft.mode === "suspect" && (
            <NumberField label="Zufallsanteil unauffälliger Anfragen (%)" value={turnstileDraft.sample_percent}
              onChange={(value) => setTurnstileDraft((current) => ({ ...current, sample_percent: value }))}
              range={view.turnstile.sample_bounds} testId="turnstile-sample-percent" />
          )}
          <fieldset>
            <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Gilt für</legend>
            {turnstileForms.map((form) => (
              <label key={form.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!turnstileDraft.forms[form.key]} data-testid={`turnstile-form-${form.key}`}
                  onChange={(event) => setTurnstileDraft((current) => ({ ...current, forms: { ...current.forms, [form.key]: event.target.checked } }))} />
                {form.label}
              </label>
            ))}
            <p className="mt-1 text-xs text-white/50">„Passwort vergessen“ teilt sich die Adresse mit der App – dort kein Turnstile.</p>
          </fieldset>
        </div>
        <ReasonField value={turnstileReason} onChange={setTurnstileReason} testId="turnstile-reason" />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={saveTurnstile} disabled={saving} data-testid="turnstile-save"
            className="px-4 py-2 bg-[#29B6E8] text-black text-xs font-bold uppercase rounded-sm disabled:opacity-50">Turnstile speichern</button>
          <button type="button" onClick={testTurnstile} disabled={saving || secretState !== "ok"} data-testid="turnstile-test"
            className="px-4 py-2 border border-white/15 text-xs font-bold uppercase rounded-sm disabled:opacity-50">Testen</button>
          {secretState !== "missing" && (
            <button type="button" onClick={removeSecret} disabled={saving} data-testid="turnstile-remove-secret"
              className="px-4 py-2 border border-live/30 text-live text-xs font-bold uppercase rounded-sm disabled:opacity-50">Secret Key entfernen</button>
          )}
        </div>
        {(testResult || view.turnstile.last_test) && (
          <p className={`text-xs ${(testResult || view.turnstile.last_test).ok ? "text-ok" : "text-[#FF8A80]"}`} data-testid="turnstile-test-result">
            Letzter Test: {(testResult || view.turnstile.last_test).detail}
          </p>
        )}
      </div>
    </div>
  );
}
