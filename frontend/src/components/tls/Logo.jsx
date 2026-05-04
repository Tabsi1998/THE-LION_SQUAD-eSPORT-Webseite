import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";

export const TLS_MASCOT = "/assets/brand/tls-mascot.png";
export const TLS_WORDMARK = "/assets/brand/tls-wordmark.png";

let cachedBranding = null;

function useBrandingAssets() {
  const [branding, setBranding] = useState(cachedBranding);
  useEffect(() => {
    if (cachedBranding) return;
    let cancelled = false;
    api.get("/settings/public").then(({ data }) => {
      if (cancelled) return;
      cachedBranding = data || {};
      setBranding(cachedBranding);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
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
    ? (branding.mascot_url || branding.logo_url || TLS_MASCOT)
    : (branding.logo_url || TLS_WORDMARK);
  const img = (
    <img
      src={src}
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
      src={branding.mascot_url || branding.logo_url || TLS_MASCOT}
      alt={branding.club_name || "TLS"}
      className={`object-contain ${className}`}
      draggable="false"
    />
  );
}
