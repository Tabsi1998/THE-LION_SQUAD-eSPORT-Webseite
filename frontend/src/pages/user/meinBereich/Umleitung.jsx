import { Navigate, useLocation } from "react-router-dom";
import { BEREICH, legacyTarget } from "@/lib/meinBereich";

// „Mein Bereich“ (#2059): /profile?tab=…, /members/*, /account/*, /my/* und /privacy-account führen in ihre Gruppe -
// mit Suche und Anker. Mails, Benachrichtigungen und die App öffnen die alten Adressen weiter. Klein und ohne Abhängigkeiten,
// weil App.jsx sie im Start-JS braucht.
export function MeinBereichUmleitung() {
  const location = useLocation();
  return <Navigate to={legacyTarget(location) || BEREICH} replace />;
}
