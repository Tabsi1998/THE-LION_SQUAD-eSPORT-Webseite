import { ShieldCheck } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { GoogleAuthButton } from "@/components/tls/GoogleAuthButton";
import { MfaSetupPanel } from "@/components/tls/MfaSetupPanel";
import { PasskeysPanel } from "@/components/tls/PasskeysPanel";
import { Section } from "./fields";
import { PasswordPanel } from "./PasswordPanel";
import { SessionsPanel } from "./SessionsPanel";

// Reiter Sicherheit (#258): Passwort, Passkeys, Zwei-Faktor, Google-Konto und
// angemeldete Geräte an einem Ort. Vorher standen Zwei-Faktor und Google
// unter Grunddaten und die Geräte hatten einen eigenen Reiter.
export function SecurityTab({ user, refresh, siteSettings }) {
  const confirm = useConfirm();
  const googleLinked = !!user?.google_linked;
  const googleOnly = user?.auth_provider === "google";
  const [params] = useSearchParams();
  // Von einer Adminseite hierher geschickt, weil Zwei-Faktor fehlt (#348).
  const sentHereForMfa = params.get("mfa") === "required";

  const unlinkGoogle = async () => {
    if (!await confirm({
      title: "Google trennen?",
      description: "Du kannst dich danach wieder mit E-Mail und Passwort anmelden.",
      confirmLabel: "Trennen",
    })) return;
    try {
      await api.post("/auth/google/unlink");
      await refresh();
      toast.success("Google-Verknüpfung entfernt.");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Google konnte nicht getrennt werden.");
    }
  };

  return (
    <Section>
      <p className="text-sm text-white/60">Passwort, Passkeys, Zwei-Faktor, Google-Konto und angemeldete Geräte an einem Ort.</p>

      {sentHereForMfa && (
        <div className="border border-[#FFD700]/40 bg-[#FFD700]/10 rounded-sm p-4 flex items-start gap-3" data-testid="profile-mfa-required">
          <ShieldCheck className="w-5 h-5 text-[#FFD700] mt-0.5 shrink-0" />
          <div className="text-sm text-white/80">
            <strong>Für den Adminbereich brauchst du die Zwei-Faktor-Anmeldung.</strong> Richte sie unten ein (dauert zwei Minuten),
            melde dich danach einmal neu an – dann geht es weiter{params.get("next") ? ` zu ${params.get("next")}` : ""}.
          </div>
        </div>
      )}

      <PasswordPanel googleOnly={googleOnly} />

      <PasskeysPanel />

      <MfaSetupPanel onChanged={refresh} highlight={sentHereForMfa} />

      {siteSettings?.google_linking_enabled !== false ? (
        <div className="border border-white/10 rounded-sm p-5 bg-[#0A0A0A]" data-testid="profile-google-link">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-heading font-black uppercase mb-1">Google-Konto</h3>
              {googleLinked ? (
                <p className="text-xs text-[#00FF88]" data-testid="profile-google-status">Verknüpft{user?.google_email ? ` · ${user.google_email}` : ""} · schneller Login mit einem Klick.</p>
              ) : (
                <p className="text-xs text-white/50" data-testid="profile-google-status">Verbinde dein Google-Konto, um dich künftig mit einem Klick anzumelden.</p>
              )}
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
            ) : (
              <div data-testid="profile-google-link-button"><GoogleAuthButton label="Google verknüpfen" intent="link" onSuccess={refresh} /></div>
            )}
          </div>
        </div>
      ) : null}

      <SessionsPanel />
    </Section>
  );
}
