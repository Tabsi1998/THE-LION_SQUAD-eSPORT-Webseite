import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NewsSignupCards, signupItems } from "./NewsSignupCard";

// News führen direkt zur Anmeldung (#1266): je verknüpftem Turnier oder Event eine Karte mit Datum, freien Plätzen
// und „Anmelden“ - ist die Anmeldung zu, der Stand. Höchstens drei.

const START = "2026-11-14T17:00:00Z";

function tournament(slug, signup, title = slug) {
  return { id: `t-${slug}`, slug, title, signup: { start_date: START, taken: null, max: null, spots_left: null, opens_at: null, ...signup } };
}

function renderCards(post) {
  return render(<MemoryRouter><NewsSignupCards post={post} /></MemoryRouter>);
}

test("offen: Datum, freie Plätze und Anmelden führt zur Anmeldung dieses Turniers", () => {
  renderCards({ linked_tournaments: [tournament("kart-cup", { state: "open", taken: 11, max: 16, spots_left: 5 }, "Kart-Cup")] });
  const card = screen.getByTestId("news-signup-kart-cup");
  expect(card).toHaveTextContent("Kart-Cup");
  expect(card).toHaveTextContent("14.11.2026");
  expect(card).toHaveTextContent("Noch 5 von 16 Plätzen frei");
  expect(within(card).getByRole("link", { name: /Anmelden/ })).toHaveAttribute("href", "/tournaments/kart-cup?anmelden=1");
});

test("je Stand das passende Wort statt Anmelden", () => {
  renderCards({
    linked_tournaments: [
      tournament("voll", { state: "full", taken: 16, max: 16, spots_left: 0 }),
      tournament("laeuft", { state: "live" }),
      tournament("fertig", { state: "results" }),
    ],
  });
  expect(screen.getByTestId("news-signup-voll")).toHaveTextContent("Ausgebucht");
  expect(screen.getByTestId("news-signup-laeuft")).toHaveTextContent("Läuft");
  expect(screen.getByTestId("news-signup-fertig")).toHaveTextContent("Ergebnisse");
  for (const slug of ["voll", "laeuft", "fertig"]) {
    expect(within(screen.getByTestId(`news-signup-${slug}`)).queryByRole("link", { name: /Anmelden/ })).toBeNull();
    expect(within(screen.getByTestId(`news-signup-${slug}`)).getByRole("link")).toHaveAttribute("href", `/tournaments/${slug}`);
  }
});

test("Events: Anmelden führt zur Event-Anmeldung, ohne Platzgrenze die Zahl der Angemeldeten", () => {
  renderCards({ linked_events: [{ id: "e1", slug: "lan", name: "LAN-Party", signup: { state: "open", start_date: START, taken: 12, max: null, spots_left: null } }] });
  const card = screen.getByTestId("news-signup-lan");
  expect(card).toHaveTextContent("LAN-Party");
  expect(card).toHaveTextContent("12 angemeldet");
  expect(within(card).getByRole("link", { name: /Anmelden/ })).toHaveAttribute("href", "/events/lan?anmelden=1");
});

test("höchstens drei Karten, ohne Verknüpfung keine", () => {
  const many = ["a", "b", "c", "d"].map((slug) => tournament(slug, { state: "open" }));
  expect(signupItems({ linked_tournaments: many })).toHaveLength(3);
  const { container } = renderCards({});
  expect(container).toBeEmptyDOMElement();
  expect(signupItems({ linked_tournaments: [{ id: "x", slug: "x", title: "Alt" }] })).toHaveLength(0);
});
