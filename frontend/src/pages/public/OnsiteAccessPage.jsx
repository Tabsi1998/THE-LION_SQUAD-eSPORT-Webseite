import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { QrCode } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { captureOnsiteToken, forgetOnsiteToken, peekOnsiteToken } from "@/lib/onsiteToken";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

// Vor-Ort-Zugang (#1592): Hierher führt der QR-Code von TV und Aushang („/vor-ort#<code>“). Der Code ist schon beim
// Start aus der Adresse genommen (lib/onsiteToken) und geht nur im Rumpf an den Server. Der setzt die Freigabe für
// genau dieses Turnier; danach geht es zur Turnierseite - ohne Code in der Adresse, auch über Login und Registrierung.

const RESCAN = "Bitte den QR-Code am Bildschirm oder am Aushang neu scannen.";

export default function OnsiteAccessPage() {
  const nav = useNavigate();
  const [token, setToken] = useState(() => peekOnsiteToken());
  const [problem, setProblem] = useState(token ? "" : RESCAN);
  useDocumentTitle("Vor Ort mitspielen", "Anmeldung vor Ort über den QR-Code.", { robots: "noindex, nofollow" });

  // Ein neuer Scan im selben Tab ändert nur den Anker - dann lädt die Seite nicht neu und der Start greift nicht.
  useEffect(() => {
    const onHash = () => {
      if (!captureOnsiteToken()) return;
      setProblem("");
      setToken(peekOnsiteToken());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    api.post("/tournaments/onsite/redeem", { token })
      .then(({ data }) => {
        forgetOnsiteToken();
        if (cancelled) return;
        const target = data?.tournament?.slug || data?.tournament?.id;
        if (target) nav(`/tournaments/${encodeURIComponent(target)}`, { replace: true });
        else setProblem(RESCAN);
      })
      .catch((error) => {
        forgetOnsiteToken();
        if (cancelled) return;
        const detail = formatApiError(error?.response?.data?.detail);
        setProblem(detail || `Der Zugang lässt sich gerade nicht prüfen. ${RESCAN}`);
      });
    return () => { cancelled = true; };
  }, [token, nav]);

  return (
    <PublicLayout>
      <section className="max-w-md mx-auto px-4 sm:px-6 py-16 text-center" aria-live="polite">
        <QrCode className="w-10 h-10 mx-auto text-[#29B6E8]" aria-hidden="true" />
        {problem ? (
          <div data-testid="onsite-access-invalid">
            <h1 className="mt-4 font-heading text-3xl font-black uppercase">Code gilt nicht</h1>
            <p className="mt-3 text-white/70">{problem}</p>
            <Link to="/tournaments" className="tls-btn tls-btn--quiet mt-8 inline-flex min-h-[44px] items-center px-5 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
              Zu den Turnieren
            </Link>
          </div>
        ) : (
          <div data-testid="onsite-access-checking">
            <h1 className="mt-4 font-heading text-3xl font-black uppercase">Einen Moment</h1>
            <p className="mt-3 text-white/70">Dein Vor-Ort-Zugang wird geprüft …</p>
          </div>
        )}
      </section>
    </PublicLayout>
  );
}
