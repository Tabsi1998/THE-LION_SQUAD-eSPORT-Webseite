import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { getCachedBranding, onBrandingUpdated, setCachedBranding } from "@/lib/brandingEvents";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

export const TLS_MASCOT = "/assets/brand/tls-mascot.png";
export const TLS_WORDMARK = "/assets/brand/tls-wordmark.png";

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
    lg: "h-14",
    xl: "h-20",
  };
  const src = variant === "mascot"
    ? (branding.mascot_url || branding.logo_dark_url || branding.logo_url || TLS_MASCOT)
    : (branding.logo_dark_url || branding.logo_url || TLS_WORDMARK);
  const img = (
    <img
      src={resolveMediaUrl(src)}
      alt={`${branding.club_name || "The Lion Squad"} eSports`}
      className={`${sizes[size]} w-auto object-contain ${className}`}
      data-testid="tls-logo"
      draggable="false"
    />
  );
  if (!asLink) return img;
  return <Link to="/" className="inline-flex items-center" data-testid="tls-logo-link">{img}</Link>;
}

export function MascotBadge({ className = "" }) {
  const branding = useBrandingAssets();
  return (
    <img
      src={resolveMediaUrl(branding.mascot_url || branding.logo_dark_url || branding.logo_url || TLS_MASCOT)}
      alt={branding.club_name || "TLS"}
      className={`object-contain ${className}`}
      draggable="false"
    />
  );
}
