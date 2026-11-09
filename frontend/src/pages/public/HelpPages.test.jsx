import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { THEMEN, hilfeSchritte } from "@/hilfe";

// Hilfe-Bereich (#2295): Übersicht mit Suche (auch als ?q= in der Adresse) und Themenkarten; ein Thema mit Inhalt,
// nummerierten Schritten samt Anker, Hinweisen und Bildern; unbekanntes Thema mit Weg zurück.

vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));

const { useDocumentTitle } = await import("@/hooks/useDocumentTitle");
const { default: HelpIndexPage } = await import("./HelpIndexPage");
const { default: HelpTopicPage } = await import("./HelpTopicPage");

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

function show(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/hilfe" element={<HelpIndexPage />} />
        <Route path="/hilfe/:thema" element={<HelpTopicPage />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeAll(() => { window.HTMLElement.prototype.scrollIntoView = vi.fn(); });

test("Übersicht: alle Themen als Karten, Suche filtert und steht in der Adresse", () => {
  show("/hilfe");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("So geht's");
  for (const thema of THEMEN) {
    const card = screen.getByTestId(`help-topic-${thema.slug}`);
    expect(card).toHaveAttribute("href", `/hilfe/${thema.slug}`);
    expect(card).toHaveTextContent(`${hilfeSchritte(thema).length} Schritte`);
  }
  expect(screen.queryByTestId("help-results")).toBeNull();

  fireEvent.change(screen.getByTestId("help-search"), { target: { value: "einchecken" } });
  expect(screen.getByTestId("where")).toHaveTextContent("/hilfe?q=einchecken");
  const results = screen.getByTestId("help-results");
  expect(within(results).getByTestId("help-result-liga-captains-check-in")).toHaveAttribute("href", "/hilfe/liga-captains#check-in");

  fireEvent.change(screen.getByTestId("help-search"), { target: { value: "xyzxyz" } });
  expect(screen.getByTestId("help-no-results")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("help-search-clear"));
  expect(screen.getByTestId("where")).toHaveTextContent(/^\/hilfe$/);
});

test("Suche aus einem geteilten Link: ?q= ist gleich ausgefüllt", () => {
  show("/hilfe?q=Activision");
  expect(screen.getByTestId("help-search")).toHaveValue("Activision");
  expect(screen.getByTestId("help-result-konto-und-profil-spiel-ids")).toBeInTheDocument();
});

test("Thema: Inhalt, nummerierte Schritte mit Anker, Hinweis und Bild für Handy und PC", () => {
  show("/hilfe/liga-captains");
  const thema = THEMEN.find((row) => row.slug === "liga-captains");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Liga für Captains");
  expect(useDocumentTitle).toHaveBeenCalledWith("Liga für Captains · Hilfe", thema.kurz, {});
  const toc = screen.getByTestId("help-toc");
  expect(within(toc).getByRole("link", { name: "4. Offene Punkte" })).toHaveAttribute("href", "#offene-punkte");

  const step = screen.getByTestId("help-step-check-in");
  expect(step).toHaveAttribute("id", "check-in");
  expect(step).toHaveTextContent("Schritt 14: Einchecken");
  expect(screen.getByTestId("help-hint-check-in")).toHaveTextContent("Grau heißt");
  const image = screen.getByTestId("help-step-image-check-in");
  expect(image).toHaveAttribute("alt", "Bildschirmfoto: Einchecken");
  expect(image).toHaveAttribute("width");
  expect(image.closest("picture").querySelector("source")).toHaveAttribute("media", "(min-width: 768px)");
  // Schritt ohne Bild: kein leerer Rahmen.
  expect(screen.queryByTestId("help-step-image-map-veto")).toBeNull();
  // Video am Abschnitt.
  expect(screen.getByTestId("help-video-liga-anmeldung")).toBeInTheDocument();
});

test("Anker im Link: der Schritt ist hervorgehoben und wird angesprungen", () => {
  show("/hilfe/turniere#einchecken");
  expect(screen.getByTestId("help-step-einchecken")).toHaveAttribute("data-active", "true");
  expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
});

test("Groß- und Kleinschreibung in der Adresse ist egal", () => {
  show("/hilfe/Liga-Captains#check-in");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Liga für Captains");
  expect(screen.getByTestId("help-step-check-in")).toHaveAttribute("data-active", "true");
});

test("unbekanntes Thema: Hinweis und Weg zur Übersicht, nicht in Suchmaschinen", () => {
  show("/hilfe/gibt-es-nicht");
  expect(screen.getByTestId("help-missing")).toHaveTextContent("Thema nicht gefunden");
  expect(screen.getByRole("link", { name: /Zur Hilfe/ })).toHaveAttribute("href", "/hilfe");
  expect(useDocumentTitle).toHaveBeenLastCalledWith("Hilfe", undefined, { robots: "noindex, follow" });
});
