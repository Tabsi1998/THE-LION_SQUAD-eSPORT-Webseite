import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Clips des Vereinskanals (#579): ohne Clips keine Kachel; Klick öffnet den Player erst nach Zustimmung.

const apiMock = { get: vi.fn() };
const consent = { value: false };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ hasConsent: () => consent.value }) }));
vi.mock("@/components/tls/ExternalMediaNotice", () => ({ ExternalMediaNotice: ({ service, url, testId }) => <div data-testid={testId}>{service} {url}</div> }));

const { TwitchClips, clipEmbedSrc, durationText } = await import("./TwitchClips");

const CLIPS = [
  { id: "ClipA", url: "https://clips.twitch.tv/ClipA", title: "Der Lob ins Tor", creator_name: "Paula", view_count: 1234, duration: 27.5, thumbnail_url: "https://clips-media.twitch.tv/a.jpg" },
  { id: "ClipB", url: "https://clips.twitch.tv/ClipB", title: "Save der Saison", creator_name: "", view_count: 80, duration: 61 },
];

beforeEach(() => {
  vi.clearAllMocks();
  consent.value = false;
  apiMock.get.mockResolvedValue({ data: CLIPS });
});

test("Helfer: Player-Adresse mit parent, Dauer als Minuten:Sekunden", () => {
  expect(clipEmbedSrc("ClipA", "lionsquad.at")).toBe("https://clips.twitch.tv/embed?clip=ClipA&parent=lionsquad.at&autoplay=true");
  expect(durationText(27.5)).toBe("0:28");
  expect(durationText(61)).toBe("1:01");
  expect(durationText(undefined)).toBe("0:00");
});

test("Kacheln mit Titel, Ersteller und Aufrufen; Klick zeigt ohne Zustimmung den Hinweis, mit Zustimmung den Player", async () => {
  const user = userEvent.setup();
  render(<TwitchClips />);
  expect(await screen.findByTestId("twitch-clips")).toHaveTextContent("Clips aus dem Rudel");
  expect(apiMock.get).toHaveBeenCalledWith("/streams/clips");
  expect(screen.getByTestId("twitch-clip-ClipA")).toHaveTextContent("Clip von Paula");
  expect(screen.getByTestId("twitch-clip-ClipA")).toHaveTextContent("1.234");
  expect(screen.getByTestId("twitch-clip-ClipB")).toHaveTextContent("1:01");
  expect(screen.queryByTestId("twitch-clips-player")).toBeNull();

  await user.click(screen.getByTestId("twitch-clip-ClipA"));
  expect(screen.getByTestId("twitch-clips-consent")).toHaveTextContent("Twitch Clip https://clips.twitch.tv/ClipA");
  expect(screen.getByTestId("twitch-clips-external")).toHaveAttribute("href", "https://clips.twitch.tv/ClipA");

  consent.value = true;
  await user.click(screen.getByTestId("twitch-clip-ClipB"));
  expect(screen.getByTestId("twitch-clips-frame")).toHaveAttribute("src", expect.stringContaining("clip=ClipB"));
  await user.click(screen.getByTestId("twitch-clips-close"));
  expect(screen.queryByTestId("twitch-clips-player")).toBeNull();
});

test("ohne Clips keine Kachel", async () => {
  apiMock.get.mockResolvedValue({ data: [] });
  const { container } = render(<TwitchClips />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(container.querySelector("[data-testid='twitch-clips']")).toBeNull();
});
