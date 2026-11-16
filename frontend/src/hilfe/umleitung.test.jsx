import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import anker from "./anker.json";
import { hilfeUmleitung } from "./pfade";
import { HilfeUmleitung } from "./HilfeUmleitung";

// Wächtertest (#2448): Kein alter Hilfe-Link geht ins Leere. Jeder Schritt aus anker.json - der Index aller Schritte,
// auf die „?“-Links, Mails, Discord und geteilte Links zeigen - wird als /hilfe/<thema>#<schritt> geöffnet und muss auf
// /faq/<thema>#<schritt> landen, wo der Schritt wirklich steht. Dazu: keine Datei unter src baut noch /hilfe-Links.

vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { get: vi.fn(() => Promise.resolve({ data: {} })) } }));

const { default: HelpTopicPage } = await import("@/pages/public/HelpTopicPage");

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

function open(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/faq" element={<p data-testid="faq-start">FAQ</p>} />
        <Route path="/faq/:thema" element={<HelpTopicPage />} />
        <Route path="/hilfe" element={<HilfeUmleitung />} />
        <Route path="/hilfe/:thema" element={<HilfeUmleitung />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeAll(() => { window.HTMLElement.prototype.scrollIntoView = vi.fn(); });

const ALTE_LINKS = Object.entries(anker).flatMap(([thema, schritte]) => Object.keys(schritte).map((schritt) => [thema, schritt]));

test("anker.json ist nicht leer - sonst prüfte der Wächter nichts", () => {
  expect(ALTE_LINKS.length).toBeGreaterThan(50);
});

test.each(ALTE_LINKS)("/hilfe/%s#%s führt zum selben Schritt in der FAQ", (thema, schritt) => {
  open(`/hilfe/${thema}#${schritt}`);
  expect(screen.getByTestId("where").textContent).toBe(`/faq/${thema}#${schritt}`);
  expect(document.getElementById(schritt)).not.toBeNull();
  expect(screen.getByTestId(`help-step-${schritt}`)).toHaveAttribute("data-active", "true");
});

test("Übersicht und Suche: /hilfe und /hilfe?q=… führen zur FAQ, die Suche bleibt", () => {
  open("/hilfe?q=check-in");
  expect(screen.getByTestId("where")).toHaveTextContent(/^\/faq\?q=check-in$/);
  expect(screen.getByTestId("faq-start")).toBeInTheDocument();
});

test("Regel ohne Router: Schreibweise, Schrägstrich am Ende, fremde Pfade", () => {
  expect(hilfeUmleitung("/hilfe")).toBe("/faq");
  expect(hilfeUmleitung("/hilfe/")).toBe("/faq");
  expect(hilfeUmleitung("/Hilfe/Liga-Captains/", "?x=1", "#check-in")).toBe("/faq/liga-captains?x=1#check-in");
  expect(hilfeUmleitung("/hilfe/turniere/zu-tief")).toBeNull();
  expect(hilfeUmleitung("/hilfreich")).toBeNull();
  expect(hilfeUmleitung("/faq/turniere")).toBeNull();
});

// Alles unter src, das noch selbst eine /hilfe-Adresse baut, wäre ein Umweg über die Weiterleitung. Erlaubt: die Regel
// selbst (pfade.js), ihre Komponente, Tests und die Routen in App.jsx.
const SRC = resolve(__dirname, "..");
const ERLAUBT = new Set(["hilfe/pfade.js", "hilfe/HilfeUmleitung.jsx", "App.jsx"]);

function dateien(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) return dateien(path);
    return /\.(jsx?|json)$/.test(name) ? [path] : [];
  });
}

// Die Texte der FAQ gehören nicht in den Start-Chunk: Nur die nachgeladenen FAQ-Seiten holen den ganzen Datensatz
// (@/hilfe), alles andere (Menü, „?“-Links, Weiterleitung in App.jsx) nur die schlanken Teile pfade.js und anker.json.
test("den ganzen FAQ-Datensatz laden nur die FAQ-Seiten", () => {
  const seiten = new Set(["pages/public/FaqPage.jsx", "pages/public/HelpTopicPage.jsx"]);
  const treffer = [];
  for (const path of dateien(SRC)) {
    const rel = relative(SRC, path).split("\\").join("/");
    if (seiten.has(rel) || rel.startsWith("hilfe/") || /\.test\.jsx?$/.test(rel)) continue;
    const text = readFileSync(path, "utf8");
    if (/from "@\/hilfe(\/index(\.js)?|\/fragen\.json|\/bereiche\.json|\/themen\/[^"]+)?"/.test(text)) treffer.push(rel);
  }
  expect(treffer).toEqual([]);
});

test("keine Datei unter src verlinkt noch auf /hilfe", () => {
  const treffer = [];
  for (const path of dateien(SRC)) {
    const rel = relative(SRC, path).split("\\").join("/");
    if (ERLAUBT.has(rel) || /\.test\.jsx?$/.test(rel)) continue;
    const text = readFileSync(path, "utf8");
    if (/["'`(]\/hilfe(\/|["'`#?])/.test(text)) treffer.push(rel);
  }
  expect(treffer).toEqual([]);
});
