import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mitglied werden (#1251, #1335): die Karte als Muster, vier Vorteils-Kacheln, der goldene Knopf „Antrag stellen“ und der
// Beitrag offen - mit Daten als Liste und Tabelle, mit altem Stand samt Datum, ohne Stand ein Satz.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

const { default: JoinMembershipPage, FeeSection } = await import("./JoinMembershipPage");

const FEES = {
  available: true, stale: false, as_of: "2026-10-07T08:00:00+00:00", purpose: "Der Beitrag zahlt Hallenmiete und Technik.",
  fees: [
    { id: 2, label: "Ordentliches Mitglied", description: "Mit Stimmrecht", amount: 60, currency: "EUR", period_label: "je Jahr", subscription_required: true, admission_fee: 10, prorated: true },
    { id: 3, label: "Ermäßigt", description: "Schüler, Lehrlinge, Studierende", amount: 30, currency: "EUR", period_label: "je Jahr", subscription_required: true, admission_fee: 0, prorated: false },
  ],
};
const PAGE = { fee_purpose: "", benefits: [
  { icon: "vote", title: "Stimmrecht im Verein", text: "Du redest mit." }, { icon: "gift", title: "Rabatte bei Partnern", text: "" },
  { icon: "trophy", title: "Turniere nur für Mitglieder", text: "" }, { icon: "card", title: "Eigene Mitgliedskarte", text: "" },
] };

function mockApi(fees = FEES, page = PAGE) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/membership/fees") return { data: fees };
    if (url === "/membership/join-page") return { data: page };
    return { data: null };
  });
}

beforeEach(() => apiMock.get.mockReset());

test("Bühne mit Karte (Muster), goldener Antrag-Knopf, vier Vorteile und der Beitrag ohne Anmeldung", async () => {
  mockApi();
  render(<MemoryRouter><JoinMembershipPage /></MemoryRouter>);
  expect(screen.getByTestId("join-card-art-name")).toHaveTextContent("Dein Name");
  expect(screen.getByTestId("join-card-art")).toHaveTextContent("Nr. 0042");
  expect(screen.getByTestId("join-card-art")).toHaveClass("tls-member-card--tilt");
  const apply = screen.getByTestId("join-apply-btn");
  expect(apply).toHaveClass("tls-btn", "tls-btn--honor");
  expect(apply).toHaveAttribute("href", "/membership/apply");
  expect(await screen.findByTestId("join-benefit-3")).toHaveTextContent("Eigene Mitgliedskarte");
  expect(screen.getByTestId("join-benefit-0")).toHaveTextContent("Stimmrecht im VereinDu redest mit.");
  const table = await screen.findByTestId("join-fees-table");
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  expect(table).toHaveTextContent("Ordentliches Mitglied60,00 € je Jahr10,00 €Mit Stimmrecht · Eintritt unterm Jahr anteilig");
  expect(screen.getByTestId("join-fees-list")).toHaveTextContent("Ermäßigt30,00 € je Jahr");
  expect(screen.getByTestId("join-fees-purpose")).toHaveTextContent("Der Beitrag zahlt Hallenmiete und Technik.");
  expect(screen.queryByTestId("join-fees-stand")).toBeNull();
  // Gold nur an Karte und Knopf: die Schrittleiste ist nicht golden.
  expect(screen.getByTestId("join-steps")).not.toHaveClass("tls-steps--gold");
});

test("alter Stand: die Beträge mit Datum; ohne Stand der Satz statt Beträgen", () => {
  const { rerender } = render(<FeeSection fees={{ ...FEES, stale: true }} />);
  expect(screen.getByTestId("join-fees-stand")).toHaveTextContent("Stand 7.10.2026 – die Mitgliederverwaltung antwortet gerade nicht.");
  rerender(<FeeSection fees={{ available: false, fees: [] }} purpose="" />);
  expect(screen.getByTestId("join-fees-none")).toHaveTextContent("Die Beiträge nennen wir dir im Antrag.");
  expect(screen.queryByTestId("join-fees-table")).toBeNull();
});

test("ohne Texte aus der Verwaltung die vier Vorgabe-Kacheln", async () => {
  mockApi({ available: false, fees: [] }, null);
  render(<MemoryRouter><JoinMembershipPage /></MemoryRouter>);
  expect(await screen.findByTestId("join-fees-none")).toBeInTheDocument();
  expect(screen.getByTestId("join-benefit-0")).toHaveTextContent("Stimmrecht im Verein");
  expect(screen.getAllByTestId(/^join-benefit-\d$/)).toHaveLength(4);
});
