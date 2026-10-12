import { render, screen } from "@testing-library/react";
import { PublicLoadingState } from "./PublicLoadingState";

// #1231: Detailseiten zeigen beim Laden ein Skelett in der Form der Seite statt eines Kreisels; die Seite hält eine
// Bildschirmhöhe frei, damit die Fußzeile nicht springt.

test("Seite: Skelett in Seitenform, Bildschirmhöhe frei, kein Kreisel", () => {
  const { container } = render(<PublicLoadingState label="Lade Turnier" />);
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("Lade Turnier");
  expect(status).toHaveAttribute("aria-busy", "true");
  expect(status.className).toContain("min-h-[100svh]");
  expect(status.querySelectorAll(".tls-skeleton").length).toBeGreaterThan(10);
  expect(container.querySelector(".animate-spin")).toBeNull();
});

test("Listen zeigen Karten, mitten im Inhalt reichen zwei Zeilen", () => {
  render(
    <>
      <PublicLoadingState cards={3} label="Lade Turniere" />
      <PublicLoadingState variant="inline" label="Lade Kalender" />
    </>,
  );
  expect(screen.getByRole("status", { name: "Lade Turniere" }).children).toHaveLength(3);
  expect(screen.getByRole("status", { name: "Lade Kalender" }).querySelectorAll(".tls-skeleton")).toHaveLength(2);
});
