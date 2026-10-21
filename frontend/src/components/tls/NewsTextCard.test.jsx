import { render, screen } from "@testing-library/react";
import { LION_PLACE, NewsTextCard } from "./NewsTextCard";
import { NEWS_CATEGORY_DARK_FALLBACK, KIND_COLORS_DARK } from "@/lib/categoryColors";

// News ohne Bild (#1343): Fläche in der dunklen Kategorie-Farbe, ein Satz aus der News und der angeschnittene Löwe -
// bei Ergebnis-News Pokal und „1. Sieger“ in Gold. Nie eine leere Fläche.

function rgb(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

test("Satz aus der News, gekürzt, auf der Kategorie-Farbe, mit Löwe", () => {
  render(<NewsTextCard news={{ category: "tournaments", excerpt: "Die Anmeldung ist offen. Mehr im Text.", title: "Cup" }} />);
  const card = screen.getByTestId("news-text-card");
  expect(card).toHaveTextContent("Die Anmeldung ist offen.");
  expect(card).not.toHaveTextContent("Mehr im Text.");
  expect(card.style.backgroundColor).toBe(rgb(KIND_COLORS_DARK.tournament));
  expect(card.querySelector("[data-testid='lion-art-plain']")).not.toBeNull();
  expect(card).toHaveAttribute("data-variant", "sentence");
});

test("Kategorie ohne Farbe: Grau", () => {
  render(<NewsTextCard news={{ category: "recap", title: "Rückblick" }} />);
  expect(screen.getByTestId("news-text-card").style.backgroundColor).toBe(rgb(NEWS_CATEGORY_DARK_FALLBACK));
});

test("Ergebnis-News: Pokal und Sieger in Gold statt Satz", () => {
  render(<NewsTextCard news={{ category: "recap", excerpt: "Was für ein Abend.", result: { winner: "NeonFalke", tournament: "Kart-Cup" } }} />);
  const card = screen.getByTestId("news-text-card");
  expect(card).toHaveAttribute("data-variant", "result");
  expect(screen.getByTestId("news-text-card-winner")).toHaveTextContent("1. NeonFalke");
  expect(card).toHaveTextContent("Kart-Cup");
  expect(card).not.toHaveTextContent("Was für ein Abend.");
});

test("als Vorschaubild (klein) nur Fläche und Löwe", () => {
  render(<NewsTextCard news={{ category: "events", excerpt: "Satz." }} size="thumb" />);
  const card = screen.getByTestId("news-text-card");
  expect(card).not.toHaveTextContent("Satz.");
  expect(card.querySelector("[data-testid='lion-art-plain']")).not.toBeNull();
});

test("der Löwe lässt die oberen Ecken frei - dort darf Saison-Deko an der Karte liegen", () => {
  render(<NewsTextCard news={{ category: "club", excerpt: "Satz." }} />);
  const lion = screen.getByTestId("lion-art-plain");
  expect(lion.getAttribute("class")).toContain(LION_PLACE);
  const height = Number(LION_PLACE.match(/h-\[(\d+)%\]/)[1]);
  const below = Number(LION_PLACE.match(/-bottom-\[(\d+)%\]/)[1]);
  // Oberkante des Löwen in % der Kartenhöhe: mindestens ein Drittel bleibt frei (ein Ei braucht gut 45 px).
  expect(100 - height + below).toBeGreaterThanOrEqual(33);
});
