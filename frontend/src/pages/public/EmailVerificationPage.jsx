import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Logo } from "@/components/tls/Logo";
import { AuthFormAlert, AuthTextField } from "@/components/tls/AuthFormFields";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";

export default function EmailVerificationPage() {
  useDocumentTitle("E-Mail bestätigen", "E-Mail-Adresse für den Community-Account bestätigen.", { robots: "noindex, nofollow" });
  const [params] = useSearchParams();
  const location = useLocation();
  const { submitting, submitOnce } = useSubmissionGuard();
  const token = params.get("token") || "";
  const [email, setEmail] = useState(location.state?.email || params.get("email") || "");
  const [status, setStatus] = useState(token ? "checking" : params.get("sent") === "1" ? "sent" : "idle");
  const [message, setMessage] = useState("");
  const handled = useRef(false);

  useEffect(() => {
    if (!token || handled.current) return;
    handled.current = true;
    api.post("/auth/verify-email", { token })
      .then(() => {
        setStatus("success");
        setMessage("Deine E-Mail-Adresse ist bestätigt. Du kannst dich jetzt anmelden.");
      })
      .catch((error) => {
        setStatus("error");
        setMessage(formatApiError(error.response?.data?.detail) || "Der Bestätigungslink ist ungültig oder abgelaufen.");
      });
  }, [token]);

  const resend = async (event) => {
    event.preventDefault();
    if (!email.trim()) return;
    const attempt = await submitOnce(() => api.post("/auth/resend-verification", { email: email.trim() }));
    if (!attempt.started) return;
    if (!attempt.error) {
      setStatus("sent");
      setMessage("Falls eine Bestätigung aussteht, wurde der Versand angefordert. Bitte prüfe in einigen Minuten dein Postfach und den Spam-Ordner.");
    } else {
      setStatus("error");
      setMessage(attempt.error.response?.data?.detail ? formatApiError(attempt.error.response.data.detail) : "Der Versand konnte nicht angefordert werden. Bitte versuche es erneut.");
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-6 bg-grid">
      <div className="w-full max-w-md border border-white/10 rounded-sm bg-[#121212] p-8 md:p-10">
        <div className="flex justify-center mb-8"><Logo size="xl" /></div>
        <h1 className="font-heading text-2xl font-black uppercase text-center">E-Mail bestätigen</h1>
        <p className="text-sm text-white/60 text-center mt-2">Auch ein bestehendes Konto kann nach einem Sicherheitsupdate eine E-Mail-Bestätigung benötigen. Dein Konto und dein Passwort bleiben erhalten.</p>
        <div className="mt-6">
          {status === "checking" && <AuthFormAlert id="verify-status" tone="info">Bestätigung wird geprüft …</AuthFormAlert>}
          {status === "success" && <AuthFormAlert id="verify-success" tone="success">{message}</AuthFormAlert>}
          {status === "error" && <AuthFormAlert id="verify-error">{message}</AuthFormAlert>}
          {status === "sent" && <AuthFormAlert id="verify-sent" tone="info">{message || "Der Versand wurde angefordert. Bitte prüfe in einigen Minuten dein Postfach und den Spam-Ordner."}</AuthFormAlert>}
          {status === "sent" && <p className="mt-3 text-sm text-white/70">Noch keine Mail? Wiederholtes Einloggen versendet keine Bestätigung. Prüfe die Adresse unten und fordere den Link einmal erneut an. Bleibt die Mail aus, muss der Betreiber die Mail-Warteschlange und den Versand prüfen.</p>}
        </div>
        {status !== "success" && (
          <form onSubmit={resend} className="mt-6 space-y-3">
            <AuthTextField id="verify-email" label="E-Mail" type="email" value={email} onChange={setEmail} autoComplete="email" required />
            <button type="submit" disabled={submitting || status === "checking"} className="tls-btn tls-btn--secondary w-full py-3 font-bold uppercase rounded-sm disabled:opacity-50" data-testid="verify-resend-submit">
              {submitting ? "Versand wird angefordert …" : "Bestätigungslink anfordern"}
            </button>
          </form>
        )}
        <div className="mt-6 text-sm text-center"><Link to="/login" className="text-white/50 hover:text-[#29B6E8]">Zum Login</Link></div>
      </div>
    </div>
  );
}
