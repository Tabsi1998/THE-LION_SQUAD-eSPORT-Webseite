import { act, render, screen } from "@testing-library/react";

// Eingebetteter Stream (#616): Player erst nach Zustimmung - und nur der eingebettete Player meldet den
// Zuschauer-Ping, mit der Kennung aus Plattform und Kanal.

const apiMock = { post: vi.fn() };
const consent = { value: true };
const auth = { user: { id: "u1" } };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/context/AuthContext", () => ({ useOptionalAuth: () => auth }));
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ hasConsent: () => consent.value }) }));
vi.mock("@/components/tls/ExternalMediaNotice", () => ({ ExternalMediaNotice: ({ service, url, testId }) => <div data-testid={testId}>{service} {url}</div> }));

const { StreamEmbed, describeStream } = await import("./StreamEmbed");
const { WATCH_AFTER_MS } = await import("@/lib/streamWatch");

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-03T18:00:00Z") });
  vi.clearAllMocks();
  apiMock.post.mockResolvedValue({ data: { watched: true, total: 1 } });
  consent.value = true;
  auth.user = { id: "u1" };
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

test("Kennung und Player-Adresse je Plattform", () => {
  expect(describeStream({ has_live_stream: true, stream_platform: "twitch", stream_url: "https://www.twitch.tv/The_Lion_Squad" }, "lionsquad.at")).toMatchObject({
    platform: "twitch", watchKey: "twitch:the_lion_squad", embedSrc: "https://player.twitch.tv/?channel=the_lion_squad&parent=lionsquad.at&muted=true&autoplay=false",
  });
  expect(describeStream({ twitch_enabled: true, twitch_channel: "@lion" }, "lionsquad.at")).toMatchObject({ platform: "twitch", watchKey: "twitch:lion", url: "https://www.twitch.tv/lion" });
  expect(describeStream({ has_live_stream: true, stream_platform: "youtube", stream_url: "https://youtu.be/dQw4w9WgXcQ" })).toMatchObject({
    watchKey: "youtube:dqw4w9wgxcq", embedSrc: "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=0",
  });
  expect(describeStream({ has_live_stream: true, stream_platform: "youtube", stream_url: "https://www.youtube.com/@LionSquad" })).toMatchObject({ watchKey: "youtube:lionsquad" });
  expect(describeStream({ has_live_stream: true, stream_platform: "kick", stream_url: "https://kick.com/lion.squad" })).toMatchObject({ watchKey: "kick:lion.squad", embedSrc: "https://player.kick.com/lion.squad" });
  // Fremde Adresse: kein Player, keine Kennung - es bleibt beim Link.
  expect(describeStream({ has_live_stream: true, stream_platform: "youtube", stream_url: "https://example.com/watch?v=dQw4w9WgXcQ" })).toMatchObject({ embedSrc: null, watchKey: "" });
  expect(describeStream({ has_live_stream: false, stream_platform: "twitch", stream_url: "https://twitch.tv/lion" })).toBeNull();
  expect(describeStream(null)).toBeNull();
});

test("mit Zustimmung: Player eingebettet, nach einer Minute der Ping", async () => {
  render(<StreamEmbed source={{ has_live_stream: true, stream_platform: "twitch", stream_url: "https://twitch.tv/paula", stream_title: "Finale" }} />);
  expect(screen.getByTitle("Live Stream")).toHaveAttribute("src", expect.stringContaining("channel=paula"));
  expect(screen.getByTestId("stream-open-external")).toHaveAttribute("href", "https://twitch.tv/paula");
  await act(async () => { vi.advanceTimersByTime(WATCH_AFTER_MS); });
  expect(apiMock.post).toHaveBeenCalledWith("/streams/watch", { key: "twitch:paula" }, { skipInvalidation: true });
});

test("ohne Zustimmung: Hinweis statt Player - und kein Ping", async () => {
  consent.value = false;
  render(<StreamEmbed source={{ has_live_stream: true, stream_platform: "twitch", stream_url: "https://twitch.tv/paula" }} />);
  expect(screen.getByTestId("stream-consent-notice")).toHaveTextContent("TWITCH Stream https://twitch.tv/paula");
  await act(async () => { vi.advanceTimersByTime(WATCH_AFTER_MS * 2); });
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("ohne Stream nichts, ohne einbettbare Adresse nur der Link", async () => {
  const { container } = render(<StreamEmbed source={{ has_live_stream: false }} />);
  expect(container).toBeEmptyDOMElement();
  render(<StreamEmbed source={{ has_live_stream: true, stream_platform: "youtube", stream_url: "https://example.com/live" }} />);
  expect(screen.getByTestId("stream-fallback-link")).toHaveAttribute("href", "https://example.com/live");
  await act(async () => { vi.advanceTimersByTime(WATCH_AFTER_MS * 2); });
  expect(apiMock.post).not.toHaveBeenCalled();
});
