import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { SetupGuide, StatusChip } from "@/components/tls/SetupGuide";
import { PlatformAppCard } from "@/pages/admin/settings/PlatformLinkSettings";
import { api, formatRequestError } from "@/lib/api";
import { INTEGRATIONS, integrationApp, integrationByKey, integrationStatus } from "@/lib/integrations";

// Verbindungen (Wunsch des Betreibers, 24.09.): je Dienst eine eigene Seite - Stand, Zugangsdaten
// (Client ID + Secret, bei Plattformen zum Verknüpfen), Rückrufadresse, „prüfen“ und die Anleitung
// aufgeklappt. Laufende Einstellungen (Webhooks, Live-Erkennung, Absender …) bleiben in ihrem
// Reiter; die Seite verlinkt dorthin.

const REQUESTS = [
  ["branding", "/settings/branding"], ["discord", "/settings/discord"], ["auth", "/settings/auth"],
  ["email", "/settings/email"], ["smtp", "/settings/smtp"], ["dolibarr", "/admin/dolibarr/status"], ["links", "/me/platform-links"],
];

export default function AdminIntegrationPage() {
  const { key } = useParams();
  const integration = integrationByKey(key);
  const app = integrationApp(integration);
  const [data, setData] = useState({});
  const [brand, setBrand] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const results = await Promise.allSettled(REQUESTS.map(([, url]) => api.get(url)));
    const next = {};
    results.forEach((result, index) => {
      const name = REQUESTS[index][0];
      if (result.status === "fulfilled") next[name] = name === "links" ? (result.value.data?.available || null) : (result.value.data || null);
      else next[name] = null;
    });
    setData(next);
    setBrand(next.branding || {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const status = useMemo(() => integrationStatus(integration, data), [integration, data]);
  const index = INTEGRATIONS.findIndex((entry) => entry.key === key);
  const previous = index > 0 ? INTEGRATIONS[index - 1] : null;
  const following = index >= 0 && index < INTEGRATIONS.length - 1 ? INTEGRATIONS[index + 1] : null;

  const setBrandField = (field, value) => setBrand((current) => ({ ...current, [field]: value }));
  const save = async () => {
    if (!app) return;
    setSaving(true);
    try {
      const payload = {};
      if (app.idField) payload[app.idField] = (brand[app.idField] || "").trim();
      if (app.secretField && brand[app.secretField]) payload[app.secretField] = brand[app.secretField];
      await api.put("/settings/branding", payload);
      toast.success(`${app.label}: gespeichert.`);
      await load();
    } catch (error) {
      toast.error(formatRequestError(error, "Speichern hat nicht geklappt."));
    } finally {
      setSaving(false);
    }
  };
  const clearSecret = async (field) => {
    try {
      await api.put("/settings/branding", { [`clear_${field}`]: true });
      toast.success("Gespeichertes entfernt.");
      await load();
    } catch (error) {
      toast.error(formatRequestError(error, "Entfernen hat nicht geklappt."));
    }
  };

  if (!integration) {
    return (
      <AdminLayout>
        <div className="border border-dashed border-white/15 rounded-sm p-10 text-center text-white/50" data-testid="integration-missing">
          Diese Verbindung gibt es nicht. <Link to="/admin/setup" className="text-[#29B6E8] hover:text-white">Zur Einrichtung</Link>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Verbindungen</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 flex flex-wrap items-center gap-3" data-testid="integration-title">
            {integration.label} <StatusChip status={status} />
          </h1>
          <p className="text-sm text-white/55 mt-2 max-w-3xl">
            Alles zu {integration.label} an einer Stelle: Stand, Zugangsdaten, Rückrufadresse, Prüfung und die Anleitung Schritt für Schritt.
            {integration.tab ? <> Die laufenden Einstellungen ({integration.tabLabel}) stehen im Reiter <Link to={integration.tab} data-testid="integration-tab-link" className="text-[#29B6E8] hover:text-white">{integration.tabLabel}</Link>.</> : null}
          </p>
        </div>
        <Link to="/admin/setup" className="text-[11px] font-bold uppercase tracking-wider text-white/50 hover:text-white inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> Alle Verbindungen</Link>
      </div>

      <div className="max-w-4xl space-y-4">
        {app && (
          <div className="border border-white/10 bg-[#121212] rounded-sm p-4" data-testid="integration-app">
            <div className="font-heading font-bold uppercase text-sm mb-3">Zugangsdaten und Prüfung</div>
            <PlatformAppCard app={{ ...app, tab: undefined }} brand={brand} setBrandField={setBrandField} onClearSecret={clearSecret} onSave={save} saving={saving} showGuide={false} />
          </div>
        )}
        <div className="space-y-3" data-testid="integration-guides">
          {integration.guides.map((guideKey) => <SetupGuide key={guideKey} guideKey={guideKey} open />)}
        </div>
        {integration.tab && (
          <Link to={integration.tab} className="inline-flex items-center gap-2 px-4 py-2 border border-white/15 text-white/80 hover:border-[#29B6E8]/60 hover:text-[#29B6E8] rounded-sm text-xs font-bold uppercase tracking-wider">
            <ExternalLink className="w-3.5 h-3.5" /> Zu den Einstellungen: {integration.tabLabel}
          </Link>
        )}
        <div className="flex flex-wrap justify-between gap-3 pt-4 border-t border-white/10 text-[11px] font-bold uppercase tracking-wider">
          {previous ? <Link to={`/admin/integrations/${previous.key}`} data-testid="integration-prev" className="inline-flex items-center gap-1 text-white/50 hover:text-white"><ArrowLeft className="w-3 h-3" /> {previous.label}</Link> : <span />}
          {following ? <Link to={`/admin/integrations/${following.key}`} data-testid="integration-next" className="inline-flex items-center gap-1 text-white/50 hover:text-white">{following.label} <ArrowRight className="w-3 h-3" /></Link> : <span />}
        </div>
      </div>
    </AdminLayout>
  );
}
