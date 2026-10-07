import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { getCachedBranding, onBrandingUpdated, setCachedBranding } from "@/lib/brandingEvents";
import { buildSrcSet } from "@/lib/imageVariants";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

export const TLS_MASCOT = "/assets/brand/tls-mascot.png";
export const TLS_WORDMARK = "/assets/brand/tls-wordmark.png";

// Logo und Maskottchen in passender Größe (#1227): das Wortlogo im Kopf war ein PNG mit 3508 × 1075 Pixeln für
// eine Anzeige von rund 180 × 56. Jetzt bekommt der Browser die festen Breiten des Servers (160 bis 800) und die
// Anzeigebreite und nimmt für scharfe Bildschirme selbst die passende - die doppelte Anzeigehöhe am PC, mehr am
// Handy. Ein SVG-Logo bleibt, wie es ist. Für die eingebauten Bilder liegen die Fassungen fertig unter
// public/assets/brand (gebaut mit services/image_variants.build_variant, wie der Server es tut).
const LOGO_WIDTHS = [160, 320, 400, 800];
const BUILT_IN = {
  [TLS_WORDMARK]: "/assets/brand/tls-wordmark",
  [TLS_MASCOT]: "/assets/brand/tls-mascot",
};
// Das Wortlogo ist gut dreimal so breit wie hoch (3508 × 1075); daraus und aus der Höhe ergibt sich die Breite.
const WORDMARK_RATIO = 3508 / 1075;
// Höhe am Handy und ab 768 px - wie die Klassen in SIZES unten.
const LOGO_HEIGHTS = { sm: [32, 32], md: [40, 40], lg: [48, 56], xl: [64, 80] };

export function brandSrcSet(src) {
  const builtIn = BUILT_IN[src];
  if (builtIn) return LOGO_WIDTHS.map((width) => `${builtIn}-${width}.webp ${width}w`).join(", ");
  return buildSrcSet(resolveMediaUrl(src), LOGO_WIDTHS);
}

/** Wie breit das Logo gezeigt wird - für das sizes-Attribut. */
export function logoSizes(size = "md", variant = "wordmark") {
  const [small, large] = LOGO_HEIGHTS[size] || LOGO_HEIGHTS.md;
  const ratio = variant === "mascot" ? 1 : WORDMARK_RATIO;
  const px = (height) => `${Math.round(height * ratio)}px`;
  return small === large ? px(small) : `(min-width: 768px) ${px(large)}, ${px(small)}`;
}

let brandingLoadPromise = null;

export function useBrandingAssets() {
  const [branding, setBranding] = useState(getCachedBranding());
  const loadBranding = useCallback(async () => {
    try {
      if (!brandingLoadPromise) {
        brandingLoadPromise = api.get("/settings/public").finally(() => {
          brandingLoadPromise = null;
        });
      }
      const { data } = await brandingLoadPromise;
      setCachedBranding(data || {});
      setBranding(data || {});
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = onBrandingUpdated((next) => {
      if (!cancelled) setBranding(next || {});
    });
    loadBranding();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadBranding]);
  useApiInvalidation(loadBranding, ["settings", "branding"]);
  return branding || {};
}

export function Logo({ variant = "wordmark", size = "md", asLink = true, className = "" }) {
  const branding = useBrandingAssets();
  const sizes = {
    sm: "h-8",
    md: "h-10",
    lg: "h-12 md:h-14",
    xl: "h-16 md:h-20",
  };
  const src = variant === "mascot"
    ? (branding.mascot_url || branding.logo_dark_url || branding.logo_url || TLS_MASCOT)
    : (branding.logo_dark_url || branding.logo_url || TLS_WORDMARK);
  const srcSet = brandSrcSet(src);
  const img = (
    <img
      src={resolveMediaUrl(src)}
      srcSet={srcSet}
      sizes={srcSet ? logoSizes(size, variant) : undefined}
      alt={`${branding.club_name || "The Lion Squad"} eSports`}
      className={`${sizes[size]} w-auto object-contain ${className}`}
      data-testid="tls-logo"
      draggable="false"
      decoding="async"
    />
  );
  if (!asLink) return img;
  return <Link to="/" className="inline-flex items-center" data-testid="tls-logo-link">{img}</Link>;
}

export function MascotBadge({ className = "", sizes = "160px" }) {
  const branding = useBrandingAssets();
  const src = branding.mascot_url || branding.logo_dark_url || branding.logo_url || TLS_MASCOT;
  const srcSet = brandSrcSet(src);
  return (
    <img
      src={resolveMediaUrl(src)}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={branding.club_name || "TLS"}
      className={`object-contain ${className}`}
      draggable="false"
      decoding="async"
    />
  );
}
