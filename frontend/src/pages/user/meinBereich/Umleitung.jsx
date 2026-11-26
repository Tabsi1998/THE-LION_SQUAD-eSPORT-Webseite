import { Navigate, useLocation } from "react-router-dom";
import { BEREICH } from "@/lib/meinBereich";
import { legacyTarget } from "@/lib/meinBereichAlt";

// „Mein Bereich“ (#2059): /profile?tab=…, /members/*, /account/*, /my/* und /privacy-account führen in ihre Gruppe -
// mit Suche und Anker. Mails, Benachrichtigungen und die App öffnen die alten Adressen weiter. App.jsx lädt sie erst,
// wenn eine alte Adresse aufgerufen wird.
export function MeinBereichUmleitung() {
  const location = useLocation();
  return <Navigate to={legacyTarget(location) || BEREICH} replace />;
}
