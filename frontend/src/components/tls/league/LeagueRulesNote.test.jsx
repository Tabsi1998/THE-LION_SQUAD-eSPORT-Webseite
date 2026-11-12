import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Regelwerk auf Team-Seite und Matchseite (#2269): gültige Fassung mit Weg zu Text und PDF, dazu der Stand der eigenen Zustimmung -
// „Neue Fassung, bitte zustimmen“ nur, wenn sie verlangt wird und fehlt.

vi.mock("@/lib/api", () => ({ API: "/api" }));

const { LeagueRulesNote, rulesConsentState } = await import("./LeagueRulesNote");

const RULES = { version_id: "v2", version: 2, label: "Version 2", valid_from: "2030-03-05", url: "/liga/probe/s1/regeln",
  pdf_url: "/api/league-rules/seasons/probe/s1/versions/v2/pdf", consent: null };

function show(rules) {
  return render(<MemoryRouter><LeagueRulesNote rules={rules} testId="note" /></MemoryRouter>);
}

test("Fassung, Link und PDF - ohne Forderung kein Zustimmungssatz", () => {
  show(RULES);
  expect(screen.getByTestId("note")).toHaveAttribute("data-consent", "none");
  expect(screen.getByTestId("note-link")).toHaveAttribute("href", "/liga/probe/s1/regeln");
  expect(screen.getByTestId("note-version")).toHaveTextContent("Version 2 · gültig ab 05.03.2030");
  expect(screen.getByTestId("note-pdf")).toHaveAttribute("href", "/api/league-rules/seasons/probe/s1/versions/v2/pdf");
  expect(screen.queryByTestId("note-consent")).toBeNull();
});

test("Neue Fassung, bitte zustimmen - mit Weg zur Regelseite; zugestimmt mit Datum", () => {
  const open = { ...RULES, consent: { required: true, agreed: false, agreed_at: null, demanded_label: "Version 2" } };
  expect(rulesConsentState(open)).toBe("open");
  const { unmount } = show(open);
  expect(screen.getByTestId("note")).toHaveAttribute("data-consent", "open");
  expect(screen.getByTestId("note-consent")).toHaveTextContent("Neue Fassung, bitte zustimmen");
  expect(screen.getByRole("link", { name: /Lesen und zustimmen/ })).toHaveAttribute("href", "/liga/probe/s1/regeln");
  unmount();
  const agreed = { ...RULES, consent: { required: true, agreed: true, agreed_at: "2030-03-06T10:00:00+00:00", demanded_label: "Version 2" } };
  expect(rulesConsentState(agreed)).toBe("agreed");
  show(agreed);
  expect(screen.getByTestId("note-consent")).toHaveTextContent("Dein Co-Team hat zugestimmt (06.03.2030)");
});

test("ohne Regelwerk nichts", () => {
  const { container } = show(null);
  expect(container).toBeEmptyDOMElement();
  expect(rulesConsentState(null)).toBeNull();
});
