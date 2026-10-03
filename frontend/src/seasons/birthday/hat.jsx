import { useId, useMemo } from "react";
import { requestBurst } from "../carnival/layer";
import { HeaderMascotHat, HeroMascotHat } from "../mascot/MascotHat";

// Die Geburtstagsmütze (#856): ein goldener Kegel mit blauem Zickzack, weißem Bommel und vorne der Zahl der Jahre -
// anders als der Partyhut am Fasching (blau mit goldenen Streifen), damit man sofort sieht, wer Geburtstag hat. Sie
// sitzt über `seasons/mascot` auf dem Löwen im Kopf und auf der Startseite; antippen lässt sie wippen und Konfetti
// aus der Mütze regnen (höchstens alle zehn Sekunden). Bei „dezent“ ist sie nur ein Bild.

export const HAT_COOLDOWN_MS = 10000;
export const WIGGLE_MS = 700;
/** Die Zahl passt bis zwei Ziffern auf den Kegel; darüber ein Stern statt einer unlesbaren Zahl. */
export const MAX_HAT_DIGITS = 2;

export function hatNumber(years) {
  const count = Math.round(Number(years));
  if (!Number.isFinite(count) || count < 1) return "";
  const text = String(count);
  return text.length <= MAX_HAT_DIGITS ? text : "";
}

export function BirthdayHatArt({ size = 24, years = null }) {
  // Je Mütze eigene Kennungen: zwei Mützen auf einer Seite dürfen sich Verlauf und Zuschnitt nicht teilen.
  const ids = `tls-bday-hat-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const number = hatNumber(years);
  return (
    <svg className="tls-birthday-hat__svg" width={size} height={size * 1.3} viewBox="0 0 40 52" aria-hidden="true" data-testid="birthday-hat-art" data-years={number || undefined}>
      <defs>
        <linearGradient id={`${ids}-gold`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#c9a800" />
          <stop offset="0.38" stopColor="#ffe66b" />
          <stop offset="0.62" stopColor="#FFD700" />
          <stop offset="1" stopColor="#b89400" />
        </linearGradient>
        <clipPath id={`${ids}-cone`}><path d="M20 7 L34.5 45 Q20 50 5.5 45 Z" /></clipPath>
      </defs>
      <path d="M20 7 L34.5 45 Q20 50 5.5 45 Z" fill={`url(#${ids}-gold)`} />
      <g clipPath={`url(#${ids}-cone)`}>
        <polyline points="2,41 6,37.4 10,41 14,37.4 18,41 22,37.4 26,41 30,37.4 34,41 38,37.4" fill="none" stroke="#29B6E8" strokeWidth="2.4" strokeLinejoin="round" />
        <circle cx="14.5" cy="19" r="1.3" fill="#ffffff" />
        <circle cx="25.5" cy="23" r="1.2" fill="#29B6E8" />
        <circle cx="11" cy="31" r="1.1" fill="#ffffff" />
        <circle cx="29" cy="32.5" r="1.1" fill="#ffffff" />
        {!number && <path d="M20 22 l1.6 3.4 3.7 0.4 -2.8 2.5 0.8 3.6 -3.3 -1.9 -3.3 1.9 0.8 -3.6 -2.8 -2.5 3.7 -0.4 Z" fill="#ffffff" />}
      </g>
      {number && (
        <text x="20" y={number.length > 1 ? 33 : 34} textAnchor="middle" fontSize={number.length > 1 ? 10.5 : 13} fontWeight="900" fontFamily="system-ui, sans-serif"
          fill="#0b2233" stroke="#fff6e0" strokeWidth="1.3" paintOrder="stroke" data-testid="birthday-hat-number">{number}</text>
      )}
      <path d="M5.5 45 Q20 50 34.5 45" stroke="#29B6E8" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="20" cy="6.5" r="4.7" fill="#f7f4ee" />
      <circle cx="18.6" cy="5" r="1.5" fill="#ffffff" />
      <path d="M15.6 3 l-1.8 -1.8 M20 1.2 v-1.4 M24.4 3 l1.8 -1.8" stroke="#29B6E8" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Die Mütze auf dem Löwen - im Kopf mittig auf dem Kopf, auf der Startseite auf dem großen Löwen. */
export function BirthdayHats({ moving, years }) {
  // Eine feste Komponente je Jahreszahl - sonst baute React die Mütze bei jedem Zeichnen neu auf.
  const Art = useMemo(() => function BirthdayHatWithYears(props) { return <BirthdayHatArt {...props} years={years} />; }, [years]);
  const common = { Art, moving, label: "Geburtstagsmütze – Konfetti werfen", title: "Konfetti!", cooldownMs: HAT_COOLDOWN_MS, wiggleMs: WIGGLE_MS, onTap: requestBurst };
  return (
    <>
      <HeaderMascotHat {...common} crown={0.42} share={0.42} testId="birthday-hat" className="tls-birthday-hat tls-birthday-hat--header" />
      <HeroMascotHat {...common} testId="birthday-hero-hat" className="tls-birthday-hat tls-birthday-hat--hero" ignore=".tls-streamers, .tls-garlands" />
    </>
  );
}
