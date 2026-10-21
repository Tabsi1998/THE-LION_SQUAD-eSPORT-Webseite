import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LogoToneHint, SponsorLogo, balancedLogoSize, logoToneMode } from "./SponsorLogo";
import { LogoTicker } from "./LogoTicker";
import { partnerTickerItems } from "./PartnerTicker";

// Sponsoren- und Partner-Logos einfarbig (#1321): weiße Fassung, Filter bei durchsichtigen Logos, sonst das Original
// auf einer ruhigen Fläche; alle Logos füllen etwa dieselbe Fläche ihres Kastens.

test("logoToneMode: weiße Fassung vor Filter vor Fläche", () => {
  expect(logoToneMode({ logo_url: "/a.png", logo_mono_url: "/a-weiss.png", logo_transparent: false })).toBe("file");
  expect(logoToneMode({ logo_url: "/a.png", logo_transparent: true })).toBe("filter");
  expect(logoToneMode({ logo_url: "/a.png", logo_transparent: false })).toBe("surface");
  expect(logoToneMode({ logo_url: "/a.png" })).toBe("surface");
});

test("balancedLogoSize: gleiche Fläche, egal ob breit oder quadratisch - nie größer als der Kasten", () => {
  // Kasten 4:1, die Hälfte der Fläche.
  const wide = balancedLogoSize(4, 4, 0.5);
  const square = balancedLogoSize(1, 4, 0.5);
  expect(wide).toEqual({ width: 70.7, height: 70.7 });
  expect(square.height).toBe(100);
  expect(square.width).toBe(25);
  // Fläche (Breite x Höhe in Kastenanteilen): das breite Logo nimmt die gewünschte Hälfte, das quadratische so viel,
  // wie die Höhe erlaubt - beide klar mehr als ein winziges Logo von früher.
  expect(Math.round(wide.width * wide.height) / 10000).toBeCloseTo(0.5, 1);
  const tall = balancedLogoSize(0.2, 1, 0.5);
  expect(tall.height).toBeLessThanOrEqual(100);
  expect(tall.width).toBeLessThanOrEqual(100);
  expect(balancedLogoSize(0, 4)).toBeNull();
});

test("weiße Fassung: weiß unten, das Original darüber zum Einblenden", () => {
  render(<SponsorLogo logo={{ logo_url: "/api/static/uploads/a.png", logo_mono_url: "/api/static/uploads/a-weiss.png" }} alt="Alpha" testId="logo" />);
  const logo = screen.getByTestId("logo");
  expect(logo).toHaveAttribute("data-tone", "file");
  expect(logo.className).toContain("tls-sponsor-logo--hover");
  expect(logo.querySelector(".tls-sponsor-logo__mono")).not.toBeNull();
  expect(logo.querySelector(".tls-sponsor-logo__color")).not.toBeNull();
  expect(screen.getByRole("img", { name: "Alpha" })).toBeInTheDocument();
});

test("durchsichtiges Logo per Filter, Logo mit Kasten im Original auf Fläche, ohne Drüberfahren-Farbe auch ohne Ebene", () => {
  const { rerender } = render(<SponsorLogo logo={{ logo_url: "/a.png", logo_transparent: true }} testId="logo" />);
  expect(screen.getByTestId("logo").className).toContain("tls-sponsor-logo--filter");
  rerender(<SponsorLogo logo={{ logo_url: "/a.png", logo_transparent: false }} testId="logo" />);
  expect(screen.getByTestId("logo").className).toContain("tls-sponsor-logo--surface");
  rerender(<SponsorLogo logo={{ logo_url: "/a.png", logo_mono_url: "/w.png" }} hoverColor={false} testId="logo" />);
  expect(screen.getByTestId("logo").className).not.toContain("tls-sponsor-logo--hover");
  expect(screen.getByTestId("logo").querySelector(".tls-sponsor-logo__color")).toBeNull();
});

test("Fußzeilen-Band: einfarbig ohne Farbe beim Drüberfahren; die Partner tragen weiße Fassung und Durchsichtigkeit mit", () => {
  const items = partnerTickerItems([{ id: "p1", slug: "gamma", name: "Gamma", logo_url: "/g.png", logo_mono_url: "/g-w.png", logo_transparent: false }]);
  expect(items[0]).toMatchObject({ logo_mono_url: "/g-w.png", logo_transparent: false });
  render(<MemoryRouter><LogoTicker items={items} boxClassFor={() => "h-8 w-24"} hoverColor={false} /></MemoryRouter>);
  const logo = screen.getByTestId("logo-ticker").querySelector(".tls-sponsor-logo");
  expect(logo).toHaveAttribute("data-tone", "file");
  expect(logo.className).not.toContain("tls-sponsor-logo--hover");
});

test("Verwaltung: Hinweis nur bei gespeichertem Logo mit Kasten und ohne weiße Fassung", () => {
  const saved = { logo_url: "/a.png", logo_transparent: false };
  const { rerender } = render(<LogoToneHint saved={saved} currentLogoUrl="/a.png" currentMonoUrl="" testId="hint" />);
  expect(screen.getByTestId("hint")).toHaveTextContent("Bitte eine durchsichtige oder weiße Fassung hochladen.");
  rerender(<LogoToneHint saved={saved} currentLogoUrl="/a.png" currentMonoUrl="/w.png" testId="hint" />);
  expect(screen.queryByTestId("hint")).toBeNull();
  rerender(<LogoToneHint saved={{ ...saved, logo_transparent: true }} currentLogoUrl="/a.png" currentMonoUrl="" testId="hint" />);
  expect(screen.queryByTestId("hint")).toBeNull();
  rerender(<LogoToneHint saved={saved} currentLogoUrl="/neu.png" currentMonoUrl="" testId="hint" />);
  expect(screen.queryByTestId("hint")).toBeNull();
});
