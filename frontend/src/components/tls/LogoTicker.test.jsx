import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Das gemeinsame Logo-Laufband (#968): ab `minForMarquee` Logos läuft es nahtlos (zwei Gruppen, die zweite
// nur Deko), darunter stehen die Logos; interne Ziele sind Router-Links, externe öffnen neu.

vi.mock("@/lib/api", () => ({ resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/SmartLogo", () => ({ SmartLogo: ({ alt, className }) => <img alt={alt} className={className} /> }));

const { LogoTicker, repeatForLoop, marqueeDuration } = await import("./LogoTicker");

const ITEMS = [
  { key: "a", name: "Alpha", logo_url: "/uploads/a.png", href: "https://alpha.test" },
  { key: "b", name: "Beta", logo_url: "/uploads/b.png", to: "/partners/beta" },
  { key: "c", name: "Gamma", logo_url: "/uploads/c.png" },
];

test("läuft ab drei Logos: zwei Gruppen, die zweite ohne Tab-Stopp, Tempo aus der Anzahl", () => {
  render(<MemoryRouter><LogoTicker items={ITEMS} boxClassFor={() => "h-10 w-40"} minItems={6} secondsPerItem={5} minSeconds={10} testId="band" /></MemoryRouter>);
  const band = screen.getByTestId("band");
  expect(band).toHaveAttribute("data-marquee", "1");
  const track = band.firstChild;
  expect(track).toHaveClass("tls-logo-ticker__track");
  expect(track.style.getPropertyValue("--tls-logo-ticker-speed")).toBe("30s");
  expect(screen.getAllByTitle("Alpha")).toHaveLength(4);
  const [first, , , hidden] = screen.getAllByTitle("Alpha");
  expect(first).toHaveAttribute("href", "https://alpha.test");
  expect(first).toHaveAttribute("target", "_blank");
  // Das Logo füllt den Kasten - auch eine kleine Vorlage wächst mit.
  expect(first.querySelector("img")).toHaveClass("w-full", "h-full", "object-contain");
  expect(hidden).toHaveAttribute("tabindex", "-1");
  expect(screen.getAllByTitle("Beta")[0]).toHaveAttribute("href", "/partners/beta");
  expect(screen.getAllByTitle("Beta")[0]).not.toHaveAttribute("target");
  expect(screen.getAllByTitle("Gamma")[0]).not.toHaveAttribute("href");
});

test("unter der Mindestzahl stehen die Logos zentriert, nichts läuft, nichts doppelt", () => {
  render(<MemoryRouter><LogoTicker items={ITEMS.slice(0, 2)} boxClassFor={() => "h-10 w-40"} minForMarquee={3} testId="band" /></MemoryRouter>);
  const band = screen.getByTestId("band");
  expect(band).toHaveAttribute("data-marquee", "0");
  expect(band.firstChild).not.toHaveClass("tls-logo-ticker__track");
  expect(band.firstChild).toHaveClass("justify-center");
  expect(screen.getAllByTitle("Alpha")).toHaveLength(1);
});

test("rückwärts bekommt das Band die Rückwärts-Klasse", () => {
  render(<MemoryRouter><LogoTicker items={ITEMS} boxClassFor={() => "h-10 w-40"} reverse testId="band" /></MemoryRouter>);
  expect(screen.getByTestId("band").firstChild).toHaveClass("tls-logo-ticker__track--reverse");
});

test("repeatForLoop füllt bis zur Mindestzahl auf, marqueeDuration hält die Untergrenze", () => {
  expect(repeatForLoop(ITEMS, 7)).toHaveLength(9);
  expect(repeatForLoop([], 7)).toEqual([]);
  expect(marqueeDuration(3, 5, 60)).toBe(60);
  expect(marqueeDuration(20, 5, 60)).toBe(100);
});
