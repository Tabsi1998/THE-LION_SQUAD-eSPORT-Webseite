import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { FRAGEN, THEMEN, haeufigeFragen } from "@/hilfe";
import { HilfeUmleitung } from "@/hilfe/HilfeUmleitung";

// FAQ (#2448, vorher Hilfe #2295): Suche über Fragen und Schritte (?q=), „Häufige Fragen“ zum Aufklappen, Bereichsliste
// mit Rollen-Filter (?rolle=), geschützte Fragen erst nach der Antwort des Servers; eine Anleitung mit Inhalt,
// nummerierten Schritten samt Anker, Hinweisen und Bildern; unbekannte Anleitung mit Weg zurück.

vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));

const { useDocumentTitle } = await import("@/hooks/useDocumentTitle");
const { api } = await import("@/lib/api");
const { default: FaqPage } = await import("./FaqPage");
const { default: HelpTopicPage } = await import("./HelpTopicPage");

const OHNE = { darf: { angemeldet: false, mitglied: false, turnierleitung: false }, fragen: [], anleitungen: [] };
const MITGLIED_FRAGE = {
  id: "helferdienst-eintragen", frage: "Wie trage ich mich für einen Helferdienst ein?", antwort: "Tippe bei einer Schicht auf Ich helfe.",
  bereich: "helferdienste", rollen: ["mitglied"], sichtbar_fuer: "mitglied", haeufig: true, link: { to: "/members/helfen", label: "Zu den Helferdiensten" },
};
const LEITUNG_FRAGE = {
  id: "leitung-check-in", frage: "Wie checke ich Spieler vor Ort ein?", antwort: "Reiter Check-in, ein Tipp auf eine Person.",
  bereich: "turnierleitung", rollen: ["turnierleitung"], sichtbar_fuer: "turnierleitung",
};

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

