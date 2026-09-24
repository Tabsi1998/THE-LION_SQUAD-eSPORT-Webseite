import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Link2, RefreshCw, ToggleLeft } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { api, formatRequestError } from "@/lib/api";

// Alle Verbindungen auf einer Seite (#546, Wunsch des Vorstands): welche aktiv, welche aus, welche fehlen –
// und welche zwar gespeichert, aber mit dem aktuellen Schlüssel nicht lesbar sind. Den Zustand rechnet das
// Backend, hier stehen nur Zeilen mit einem Satz dazu und dem Weg zur Seite, auf der man es ändert.

export const STATE_META = {
  active: { label: "aktiv", className: "border-[#00FF88]/40 text-[#00FF88] bg-[#00FF88]/10" },
  off: { label: "aus", className: "border-white/15 text-white/50 bg-white/5" },
  missing: { label: "fehlt", className: "border-[#FFD700]/40 text-[#FFD700] bg-[#FFD700]/10" },
  unreadable: { label: "nicht lesbar", className: "border-[#FF3B30]/50 text-[#FF3B30] bg-[#FF3B30]/10" },
  error: { label: "Fehler", className: "border-[#FF3B30]/50 text-[#FF3B30] bg-[#FF3B30]/10" },
};

export function StateChip({ state, testId }) {
  const meta = STATE_META[state] || STATE_META.off;
  return <span data-testid={testId} className={`inline-flex items-center px-2 py-0.5 rounded-sm border text-[10px] font-bold uppercase tracking-wider ${meta.className}`}>{meta.label}</span>;
}

const PLATFORM_GROUPS = [["social", "Socials"], ["game", "Spielkonten"]];

