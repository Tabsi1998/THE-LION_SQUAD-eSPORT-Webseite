import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WHATS_NEW_SEEN_KEY } from "@/lib/whatsNew";

// „Neu auf der Website“ (#1240): /neu zeigt die Einträge, neueste oben; der Link in der Fußzeile trägt einen Punkt,
// solange seit dem letzten Besuch etwas dazugekommen ist - das Öffnen der Seite löscht ihn.

vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const { default: WhatsNewPage } = await import("./WhatsNewPage");
const { WhatsNewLink } = await import("@/components/tls/WhatsNewLink");

const DATA = { items: [
  { date: "2026-09-01", text: "Ältere Neuerung." },
  { date: "2026-10-20", text: "Neueste Neuerung.", link: "/fastlap" },
] };

beforeEach(() => window.localStorage.clear());

test("/neu: neueste oben, mit Datum und Link", () => {
  render(<MemoryRouter><WhatsNewPage data={DATA} /></MemoryRouter>);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Neu auf der Website");
  expect(screen.getByTestId("whatsnew-item-0")).toHaveTextContent("20.10.2026");
  expect(screen.getByTestId("whatsnew-item-0")).toHaveTextContent("Neueste Neuerung.");
  expect(screen.getByRole("link", { name: /Ansehen/ })).toHaveAttribute("href", "/fastlap");
  expect(screen.getByTestId("whatsnew-item-1")).toHaveTextContent("Ältere Neuerung.");
});

test("Punkt am Link nur bei Neuem seit dem letzten Besuch; /neu öffnen löscht ihn", () => {
  window.localStorage.setItem(WHATS_NEW_SEEN_KEY, JSON.stringify({ date: "2026-09-01", count: 1 }));
  render(<MemoryRouter><WhatsNewLink data={DATA} /></MemoryRouter>);
  expect(screen.getByTestId("footer-whatsnew")).toHaveAttribute("href", "/neu");
  expect(screen.getByTestId("footer-whatsnew-dot")).toBeInTheDocument();

  act(() => { render(<MemoryRouter><WhatsNewPage data={DATA} /></MemoryRouter>); });
  expect(screen.queryByTestId("footer-whatsnew-dot")).toBeNull();
  expect(JSON.parse(window.localStorage.getItem(WHATS_NEW_SEEN_KEY))).toEqual({ date: "2026-10-20", count: 1 });
});

test("erster Besuch: kein Punkt", () => {
  render(<MemoryRouter><WhatsNewLink data={DATA} /></MemoryRouter>);
  expect(screen.getByTestId("footer-whatsnew")).toHaveTextContent("Neu");
  expect(screen.queryByTestId("footer-whatsnew-dot")).toBeNull();
});
