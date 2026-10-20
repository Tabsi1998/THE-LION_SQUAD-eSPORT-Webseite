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

test("langer Titel: normal geschrieben, bricht um und endet nach vier Zeilen", () => {
  renderLead({ ...NEWS, title: "Ein sehr langer Titel ".repeat(12) });
  const title = screen.getByRole("heading");
  expect(title.className).toContain("line-clamp-4");
  expect(title.className).toContain("break-words");
  expect(title.className).not.toContain("uppercase");
});

test("eigene Kennung und Überschrift für die Startseite", () => {
  renderLead(NEWS, { testId: "home-featured-news-kart-cup", headingLevel: 2 });
  expect(screen.getByTestId("home-featured-news-kart-cup")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Kart-Cup im November");
});
