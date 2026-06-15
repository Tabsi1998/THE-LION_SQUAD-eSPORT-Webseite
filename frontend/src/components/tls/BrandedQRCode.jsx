import { QRCodeSVG } from "qrcode.react";
import { resolveMediaUrl } from "@/lib/api";
import { TLS_MASCOT, useBrandingAssets } from "@/components/tls/Logo";

export function BrandedQRCode({
  value,
  size = 116,
  bgColor = "#ffffff",
  fgColor = "#0A0A0A",
  className = "",
  logoRatio = 0.24,
}) {
  const branding = useBrandingAssets();
  const logo = resolveMediaUrl(branding.qr_logo_url || branding.mascot_url || branding.favicon_dark_url || branding.logo_dark_url || branding.logo_url || TLS_MASCOT);
  const badgeSize = Math.max(20, Math.round(size * logoRatio));
  const logoSize = Math.round(badgeSize * 0.72);

  return (
    <span
      className={`relative inline-block align-middle ${className}`}
      style={{ width: size, height: size, backgroundColor: bgColor }}
      aria-label="QR-Code"
    >
      <QRCodeSVG
        value={value || "https://lionsquad.at"}
        size={size}
        bgColor={bgColor}
        fgColor={fgColor}
        level="H"
        includeMargin={false}
        className="block h-full w-full"
      />
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-[0_0_0_1px_rgba(10,10,10,0.14)]"
        style={{ width: badgeSize, height: badgeSize }}
      >
        <img
          src={logo}
          alt=""
          draggable="false"
          className="block object-contain"
          style={{ width: logoSize, height: logoSize, transform: "scale(1.18)" }}
        />
      </span>
    </span>
  );
}
