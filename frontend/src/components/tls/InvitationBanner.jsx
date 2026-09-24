import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Crown, X } from "lucide-react";
import { api } from "@/lib/api";

// Einladung zum Verein (#507): hat der Vorstand den Mitgliedsantrag für dieses Konto freigeschaltet, steht
// das beim nächsten Besuch oben auf jeder Seite - bis der Antrag gestellt ist oder die Einladung zurück-
// gezogen wurde. Ausblenden gilt für die Sitzung; beim nächsten Login ist der Hinweis wieder da.
const DISMISS_KEY = "tls_invitation_dismissed";

function readDismissed() {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function InvitationBanner({ pathname = "/" }) {
  const [invitation, setInvitation] = useState(null);
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    let alive = true;
    api.get("/membership/invitation/me")
      .then(({ data }) => { if (alive) setInvitation(data?.open ? data : null); })
      .catch(() => { if (alive) setInvitation(null); });
    return () => { alive = false; };
  }, [pathname]);

  if (!invitation || dismissed || pathname.startsWith("/membership/apply")) return null;
  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* Sitzung ohne Speicher: nur für diese Seite ausblenden */
    }
    setDismissed(true);
  };
  return (
    <div className="border-b border-[#FFD700]/40 bg-[#FFD700]/10" data-testid="invitation-banner">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center gap-3 text-sm">
        <Crown className="w-4 h-4 text-[#FFD700] shrink-0" />
        <span className="font-bold uppercase tracking-wider text-[#FFD700] text-xs">Einladung zum Verein</span>
        <span className="text-white/80">Der Vorstand lädt dich ein, Mitglied zu werden – der Antrag ist für dich freigeschaltet.</span>
        {invitation.note ? <span className="text-white/60 italic" data-testid="invitation-note">„{invitation.note}“</span> : null}
        <Link to="/membership/apply" data-testid="invitation-apply" className="ml-auto inline-flex items-center px-4 py-1.5 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#ffe45c]">Antrag ausfüllen</Link>
        <button type="button" onClick={dismiss} aria-label="Hinweis ausblenden" data-testid="invitation-dismiss" className="text-white/50 hover:text-white"><X className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

export default InvitationBanner;
