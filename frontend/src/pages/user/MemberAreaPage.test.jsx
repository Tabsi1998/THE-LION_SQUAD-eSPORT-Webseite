import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mitgliederbereich: oben die eigene Karte mit Gruß, „Mitglied seit“ und Beitragsstand (#1336), darunter die Sprungleiste
// mit dem, was offen ist (#1257) - Zahl nur, wenn etwas offen ist; die Zusage zur Versammlung geht direkt in der Karte.
// Dazu die Discord-Server des Vereins mit dem eigenen Status (#626).

const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({
  API: "/api",
  api: apiMock,
  formatApiError: (detail) => (typeof detail === "string" ? detail : ""),
  formatMemberSince: (value) => (value ? "Februar 2026" : "-"),
  resolveMediaUrl: (value) => value || "",
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", display_name: "LunaByte" } }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: MemberAreaPage } = await import("./MemberAreaPage");

const SERVERS = [
  { available: true, guild_id: "1", name: "LION", member_count: 120, invite_url: "https://discord.gg/lion", main: true },
  { available: true, guild_id: "2", name: "Rocket League", member_count: 40, invite_url: "https://discord.gg/rocket", main: false },
];

const MEMBER = { membership: { member_status: "active", member_number: "TLS-031", member_since: "2026-02-01", membership_type: "ordinary" } };
const PAID = { ...MEMBER, dolibarr: { led_by_dolibarr: true, type_label: "Ordentliches Mitglied", paid_until: "2026-12-31", fee: { status: "paid" } } };
const DUE = { ...MEMBER, dolibarr: { led_by_dolibarr: true, fee: { status: "due" } } };
const MEETING = { id: 7, kind_label: "Generalversammlung", title: "Generalversammlung 2026", day: "2026-10-24", time: "18:00", place: "Vereinsheim", format_label: "vor Ort", response: "", response_label: "noch keine Antwort", can_respond: true };

function mockApi({ discord = { linked: true, servers: [] }, me = { membership: {} }, summary = {}, documents = [], news = [] } = {}) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/membership/discord-servers") {
      if (discord instanceof Error) throw discord;
      return { data: discord };
    }
    if (url === "/settings/public") return { data: { discord_invite_url: "https://discord.gg/lion" } };
    if (url === "/membership/me") return { data: me };
    if (url === "/membership/area-summary") return { data: summary };
    if (url === "/documents") return { data: documents };
    if (url === "/news") return { data: news };
    return { data: url.startsWith("/membership/") ? {} : [] };
  });
}

function renderPage() {
  return render(<MemoryRouter><MemberAreaPage /></MemoryRouter>);
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.put.mockReset();
});

test("Kopf: die eigene Karte, Gruß, „Mitglied seit“ und „Beitrag bezahlt“", async () => {
  mockApi({ me: PAID });
  renderPage();
  expect(await screen.findByTestId("member-area-card")).toBeInTheDocument();
  expect(screen.getByTestId("member-area-card-name")).toHaveTextContent("LunaByte");
  expect(screen.getByTestId("member-area-card")).toHaveTextContent("Nr. TLS-031 · seit 2026");
  expect(screen.getByTestId("member-area-card")).toHaveTextContent("Ordentliches Mitglied · gültig bis 31.12.2026");
  expect(screen.getByTestId("member-area-card-link")).toHaveAttribute("href", "/members/membership#mitgliedskarte");
  expect(screen.getByTestId("member-area-greeting")).toHaveTextContent("Hallo, LunaByte");
  expect(screen.getByTestId("member-area-since")).toHaveTextContent("Mitglied seit Februar 2026");
  expect(screen.getByTestId("member-area-fee")).toHaveTextContent("Beitrag bezahlt");
  expect(screen.getByTestId("member-area-fee")).toHaveAttribute("data-tone", "ok");
  expect(screen.getByTestId("member-area-my-membership")).toHaveAttribute("href", "/members/membership");
});

test("Kopf: offener Beitrag; ohne Dolibarr kein Schild; ohne gültige Mitgliedschaft keine Karte", async () => {
  mockApi({ me: DUE });
  const { unmount } = renderPage();
  expect(await screen.findByTestId("member-area-fee")).toHaveTextContent("Beitrag offen");
  expect(screen.getByTestId("member-area-fee")).toHaveAttribute("data-tone", "warn");
  unmount();

  mockApi({ me: MEMBER });
  const second = renderPage();
  expect(await screen.findByTestId("member-area-card")).toBeInTheDocument();
  expect(screen.queryByTestId("member-area-fee")).toBeNull();
  second.unmount();

  mockApi({ me: { membership: { member_status: "pending" } } });
  renderPage();
  expect(await screen.findByTestId("member-area-greeting")).toHaveTextContent("Hallo, LunaByte");
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/membership/area-summary"));
  expect(screen.queryByTestId("member-area-card")).toBeNull();
});

