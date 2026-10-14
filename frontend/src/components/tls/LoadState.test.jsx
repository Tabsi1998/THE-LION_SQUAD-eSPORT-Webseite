import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LoadNotice, LoadState } from "./LoadState";

// Die Anzeige zum Lade-Baustein (hooks/useLoad.js): Laden, Fehler mit „Nochmal versuchen“, leer und Inhalt getrennt; ein
// alter Stand steht mit Hinweis da.

function view(load, props = {}) {
  return render(
    <MemoryRouter>
      <LoadState load={load} loading={<div>lädt</div>} empty={<div>nichts da</div>} errorTitle="Liste konnte nicht laden" {...props}>
        {(data) => <ul>{data.map((row) => <li key={row}>{row}</li>)}</ul>}
      </LoadState>
    </MemoryRouter>
  );
}

const base = { data: null, status: "loading", loading: true, error: null, problem: null, stale: false, reload: vi.fn(), mutate: vi.fn() };

test("laden zeigt nur den Platzhalter", () => {
  view(base);
  expect(screen.getByText("lädt")).toBeInTheDocument();
  expect(screen.queryByText("nichts da")).not.toBeInTheDocument();
});

test("ein Fehler zeigt was passiert ist und „Nochmal versuchen“ - nie „nichts da“", () => {
  const reload = vi.fn();
  view({ ...base, status: "error", loading: false, problem: "error", reload });
  expect(screen.getByTestId("public-error-state")).toHaveTextContent("Liste konnte nicht laden");
  expect(screen.queryByText("nichts da")).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId("public-error-retry"));
  expect(reload).toHaveBeenCalled();
});

test("ohne Netz sagt der Fehler das", () => {
  view({ ...base, status: "error", loading: false, problem: "offline" });
  expect(screen.getByTestId("public-error-state")).toHaveAttribute("data-kind", "offline");
  expect(screen.getByTestId("public-error-state")).toHaveTextContent("Ohne Netz");
});

test("fehlt das Recht, steht der Satz des Servers da (#1353)", () => {
  view({ ...base, status: "error", loading: false, problem: "denied", error: { response: { status: 403, data: { detail: "Dafür fehlt dir der Bereich „Finanzen“." } } } });
  expect(screen.getByTestId("public-error-state")).toHaveTextContent("Dafür fehlt dir der Bereich „Finanzen“.");
});

test("nicht gefunden kann eine eigene Ansicht haben", () => {
  view({ ...base, status: "error", loading: false, problem: "notFound" }, { notFound: <div>gibt es nicht</div> });
  expect(screen.getByText("gibt es nicht")).toBeInTheDocument();
});

test("leer nur nach Erfolg, Inhalt mit Daten", () => {
  const { unmount } = view({ ...base, status: "empty", loading: false, data: [] });
  expect(screen.getByText("nichts da")).toBeInTheDocument();
  unmount();
  view({ ...base, status: "ok", loading: false, data: ["a", "b"] });
  expect(screen.getByText("b")).toBeInTheDocument();
  expect(screen.queryByTestId("load-stale")).not.toBeInTheDocument();
});

test("alter Stand: Inhalt bleibt, ein Hinweis mit „Nochmal versuchen“ steht darüber", () => {
  const reload = vi.fn();
  view({ ...base, status: "ok", loading: false, data: ["a"], stale: true, problem: "error", reload });
  expect(screen.getByText("a")).toBeInTheDocument();
  expect(screen.getByTestId("load-stale")).toHaveTextContent("letzten Stand");
  fireEvent.click(screen.getByRole("button", { name: /Nochmal versuchen/ }));
  expect(reload).toHaveBeenCalled();
});

test("LoadNotice meldet einen Teilausfall mit eigenem Satz", () => {
  const onRetry = vi.fn();
  render(<LoadNotice message="Urkunden konnten gerade nicht laden." onRetry={onRetry} testId="teil" />);
  expect(screen.getByTestId("teil")).toHaveTextContent("Urkunden konnten gerade nicht laden.");
  fireEvent.click(screen.getByRole("button", { name: /Nochmal versuchen/ }));
  expect(onRetry).toHaveBeenCalled();
});