// Haken je Plattform (#558): abgehakt heißt nirgends - nicht im Profil, nicht im öffentlichen Profil, nicht in der
// App, nicht in der Datenschutzerklärung. Gespeichert bleibt alles; der Haken bringt es zurück.
export function PlatformSwitches({ platforms, off, onChange, onSave, saving, dirty }) {
  if (!platforms.length) return null;
  const toggle = (key, enabled) => {
    const next = new Set(off);
    if (enabled) next.delete(key);
    else next.add(key);
    onChange(next);
  };
  return (
    <section className="mb-8" data-testid="platforms-section">
      <h2 className="font-heading text-lg font-black uppercase mb-1 inline-flex items-center gap-2"><ToggleLeft className="w-4 h-4 text-[#29B6E8]" /> Plattformen für Mitglieder</h2>
      <p className="text-xs text-white/55 mb-3 max-w-3xl">
        Abgehakt heißt: die Plattform erscheint nirgends – nicht im Profil, nicht im öffentlichen Profil, nicht in der App, nicht in der
        Datenschutzerklärung. Eingetragene Namen und Verknüpfungen bleiben gespeichert und sind wieder da, sobald der Haken zurück ist.
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button type="button" onClick={() => onChange(new Set())} data-testid="platforms-enable-all" className="px-3 py-1.5 border border-white/15 rounded-sm text-[11px] font-bold uppercase tracking-wider text-white/70 hover:text-white hover:border-white/40">Alle an</button>
        <button type="button" onClick={() => onChange(new Set(platforms.map((platform) => platform.key)))} data-testid="platforms-disable-all" className="px-3 py-1.5 border border-white/15 rounded-sm text-[11px] font-bold uppercase tracking-wider text-white/70 hover:text-white hover:border-white/40">Alle aus</button>
        <button type="button" onClick={onSave} disabled={saving || !dirty} data-testid="platforms-save" className="px-3 py-1.5 bg-[#29B6E8] text-black rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">{saving ? "Speichert …" : "Speichern"}</button>
        <span className="text-xs text-white/45" data-testid="platforms-off-count">{off.size} von {platforms.length} aus</span>
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm divide-y divide-white/5">
        {PLATFORM_GROUPS.map(([group, title]) => (
          <div key={group} className="p-4">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/45 mb-2">{title}</div>
            <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
              {platforms.filter((platform) => platform.group === group).map((platform) => (
                <label key={platform.key} className="inline-flex items-center gap-2 text-sm cursor-pointer" data-testid={`platform-toggle-${platform.key}-row`}>
                  <input type="checkbox" checked={!off.has(platform.key)} onChange={(event) => toggle(platform.key, event.target.checked)} data-testid={`platform-toggle-${platform.key}`} className="accent-[#29B6E8] w-4 h-4" />
                  <span className={off.has(platform.key) ? "text-white/40 line-through" : "text-white"}>{platform.label}</span>
                  {!platform.linkable && <span className="text-[10px] text-white/30 uppercase tracking-wider">getippt</span>}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function AdminIntegrationsOverviewPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [platformsOff, setPlatformsOff] = useState(null);
  const [savingPlatforms, setSavingPlatforms] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: next } = await api.get("/settings/integrations/overview");
      setData(next && Array.isArray(next.items) ? next : { items: [], summary: {}, groups: [] });
    } catch (error) {
      toast.error(formatRequestError(error, "Die Übersicht konnte nicht geladen werden."));
      setData((current) => current || { items: [], summary: {}, groups: [] });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = data?.items || [];
  const platforms = useMemo(() => (Array.isArray(data?.platforms) ? data.platforms : []), [data]);
  const serverOff = useMemo(() => new Set(platforms.filter((platform) => !platform.enabled).map((platform) => platform.key)), [platforms]);
  useEffect(() => { setPlatformsOff(null); }, [serverOff]);
  const off = platformsOff || serverOff;
  const platformsDirty = off.size !== serverOff.size || [...off].some((key) => !serverOff.has(key));
  const savePlatforms = async () => {
    setSavingPlatforms(true);
    try {
      await api.put("/settings/branding", { disabled_platforms: [...off].sort() });
      toast.success("Plattformen gespeichert – abgehakte erscheinen ab jetzt nirgends.");
      await load();
    } catch (error) {
      toast.error(formatRequestError(error, "Speichern hat nicht geklappt."));
    } finally {
      setSavingPlatforms(false);
    }
  };
  const summary = data?.summary || {};
  const groups = (data?.groups || []).filter((group) => items.some((item) => item.group === group));
  const unreadable = items.filter((item) => item.state === "unreadable");

  return (
    <AdminLayout>
      <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Verbindungen</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Alle Verbindungen</h1>
          <p className="text-sm text-white/60 mt-1 max-w-3xl">
            Anmeldung, E-Mail, Plattformen zum Verknüpfen, Discord und weitere Dienste – mit ihrem Zustand. Ändern tut man jede Verbindung auf ihrer eigenen Seite.
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} data-testid="integrations-refresh" className="inline-flex items-center gap-2 px-4 py-2 border border-white/15 rounded-sm text-xs font-bold uppercase tracking-wider hover:border-[#29B6E8]/60 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Aktualisieren
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-6" data-testid="integrations-summary">
        {Object.entries(STATE_META).map(([state, meta]) => (
          <span key={state} data-testid={`integrations-count-${state}`} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm border text-xs font-bold ${meta.className}`}>
            {summary[state] || 0} <span className="uppercase tracking-wider text-[10px]">{meta.label}</span>
          </span>
        ))}
      </div>

      {unreadable.length > 0 && (
        <div data-testid="integrations-unreadable-hint" className="flex items-start gap-3 border border-[#FF3B30]/40 bg-[#FF3B30]/5 rounded-sm p-4 mb-6 text-sm">
          <AlertTriangle className="w-5 h-5 text-[#FF3B30] shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-[#FF3B30] uppercase tracking-wider text-xs">Gespeichert, aber nicht lesbar: {unreadable.map((item) => item.label).join(", ")}</div>
            <p className="text-white/70 mt-1">
              Diese Zugangsdaten liegen in der Datenbank, lassen sich aber mit dem aktuellen Schlüssel nicht entschlüsseln. Meist wurde
              SETTINGS_ENCRYPTION_KEY in der .env am Server geändert – zum Beispiel nach einem Server-Update oder einer Neuinstallation.
              Alten Wert wiederherstellen, dann sind sie sofort wieder da. Oder die Zugangsdaten auf den betroffenen Seiten neu eintragen.
            </p>
          </div>
        </div>
      )}

      <PlatformSwitches platforms={platforms} off={off} onChange={setPlatformsOff} onSave={savePlatforms} saving={savingPlatforms} dirty={platformsDirty} />

      {data === null ? (
        <p className="text-white/40 text-sm" data-testid="integrations-loading">Verbindungen werden geprüft …</p>
      ) : groups.map((group) => (
        <section key={group} className="mb-8" data-testid={`integrations-group-${group}`}>
          <h2 className="font-heading text-lg font-black uppercase mb-3 inline-flex items-center gap-2"><Link2 className="w-4 h-4 text-[#29B6E8]" /> {group}</h2>
          <div className="border border-white/10 bg-[#121212] rounded-sm divide-y divide-white/5">
            {items.filter((item) => item.group === group).map((item) => (
              <Link key={item.key} to={item.to} data-testid={`integration-row-${item.key}`} className="flex items-center gap-4 px-4 py-3 hover:bg-white/5 transition">
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm">{item.label}</div>
                  {item.detail ? <div className="text-xs text-white/50 truncate" data-testid={`integration-detail-${item.key}`}>{item.detail}</div> : null}
                </div>
                <StateChip state={item.state} testId={`integration-state-${item.key}`} />
                <ArrowRight className="w-4 h-4 text-white/30 shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </AdminLayout>
  );
}
