import { render, screen } from "@testing-library/react";
import { GuestBadge, guestText } from "./GuestBadge";

describe("Gast-Plakette (#1665)", () => {
  test("ohne Kennzeichen steht nichts da", () => {
    const { container } = render(<GuestBadge badge={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("„Gast · Verein/Schule“ - vorgelesen als Gastteam mit Namen, ganz und ohne Kürzung", () => {
    const org = "Höhere Technische Bundeslehranstalt für Probeberufe am Probeberg Nord";
    render(<GuestBadge badge={{ label: "Gast", org }} testId="guest" />);
    const badge = screen.getByTestId("guest");
    expect(badge).toHaveTextContent("Gast");
    expect(badge).toHaveTextContent(org);
    expect(badge.className).not.toMatch(/truncate|line-clamp/);
    expect(screen.getByText(`Gastteam: ${org}`)).toHaveClass("sr-only");
    expect(badge.getAttribute("title")).toContain(org);
  });

  test("schmale Spalten: die Klasse für „nur Gast am Handy“, der Name bleibt vorgelesen und im title", () => {
    render(<GuestBadge badge={{ label: "Gast", org: "Probeschule Nord" }} compact testId="guest" />);
    const badge = screen.getByTestId("guest");
    expect(badge).toHaveClass("tls-guest-badge--compact");
    expect(screen.getByText("Gastteam: Probeschule Nord")).toHaveClass("sr-only");
    expect(badge.getAttribute("title")).toContain("Probeschule Nord");
  });

  test("TV und Discord: nur „Gast“", () => {
    render(<GuestBadge badge={{ label: "Gast" }} testId="guest" />);
    expect(screen.getByTestId("guest")).toHaveTextContent(/^GastGastteam$/);
    expect(guestText({ label: "Gast" })).toBe("Gast");
    expect(guestText({ label: "Gast", org: "SV Probedorf" })).toBe("Gast · SV Probedorf");
    expect(guestText(null)).toBe("");
  });
});
