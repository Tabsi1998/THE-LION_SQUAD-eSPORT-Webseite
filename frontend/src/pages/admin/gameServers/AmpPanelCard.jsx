import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Server } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";

// AMP-Panel (#2112): Zugang für den Sync-Modus „AMP-Panel“. Adresse, Benutzer und Passwort; das Passwort liegt
// verschlüsselt auf dem Server und kommt nie zurück - die Seite weiß nur, ob eines gespeichert ist.
export function AmpPanelCard() {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);
  const [form, setForm] = useState({ base_url: "", username: "", password: "", enabled: true });
  const [busy, setBusy] = useState("");
  const [test, setTest] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/settings/amp");
      setState(data || {});
      setForm({ base_url: data?.base_url || "", username: data?.username || "", password: "", enabled: data?.enabled !== false });
    } catch (error) {
      setState({ error: formatApiError(error?.response?.data?.detail) || "Die AMP-Einstellungen ließen sich nicht laden." });
    }
  }, []);

  useEffect(() => { if (open && !state) load(); }, [open, state, load]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const configured = !!state?.configured;
  // Das gespeicherte Passwort gilt nur für die bisherige Adresse (#2112) - bei einer neuen muss es neu eingetragen werden.
  const addressChanged = configured && form.base_url.trim() !== (state?.base_url || "");

  const save = async (event) => {
    event.preventDefault();
    const address = form.base_url.trim();
    if (address && !address.toLowerCase().startsWith("https://")) {
      toast.error("Die AMP-Adresse beginnt mit https://.");
      return;
    }
    if (addressChanged && !form.password.trim()) {
      toast.error("Neue Adresse: bitte das Passwort neu eintragen.");
      return;
    }
    setBusy("save");
    try {
      await api.put("/settings/amp", {
        base_url: address,
        username: form.username.trim(),
        enabled: form.enabled,
        ...(form.password.trim() ? { password: form.password } : {}),
      });
      toast.success("AMP-Zugang gespeichert.");
      setTest(null);
      await load();
    } catch (error) {
      toast.error(formatApiError(error?.response?.data?.detail) || "Speichern fehlgeschlagen.");
    } finally {
      setBusy("");
    }
  };

  const runTest = async () => {
    setBusy("test");
    try {
      const { data } = await api.post("/settings/amp/test");
      setTest(data);
    } catch (error) {
      setTest({ ok: false, error: formatApiError(error?.response?.data?.detail) || "Test fehlgeschlagen." });
    } finally {
      setBusy("");
    }
  };

  const clearPassword = async () => {
    if (!await confirm({
      title: "AMP-Passwort entfernen?",
      description: "Ohne Passwort fragt die Website das Panel nicht mehr ab. Server im Modus „AMP-Panel“ bekommen dann einen Sync-Hinweis.",
      confirmLabel: "Passwort entfernen",
      tone: "danger",
    })) return;
    setBusy("clear");
    try {
      await api.put("/settings/amp", { clear_password: true, enabled: form.enabled });
      toast.success("AMP-Passwort entfernt.");
      setTest(null);
      await load();
    } catch (error) {
      toast.error(formatApiError(error?.response?.data?.detail) || "Entfernen fehlgeschlagen.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="mb-6 border border-white/10 bg-[#121212] rounded-sm" data-testid="amp-panel-card">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} data-testid="amp-panel-toggle" className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="inline-flex items-center gap-2 min-w-0">
          <Server className="w-4 h-4 shrink-0 text-[#29B6E8]" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/70">AMP-Panel</span>
          <span className="text-xs text-white/45 truncate">für Server mit Sync „AMP-Panel“</span>
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-white/50 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <form onSubmit={save} className="border-t border-white/10 p-4 space-y-3" data-testid="amp-panel-form">
          {state?.error && <p className="text-sm text-warn">{state.error}</p>}
          <p className="text-xs text-white/50">Am besten ein eigener AMP-Benutzer nur mit Leserechten. Das Passwort wird verschlüsselt gespeichert und nie wieder angezeigt.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <AmpField label="Adresse (https)" value={form.base_url} onChange={(v) => set("base_url", v)} placeholder="https://amp.example.org" testId="amp-base-url" />
            <AmpField label="Benutzer" value={form.username} onChange={(v) => set("username", v)} testId="amp-username" autoComplete="off" />
            <AmpField
              label={configured ? "Passwort (gespeichert – leer lassen, um es zu behalten)" : "Passwort"}
              type="password"
              value={form.password}
              onChange={(v) => set("password", v)}
              testId="amp-password"
              autoComplete="new-password"
            />
            {addressChanged && (
              <p className="md:col-span-2 text-xs text-warn" data-testid="amp-password-needed">
                Neue Adresse: Das gespeicherte Passwort gilt nur für die bisherige. Bitte das Passwort neu eintragen.
              </p>
            )}
            <label className="flex items-center gap-2 text-sm self-end pb-2">
              <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} className="accent-[#29B6E8]" data-testid="amp-enabled" />
              Panel abfragen
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={!!busy} data-testid="amp-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40">Speichern</button>
            <button type="button" disabled={!!busy || !configured} onClick={runTest} data-testid="amp-test" className="px-4 py-2 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-40">Verbindung testen</button>
            {configured && (
              <button type="button" disabled={!!busy} onClick={clearPassword} data-testid="amp-clear-password" className="px-4 py-2 border border-live/40 text-live font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-live/10 disabled:opacity-40">Passwort entfernen</button>
            )}
          </div>
          {test && (
            <div className={`text-sm ${test.ok ? "text-ok" : "text-warn"}`} data-testid="amp-test-result">
              {test.ok
                ? `Verbunden: ${test.instance_count} Instanz${test.instance_count === 1 ? "" : "en"}${test.instances?.length ? ` – ${test.instances.map((item) => item.name).filter(Boolean).join(", ")}` : ""}.`
                : `Keine Verbindung: ${test.error}`}
            </div>
          )}
        </form>
      )}
    </section>
  );
}

function AmpField({ label, value, onChange, type = "text", placeholder = "", testId, autoComplete }) {
  return (
    <label className="block min-w-0">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} data-testid={testId}
        className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm focus:border-[#29B6E8] focus:outline-none" />
    </label>
  );
}