test("Sprungleiste: Zahl nur, wo etwas offen ist; vorhandene Abschnitte als Sprung, fehlende als Seite", async () => {
  mockApi({
    me: PAID,
    summary: { meetings_open: 1, ballots_open: 0, next_meeting: MEETING, helping_free: 6, helping_mine: 0, news_new: 1, documents: 2, documents_new: 0 },
    documents: [{ id: "d1", title: "Statuten", original_filename: "statuten.pdf" }],
  });
  renderPage();
  const bar = await screen.findByTestId("member-area-links");
  await waitFor(() => expect(within(bar).getByTestId("member-area-jump-versammlung")).toHaveTextContent("Versammlung · 1 offen"));
  expect(within(bar).getByTestId("member-area-jump-versammlung")).toHaveAttribute("aria-label", "Versammlung, 1 offen");
  expect(within(bar).getByTestId("member-area-jump-helfen")).toHaveTextContent("Helfen · 6 frei");
  expect(within(bar).getByTestId("member-area-jump-news")).toHaveTextContent("News · 1 neu");
  expect(within(bar).getByTestId("member-area-jump-karte")).toHaveTextContent(/^Karte$/);
  expect(within(bar).getByTestId("member-area-jump-dokumente")).toHaveTextContent(/^Dokumente$/);

  // Versammlung und Dokumente stehen auf der Seite: Sprung; Helfen und News nicht (nichts geladen): ihre Seiten.
  await waitFor(() => expect(within(bar).getByTestId("member-area-jump-dokumente")).toHaveAttribute("href", "#dokumente"));
  expect(within(bar).getByTestId("member-area-jump-versammlung")).toHaveAttribute("href", "#versammlung");
  expect(within(bar).getByTestId("member-area-jump-karte")).toHaveAttribute("href", "#karte");
  expect(within(bar).getByTestId("member-area-jump-helfen")).toHaveAttribute("href", "/members/helfen");
  expect(within(bar).getByTestId("member-area-jump-news")).toHaveAttribute("href", "/members/news");

  // Ein Tipp: der Eintrag wird aktiv (goldener Strich), der Abschnitt bekommt den Fokus.
  fireEvent.click(within(bar).getByTestId("member-area-jump-versammlung"));
  expect(within(bar).getByTestId("member-area-jump-versammlung")).toHaveAttribute("data-active", "1");
  expect(within(bar).getByTestId("member-area-jump-versammlung")).toHaveAttribute("aria-current", "location");
  expect(document.activeElement).toBe(document.getElementById("versammlung"));
  expect(within(bar).getByTestId("member-area-jump-dokumente")).toHaveAttribute("data-active", "0");
});

test("Zusage in der Karte: ohne Seitenwechsel, die Zahl in der Leiste geht weg", async () => {
  mockApi({ me: PAID, summary: { meetings_open: 1, ballots_open: 0, next_meeting: MEETING, helping_free: 0, news_new: 0 } });
  apiMock.put.mockResolvedValue({ data: { ...MEETING, response: "yes", response_label: "zugesagt" } });
  renderPage();
  const card = await screen.findByTestId("member-area-meeting-7");
  expect(card).toHaveTextContent("Generalversammlung 2026");
  expect(card).toHaveTextContent("Okt");
  expect(card).toHaveTextContent("24.10.2026");
  expect(screen.getByTestId("member-area-answer")).toHaveTextContent("Deine Antwort: noch keine Antwort");
  fireEvent.click(screen.getByTestId("member-area-answer-yes"));
  await waitFor(() => expect(screen.getByTestId("member-area-answer")).toHaveTextContent("Deine Antwort: zugesagt"));
  expect(apiMock.put).toHaveBeenCalledWith("/membership/me/meetings/7/response", { response: "yes" });
  expect(screen.getByTestId("member-area-answer-yes")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("member-area-jump-versammlung")).toHaveTextContent(/^Versammlung$/);
  // Dieselbe Antwort noch einmal schickt nichts.
  fireEvent.click(screen.getByTestId("member-area-answer-yes"));
  expect(apiMock.put).toHaveBeenCalledTimes(1);
});

test("Dokumente: nur die Vereinsdokumente (scope=club)", async () => {
  mockApi({ me: PAID, documents: [{ id: "d1", title: "Statuten", original_filename: "statuten.pdf" }] });
  renderPage();
  expect(await screen.findByTestId("member-area-documents")).toHaveTextContent("Statuten");
  expect(apiMock.get).toHaveBeenCalledWith("/documents", { params: { scope: "club" } });
});

test("alle Server mit eigenem Status", async () => {
  mockApi({ discord: { linked: true, servers: [{ ...SERVERS[0], member: true }, { ...SERVERS[1], member: false }] } });
  renderPage();
  expect(await screen.findByTestId("member-area-discord-servers")).toHaveTextContent("Discord-Server");
  expect(screen.getByTestId("member-area-discord-server-1-joined")).toHaveTextContent("Du bist dabei");
  expect(screen.getByTestId("member-area-discord-server-2-join")).toHaveAttribute("href", "https://discord.gg/rocket");
  expect(screen.queryByTestId("member-area-discord-server-link-hint")).toBeNull();
});

test("ohne Verknüpfung: Einladungen und der Weg zum Verknüpfen", async () => {
  mockApi({ discord: { linked: false, servers: SERVERS.map((server) => ({ ...server, member: null })) } });
  renderPage();
  expect(await screen.findByTestId("member-area-discord-server-link-hint")).toHaveTextContent("Discord verknüpfen");
  expect(screen.getByTestId("member-area-discord-server-1-join")).toBeInTheDocument();
  expect(screen.queryByTestId("member-area-discord-server-1-joined")).toBeNull();
});

test("keine Server oder Fehler: kein Block", async () => {
  mockApi({ discord: { linked: true, servers: [] } });
  const { unmount } = renderPage();
  expect(await screen.findByTestId("member-area-discord")).toBeInTheDocument();
  expect(screen.queryByTestId("member-area-discord-servers")).toBeNull();
  unmount();
  mockApi({ discord: new Error("offline") });
  renderPage();
  expect(await screen.findByTestId("member-area-discord")).toBeInTheDocument();
  expect(screen.queryByTestId("member-area-discord-servers")).toBeNull();
});
