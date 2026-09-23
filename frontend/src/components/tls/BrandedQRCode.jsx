import { useMemo } from "react";
import { resolveMediaUrl } from "@/lib/api";
import { TLS_MASCOT, useBrandingAssets } from "@/components/tls/Logo";
import { finderParts, qrModel } from "@/lib/qrDesign";

// QR-Code mit Löwe (#400): eine Komponente für TV-Ansichten, Mitgliedskarte und Downloads. Das
// Logo kommt aus Branding → „QR-Logo“ (PNG, transparent), sonst Maskottchen/Logo; es sitzt scharf
// auf einer abgerundeten Platte mit Ruhezone statt hochskaliert in einem harten Ring. Module
// abgerundet, Suchmuster in der Akzentfarbe, Fehlerkorrektur H.

export function qrLogoHref(branding) {
  return resolveMediaUrl(branding?.qr_logo_url || branding?.mascot_url || branding?.favicon_dark_url || branding?.logo_dark_url || branding?.logo_url || TLS_MASCOT);
}

export function BrandedQRCode({
  value,
  size = 116,
  bgColor = "#ffffff",
  fgColor = "#0A0A0A",
  accent = null,
  className = "",
  logoRatio = 0.22,
  withLogo = true,
}) {
  const branding = useBrandingAssets();
  const logo = qrLogoHref(branding);
  const accentColor = accent || branding?.primary_color || fgColor;
  const model = useMemo(
    () => qrModel({ value, size, logoRatio, fgColor, bgColor, accent: accentColor, withLogo }),
    [accentColor, bgColor, fgColor, logoRatio, size, value, withLogo],
  );

  return (
    <span
      className={`inline-block align-middle leading-none ${className}`}
      style={{ width: size, height: size }}
      aria-label="QR-Code"
      data-testid="branded-qr-code"
    >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-hidden="true"
      className="block h-full w-full"
    >
      <rect width={size} height={size} rx={model.frameRadius} fill={model.colors.bg} />
      <g fill={model.colors.fg}>
        {model.modules.map((m) => <rect key={`${m.x}-${m.y}`} x={m.x} y={m.y} width={model.moduleSize} height={model.moduleSize} rx={model.moduleRadius} />)}
      </g>
      {model.finders.map((finder, index) => finderParts(model, finder).map((part, partIndex) => (
        <rect key={`f${index}-${partIndex}`} x={part.x} y={part.y} width={part.size} height={part.size} rx={part.radius} fill={part.fill} />
      )))}
      {model.plate ? (
        <>
          <rect x={model.plate.x} y={model.plate.y} width={model.plate.size} height={model.plate.size} rx={model.plate.radius} fill={model.colors.bg} />
          <image href={logo} x={model.logo.x} y={model.logo.y} width={model.logo.size} height={model.logo.size} preserveAspectRatio="xMidYMid meet" data-testid="branded-qr-logo" />
        </>
      ) : null}
    </svg>
    </span>
  );
}
