import { Navigate, useLocation } from "react-router-dom";
import { FAQ_PFAD, hilfeUmleitung } from "./pfade";

// Alte Hilfe-Adressen (#2295) führen zur FAQ (#2448): /hilfe → /faq, /hilfe/<thema>#<schritt> → /faq/<thema>#<schritt>,
// Suche (?q=) inklusive. Bleibt in der Entwicklung ohne Nginx und für alte Links in Apps, Mails und Discord wirksam.
export function HilfeUmleitung() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={hilfeUmleitung(pathname, search, hash) || FAQ_PFAD} replace />;
}