async function show(path, antwort = OHNE) {
  api.get.mockResolvedValue({ data: antwort });
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/faq" element={<FaqPage />} />
        <Route path="/faq/:thema" element={<HelpTopicPage />} />
        <Route path="/hilfe" element={<HilfeUmleitung />} />
        <Route path="/hilfe/:thema" element={<HilfeUmleitung />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  await act(async () => {});
  return view;
}

beforeAll(() => { window.HTMLElement.prototype.scrollIntoView = vi.fn(); });
// Der Browser kann WebM - außer im Test zu älteren iPhones unten.
beforeEach(() => {
  window.HTMLMediaElement.prototype.canPlayType = () => "maybe";
  api.get.mockReset();
});

test("Aufbau: Suche mit Label, Häufige Fragen, Bereiche - für Gäste nichts Geschütztes", async () => {
  await show("/faq");
  expect(api.get).toHaveBeenCalledWith("/faq");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("So geht's");
  expect(screen.getByLabelText("FAQ durchsuchen")).toBe(screen.getByTestId("faq-search"));
  expect(screen.getByRole("search")).toBeInTheDocument();
  const haeufig = within(screen.getByTestId("faq-haeufig"));
  const oeffentlich = haeufigeFragen();
  expect(oeffentlich.length).toBeGreaterThanOrEqual(8);
  expect(oeffentlich.length).toBeLessThanOrEqual(12);
  for (const frage of oeffentlich) expect(haeufig.getByTestId(`faq-frage-${frage.id}`)).toHaveTextContent(frage.frage);
  // Geschützte Bereiche fehlen für Gäste ganz; die übrigen stehen in der Liste, leere als „Kommt bald“.
  expect(screen.queryByTestId("faq-bereich-helferdienste")).toBeNull();
  expect(screen.queryByTestId("faq-bereich-turnierleitung")).toBeNull();
  expect(screen.queryByTestId("faq-rolle-turnierleitung")).toBeNull();
  expect(screen.getByTestId("faq-bereich-knopf-liga")).toBeInTheDocument();
  expect(useDocumentTitle).toHaveBeenCalledWith("FAQ", expect.any(String));
});

test("Aufklappen: Frage als Disclosure mit aria-expanded, Antwort mit Link zur Anleitung", async () => {
  await show("/faq");
  const knopf = screen.getByTestId("faq-frage-knopf-team-beitreten");
  const antwort = screen.getByTestId("faq-antwort-team-beitreten");
  expect(knopf.tagName).toBe("BUTTON");
  expect(knopf).toHaveAttribute("aria-expanded", "false");
  expect(knopf).toHaveAttribute("aria-controls", antwort.id);
  expect(antwort).not.toBeVisible();
  fireEvent.click(knopf);
  expect(knopf).toHaveAttribute("aria-expanded", "true");
  expect(antwort).toBeVisible();
  expect(within(antwort).getByRole("link", { name: /Zur Anleitung/ })).toHaveAttribute("href", "/faq/team-und-co-team#beitreten");
  fireEvent.click(knopf);
  expect(antwort).not.toBeVisible();

  // Ein Bereich klappt genauso auf: Anleitungen und Fragen darin.
  const bereich = screen.getByTestId("faq-bereich-knopf-teams");
  fireEvent.click(bereich);
  expect(bereich).toHaveAttribute("aria-expanded", "true");
  const inhalt = within(screen.getByTestId("faq-bereich-inhalt-teams"));
  expect(inhalt.getByTestId("faq-anleitung-teams-team-und-co-team")).toHaveAttribute("href", "/faq/team-und-co-team");
});

test("Suche über Fragen und Schritte: Treffer zeigen ihren Bereich, die Anfrage steht in der Adresse", async () => {
  await show("/faq");
  fireEvent.change(screen.getByTestId("faq-search"), { target: { value: "einchecken" } });
  expect(screen.getByTestId("where")).toHaveTextContent("/faq?q=einchecken");
  const liga = screen.getByTestId("faq-treffer-schritt-liga-captains-check-in");
  expect(liga).toHaveAttribute("href", "/faq/liga-captains#check-in");
  expect(within(liga).getByTestId("faq-treffer-bereich")).toHaveTextContent("Liga");
  expect(within(screen.getByTestId("faq-treffer-schritt-turniere-einchecken")).getByTestId("faq-treffer-bereich")).toHaveTextContent("Turniertag vor Ort");
  expect(screen.queryByTestId("faq-haeufig")).toBeNull();

  fireEvent.change(screen.getByTestId("faq-search"), { target: { value: "beitrittscode" } });
  const frage = screen.getByTestId("faq-treffer-frage-team-beitreten");
  expect(frage).toHaveAttribute("href", "/faq#frage-team-beitreten");
  expect(frage).toHaveTextContent("Teams & Co-Teams");

  fireEvent.change(screen.getByTestId("faq-search"), { target: { value: "xyzxyz" } });
  expect(screen.getByTestId("faq-no-results")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("faq-search-clear"));
  expect(screen.getByTestId("where")).toHaveTextContent(/^\/faq$/);
});

test("Suche aus einem geteilten Link: ?q= ist gleich ausgefüllt", async () => {
  await show("/faq?q=Activision");
  expect(screen.getByTestId("faq-search")).toHaveValue("Activision");
  expect(screen.getByTestId("faq-treffer-frage-activision-id")).toBeInTheDocument();
  expect(screen.getByTestId("faq-treffer-schritt-konto-und-profil-spiel-ids")).toBeInTheDocument();
});

test("Rollen-Filter als Chips: Auswahl in der Adresse, Bereiche passend gefiltert, „Alle“ hebt ihn auf", async () => {
  await show("/faq");
  expect(screen.getByTestId("faq-rolle-alle")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByTestId("faq-rolle-captain"));
  expect(screen.getByTestId("where")).toHaveTextContent("/faq?rolle=captain");
  expect(screen.getByTestId("faq-rolle-captain")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("faq-bereich-liga")).toBeInTheDocument();
  // „Verein & Mitgliedschaft“ ist ein Bereich für Mitglieder, nicht für Captains.
  expect(screen.queryByTestId("faq-bereich-verein-mitgliedschaft")).toBeNull();
  fireEvent.click(screen.getByTestId("faq-bereich-knopf-teams"));
  const teams = within(screen.getByTestId("faq-bereich-inhalt-teams"));
  // Beitreten ist eine Spieler-Frage - unter Captain steht sie nicht im Bereich.
  expect(teams.queryByTestId("faq-frage-team-beitreten-bereich")).toBeNull();
  expect(teams.getByTestId("faq-frage-was-ist-co-team-bereich")).toBeInTheDocument();

  fireEvent.click(screen.getByTestId("faq-rolle-mitglied"));
  expect(screen.getByTestId("faq-bereich-verein-mitgliedschaft")).toBeInTheDocument();
  expect(screen.queryByTestId("faq-bereich-liga")).toBeNull();
  fireEvent.click(screen.getByTestId("faq-rolle-alle"));
  expect(screen.getByTestId("where")).toHaveTextContent(/^\/faq$/);
});

test("Rolle aus einem Link, die jemand nicht hat: kein Filter (Turnierleitung nur mit Rechten)", async () => {
  await show("/faq?rolle=turnierleitung");
  expect(screen.getByTestId("faq-rolle-alle")).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByTestId("faq-bereich-turnierleitung")).toBeNull();
});

