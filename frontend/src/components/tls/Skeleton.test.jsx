import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { SkeletonCards, SkeletonDetailHeader, SkeletonLines, SkeletonList, SkeletonTable } from "./Skeleton";
import { PageTransition } from "./PageTransition";

// #226: Skelette in der Form des Inhalts, für Vorleser als „beschäftigt“ markiert; der
// Seitenwechsel blendet ein - nicht beim ersten Aufbau und nicht mit „Bewegung reduzieren“.

test("jedes Skelett ist ein Status mit Beschriftung und hat die passende Form", () => {
  render(
    <>
      <SkeletonLines lines={4} label="Lade Text" />
      <SkeletonCards count={2} label="Lade Karten" />
      <SkeletonList rows={3} label="Lade Liste" />
      <SkeletonTable rows={2} columns={3} label="Lade Tabelle" />
      <SkeletonDetailHeader label="Lade Kopf" />
    </>,
  );
  expect(screen.getByRole("status", { name: "Lade Text" }).querySelectorAll(".tls-skeleton")).toHaveLength(4);
  expect(screen.getByRole("status", { name: "Lade Karten" }).children).toHaveLength(2);
  expect(screen.getByRole("status", { name: "Lade Liste" }).children).toHaveLength(3);
  // Kopfzeile plus zwei Zeilen à drei Knochen
  expect(screen.getByRole("status", { name: "Lade Tabelle" }).querySelectorAll(".tls-skeleton")).toHaveLength(9);
  expect(screen.getByRole("status", { name: "Lade Kopf" })).toHaveAttribute("aria-busy", "true");
});

function Page({ to }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(to)}>weiter</button>;
}

test("der Seitenwechsel blendet ein - nicht beim ersten Aufbau, nicht mit Bewegung reduzieren", () => {
  const animate = vi.fn();
  window.Element.prototype.animate = animate;
  render(
    <MemoryRouter initialEntries={["/a"]}>
      <PageTransition>
        <Routes>
          <Route path="/a" element={<Page to="/b" />} />
          <Route path="/b" element={<Page to="/a" />} />
        </Routes>
      </PageTransition>
    </MemoryRouter>,
  );
  expect(animate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("weiter"));
  expect(animate).toHaveBeenCalledTimes(1);

  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  fireEvent.click(screen.getByText("weiter"));
  expect(animate).toHaveBeenCalledTimes(1);
  delete window.matchMedia;
  delete window.Element.prototype.animate;
});
