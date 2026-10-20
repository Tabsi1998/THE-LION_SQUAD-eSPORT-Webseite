import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";

// Untermenüs per Antippen und mit der Tastatur (#1233): mit der Maus bleibt das Drüberfahren, am Tablet öffnet das erste
// Antippen das Untermenü (erst ein Eintrag öffnet eine Seite), mit der Tastatur öffnen Enter, Leertaste und die Pfeile;
// Escape schließt und gibt den Fokus zurück. Das gespeicherte Menü wie auf dem Server: „Verein“ hat ein eigenes Ziel.

const NAV = [
  { to: "/", label: "Home", order: 0 },
  { to: "/about", label: "Verein", order: 1, children: [
    { to: "/about", label: "Über uns" }, { to: "/board", label: "Vorstand" }, { to: "/galerie", label: "Galerie" },
  ] },
  { to: "/esports", label: "eSports", order: 2, children: [{ to: "/tournaments", label: "Turniere" }, { to: "/fastlap", label: "Fast Lap" }] },
  { label: "Community", order: 3, children: [{ to: "/community", label: "Übersicht" }, { to: "/teams", label: "Teams" }] },
];
vi.mock("@/lib/api", () => ({ api: { get: vi.fn(async () => ({ data: { items: NAV } })) } }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { MainNav } = await import("./MainNav");

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

async function renderNav() {
  window.localStorage.clear();
  const view = render(
    <MemoryRouter initialEntries={["/"]}>
      <button type="button">davor</button>
      <MainNav />
      <button type="button">danach</button>
      <Where />
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByTestId("nav-verein")).toHaveAttribute("href", "/about"));
  return view;
}

function tap(element) {
  fireEvent.pointerDown(element, { pointerType: "touch" });
  fireEvent.pointerUp(element, { pointerType: "touch" });
  fireEvent.click(element);
}

const menu = (key) => screen.queryByTestId(`nav-${key}-dropdown`);
const isOpen = (key) => Boolean(menu(key)) && !menu(key).hidden;

test("Touch: das erste Antippen öffnet das Untermenü statt die Seite, ein Eintrag öffnet die Seite", async () => {
  await renderNav();
  const verein = screen.getByTestId("nav-verein");
  tap(verein);
  expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/);
  expect(isOpen("verein")).toBe(true);
  expect(verein).toHaveAttribute("aria-expanded", "true");
  tap(screen.getByTestId("nav-sub-vorstand"));
  expect(screen.getByTestId("where")).toHaveTextContent("/board");
  expect(isOpen("verein")).toBe(false);
});

test("Touch: ein zweites Antippen schließt, ein Tipp daneben auch", async () => {
  await renderNav();
  const esports = screen.getByTestId("nav-esports");
  tap(esports);
  expect(isOpen("esports")).toBe(true);
  tap(esports);
  expect(isOpen("esports")).toBe(false);
  expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/);
  tap(esports);
  expect(isOpen("esports")).toBe(true);
  fireEvent.pointerDown(document.body, { pointerType: "touch" });
  expect(isOpen("esports")).toBe(false);
});

test("Touch: Hauptpunkt ohne eigene Adresse (Community) öffnet per Antippen", async () => {
  await renderNav();
  tap(screen.getByTestId("nav-community"));
  expect(isOpen("community")).toBe(true);
});

test("Übersicht oben: ist das Ziel des Hauptpunkts kein Eintrag, steht es als „Übersicht …“ ganz oben", async () => {
  await renderNav();
  tap(screen.getByTestId("nav-esports"));
  const links = [...menu("esports").querySelectorAll("a")];
  expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Übersicht eSports", "/esports"], ["Turniere", "/tournaments"], ["Fast Lap", "/fastlap"],
  ]);
  // „Verein“ führt schon „Über uns“ (/about) - kein zweiter Eintrag dafür.
  tap(screen.getByTestId("nav-verein"));
  expect([...menu("verein").querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["/about", "/board", "/galerie"]);
});

test("Maus: Drüberfahren öffnet, ein Klick auf den Hauptpunkt öffnet weiter die Seite", async () => {
  const user = userEvent.setup();
  await renderNav();
  const verein = screen.getByTestId("nav-verein");
  await user.hover(verein);
  expect(isOpen("verein")).toBe(true);
  await user.click(verein);
  expect(screen.getByTestId("where")).toHaveTextContent("/about");
  await user.unhover(verein);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
  expect(isOpen("verein")).toBe(false);
});

test("Tastatur: Enter öffnet, Pfeile wandern, Escape schließt und gibt den Fokus zurück", async () => {
  const user = userEvent.setup();
  await renderNav();
  const verein = screen.getByTestId("nav-verein");
  verein.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/);
  expect(isOpen("verein")).toBe(true);
  expect(verein).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByTestId("nav-sub-ber-uns")).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByTestId("nav-sub-vorstand")).toHaveFocus();
  await user.keyboard("{ArrowDown}{ArrowDown}");
  expect(screen.getByTestId("nav-sub-ber-uns")).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(screen.getByTestId("nav-sub-galerie")).toHaveFocus();
  await user.keyboard("{Home}");
  expect(screen.getByTestId("nav-sub-ber-uns")).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByTestId("nav-sub-galerie")).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(isOpen("verein")).toBe(false);
  expect(verein).toHaveFocus();
  expect(verein).toHaveAttribute("aria-expanded", "false");
});

test("Tastatur: Leertaste und Pfeil nach unten öffnen auch einen Hauptpunkt ohne Adresse, Enter auf einem Eintrag öffnet die Seite", async () => {
  const user = userEvent.setup();
  await renderNav();
  const community = screen.getByTestId("nav-community");
  community.focus();
  await user.keyboard(" ");
  expect(isOpen("community")).toBe(true);
  expect(screen.getByTestId("nav-sub-bersicht")).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(community).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(isOpen("community")).toBe(true);
  await user.keyboard("{ArrowDown}{Enter}");
  expect(screen.getByTestId("where")).toHaveTextContent("/teams");
  expect(isOpen("community")).toBe(false);
});

test("Tastatur: wer mit Tab das Untermenü verlässt, schließt es", async () => {
  const user = userEvent.setup();
  await renderNav();
  const esports = screen.getByTestId("nav-esports");
  esports.focus();
  await user.keyboard("{Enter}");
  expect(isOpen("esports")).toBe(true);
  await user.tab();
  await user.tab();
  await user.tab();
  expect(isOpen("esports")).toBe(false);
});

test("aria: aria-expanded und aria-controls zeigen auf das Untermenü", async () => {
  await renderNav();
  for (const key of ["verein", "esports", "community"]) {
    const trigger = screen.getByTestId(`nav-${key}`);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const id = trigger.getAttribute("aria-controls");
    expect(id).toBeTruthy();
    expect(document.getElementById(id)).toBe(menu(key));
  }
});

// Kompakte Kopfzeile (#1234): zwischen 1024 und 1439 px rücken die Menüpunkte zusammen, ab 1440 px wie bisher.
test("kompakte Kopfzeile: Menüpunkte zwischen 1024 und 1439 px enger", async () => {
  await renderNav();
  for (const key of ["home", "verein", "community"]) {
    const link = screen.getByTestId(`nav-${key}`);
    expect(link.className).toMatch(/(^|\s)px-4(\s|$)/);
    expect(link.className).toMatch(/(^|\s)lg:px-1\.5(\s|$)/);
    expect(link.className).toMatch(/(^|\s)min-\[1440px\]:px-4(\s|$)/);
  }
});