test("Mitglied: der Server liefert Mitglieder-Fragen nach - Häufige Fragen und Helferdienste kommen dazu", async () => {
  await show("/faq", { darf: { angemeldet: true, mitglied: true, turnierleitung: false }, fragen: [MITGLIED_FRAGE], anleitungen: [] });
  await waitFor(() => expect(within(screen.getByTestId("faq-haeufig")).getByTestId("faq-frage-helferdienst-eintragen")).toBeInTheDocument());
  expect(screen.getByTestId("faq-bereich-helferdienste")).toBeInTheDocument();
  expect(screen.queryByTestId("faq-bereich-turnierleitung")).toBeNull();
  fireEvent.change(screen.getByTestId("faq-search"), { target: { value: "helferdienst" } });
  expect(screen.getByTestId("faq-treffer-frage-helferdienst-eintragen")).toHaveTextContent("Helferdienste");
});

test("Turnierleitung: eigener Bereich und Rollen-Chip, eine Frage per Link wird aufgeklappt und angesprungen", async () => {
  await show("/faq#frage-leitung-check-in", { darf: { angemeldet: true, mitglied: false, turnierleitung: true }, fragen: [LEITUNG_FRAGE], anleitungen: [] });
  await waitFor(() => expect(screen.getByTestId("faq-bereich-knopf-turnierleitung")).toHaveAttribute("aria-expanded", "true"));
  expect(screen.getByTestId("faq-frage-knopf-leitung-check-in")).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByTestId("faq-rolle-turnierleitung")).toBeInTheDocument();
  expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
});

test("Antwort des Servers mit Unsinn: nur echte Rechte (true), Bereiche bleiben zu", async () => {
  await show("/faq", { darf: { mitglied: "ja", turnierleitung: 1 }, fragen: [{ id: "x" }, null, MITGLIED_FRAGE] });
  expect(screen.queryByTestId("faq-bereich-helferdienste")).toBeNull();
  expect(screen.queryByTestId("faq-bereich-turnierleitung")).toBeNull();
});

test("Server nicht erreichbar: die öffentliche FAQ steht trotzdem", async () => {
  api.get.mockRejectedValue(new Error("offline"));
  render(<MemoryRouter initialEntries={["/faq"]}><Routes><Route path="/faq" element={<FaqPage />} /></Routes></MemoryRouter>);
  await act(async () => {});
  expect(screen.getByTestId("faq-haeufig")).toBeInTheDocument();
  expect(within(screen.getByTestId("faq-haeufig")).getAllByTestId(/^faq-frage-knopf-/).length).toBe(haeufigeFragen().length);
  expect(screen.queryByTestId("faq-bereich-helferdienste")).toBeNull();
});

