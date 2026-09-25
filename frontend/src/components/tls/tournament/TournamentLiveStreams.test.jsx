import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// „Turnier live“ (#579): Kasten nur mit Streams; erster Stream als Player erst nach Zustimmung; alle als Zeilen.

const apiMock = { get: vi.fn() };
const consent = { value: false };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ hasConsent: () => consent.value }) }));
vi.mock("@/components/tls/ExternalMediaNotice", () => ({ ExternalMediaNotice: ({ service, url, testId }) => <div data-testid={testId}>{service} {url}</div> }));

const { TournamentLiveStreams, twitchPlayerSrc } = await import("./TournamentLiveStreams");

const STREAMS = [
  { user_id: "u1", username: "paula", display_name: "Paula", twitch_login: "paula", title: "Finale!", game_name: "Rocket League", viewer_count: 1200, stream_url: "https://twitch.tv/paula", public_profile_url: "/u/paula", avatar_url: "/a.webp" },
  { user_id: "u2", username: "kai", display_name: "Kai", twitch_login: "kai", title: "Zweiter Blick", game_name: "Rocket League", viewer_count: 3, stream_url: "https://twitch.tv/kai", public_profile_url: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  consent.value = false;
  apiMock.get.mockResolvedValue({ data: STREAMS });
});

test("Player-Adresse mit parent", () => {
  expect(twitchPlayerSrc("paula", "lionsquad.at")).toBe("https://player.twitch.tv/?channel=paula&parent=lionsquad.at&muted=true&autoplay=false");
});

test("zwei Streams: Kopfzeile, Hinweis statt Player ohne Zustimmung, Zeilen mit Profil-Link und Zuschauen", async () => {
  render(<MemoryRouter><TournamentLiveStreams tournament={{ id: "t1", slug: "sommer-cup" }} /></MemoryRouter>);
  expect(await screen.findByTestId("tournament-live-streams")).toHaveTextContent("2 Teilnehmer streamen das Turnier");
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments/sommer-cup/streams");
  expect(screen.getByTestId("tournament-live-consent")).toHaveTextContent("Twitch Stream https://twitch.tv/paula");
  expect(screen.getByTestId("tournament-live-u1").querySelector("a[href='/u/paula']")).toHaveTextContent("Paula");
  expect(screen.getByTestId("tournament-live-u1")).toHaveTextContent("Finale! · Rocket League");
  expect(screen.getByTestId("tournament-live-u1")).toHaveTextContent("1.200");
  expect(screen.getByTestId("tournament-live-u2").querySelector("a[href='/u/kai']")).toBeNull();
  expect(screen.getByTestId("tournament-live-open")).toHaveAttribute("href", "https://twitch.tv/paula");
});

test("ein Stream mit Zustimmung: Player von Twitch; ohne Streams nichts", async () => {
  consent.value = true;
  apiMock.get.mockResolvedValueOnce({ data: [STREAMS[0]] });
  render(<MemoryRouter><TournamentLiveStreams tournament={{ id: "t1" }} /></MemoryRouter>);
  expect(await screen.findByTestId("tournament-live-streams")).toHaveTextContent("Paula streamt das Turnier");
  expect(screen.getByTestId("tournament-live-frame")).toHaveAttribute("src", expect.stringContaining("channel=paula"));

  apiMock.get.mockResolvedValueOnce({ data: [] });
  const { container } = render(<MemoryRouter><TournamentLiveStreams tournament={{ id: "t2" }} /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  expect(container.querySelector("[data-testid='tournament-live-streams']")).toBeNull();
});
