import { QRCodeSVG } from "qrcode.react";
import { resolveMediaUrl } from "@/lib/api";
import { TLS_MASCOT, useBrandingAssets } from "@/components/tls/Logo";

export function BrandedQRCode({
  value,
  size = 116,
  bgColor = "#ffffff",
  fgColor = "#0A0A0A",
  className = "",
  logoRatio = 0.16,
}) {
  const branding = useBrandingAssets();
  const logo = resolveMediaUrl(branding.qr_logo_url || branding.mascot_url || branding.favicon_dark_url || branding.logo_dark_url || branding.logo_url || TLS_MASCOT);
  const logoSize = Math.max(18, Math.round(size * logoRatio));

  return (
    <QRCodeSVG
      value={value || "https://lionsquad.at"}
      size={size}
      bgColor={bgColor}
      fgColor={fgColor}
      level="H"
      includeMargin={false}
      className={className}
      imageSettings={{
        src: logo,
        height: logoSize,
        width: logoSize,
        excavate: true,
      }}
    />
  );
}
