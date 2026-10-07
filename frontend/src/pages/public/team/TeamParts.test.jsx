import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Team-Seite (#1191): Abschnitte „Angemeldet für“ und „Letzte Spiele“, Beitreten über den Einladungs-Link,
// das Blatt „Einladen“ mit QR-Code und neuem Link. Erfundene Daten.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback, resolveMediaUrl: (v) => v || "" }));
const confirmMock = vi.fn();
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/components/tls/BrandedQRCode", () => ({ BrandedQRCode: ({ value }) => <div data-testid="branded-qr-code" data-value={value} /> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { TeamSchedule } = await import("./TeamSchedule");
const { TeamJoinCard } = await import("./TeamJoinCard");
const { TeamInviteSheet } = await import("./TeamInviteSheet");

const OVERVIEW = {
  upcoming: [{ registration_id: "r-1", status: "approved", status_label: "Angemeldet", tournament: { id: "t1", slug: "rl-herbst", title: "Rocket League Herbst-Cup", start_date: "2026-10-17T14:00:00Z", event_name: "Herbst-LAN" } }],
  recent: [
    { match_id: "m-1", kind: "duel", outcome: "win", score: "3:1", opponent: "Pixelpiraten", round_label: "Finale", tournament: { title: "Liga Herbst" } },
    { match_id: "m-2", kind: "duel", outcome: "loss", score: "1:2", opponent: "Team Kaktus", round_label: "Halbfinale", tournament: { title: "Liga Herbst" } },
  ],
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  confirmMock.mockReset();
});

test("„Angemeldet für“ und „Letzte Spiele“ mit Stand, Ergebnis und Sieg oder Niederlage", () => {
  render(<MemoryRouter><TeamSchedule overview={OVERVIEW} /></MemoryRouter>);
  const upcoming = screen.getByTestId("team-upcoming");
  expect(within(upcoming).getByText("Rocket League Herbst-Cup")).toBeInTheDocument();
  expect(screen.getByTestId("team-upcoming-status-r-1")).toHaveTextContent("Angemeldet");
  expect(screen.getByTestId("team-upcoming-r-1")).toHaveAttribute("href", "/tournaments/rl-herbst");
  expect(screen.getByTestId("team-recent-m-1")).toHaveTextContent("3:1 gegen Pixelpiraten");
  expect(screen.getByTestId("team-recent-m-1")).toHaveTextContent("Liga Herbst · Finale");
  expect(screen.getByTestId("team-recent-outcome-m-1")).toHaveTextContent("Sieg");
  expect(screen.getByTestId("team-recent-outcome-m-2")).toHaveTextContent("Niederlage");
  expect(screen.getByTestId("team-recent-m-2")).toHaveAttribute("href", "/matches/m-2");
});

test("ohne Termine und Spiele bleibt der Abschnitt weg", () => {
  const { container } = render(<MemoryRouter><TeamSchedule overview={{ upcoming: [], recent: [] }} /></MemoryRouter>);
  expect(container).toBeEmptyDOMElement();
});

test("Einladungs-Link mit Konto: nur noch „Beitreten“ tippen", async () => {
  apiMock.get.mockResolvedValue({ data: { valid: true, already_member: false, team: { name: "Lions Rocket", member_count: 5 } } });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  const onJoined = vi.fn();
  render(<MemoryRouter><TeamJoinCard teamId="t-1" token="AbC123" user={{ id: "u-9" }} onJoined={onJoined} /></MemoryRouter>);
  expect(await screen.findByText("Du bist eingeladen: Lions Rocket")).toBeInTheDocument();
  expect(apiMock.get).toHaveBeenCalledWith("/teams/t-1/invite-link/check", { params: { token: "AbC123" } });
  fireEvent.click(screen.getByTestId("team-join-invite-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/teams/t-1/join-link", { token: "AbC123" }));
  await waitFor(() => expect(onJoined).toHaveBeenCalledTimes(1));
});

test("Einladungs-Link ohne Konto: anmelden und danach zurück zur Einladung", async () => {
  apiMock.get.mockResolvedValue({ data: { valid: true, already_member: false, team: { name: "Lions Rocket" } } });
  render(<MemoryRouter initialEntries={["/teams/t-1?einladung=AbC123"]}><TeamJoinCard teamId="t-1" token="AbC123" user={null} /></MemoryRouter>);
  const login = await screen.findByTestId("team-join-invite-login");
  expect(login).toHaveAttribute("href", `/login?next=${encodeURIComponent("/teams/t-1?einladung=AbC123")}`);
});

test("ein alter Link sagt, dass er nicht mehr gilt; wer schon drin ist, sieht nichts", async () => {
  apiMock.get.mockResolvedValueOnce({ data: { valid: false, already_member: false, team: { name: "Lions Rocket" } } });
  const { unmount } = render(<MemoryRouter><TeamJoinCard teamId="t-1" token="alt" user={{ id: "u-9" }} /></MemoryRouter>);
  expect(await screen.findByTestId("team-join-invalid")).toHaveTextContent("gilt nicht mehr");
  unmount();
  apiMock.get.mockResolvedValueOnce({ data: { valid: true, already_member: true, team: { name: "Lions Rocket" } } });
  const { container } = render(<MemoryRouter><TeamJoinCard teamId="t-1" token="AbC123" user={{ id: "u-1" }} /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  expect(container).toBeEmptyDOMElement();
});

test("Einladen: QR-Code mit dem Link, neu erzeugen erst nach Rückfrage", async () => {
  apiMock.get.mockResolvedValue({ data: { url: "https://lionsquad.at/teams/t-1?einladung=Alt111", token: "Alt111" } });
  apiMock.post.mockResolvedValue({ data: { url: "https://lionsquad.at/teams/t-1?einladung=Neu222", token: "Neu222" } });
  render(<MemoryRouter><TeamInviteSheet team={{ id: "t-1", name: "Lions Rocket", tag: "LRK", join_code: "Kx7pQ2" }} onClose={() => {}} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("team-invite-url")).toHaveValue("https://lionsquad.at/teams/t-1?einladung=Alt111"));
  expect(screen.getByTestId("branded-qr-code")).toHaveAttribute("data-value", "https://lionsquad.at/teams/t-1?einladung=Alt111");
  expect(screen.getByTestId("team-join-code-box")).toHaveTextContent("Kx7pQ2");

  confirmMock.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByTestId("team-invite-renew"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
  expect(apiMock.post).not.toHaveBeenCalled();

  confirmMock.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByTestId("team-invite-renew"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/teams/t-1/invite-link"));
  await waitFor(() => expect(screen.getByTestId("team-invite-url")).toHaveValue("https://lionsquad.at/teams/t-1?einladung=Neu222"));
});
