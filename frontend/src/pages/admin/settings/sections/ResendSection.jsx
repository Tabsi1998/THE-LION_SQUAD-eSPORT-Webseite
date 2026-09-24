// Einstellungen (#223): Abschnitt „E-Mail-Versand über Resend“ – nur Darstellung; Zustand und Handler bleiben in AdminSettingsPage.
import { formatApiError } from "@/lib/api";
import { SetupGuide } from "@/components/tls/SetupGuide";
import { toast } from "sonner";
import { Send, AlertTriangle } from "lucide-react";

export function ResendSection({ email, setEmail, testEmail, setTestEmail, savingEmail, saveEmail, clearEmailSecret, sendTest, mailViaSmtp, emailNotConfigured }) {
  return (
    <div className="max-w-2xl space-y-4">
      <SetupGuide guideKey="resend" />
      {mailViaSmtp && (
        <div data-testid="email-via-smtp" className="border border-white/10 bg-[#121212] rounded-sm p-4 text-sm text-white/70">
          Der Versand läuft über <strong>SMTP</strong> (Verbindungen → SMTP). Resend ist damit nicht im Einsatz; ein hier gespeicherter Key stört nicht.
        </div>
      )}
      {emailNotConfigured && (
        <div data-testid="email-not-configured" className="flex items-start gap-3 border border-[#FFD700]/30 bg-[#FFD700]/5 rounded-sm p-4">
          <AlertTriangle className="w-5 h-5 text-[#FFD700] shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-bold text-[#FFD700] uppercase tracking-wider text-xs">Kein Resend API Key hinterlegt</div>
            <p className="text-white/70 mt-1">Alle E-Mails (Anmeldungen, Passwort-Reset, Check-in-Erinnerungen, Spiel-Nachrichten) werden aktuell übersprungen. Hole dir einen kostenlosen Key auf <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer" className="text-[#29B6E8] hover:underline">resend.com/api-keys</a> und trage ihn unten ein.</p>
          </div>
        </div>
      )}
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-heading font-bold uppercase">Resend API</div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={email.enabled} onChange={(e) => setEmail({ ...email, enabled: e.target.checked })} className="accent-[#29B6E8]" data-testid="email-enabled" />
            <span>Versand aktiv</span>
          </label>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">API Key {email.resend_api_key_masked && <span className="text-white/40 normal-case">(aktuell: {email.resend_api_key_masked})</span>}</div>
          <input type="password" placeholder="re_..." value={email.resend_api_key} onChange={(e) => setEmail({ ...email, resend_api_key: e.target.value })} data-testid="email-api-key" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
          <p className="text-xs text-white/40 mt-1">Leer lassen um den bestehenden Key beizubehalten.</p>
          {email.resend_api_key_masked && <button type="button" onClick={() => clearEmailSecret().catch((e) => toast.error(formatApiError(e.response?.data?.detail)))} className="mt-2 text-[10px] uppercase font-bold text-[#FF6B6B]">Gespeicherten Key entfernen</button>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Absendername</div>
            <input value={email.sender_name || ""} onChange={(e) => setEmail({ ...email, sender_name: e.target.value })} data-testid="email-sender-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="THE LION SQUAD" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Absender-E-Mail</div>
            <input value={email.sender_email || ""} onChange={(e) => setEmail({ ...email, sender_email: e.target.value })} data-testid="email-sender-email" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="noreply@lionsquad.at" />
          </div>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Antworten an</div>
          <input type="email" value={email.reply_to_email || ""} onChange={(e) => setEmail({ ...email, reply_to_email: e.target.value })} data-testid="email-reply-to" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" placeholder="office@lionsquad.at" />
          <p className="text-xs text-white/40 mt-1">Reply-To für Rückfragen. Leer = sichtbare Absender-E-Mail.</p>
        </div>
        <button onClick={saveEmail} disabled={savingEmail} data-testid="email-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{savingEmail ? "Speichere..." : "Speichern"}</button>
      </div>

      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
        <div className="font-heading font-bold uppercase">Testmail senden</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input type="email" placeholder="test@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} data-testid="email-test-to" className="flex-1 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          <button onClick={sendTest} data-testid="email-test-send" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm inline-flex items-center justify-center gap-2"><Send className="w-3.5 h-3.5" /> Senden</button>
        </div>
      </div>
    </div>
  );
}
