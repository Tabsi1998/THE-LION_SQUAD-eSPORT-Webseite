// Bild-Wartung (#2130): wirkt auf alle Sammlungen und braucht den Bereich System - deshalb hier und nicht mehr auf der
// Sponsorenseite, wo die Redaktion nur eine 403 bekam.
import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { toast } from "sonner";
import { Upload } from "lucide-react";

const BUTTON = "px-4 py-2 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 text-xs disabled:opacity-50";

export function ImageMaintenancePanel() {
  const [busy, setBusy] = useState("");
  const [audit, setAudit] = useState(null);
  const confirm = useConfirm();

  const run = async (name, work, fallback) => {
    setBusy(name);
    try {
      await work();
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail) || fallback);
    } finally {
      setBusy("");
    }
  };

  const check = () => run("audit", async () => {
    const { data } = await api.get("/uploads/audit-images");
    setAudit(data);
    const s = data.summary || {};
    toast.success(`Bilder geprüft: ${s.local_ok || 0} ok, ${s.legacy_local || 0} alte Adressen, ${s.missing_file || 0} fehlend, ${s.external || 0} extern.`);
  }, "Bildprüfung fehlgeschlagen.");

  const repair = async () => {
    if (!await confirm({ title: "Bild-Adressen reparieren?", description: "Alte lokale Bildpfade werden auf /api/static/uploads/... umgestellt.", confirmLabel: "Reparieren", tone: "info" })) return;
    await run("repair", async () => {
      const { data } = await api.post("/uploads/normalize-image-urls");
      setAudit(data);
      toast.success(`${data.summary?.normalized || 0} Bild-Adressen repariert.`);
    }, "Reparieren fehlgeschlagen.");
  };

  const clearMissing = async () => {
    if (!await confirm({ title: "Fehlende Bilder leeren?", description: "Bildfelder, die auf nicht mehr vorhandene Dateien zeigen, werden geleert.", confirmLabel: "Leeren" })) return;
    await run("clear", async () => {
      const { data } = await api.post("/uploads/clear-missing-image-refs");
      setAudit(data);
      toast.success(`${data.summary?.cleared_missing || 0} kaputte Bild-Verknüpfung(en) geleert.`);
    }, "Leeren fehlgeschlagen.");
  };

  const importExternal = async () => {
    if (!await confirm({ title: "Externe Bilder lokal speichern?", description: "Externe Bild-Adressen werden heruntergeladen und durch eigene ersetzt.", confirmLabel: "Speichern", tone: "info" })) return;
    await run("import", async () => {
      const { data } = await api.post("/uploads/migrate-external-images");
      const total = Object.values(data.summary || {}).reduce((sum, row) => sum + (row.updated || 0), 0);
      toast.success(`${total} Bilder lokal gespeichert.`);
      const { data: fresh } = await api.get("/uploads/audit-images");
      setAudit(fresh);
    }, "Speichern fehlgeschlagen.");
  };

  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5" data-testid="image-maintenance">
      <div className="font-heading font-bold uppercase mb-1">Bild-Wartung</div>
      <p className="text-xs text-white/50 mb-3">Gilt für alle Bilder der Website: Sponsoren, News, Events, Spiele und den Rest.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={check} disabled={Boolean(busy)} data-testid="image-audit-btn" className={`${BUTTON} hover:border-[#FFD700] hover:text-[#FFD700]`}>{busy === "audit" ? "Prüfe…" : "Bilder prüfen"}</button>
        <button type="button" onClick={repair} disabled={Boolean(busy)} data-testid="image-normalize-btn" className={`${BUTTON} hover:border-[#29B6E8] hover:text-[#29B6E8]`}>{busy === "repair" ? "Repariere…" : "Adressen reparieren"}</button>
        <button type="button" onClick={clearMissing} disabled={Boolean(busy)} data-testid="image-clear-missing-btn" className={`${BUTTON} hover:border-[#FF3B30] hover:text-[#FF3B30]`}>{busy === "clear" ? "Leere…" : "Fehlende leeren"}</button>
        <button type="button" onClick={importExternal} disabled={Boolean(busy)} data-testid="image-migrate-btn" className={`${BUTTON} hover:border-[#29B6E8] hover:text-[#29B6E8]`}><Upload className="w-4 h-4" aria-hidden="true" /> {busy === "import" ? "Speichere…" : "Externe Bilder lokal speichern"}</button>
      </div>
      {audit?.summary && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs" data-testid="image-audit-result">
          {[
            ["OK", audit.summary.local_ok],
            ["Alte Adressen", audit.summary.legacy_local],
            ["Repariert", audit.summary.normalized],
            ["Extern", audit.summary.external],
            ["Datei fehlt", audit.summary.missing_file],
            ["Ungültig", audit.summary.invalid_local],
            ["Sonstige", audit.summary.other],
          ].map(([label, value]) => (
            <div key={label} className="border border-white/10 rounded-sm px-3 py-2">
              <div className="text-white/45 uppercase tracking-wider font-bold">{label}</div>
              <div className="font-display text-lg text-white mt-1">{value || 0}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
