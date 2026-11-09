import { Link } from "react-router-dom";
import { CircleHelp } from "lucide-react";
import { hilfePfad, hilfeSchritte, hilfeThema } from "@/hilfe";

// „?“ an Stellen, an denen jemand hängen bleiben kann (#2295): führt zum passenden Schritt im Hilfe-Bereich. Öffnet
// einen neuen Tab, damit ein halb ausgefülltes Formular stehen bleibt. Ein unbekannter Schritt zeigt nichts - ein
// Test prüft alle Ziele gegen die Hilfe-Daten (HelpLink.test.jsx).

export function helpTarget(thema, schritt) {
  const data = hilfeThema(thema);
  const step = hilfeSchritte(data).find((row) => row.id === schritt);
  return step ? { to: hilfePfad(thema, schritt), label: step.titel } : null;
}

export function HelpLink({ thema, schritt, className = "" }) {
  const target = helpTarget(thema, schritt);
  if (!target) return null;
  return (
    <Link to={target.to} target="_blank" rel="noopener" data-testid={`help-link-${schritt}`}
      aria-label={`Hilfe: ${target.label} (neuer Tab)`} title={`Hilfe: ${target.label}`}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/50 transition hover:bg-[#29B6E8]/10 hover:text-[#29B6E8] focus-visible:text-[#29B6E8] relative before:absolute before:-inset-1.5 before:content-[''] ${className}`}>
      <CircleHelp className="h-[18px] w-[18px]" aria-hidden="true" />
    </Link>
  );
}
