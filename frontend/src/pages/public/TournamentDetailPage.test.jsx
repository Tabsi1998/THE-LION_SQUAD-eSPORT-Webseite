import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Startgeld (#319): die Seite nennt das Startgeld vor der Anmeldung, die Anmeldung geht nur mit
// der Kostenübernahme raus, und danach sieht nur die anmeldende Person ihren Preis.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
let authUser = null;
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (e, f) => f || String(e), resolveMediaUrl: (u) => u }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useCanonicalSlugRedirect", () => ({ useCanonicalSlugRedirect: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/Breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/components/tls/StreamEmbed", () => ({ StreamEmbed: () => null }));
vi.mock("@/components/tls/PrizeList", () => ({ PrizeList: () => null }));
vi.mock("@/components/tls/MentionTextarea", () => ({ MentionTextarea: () => null }));
vi.mock("@/components/tls/MentionText", () => ({ MentionText: ({ text }) => <span>{text}</span> }));
vi.mock("@/components/tls/ChatAttachments", () => ({ ChatAttachButton: () => null, ChatAttachmentDrafts: () => null, ChatMessageAttachments: () => null, useChatAttachmentDrafts: () => ({ drafts: [], add: () => {}, remove: () => {}, clear: () => {}, uploading: false }) }));
vi.mock("@/components/tls/ChatStickers", () => ({ ChatMessageSticker: () => null, ChatStickerButton: () => null, ChatStickerPicker: () => null }));

const TournamentDetailPage = (await import("./TournamentDetailPage")).default;

const OFFER = { enabled: true, currency: "EUR", positions: [{ key: "startgeld", label: "Startgeld", amount_cents: 1000, basis: "per_person", optional: false }] };
const base = {
  id: "t1", slug: "cup", title: "Herbst-Cup", status: "registration_open", registration_enabled: true, participant_count: 0, max_participants: 16,
  team_mode: "solo", team_size: 1, event_mode: "online", game: { id: "g1", slug: "rl", name: "Rocket League", player_id_fields: [] },
  public_phase: { state: "registration_open", label: "Anmeldung" },
};

function mockApi(tournament, registrations = []) {
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: tournament });
    if (path === "/tournaments/t1/registrations") return Promise.resolve({ data: registrations });
    if (path === "/teams/my") return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/tournaments/cup"]}>
      <Routes><Route path="/tournaments/:slug" element={<TournamentDetailPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authUser = { id: "u1", username: "paula", display_name: "Paula" };
  apiMock.post.mockResolvedValue({ data: { id: "r1", status: "approved" } });
});

test("ohne Startgeld meldet der Knopf sofort an - wie bisher", async () => {
  const user = userEvent.setup();
  mockApi(base);
  renderPage();
  await user.click(await screen.findByTestId("tournament-register-btn"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/register", expect.objectContaining({ accept_costs: false, selected_positions: [] }), expect.anything()));
  expect(screen.queryByTestId("tournament-offer")).not.toBeInTheDocument();
});

test("mit Startgeld steht der Betrag vorne, und angemeldet wird erst mit dem Haken", async () => {
  const user = userEvent.setup();
  mockApi({ ...base, offer: OFFER });
  renderPage();
  expect(await screen.findByTestId("tournament-offer")).toHaveTextContent("10,00 € Startgeld");
  await user.click(screen.getByTestId("tournament-register-btn"));

  const submit = await screen.findByTestId("tournament-register-submit");
  expect(submit).toBeDisabled();
  expect(screen.getByTestId("tournament-quote")).toHaveTextContent("10,00 €");
  await user.click(screen.getByTestId("tournament-accept-costs"));
  expect(submit).toBeEnabled();
  expect(submit).toHaveTextContent("Verbindlich anmelden · 10,00 €");
  await user.click(submit);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/register", expect.objectContaining({ accept_costs: true }), expect.anything()));
});

test("bei Teams rechnet die Summe mit der Teamgröße und die Teamleitung übernimmt", async () => {
  const user = userEvent.setup();
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: { ...base, team_mode: "team", team_size: 5, offer: OFFER } });
    if (path === "/teams/my") return Promise.resolve({ data: [{ id: "team-1", name: "Lions", tag: "TLS", my_role: "leader", can_manage: true }] });
    return Promise.resolve({ data: [] });
  });
  renderPage();
  expect(await screen.findByTestId("tournament-offer")).toHaveTextContent("10,00 € je Spieler · Team mit 5 Spielern 50,00 €");
  expect(screen.getByTestId("tournament-offer")).toHaveTextContent("Die Teamleitung übernimmt das Startgeld");
  await user.click(screen.getByTestId("tournament-register-btn"));
  expect(await screen.findByTestId("tournament-quote")).toHaveTextContent("50,00 €");
  expect(screen.getByTestId("tournament-accept-costs").closest("label")).toHaveTextContent("für das Team");
});

test("die eigene Anmeldung zeigt den eingefrorenen Preis, Warteliste den Hinweis", async () => {
  mockApi({ ...base, offer: OFFER }, [
    { id: "r1", user_id: "u1", display_name: "Paula", status: "approved", price: { total_cents: 1000, currency: "EUR", billing_status: "pending", payer_user_id: "u1" } },
    { id: "r2", display_name: "Fremd", status: "approved" },
  ]);
  renderPage();
  expect(await screen.findByTestId("tournament-own-price")).toHaveTextContent("Dein Startgeld: 10,00 €");
  expect(screen.getByTestId("tournament-own-price")).toHaveTextContent("Meine Rechnungen");
  expect(screen.queryByTestId("tournament-register-btn")).not.toBeInTheDocument();

  mockApi({ ...base, offer: OFFER }, [{ id: "r1", user_id: "u1", display_name: "Paula", status: "waitlist" }]);
  renderPage();
  expect(await screen.findByTestId("tournament-price-pending")).toHaveTextContent("erst, wenn deine Teilnahme bestätigt ist");
});

test("Partner II (#469): das Turnier nennt seine Partner mit Link auf die Partnerseite", async () => {
  mockApi({ ...base, partners: [{ id: "p1", slug: "pineapps-esports", name: "PineApps eSports" }] });
  renderPage();
  expect(await screen.findByTestId("tournament-partner-pineapps-esports")).toHaveAttribute("href", "/partners/pineapps-esports");
  expect(screen.getByTestId("tournament-partner-pineapps-esports")).toHaveTextContent("mit PineApps eSports");
});
