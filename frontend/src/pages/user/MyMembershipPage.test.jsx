import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// „Meine Mitgliedschaft“ (#295): Beitragskarte aus der Mitgliederverwaltung – und
// für ein Konto ohne Zuordnung der Weg, sie beim Vorstand anzufragen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };

vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler", formatMemberSince: () => "1.1.2023" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { display_name: "Paula" } }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const MyMembershipPage = (await import("./MyMembershipPage")).default;
const membership = {
  member_status: "active", membership_type: "ordinary", member_number: "12", member_since: "2023-01-01",
  // Käme vom Server je wieder eine interne Notiz mit, zeigt die Seite sie trotzdem nicht (#345).
  notes: "intern: zahlt spät",
  history: [{ at: "2026-09-21T10:00:00+00:00", from_status: "none", to_status: "active", source: "dolibarr", notes: "intern" }],
};

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

test("aktive Mitglieder tragen sich ins Verzeichnis ein und pflegen ihren Eintrag (#410)", async () => {
  const user = userEvent.setup();
  const me = { membership, is_active_member: true, dolibarr: null };
  let directory = { eligible: true, listed: false, blocked: false, editorial: false, slug: null, entry: { display_name: "Paula", gamertag: "paula", photo_url: "", bio: "", games: ["Rocket League"], platforms: ["PC"] } };
  apiMock.get.mockImplementation(async (url) => ({ data: url === "/membership/me/directory" ? directory : me }));
  apiMock.put.mockImplementation(async (url, body) => {
    directory = { ...directory, ...(body.listed !== undefined ? { listed: body.listed, slug: "paula" } : {}), entry: { ...directory.entry, ...(body.gamertag !== undefined ? { gamertag: body.gamertag, games: body.games, platforms: body.platforms, bio: body.bio } : {}) } };
    return { data: directory };
  });
  renderPage();
  const toggle = await screen.findByTestId("membership-directory-switch");
  expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(screen.queryByTestId("membership-directory-form")).toBeNull();

  await user.click(toggle);
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/membership/me/directory", { listed: true }));
  expect(await screen.findByTestId("membership-directory-form")).toBeInTheDocument();
  expect(screen.getByTestId("membership-directory-link")).toHaveAttribute("href", "/members/paula");
  expect(screen.getByTestId("membership-directory-games")).toHaveValue("Rocket League");

  await user.clear(screen.getByTestId("membership-directory-gamertag"));
  await user.type(screen.getByTestId("membership-directory-gamertag"), "PaulaGG");
  await user.clear(screen.getByTestId("membership-directory-games"));
  await user.type(screen.getByTestId("membership-directory-games"), "F1 25, Rocket League");
  await user.click(screen.getByTestId("membership-directory-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenLastCalledWith("/membership/me/directory", { gamertag: "PaulaGG", games: ["F1 25", "Rocket League"], platforms: ["PC"], bio: "" }));
  expect(toastMock.success).toHaveBeenCalledWith("Eintrag gespeichert.");
});

test("ein gesperrter Eintrag zeigt nur den Hinweis", async () => {
  const me = { membership, is_active_member: true, dolibarr: null };
  const directory = { eligible: true, listed: false, blocked: true, editorial: false, slug: "paula", entry: { display_name: "Paula", gamertag: "paula", games: [], platforms: [], bio: "" } };
  apiMock.get.mockImplementation(async (url) => ({ data: url === "/membership/me/directory" ? directory : me }));
  renderPage();
  expect(await screen.findByTestId("membership-directory-blocked")).toHaveTextContent("gesperrt");
  expect(screen.queryByTestId("membership-directory-switch")).toBeNull();
});

test("ist Dolibarr nicht angebunden, bleibt die Seite wie bisher", async () => {
  apiMock.get.mockResolvedValue({ data: { membership, is_active_member: true, dolibarr: null } });
  renderPage();
  await waitFor(() => expect(screen.getAllByText("Aktives Mitglied").length).toBeGreaterThan(0));
  expect(screen.queryByText(/zahlt spät/)).toBeNull();
  expect(screen.queryByText(/„intern/)).toBeNull();
  expect(screen.getByText("aus der Mitgliederverwaltung übernommen")).toBeInTheDocument();
  expect(screen.queryByTestId("membership-fee-card")).toBeNull();
  expect(screen.queryByTestId("membership-link-card")).toBeNull();
});
