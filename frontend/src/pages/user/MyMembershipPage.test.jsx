import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// „Meine Mitgliedschaft“ (#295): Beitragskarte aus der Mitgliederverwaltung – und
// für ein Konto ohne Zuordnung der Weg, sie beim Vorstand anzufragen.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };

vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler", formatMemberSince: () => "1.1.2023" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { display_name: "Paula" } }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const MyMembershipPage = (await import("./MyMembershipPage")).default;
const membership = { member_status: "active", membership_type: "ordinary", member_number: "12", member_since: "2023-01-01", history: [] };

beforeEach(() => vi.clearAllMocks());

const renderPage = () => render(<MemoryRouter><MyMembershipPage /></MemoryRouter>);

test("mit bestätigter Zuordnung steht der Beitragsstand samt Stand-Datum da", async () => {
  apiMock.get.mockResolvedValue({ data: { membership, is_active_member: true, dolibarr: {
    connected: true, led_by_dolibarr: true, as_of: "2026-09-21T10:00:00+00:00", stale: false, paid_until: "2025-12-31", membership_ends: null,
    functions: [{ label: "Kassier:in", since: "2026-03-01" }],
    fee: { required: true, status: "due", next_due: "2026-01-01", amount: 50, currency: "EUR", discount: { kind: "none", label: "" }, payer: "self" },
    link: { status: "verified" },
  } } });
  renderPage();
  const card = await screen.findByTestId("membership-fee-card");
  expect(card).toHaveTextContent("fällig");
  expect(card).toHaveTextContent("Nächster Beitrag seit 1.1.2026 offen");
  expect(card).toHaveTextContent("Funktion im Verein: Kassier:in");
  expect(card).toHaveTextContent("Stand aus der Mitgliederverwaltung vom");
  expect(screen.queryByTestId("membership-link-card")).toBeNull();
});

test("ohne Zuordnung lässt sie sich anfragen – bestätigt wird sie vom Vorstand", async () => {
  const user = userEvent.setup();
  apiMock.get.mockResolvedValue({ data: { membership: null, is_active_member: false, dolibarr: { connected: true, led_by_dolibarr: false, link: null } } });
  apiMock.post.mockResolvedValue({ data: { status: "requested" } });
  renderPage();
  expect(await screen.findByTestId("membership-link-card")).toHaveTextContent("eine Mitgliedsnummer allein reicht dafür nicht");
  await user.type(screen.getByTestId("membership-link-ref"), " 12 ");
  await user.click(screen.getByTestId("membership-link-request"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/membership/dolibarr/link-request", { member_ref: "12" }));
});

test("ist Dolibarr nicht angebunden, bleibt die Seite wie bisher", async () => {
  apiMock.get.mockResolvedValue({ data: { membership, is_active_member: true, dolibarr: null } });
  renderPage();
  await waitFor(() => expect(screen.getByText("Aktives Mitglied")).toBeInTheDocument());
  expect(screen.queryByTestId("membership-fee-card")).toBeNull();
  expect(screen.queryByTestId("membership-link-card")).toBeNull();
});
