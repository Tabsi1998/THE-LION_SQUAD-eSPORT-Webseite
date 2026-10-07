import { forwardRef, useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { motionAllowed } from "@/lib/motion";

// Die Mitgliedskarte als Bild (#1335, Wahl des Betreibers: Variante A - schwarz mit Gold): Format einer Bankkarte, feines
// Löwen-Muster, Vereinslogo und Lichtkante in Gold, Name, Mitgliedsnummer, Art und „gültig bis“. Dieselbe Karte steht als
// Muster auf „Mitglied werden“ („Dein Name“, „Nr. 0042“), echt auf „Meine Mitgliedschaft“ (mit Prüfcode), als Bild zum
// Speichern und offline (#1256, dort statt des Codes „Prüfcode braucht Netz“) und klein oben im Mitgliederbereich (#1336).
// Ein ruhiger Lichtlauf zieht einmal beim ersten Sichtbarwerden über die Karte - mit „Bewegung reduzieren“ nie. Gold ist hier
// richtig: Mitgliedschaft ist Ehre.

export const MASCOT = "/assets/brand/tls-mascot.png";

/** „TLS-031 · seit 2024“ - Nummer und Jahr, was davon da ist. */
export function cardNumberLine(number, since) {
  const year = /^\d{4}/.test(String(since || "")) ? String(since).slice(0, 4) : "";
  return [number ? `Nr. ${number}` : "", year ? `seit ${year}` : ""].filter(Boolean).join(" · ");
}

/** „gültig bis 31.12.2026“ oder „gültig, solange die Mitgliedschaft besteht“. */
export function validLine(validUntil) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(validUntil || ""));
  return match ? `gültig bis ${match[3]}.${match[2]}.${match[1]}` : "";
}

function useShineOnce(node, enabled) {
  const [shine, setShine] = useState(false);
  useEffect(() => {
    if (!enabled || !node || !motionAllowed() || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShine(true);
        observer.disconnect();
      }
    }, { threshold: 0.6 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, enabled]);
  return shine;
}

/**
 * Die Karte. Den Prüfcode zeigt „Meine Mitgliedschaft“ groß daneben (gut scanbar); `offline`: auf der Karte der Hinweis
 * „Prüfcode braucht Netz“ (Bild und Offline-Karte). `tilt`: leicht schräg wie auf „Mitglied werden“ (am Handy gerade).
 */
export const MemberCardArt = forwardRef(function MemberCardArt(
  { name, number, since, typeLabel, validUntil, clubName = "The Lion Squad", offline = false, tilt = false, shine = true, className = "", testId = "member-card-art" },
  ref,
) {
  const [node, setNode] = useState(null);
  const shining = useShineOnce(node, shine);
  const setRefs = (element) => {
    setNode(element);
    if (typeof ref === "function") ref(element);
    else if (ref) ref.current = element;
  };
  const numberLine = cardNumberLine(number, since);
  const valid = validLine(validUntil);
  return (
    <div ref={setRefs} data-testid={testId} data-shine={shining ? "1" : "0"} className={`tls-member-card ${tilt ? "tls-member-card--tilt" : ""} ${className}`}>
      <span className="tls-member-card__shine" aria-hidden="true" />
      <div className="tls-member-card__head">
        <img src={MASCOT} alt="" className="tls-member-card__logo" draggable="false" />
        <span className="tls-member-card__club">{clubName}<span>Mitglied</span></span>
      </div>
      <span className="tls-member-card__chip" aria-hidden="true" />
      <div className="tls-member-card__body">
        <span className="tls-member-card__name" data-testid={`${testId}-name`}>{name}</span>
        {numberLine ? <span className="tls-member-card__number">{numberLine}</span> : null}
        {typeLabel || valid ? <span className="tls-member-card__meta">{[typeLabel, valid].filter(Boolean).join(" · ")}</span> : null}
      </div>
      {offline ? (
        <div className="tls-member-card__qr tls-member-card__qr--off" data-testid={`${testId}-offline`}>
          <WifiOff aria-hidden="true" />
          <span>Prüfcode braucht Netz</span>
        </div>
      ) : null}
    </div>
  );
});
