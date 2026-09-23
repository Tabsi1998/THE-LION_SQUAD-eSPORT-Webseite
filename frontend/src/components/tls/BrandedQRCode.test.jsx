import { render, screen } from "@testing-library/react";

// QR-Code mit Löwe (#400): das QR-Logo aus dem Branding sitzt auf der Platte, die Suchmuster tragen
// die Akzentfarbe; ohne Logo bleibt die Mitte voll.

const brandingState = { value: {} };
vi.mock("@/components/tls/Logo", () => ({ TLS_MASCOT: "/assets/brand/tls-mascot.png", useBrandingAssets: () => brandingState.value }));
vi.mock("@/lib/api", () => ({ resolveMediaUrl: (value) => (String(value).startsWith("/") ? `https://lionsquad.at${value}` : value) }));

const { BrandedQRCode } = await import("./BrandedQRCode");

test("nimmt das QR-Logo aus dem Branding und die Akzentfarbe", () => {
  brandingState.value = { qr_logo_url: "/api/uploads/branding/loewe.png", mascot_url: "/assets/brand/tls-mascot.png", primary_color: "#29B6E8" };
  render(<BrandedQRCode value="https://lionsquad.at/members/verify/abc" size={168} logoRatio={0.2} />);
  const svg = screen.getByTestId("branded-qr-code").querySelector("svg");
  expect(svg.getAttribute("width")).toBe("168");
  expect(screen.getByTestId("branded-qr-logo").getAttribute("href")).toBe("https://lionsquad.at/api/uploads/branding/loewe.png");
  expect(svg.querySelectorAll('rect[fill="#29B6E8"]')).toHaveLength(6);
});

test("ohne QR-Logo das Maskottchen; ohne Logo keine Platte", () => {
  brandingState.value = {};
  const { unmount } = render(<BrandedQRCode value="https://lionsquad.at" />);
  expect(screen.getByTestId("branded-qr-logo").getAttribute("href")).toBe("https://lionsquad.at/assets/brand/tls-mascot.png");
  unmount();
  render(<BrandedQRCode value="https://lionsquad.at" withLogo={false} />);
  expect(screen.queryByTestId("branded-qr-logo")).toBeNull();
});
