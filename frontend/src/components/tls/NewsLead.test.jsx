import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NewsLead } from "./NewsLead";

vi.mock("@/lib/api", () => ({ resolveMediaUrl: (u) => u }));

// Angepinnte News als breiter Aufmacher (#1342, Variante A): Bild links, rechts Kategorie, Titel, Anriss und
// „Weiterlesen“ - der Text steht nie auf dem Bild, die ganze Fläche ist ein Link.

const NEWS = { id: "n1", slug: "kart-cup", title: "Kart-Cup im November", category: "tournaments", excerpt: "Die Anmeldung ist offen. Es gibt 16 Plätze.", pinned: true };

function renderLead(news, props = {}) {
  return render(<MemoryRouter><NewsLead news={news} {...props} /></MemoryRouter>);
}

test("mit Bild: eine Fläche als Link, Bild links, Text rechts daneben", () => {
  renderLead({ ...NEWS, banner_url: "/kart.webp" });
  const lead = screen.getByTestId("news-lead-kart-cup");
  expect(lead.tagName).toBe("A");
  expect(lead).toHaveAttribute("href", "/news/kart-cup");
  expect(lead).toHaveAttribute("data-season-anchor", "card");
  expect(lead.className).toContain("md:grid-cols-2");
  expect(lead.className).toContain("lg:grid-cols-[55fr_45fr]");
  const media = screen.getByTestId("news-lead-media");
  expect(media.className).toContain("aspect-video");
  expect(media.querySelector("img")).not.toBeNull();
  expect(screen.queryByTestId("news-text-card")).toBeNull();
  const text = screen.getByTestId("news-lead-text");
  expect(text).toHaveTextContent("Turniere");
  expect(text).toHaveTextContent("Kart-Cup im November");
  expect(text).toHaveTextContent("Die Anmeldung ist offen. Es gibt 16 Plätze.");
  expect(text).toHaveTextContent("Weiterlesen");
  expect(media.contains(text)).toBe(false);
});

test("ohne Bild: links die Text-Karte", () => {
  renderLead(NEWS);
  expect(screen.getByTestId("news-lead-media").querySelector("[data-testid='news-text-card']")).not.toBeNull();
});

// Schrift-Treppe (#1302): Der Aufmacher hat eine Stufe, den Abschnitt (24 / 20 px) - ein langer Titel bricht um
// (#1314), eine kleinere Zwischenstufe gibt es nicht mehr.
test("langer Titel: normal geschrieben, steht ganz da - im Abschnitt wie der kurze (#1314, #1302)", () => {
  const long = "Ein sehr langer Titel ".repeat(12).trim();
  renderLead({ ...NEWS, title: long });
  const title = screen.getByRole("heading");
  expect(title).toHaveTextContent(long);
  expect(title.className).not.toContain("line-clamp");
  expect(title.className).toContain("tls-wrap");
  expect(title.className).toContain("tls-type-section");
  expect(title.className).not.toContain("uppercase");
});

test("kurzer Titel: Abschnitt", () => {
  renderLead(NEWS);
  expect(screen.getByRole("heading").className).toContain("tls-type-section");
});

test("eigene Kennung und Überschrift für die Startseite", () => {
  renderLead(NEWS, { testId: "home-featured-news-kart-cup", headingLevel: 2 });
  expect(screen.getByTestId("home-featured-news-kart-cup")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Kart-Cup im November");
});
