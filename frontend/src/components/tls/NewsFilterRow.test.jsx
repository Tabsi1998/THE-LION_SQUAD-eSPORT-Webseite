import { fireEvent, render, screen } from "@testing-library/react";
import { NewsFilterRow } from "./NewsFilterRow";

// News-Kategorien (#1249): nur die, die es gibt, mit Anzahl - eine Zeile weicher Knöpfe zum Wischen, die Suche als
// Symbol am Ende der Zeile.

const IN_USE = [
  { k: "tournaments", l: "Turniere", count: 3 },
  { k: "club", l: "Verein", count: 1 },
];

test("nur Kategorien mit Artikeln, jede mit Anzahl, Alle mit der Summe", () => {
  render(<NewsFilterRow categories={IN_USE} active="" onSelect={() => {}} query="" onQuery={() => {}} />);
  expect(screen.getByTestId("news-filter-all")).toHaveTextContent("Alle4");
  expect(screen.getByTestId("news-filter-tournaments")).toHaveTextContent("Turniere3");
  expect(screen.getByTestId("news-filter-club")).toHaveTextContent("Verein1");
  expect(screen.queryByTestId("news-filter-sponsors")).toBeNull();
  expect(screen.getByTestId("news-filter-all")).toHaveAttribute("aria-pressed", "true");
});

test("eine Zeile: die Knöpfe brechen nicht um, die Zeile wischt", () => {
  render(<NewsFilterRow categories={IN_USE} active="club" onSelect={() => {}} query="" onQuery={() => {}} />);
  const row = screen.getByTestId("news-filter-row");
  expect(row.className).toContain("overflow-x-auto");
  expect(row.className).toContain("flex-nowrap");
  expect(screen.getByTestId("news-filter-club")).toHaveAttribute("aria-pressed", "true");
});

test("eine gewählte Kategorie ohne Artikel bleibt sichtbar, damit man sie abwählen kann", () => {
  render(<NewsFilterRow categories={IN_USE} active="sponsors" onSelect={() => {}} query="" onQuery={() => {}} />);
  expect(screen.getByTestId("news-filter-sponsors")).toHaveTextContent("Sponsoren0");
});

test("Wahl und Suche: das Symbol klappt das Feld auf, Leeren klappt es zu", () => {
  const onSelect = vi.fn();
  const onQuery = vi.fn();
  const { rerender } = render(<NewsFilterRow categories={IN_USE} active="" onSelect={onSelect} query="" onQuery={onQuery} />);
  fireEvent.click(screen.getByTestId("news-filter-tournaments"));
  expect(onSelect).toHaveBeenCalledWith("tournaments");

  expect(screen.queryByTestId("news-search")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "News suchen" }));
  const input = screen.getByTestId("news-search");
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "Mario" } });
  expect(onQuery).toHaveBeenCalledWith("Mario");

  rerender(<NewsFilterRow categories={IN_USE} active="" onSelect={onSelect} query="Mario" onQuery={onQuery} />);
  fireEvent.click(screen.getByRole("button", { name: "Suche leeren" }));
  expect(onQuery).toHaveBeenLastCalledWith("");
});

test("mit Suchbegriff aus der Adresse ist das Feld gleich offen", () => {
  render(<NewsFilterRow categories={IN_USE} active="" onSelect={() => {}} query="Kart" onQuery={() => {}} />);
  expect(screen.getByTestId("news-search")).toHaveValue("Kart");
});
