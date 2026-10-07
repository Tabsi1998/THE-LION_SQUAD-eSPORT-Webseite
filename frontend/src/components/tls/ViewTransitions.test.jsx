import { act, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ViewTransitions } from "./ViewTransitions";

// Seitenwechsel (#1073): Ein Klick auf einen Link läuft im Übergang des Browsers - mit allem, was der Link mitgibt
// (state). Navigieren aus dem Code (Weiterleitungen) und „Bewegung reduzieren“ bleiben ohne Übergang.

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}{location.state?.von ? ` von ${location.state.von}` : ""}</p>;
}

function Redirect() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate("/weiter")}>weiter</button>;
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <ViewTransitions />
      <Link to="/teams" state={{ von: "start" }}>Teams</Link>
      <Redirect />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  );
}

const realStart = document.startViewTransition;
const realMatch = window.matchMedia;
let started;
beforeEach(() => {
  started = [];
  document.startViewTransition = (update) => {
    const done = update();
    started.push(done);
    return { finished: Promise.resolve(done) };
  };
  window.matchMedia = () => ({ matches: false });
});
afterEach(() => {
  document.startViewTransition = realStart;
  window.matchMedia = realMatch;
});

test("Klick auf einen Link: Übergang, das Ziel samt state kommt an, der Browser wird losgelassen", async () => {
  renderApp();
  await act(async () => { fireEvent.click(screen.getByText("Teams")); });
  expect(started).toHaveLength(1);
  expect(screen.getByTestId("where")).toHaveTextContent("/teams von start");
  // Die neue Seite steht - der wartende Übergang ist losgelassen (nicht erst nach der Wartezeit).
  await expect(started[0]).resolves.toBe(true);
});

test("Navigieren aus dem Code bleibt ohne Übergang", async () => {
  renderApp();
  await act(async () => { fireEvent.click(screen.getByText("weiter")); });
  expect(started).toHaveLength(0);
  expect(screen.getByTestId("where")).toHaveTextContent("/weiter");
});

test("mit „Bewegung reduzieren“ kein Übergang", async () => {
  window.matchMedia = () => ({ matches: true });
  renderApp();
  await act(async () => { fireEvent.click(screen.getByText("Teams")); });
  expect(started).toHaveLength(0);
  expect(screen.getByTestId("where")).toHaveTextContent("/teams von start");
});
