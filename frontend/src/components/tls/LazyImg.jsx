import { useMemo, useState } from "react";
import { resolveMediaUrl } from "@/lib/api";
import { buildSrcSet } from "@/lib/imageVariants";

/**
 * Shared public image helper with consistent lazy/eager loading, async decoding
 * and upload URL normalization. Pass `priority` only for above-the-fold images.
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
  width,
  height,
  ...rest
}) {
  const [failed, setFailed] = useState(false);
  const resolvedSrc = useMemo(() => resolveMediaUrl(failed && fallbackSrc ? fallbackSrc : src), [failed, fallbackSrc, src]);
  // Ohne srcset war das sizes-Attribut wirkungslos: der Browser hatte nur die
  // gespeicherte Fassung zur Auswahl, bis zu 4096 Pixel breit - für eine
  // Kachel, die rund 400 zeigt.
  const resolvedSrcSet = useMemo(() => srcSet || buildSrcSet(resolvedSrc), [srcSet, resolvedSrc]);

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
