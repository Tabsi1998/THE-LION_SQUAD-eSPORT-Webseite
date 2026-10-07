import { useEffect, useMemo, useState } from "react";
import { resolveMediaUrl } from "@/lib/api";
import { buildSrcSet, VARIANT_WIDTHS, widthsForScreen } from "@/lib/imageVariants";

/**
 * Shared public image helper with consistent lazy/eager loading, async decoding
 * and upload URL normalization. Pass `priority` only for above-the-fold images.
 *
 * `sizes` ist Pflicht (#1227): ohne die Angabe, wie breit das Bild gezeigt wird, nimmt der Browser „volle
 * Bildschirmbreite“ an und lädt für ein kleines Bild eine große Fassung. Der Wächter
 * lib/imageSizes.test.jsx meldet jede Stelle ohne; beim Entwickeln warnt zusätzlich die Konsole.
 * `widths` grenzt die angebotenen Fassungen ein (etwa nur die kleinen für ein Profilbild).
 */
export function LazyImg({
  src,
  fallbackSrc = "",
  alt = "",
  className = "",
  style,
  onError,
  onLoad,
  priority = false,
  loading,
  decoding = "async",
  sizes,
  srcSet,
  widths,
  width,
  height,
  ...rest
}) {
  const [failed, setFailed] = useState(false);
  const resolvedSrc = useMemo(() => resolveMediaUrl(failed && fallbackSrc ? fallbackSrc : src), [failed, fallbackSrc, src]);
  // Ohne srcset war das sizes-Attribut wirkungslos: der Browser hatte nur die
  // gespeicherte Fassung zur Auswahl, bis zu 4096 Pixel breit - für eine
  // Kachel, die rund 400 zeigt.
  // Höchstens bis zur doppelten Bildschirmbreite (#1227) - am Handy reicht für ein Foto über die ganze Breite die 800er.
  const widthKey = Array.isArray(widths) ? widths.join(",") : "";
  const resolvedSrcSet = useMemo(
    () => srcSet || buildSrcSet(resolvedSrc, widthsForScreen(widthKey ? widthKey.split(",").map(Number) : VARIANT_WIDTHS)),
    [srcSet, resolvedSrc, widthKey],
  );

  useEffect(() => {
    if (import.meta.env.DEV && resolvedSrcSet && !sizes) {
      console.warn(`[LazyImg] „sizes“ fehlt für ${resolvedSrc} - der Browser rechnet mit voller Bildschirmbreite.`);
    }
  }, [resolvedSrcSet, sizes, resolvedSrc]);

  if (!resolvedSrc) return null;

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      style={style}
      loading={loading || (priority ? "eager" : "lazy")}
      decoding={decoding}
      fetchPriority={priority ? "high" : undefined}
      srcSet={resolvedSrcSet}
      sizes={resolvedSrcSet ? (sizes || "100vw") : sizes}
      width={width}
      height={height}
      onError={(event) => {
        if (fallbackSrc && !failed) setFailed(true);
        onError?.(event);
      }}
      onLoad={onLoad}
      {...rest}
    />
  );
}
