import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// YouTube → News (#578): Schalter speichern sofort, „Jetzt abrufen“ sagt in Worten, was passiert ist,
// der Stand zeigt Kanal, letzten Abruf, letztes Video und Fehler.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));

const { YoutubeSettings, fetchResultText, whenText } = await import("./YoutubeSettings");

const STATUS = {
  enabled: false, publish: false, include_shorts: false, channel_url: "", branding_url: "https://www.youtube.com/@TheLionSquadeSports",
  channel_id: "", feed_url: "", last_run_at: null, last_error: null, last_video: null, baseline_at: null, interval_minutes: 15, videos_seen: 0, news_created: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: STATUS });
  apiMock.put.mockImplementation(async (_url, patch) => ({ data: { ...STATUS, ...patch } }));
});

test("Texte in Worten", () => {
  expect(fetchResultText({ baseline: true, seen: 15, created: 0 })).toContain("15 vorhandene Videos gemerkt");
  expect(fetchResultText({ created: 2, skipped_shorts: 1 })).toBe("Abruf fertig: 2 neue News, 1 Shorts übersprungen.");
  expect(fetchResultText({ error: "Kanal nicht gefunden" })).toBe("Abruf fehlgeschlagen: Kanal nicht gefunden");
  expect(whenText(null)).toBe("noch nie");
});

test("ohne Kanal-ID steht, dass sie beim ersten Abruf kommt; Schalter speichern sofort", async () => {
  const user = userEvent.setup();
  render(<YoutubeSettings />);
  expect(await screen.findByTestId("youtube-feed-channel-id")).toHaveTextContent("@TheLionSquadeSports – Kanal-ID kommt beim ersten Abruf");
  expect(screen.getByTestId("youtube-feed-last-run")).toHaveTextContent("noch nie");
  await user.click(screen.getByTestId("youtube-feed-enabled"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/youtube", { enabled: true }));
  expect(toastMock.success).toHaveBeenCalledWith("Abruf an.");
  await user.click(screen.getByTestId("youtube-feed-publish"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/youtube", { publish: true }));

  await user.type(screen.getByTestId("youtube-feed-channel"), "https://www.youtube.com/@Anderer");
  await user.click(screen.getByTestId("youtube-feed-channel-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/settings/youtube", { channel_url: "https://www.youtube.com/@Anderer" }));
});

test("„Jetzt abrufen“ zeigt das Ergebnis und den neuen Stand; Fehler stehen rot da", async () => {
  const user = userEvent.setup();
  apiMock.post.mockResolvedValueOnce({ data: { ...STATUS, channel_id: "UCabcdefghijklmnopqrstuv", last_run_at: "2026-09-25T10:00:00+00:00", videos_seen: 15,
    last_video: { title: "Sommer-Cup Finale", url: "https://www.youtube.com/watch?v=abcdefghijk" }, result: { baseline: true, seen: 15, created: 0 } } });
  render(<YoutubeSettings />);
  await user.click(await screen.findByTestId("youtube-feed-fetch"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/youtube/fetch"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("15 vorhandene Videos gemerkt")));
  expect(screen.getByTestId("youtube-feed-channel-id")).toHaveTextContent("UCabcdefghijklmnopqrstuv");
  expect(screen.getByTestId("youtube-feed-last-video")).toHaveTextContent("Sommer-Cup Finale");
  expect(screen.getByTestId("youtube-feed-counts")).toHaveTextContent("15 / 0");

  apiMock.post.mockResolvedValueOnce({ data: { ...STATUS, last_error: "Kanal nicht gefunden – stimmt die Adresse?", result: { error: "Kanal nicht gefunden – stimmt die Adresse?", created: 0 } } });
  await user.click(screen.getByTestId("youtube-feed-fetch"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Abruf fehlgeschlagen: Kanal nicht gefunden – stimmt die Adresse?"));
  expect(screen.getByTestId("youtube-feed-last-error")).toHaveTextContent("Kanal nicht gefunden");
});
