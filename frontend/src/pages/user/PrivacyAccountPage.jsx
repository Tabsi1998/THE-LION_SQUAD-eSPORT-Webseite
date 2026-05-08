import { useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Download, AlertTriangle } from "lucide-react";
import { usePrompt } from "@/components/tls/ConfirmDialog";

export default function PrivacyAccountPage() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const prompt = usePrompt();

  const exportData = async () => {
    setBusy(true);
    try {
      const { data } = await api.get("/dsgvo/export-my-data");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `tls-arena-meine-daten-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Datenexport heruntergeladen.");
    } catch (err) { toast.error(formatRequestError(err, "Export fehlgeschlagen.")); }
    setBusy(false);
  };

  const anonymize = async () => {
    const answer = await prompt({
      title: "Account anonymisieren?",
      description: 'Diese Aktion ist unwiderruflich. Tippe "LÖSCHEN", um die Anonymisierung zu bestätigen.',
      placeholder: "LÖSCHEN",
      confirmLabel: "Anonymisieren",
      multiline: false,
      required: true,
    });
    if (answer !== "LÖSCHEN") return;
    setBusy(true);
    try {
      await api.post("/dsgvo/anonymize-me");
      toast.success("Dein Account wurde anonymisiert.");
      await logout();
      nav("/");
    } catch (err) { toast.error(formatRequestError(err, "Anonymisierung fehlgeschlagen.")); }
    setBusy(false);
  };

  return (
    <PublicLayout>
      <div className="max-w-3xl mx-auto px-4 py-12">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">DSGVO / Datenschutz</span>
        <h1 className="mt-2 font-heading text-3xl md:text-5xl font-black uppercase">Meine Daten</h1>
        <p className="mt-2 text-white/60 text-sm">Du hast jederzeit das Recht auf Auskunft, Datenportabilität und Löschung deiner personenbezogenen Daten gemäß DSGVO Artikel 15–17.</p>

        <div className="mt-8 space-y-6">
          {/* Export */}
          <div className="border border-white/10 rounded-sm bg-[#121212] p-5 md:p-6">
            <div className="flex items-start gap-3">
              <Download className="w-5 h-5 text-[#29B6E8] mt-1 shrink-0" />
              <div className="flex-1">
                <h2 className="font-heading text-lg md:text-xl font-bold uppercase">Datenexport</h2>
                <p className="mt-1 text-sm text-white/60">Lade alle Daten herunter, die wir über dich gespeichert haben — Profil, Turnier-Anmeldungen, F1-Zeiten, Teams und E-Mail-Logs.</p>
                <button onClick={exportData} disabled={busy} data-testid="dsgvo-export-btn" className="mt-4 px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50">
                  {busy ? "Lade…" : "Als JSON herunterladen"}
                </button>
              </div>
            </div>
          </div>

          {/* Anonymize */}
          <div className="border border-[#FF3B30]/30 rounded-sm bg-[#FF3B30]/5 p-5 md:p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-[#FF3B30] mt-1 shrink-0" />
              <div className="flex-1">
                <h2 className="font-heading text-lg md:text-xl font-bold uppercase text-[#FF3B30]">Account anonymisieren</h2>
                <p className="mt-1 text-sm text-white/60">Dein Account wird dauerhaft deaktiviert und alle persönlichen Daten (E-Mail, Discord, Plattform-IDs, Bio, Avatar) werden überschrieben. Deine Turnier-Statistiken bleiben anonymisiert zur Wahrung der sportlichen Integrität erhalten. Diese Aktion kann <strong>nicht rückgängig gemacht</strong> werden.</p>
                <button onClick={anonymize} disabled={busy} data-testid="dsgvo-anonymize-btn" className="mt-4 px-5 py-2.5 border border-[#FF3B30] text-[#FF3B30] font-bold uppercase tracking-wider rounded-sm hover:bg-[#FF3B30]/10 disabled:opacity-50">
                  Account anonymisieren
                </button>
              </div>
            </div>
          </div>

          {/* Current account info */}
          <div className="border border-white/10 rounded-sm bg-[#121212] p-5 md:p-6 text-sm">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-3">Aktueller Account</div>
            <dl className="grid grid-cols-2 gap-y-2">
              <dt className="text-white/40">Benutzername</dt><dd>{user?.username}</dd>
              <dt className="text-white/40">E-Mail</dt><dd>{user?.email}</dd>
              <dt className="text-white/40">Rolle</dt><dd className="text-[#29B6E8] uppercase text-xs tracking-widest">{user?.role}</dd>
              <dt className="text-white/40">Registriert</dt><dd>{user?.created_at && new Date(user.created_at).toLocaleDateString("de-DE")}</dd>
            </dl>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
