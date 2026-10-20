/**
 * SponsorLogo (#1321): Sponsoren- und Partner-Logos einfarbig weiß, beim Drüberfahren und beim Tastatur-Fokus in ihrer
 * Farbe - so wirken alle gleich wertvoll. Am Handy (kein Drüberfahren) bleiben sie weiß.
 *
 * Woher das Weiß kommt:
 * - eine hochgeladene weiße Fassung (`logo_mono_url`) - darüber liegt das Original und blendet beim Drüberfahren ein;
 * - sonst bei durchsichtigen Logos (`logo_transparent`, sagt der Server) per CSS-Filter;
 * - sonst (Logo mit Kasten oder unbekannt) das Original auf einer ruhigen Fläche - nie ein weißes Rechteck.
 *
 * Optisch gleich groß: nach dem Laden kennt das Logo sein Seitenverhältnis und bekommt Breite und Höhe so, dass es
 * etwa denselben Anteil seines Kastens füllt - ein breites Schriftlogo wird nicht riesig, ein quadratisches nicht winzig.
 */
import { useCallback, useRef, useState } from "react";
import { resolveMediaUrl } from "@/lib/api";
import { SmartLogo } from "@/components/tls/SmartLogo";

/** Wie das Logo weiß wird: "file" (weiße Fassung), "filter" (durchsichtig) oder "surface" (Original auf Fläche). */
export function logoToneMode(logo) {
  if (logo?.logo_mono_url) return "file";
  if (logo?.logo_transparent === true) return "filter";
  return "surface";
}

/**
 * Breite und Höhe in Prozent des Kastens, damit Logos mit verschiedenem Seitenverhältnis dieselbe Fläche füllen.
 * `ratio`: Breite/Höhe des Logos, `boxRatio`: Breite/Höhe des Kastens, `fill`: Anteil der Kastenfläche (0-1).
 */
export function balancedLogoSize(ratio, boxRatio, fill = 0.5) {
  if (!(ratio > 0) || !(boxRatio > 0)) return null;
  const area = Math.min(Math.max(fill, 0.05), 1) * boxRatio;
  let width = Math.sqrt(area * ratio);
  let height = Math.sqrt(area / ratio);
  const shrink = Math.min(1, boxRatio / width, 1 / height);
  width *= shrink;
  height *= shrink;
  return { width: Math.round((width / boxRatio) * 1000) / 10, height: Math.round(height * 1000) / 10 };
}

/**
 * Hinweis in der Verwaltung (#1321): das gespeicherte Logo hat einen Kasten und es gibt keine weiße Fassung - dann steht
 * es im Original auf einer Fläche statt weiß. Nur, solange im Formular noch dieses Logo steht.
 */
export function LogoToneHint({ saved, currentLogoUrl, currentMonoUrl, testId }) {
  if (!saved?.logo_url || saved.logo_transparent !== false) return null;
  if (currentMonoUrl || currentLogoUrl !== saved.logo_url) return null;
  return (
    <p className="text-xs text-[#FFD700] border border-[#FFD700]/30 bg-[#FFD700]/5 rounded-sm px-3 py-2" data-testid={testId}>
      Dieses Logo hat einen Kasten und kann auf der Website nicht weiß erscheinen – es steht dort im Original auf einer
      ruhigen Fläche. Bitte eine durchsichtige oder weiße Fassung hochladen.
    </p>
  );
}

export function SponsorLogo({ logo, alt = "", hoverColor = true, fill = 0.5, className = "", testId }) {
  const boxRef = useRef(null);
  const [size, setSize] = useState(null);
  const mode = logoToneMode(logo);
  const onSize = useCallback((width, height) => {
    const box = boxRef.current?.parentElement;
    const boxWidth = box?.clientWidth || 0;
    const boxHeight = box?.clientHeight || 0;
    if (!width || !height || !boxWidth || !boxHeight) return;
    setSize(balancedLogoSize(width / height, boxWidth / boxHeight, fill));
  }, [fill]);
  if (!logo?.logo_url && !logo?.logo_mono_url) return null;
  const style = size ? { width: `${size.width}%`, height: `${size.height}%` } : undefined;
  const color = logo.logo_url ? resolveMediaUrl(logo.logo_url) : "";
  const logoClass = "w-full h-full object-contain";
  return (
    <span
      ref={boxRef}
      className={`tls-sponsor-logo tls-sponsor-logo--${mode} ${hoverColor ? "tls-sponsor-logo--hover" : ""} ${className}`}
      style={style}
      data-tone={mode}
      data-testid={testId}
    >
      {mode === "file" ? (
        <>
          <span className="tls-sponsor-logo__mono"><SmartLogo src={resolveMediaUrl(logo.logo_mono_url)} alt={alt} className={logoClass} onSize={onSize} /></span>
          {hoverColor && color ? <span className="tls-sponsor-logo__color" aria-hidden="true"><SmartLogo src={color} className={logoClass} /></span> : null}
        </>
      ) : (
        <span className="tls-sponsor-logo__mono"><SmartLogo src={color} alt={alt} className={logoClass} onSize={onSize} /></span>
      )}
    </span>
  );
}
