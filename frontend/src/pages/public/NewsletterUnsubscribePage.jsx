import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Logo } from "@/components/tls/Logo";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

// Newsletter mit einem Klick abbestellen (#2119 ML4): der Link aus der Mail führt hierher. Abgemeldet wird erst mit dem
// Knopf - Linkvorschauen und Virenscanner öffnen den Link, ohne etwas auszulösen. Kein Login nötig.

export default function NewsletterUnsubscribePage() {
  useDocumentTitle("Newsletter abbestellen", "Newsletter von THE LION SQUAD abbestellen.", { robots: "noindex, nofollow" });
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [status, setStatus] = useState(token ? "ready" : "missing");
  const [message, setMessage] = useState("");

  const unsubscribe = async () => {
    setStatus("busy");
    try {
      const { data } = await api.post(`/settings/newsletter/unsubscribe?token=${encodeURIComponent(token)}`);
      setStatus("done");
      setMessage(data?.already ? "Du warst schon abgemeldet – es kommt kein Newsletter mehr." : "Erledigt – du bekommst keinen Newsletter mehr.");
    } catch (error) {
      setStatus("error");
      setMessage(formatApiError(error.response?.data?.detail) || "Das hat nicht geklappt. Versuch es später noch einmal.");
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-4 sm:p-6 bg-grid">
      <div className="w-full max-w-md border border-white/10 rounded-sm bg-[#121212] p-6 sm:p-10" data-testid="newsletter-unsubscribe">
        <div className="flex justify-center mb-8"><Logo size="xl" /></div>
        <h1 className="font-heading text-2xl font-black uppercase text-center">Newsletter abbestellen</h1>
        {status === "missing" ? (
          <div className="mt-6">
            <AuthFormAlert id="unsubscribe-missing">Im Link fehlt der Schlüssel. Öffne den Link aus der Mail noch einmal – oder bestell den Newsletter im Profil unter Benachrichtigungen ab.</AuthFormAlert>
          </div>
        ) : null}
        {status === "ready" || status === "busy" ? (
          <>
            <p className="text-sm text-white/65 text-center mt-3">Du bekommst dann keine Mails mehr zu neuen News und Events. Mails zu deinem Konto, deinen Turnieren und Anmeldungen kommen weiter.</p>
            <button type="button" onClick={unsubscribe} disabled={status === "busy"} className="tls-btn tls-btn--primary mt-6 w-full py-3 font-bold uppercase tracking-wider rounded-sm disabled:opacity-50" data-testid="newsletter-unsubscribe-confirm">
              {status === "busy" ? "Melde ab …" : "Newsletter abbestellen"}
            </button>
          </>
        ) : null}
        {status === "done" ? (
          <div className="mt-6 space-y-3">
            <AuthFormAlert id="unsubscribe-done" tone="success">{message}</AuthFormAlert>
            <p className="text-sm text-white/60">Doch wieder dabei sein? Im Profil unter Benachrichtigungen kannst du den Newsletter jederzeit wieder einschalten.</p>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="mt-6"><AuthFormAlert id="unsubscribe-error">{message}</AuthFormAlert></div>
        ) : null}
        <div className="mt-6 text-sm text-center"><Link to="/" className="text-white/50 hover:text-[#29B6E8]">Zur Startseite</Link></div>
      </div>
    </div>
  );
}
