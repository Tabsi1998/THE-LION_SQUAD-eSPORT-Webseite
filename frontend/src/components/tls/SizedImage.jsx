import { useEffect, useState } from "react";
import { LazyImg } from "@/components/tls/LazyImg";
import { widthsForDisplay } from "@/lib/imageVariants";

// Die Größen für Profilbilder (#1227, Fabians Auswahl vom 07.10.2026) - rund in Listen, Chats und Profil.
export const PROFILE_IMAGE_SIZES = [24, 32, 40, 48, 96];

/**
 * Bilder in passender Größe (#1227): der Baustein für Profilbilder und Kacheln. Er bietet dem Browser nur die
 * festen Breiten des Servers an, die zu dieser Anzeige passen (ein 40-Pixel-Profilbild bekommt die 160er), und sagt
 * ihm, wie breit das Bild gezeigt wird - am scharfen Handy-Bildschirm nimmt der Browser dann von selbst die
 * nächstgrößere. Bilder weiter unten laden erst beim Hinscrollen.
 *
 * - `size`: quadratisch in festen Pixeln (24, 32, 40, 48, 96 …), mit `round` rund.
 * - `width` und `height`: ein festes Rechteck (etwa 80 × 64 für eine kleine Kachel).
 * - `sizes`: für Kacheln, die mit dem Bildschirm wachsen (dann füllt das Bild seinen Kasten).
 * Ohne Bild oder wenn es nicht lädt, steht `fallback` da - #1319 legt dort zwei Buchstaben auf Farbe hinein.
 */
export function SizedImage({ src, size, width = size, height = size, sizes, round = false, alt = "", className = "", style, fallback = null, ...rest }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return fallback;
  const fixed = Number(width) > 0;
  return (
    <LazyImg
      src={src}
      alt={alt}
      sizes={sizes || (fixed ? `${width}px` : undefined)}
      widths={fixed && !sizes ? widthsForDisplay(Math.max(Number(width), Number(height) || 0)) : undefined}
      width={fixed ? width : undefined}
      height={fixed ? height : undefined}
      className={`${round ? "rounded-full" : ""} object-cover ${className}`.trim()}
      style={fixed ? { width, height, ...style } : style}
      onError={() => setFailed(true)}
      {...rest}
    />
  );
}
