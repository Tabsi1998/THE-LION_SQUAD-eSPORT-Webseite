import { QRCodeSVG } from "qrcode.react";
import { resolveMediaUrl } from "@/lib/api";
import { TLS_MASCOT, useBrandingAssets } from "@/components/tls/Logo";

export function BrandedQRCode({
  value,
  size = 116,
  bgColor = "#ffffff",
  fgColor = "#0A0A0A",
  className = "",
  logoRatio = 0.25,
}) {
  const branding = useBrandingAssets();
  const logo = resolveMediaUrl(branding.qr_logo_url || branding.mascot_url || branding.favicon_dark_url || branding.logo_dark_url || branding.logo_url || TLS_MASCOT);
  const badgeSize = Math.max(22, Math.round(size * logoRatio));
  const logoSize = Math.round(badgeSize * 0.76);
  const ringSize = Math.max(1, Math.round(size * 0.011));
  const cutoutRadius = Math.round(badgeSize / 2 + ringSize + Math.max(1, size * 0.006));
  const qrCutoutMask = `radial-gradient(circle ${cutoutRadius}px at 50% 50%, transparent 0 ${cutoutRadius}px, #000 ${cutoutRadius + 1}px)`;

  return (
    <span
      className={`relative inline-block overflow-hidden align-middle ${className}`}
      style={{ width: size, height: size, backgroundColor: bgColor }}
      aria-label="QR-Code"
    >
      <QRCodeSVG
        value={value || "https://lionsquad.at"}
        size={size}
        bgColor="transparent"
        fgColor={fgColor}
        level="H"
        marginSize={0}
        className="block h-full w-full"
        style={{
          WebkitMaskImage: qrCutoutMask,
          maskImage: qrCutoutMask,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskSize: "100% 100%",
          maskSize: "100% 100%",
        }}
      />
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full"
        style={{
          width: badgeSize,
          height: badgeSize,
          backgroundColor: bgColor,
          boxShadow: `0 0 0 ${ringSize}px ${fgColor}, 0 0 0 ${ringSize + 1}px ${bgColor}`,
        }}
      >
        <img
          src={logo}
          alt=""
          draggable="false"
          className="block object-contain"
          style={{ width: logoSize, height: logoSize, transform: "scale(1.12)" }}
        />
      </span>
    </span>
  );
}