test("Häufige Fragen: höchstens 12, auch mit Mitglied und Leitung zusammen", () => {
  const alle = haeufigeFragen({ fragen: [...FRAGEN, MITGLIED_FRAGE, { ...LEITUNG_FRAGE, haeufig: true }], darf: { mitglied: true, turnierleitung: true } });
  expect(alle.length).toBeLessThanOrEqual(12);
});

test("Anleitung: Inhalt, nummerierte Schritte mit Anker, Hinweis und Bild für Handy und PC", async () => {
  await show("/faq/liga-captains");
  const thema = THEMEN.find((row) => row.slug === "liga-captains");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Liga für Captains");
  expect(useDocumentTitle).toHaveBeenCalledWith("Liga für Captains · FAQ", thema.kurz, {});
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

test("Anker im Link: der Schritt ist hervorgehoben und wird angesprungen", async () => {
  await show("/faq/turniere#einchecken");
  expect(screen.getByTestId("help-step-einchecken")).toHaveAttribute("data-active", "true");
  expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
});

test("Alter Link mit Anker: /hilfe/<thema>#<schritt> landet auf /faq beim selben Schritt", async () => {
  await show("/hilfe/turniere#einchecken");
  expect(screen.getByTestId("where")).toHaveTextContent("/faq/turniere#einchecken");
  expect(screen.getByTestId("help-step-einchecken")).toHaveAttribute("data-active", "true");
});

test("Browser ohne WebM (ältere iPhones): kein leeres Video, die Bilder bleiben", async () => {
  window.HTMLMediaElement.prototype.canPlayType = () => "";
  await show("/faq/liga-captains");
  expect(screen.queryByTestId("help-video-liga-anmeldung")).toBeNull();
  expect(screen.getByTestId("help-step-image-check-in")).toBeInTheDocument();
});

test("Groß- und Kleinschreibung in der Adresse ist egal", async () => {
  await show("/faq/Liga-Captains#check-in");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Liga für Captains");
  expect(screen.getByTestId("help-step-check-in")).toHaveAttribute("data-active", "true");
});

test("unbekannte Anleitung: Hinweis und Weg zur FAQ, nicht in Suchmaschinen", async () => {
  await show("/faq/gibt-es-nicht");
  expect(screen.getByTestId("help-missing")).toHaveTextContent("Anleitung nicht gefunden");
  expect(screen.getByRole("link", { name: /Zur FAQ/ })).toHaveAttribute("href", "/faq");
  expect(useDocumentTitle).toHaveBeenLastCalledWith("FAQ", undefined, { robots: "noindex, follow" });
});

// Review-Runde 1 (#2448): F4 Rollen-Filter ohne „Kommt bald“, F6 kaputter Anker, F7 Anker einmal, Suche mit Anker,
// Fragen im Bereich als h4, Ansage nur der Trefferzahl.

test("F4: mit Rollen-Filter kein „Kommt bald“ - leere Bereiche fallen weg, ohne Filter stehen sie da", async () => {
  await show("/faq", { darf: { angemeldet: true, mitglied: true, turnierleitung: false }, fragen: [], anleitungen: [] });
  expect(screen.getByTestId("faq-bereich-helferdienste")).toHaveAttribute("data-leer", "true");
  expect(screen.getByTestId("faq-bereich-bald-helferdienste")).toHaveTextContent("Kommt bald");
  fireEvent.click(screen.getByTestId("faq-rolle-mitglied"));
  expect(screen.queryByTestId("faq-bereich-helferdienste")).toBeNull();
  expect(screen.queryAllByTestId(/^faq-bereich-bald-/)).toEqual([]);
  for (const rolle of ["spieler", "captain"]) {
    fireEvent.click(screen.getByTestId(`faq-rolle-${rolle}`));
    expect(screen.queryAllByTestId(/^faq-bereich-bald-/), rolle).toEqual([]);
  }
});

test("F6: ein kaputter Anker (#%E0%A4) bricht weder die FAQ noch eine Anleitung", async () => {
  await show("/faq#%E0%A4");
  expect(screen.getByTestId("faq-haeufig")).toBeInTheDocument();
  await show("/faq/turniere#%E0%A4");
  expect(screen.getAllByTestId("help-topic").length).toBeGreaterThan(0);
});

test("F7: der Anker springt einmal je Aufruf - nicht noch einmal nach der Antwort des Servers oder einer Invalidierung", async () => {
  const { emitApiInvalidation } = await import("@/lib/apiInvalidation");
  const scroll = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = scroll;
  await show("/faq#frage-team-beitreten", { darf: { angemeldet: true, mitglied: true, turnierleitung: false }, fragen: [MITGLIED_FRAGE], anleitungen: [] });
  await waitFor(() => expect(within(screen.getByTestId("faq-haeufig")).getByTestId("faq-frage-helferdienst-eintragen")).toBeInTheDocument());
  expect(scroll).toHaveBeenCalledTimes(1);
  const knopf = screen.getByTestId("faq-frage-knopf-team-beitreten");
  fireEvent.click(knopf);
  expect(knopf).toHaveAttribute("aria-expanded", "false");
  await act(async () => { emitApiInvalidation({ resource: "auth" }); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(knopf).toHaveAttribute("aria-expanded", "false");
  expect(scroll).toHaveBeenCalledTimes(1);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

test("F7: Anker auf eine häufige Frage bei laufender Suche - die Frage steht offen in ihrem Bereich", async () => {
  await show("/faq?q=team#frage-team-beitreten");
  expect(screen.getByTestId("faq-results")).toBeInTheDocument();
  expect(screen.getByTestId("faq-bereich-knopf-teams")).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByTestId("faq-frage-knopf-team-beitreten-bereich")).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByTestId("faq-antwort-team-beitreten-bereich")).toBeVisible();
});

test("F7: Fragen im Bereich sind h4 unter dem h3 des Bereichs, nur die Trefferzahl wird angesagt", async () => {
  await show("/faq");
  fireEvent.click(screen.getByTestId("faq-bereich-knopf-teams"));
  const frage = screen.getByTestId("faq-frage-knopf-team-beitreten-bereich");
  expect(frage.closest("h4")).not.toBeNull();
  expect(screen.getByTestId("faq-bereich-knopf-teams").closest("h3")).not.toBeNull();
  expect(screen.getByTestId("faq-frage-knopf-team-beitreten").closest("h3")).not.toBeNull();
  expect(screen.getByTestId("faq-results-ansage")).toHaveAttribute("aria-live", "polite");
  fireEvent.change(screen.getByTestId("faq-search"), { target: { value: "beitrittscode" } });
  expect(screen.getByTestId("faq-results-ansage")).toHaveTextContent(/^\d+ Treffer$/);
  expect(screen.getByTestId("faq-results")).not.toHaveAttribute("aria-live");
  expect(document.querySelectorAll("[aria-live]").length).toBe(1);
});

test("F1: zugeklappte Panels sind auch per Stil zu - kein später geladenes Stylesheet kann sie öffnen", async () => {
  await show("/faq");
  // Als Stil am Element selbst - das schlägt jede Klasse, auch aus einem später nachgeladenen Stylesheet.
  expect(screen.getByTestId("faq-antwort-team-beitreten").style.display).toBe("none");
  expect(screen.getByTestId("faq-bereich-inhalt-teams").style.display).toBe("none");
  fireEvent.click(screen.getByTestId("faq-frage-knopf-team-beitreten"));
  expect(screen.getByTestId("faq-antwort-team-beitreten").style.display).toBe("");
});
