import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LION_PATH, LionArt } from "./LionArt";
import { PublicEmptyState, PublicErrorState, artForProblem } from "./PublicEmptyState";

// Leer, Fehler und offline mit dem Löwen (#1325): drei Bilder, eine Zeichnung in Web und App.

test("jedes Bild: Löwe in einer Farbe plus sein Zeichen, ohne Titel nur Schmuck", () => {
  const { container } = render(
    <>
      <LionArt art="sleep" />
      <LionArt art="search" />
      <LionArt art="offline" title="Ohne Netz" />
      <LionArt art="plain" />
    </>,
  );
  for (const art of ["sleep", "search", "offline"]) {
    const svg = screen.getByTestId(`lion-art-${art}`);
    expect(svg.querySelector("path[fill='currentColor']").getAttribute("d")).toBe(LION_PATH);
    expect(svg.querySelector(`[data-sign='${art}']`)).not.toBeNull();
    expect(svg.querySelector("mask")).not.toBeNull();
  }
  expect(screen.getByTestId("lion-art-sleep")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByRole("img", { name: "Ohne Netz" })).toBe(screen.getByTestId("lion-art-offline"));
  expect(screen.getByTestId("lion-art-plain").querySelector("[data-sign]")).toBeNull();
  // Jede Maske hat ihre eigene Kennung - mehrere Löwen auf einer Seite stören sich nicht.
  const ids = [...container.querySelectorAll("mask")].map((mask) => mask.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("die App zeichnet denselben Löwen", () => {
  const app = readFileSync(path.join(process.cwd(), "../mobile/src/components/LionArt.tsx"), "utf8");
  const match = app.match(/export const LION_PATH = "([^"]+)";/);
  expect(match?.[1]).toBe(LION_PATH);
});

test("leer: schlafender Löwe, ein Knopf, der zweite Weg als Link", () => {
  render(
    <MemoryRouter>
      <PublicEmptyState title="Noch keine Turniere" description="Sobald eins angekündigt ist, steht es hier." primaryAction={{ to: "/events", label: "Events ansehen" }} secondaryAction={{ to: "/news", label: "News lesen" }} />
    </MemoryRouter>,
  );
  const box = screen.getByTestId("public-empty-state");
  expect(box).toHaveAttribute("data-art", "sleep");
  expect(box.querySelector("[data-testid='lion-art-sleep']")).not.toBeNull();
  expect(screen.getByRole("heading", { name: "Noch keine Turniere" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Events ansehen" }).className).toContain("tls-btn--primary");
  expect(screen.getByRole("link", { name: "News lesen" }).className).not.toContain("tls-btn");
});

test("Ladefehler: nicht gefunden mit Lupe, sonst der Stecker", () => {
  expect(artForProblem("notFound")).toBe("search");
  expect(artForProblem("denied")).toBe("sleep");
  expect(artForProblem("offline")).toBe("offline");
  expect(artForProblem("error")).toBe("offline");
  render(<PublicErrorState kind="error" onRetry={() => undefined} />);
  expect(screen.getByRole("alert").querySelector("[data-testid='lion-art-offline']")).not.toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent("Da ist uns ein Kabel rausgerutscht");
});
