import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { SetupGuide } from "@/components/tls/SetupGuide";
import { api } from "@/lib/api";
import { SETUP_GUIDE_ORDER, guideStatus } from "@/lib/setupGuides";

// Einrichtung (Wunsch des Betreibers, 24.09.): alle Anleitungen an einer Stelle - je Dienst der
// Stand (eingerichtet, fehlt, optional) und die Schritte mit Links und Werten zum Kopieren. Was
// fehlt, steht offen; der Rest ist zugeklappt. Der Stand kommt aus den vorhandenen Admin-Daten.

export default function AdminSetupPage() {
  const [data, setData] = useState({});

  const load = useCallback(async () => {
    const requests = [
      ["branding", "/settings/branding"], ["discord", "/settings/discord"], ["auth", "/settings/auth"],
      ["email", "/settings/email"], ["smtp", "/settings/smtp"], ["dolibarr", "/admin/dolibarr/status"], ["links", "/me/platform-links"],
    ];
    const results = await Promise.allSettled(requests.map(([, url]) => api.get(url)));
    const next = {};
    results.forEach((result, index) => {
      const key = requests[index][0];
      if (result.status === "fulfilled") next[key] = key === "links" ? (result.value.data?.available || null) : (result.value.data || null);
      else next[key] = null;
    });
    setData(next);
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => SETUP_GUIDE_ORDER.map((key) => ({ key, status: guideStatus(key, data) })), [data]);
  const done = rows.filter((row) => row.status.state === "ok").length;
  const missing = rows.filter((row) => row.status.state === "missing").length;

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">System</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Einrichtung</h1>
      <p className="text-sm text-white/55 mt-2 max-w-3xl">
        Jeder angebundene Dienst mit Schritt-für-Schritt-Anleitung, Links zur jeweiligen Konsole und den Werten zum Kopieren.
        Der Stand kommt aus den Einstellungen; was fehlt, steht offen.
      </p>
      <div className="mt-4 mb-6 flex flex-wrap gap-3 text-xs" data-testid="setup-summary">
        <span className="border border-[#00FF88]/40 text-[#00FF88] rounded-sm px-3 py-1.5 font-bold uppercase tracking-wider">{done} eingerichtet</span>
        <span className="border border-[#FFD700]/50 text-[#FFD700] rounded-sm px-3 py-1.5 font-bold uppercase tracking-wider">{missing} fehlen</span>
        <span className="border border-white/15 text-white/50 rounded-sm px-3 py-1.5 font-bold uppercase tracking-wider">{rows.length - done - missing} optional oder offen</span>
      </div>
      <div className="max-w-4xl space-y-3">
        {rows.map((row) => <SetupGuide key={row.key} guideKey={row.key} status={row.status} open={row.status.state === "missing"} showWhere />)}
      </div>
    </AdminLayout>
  );
}
