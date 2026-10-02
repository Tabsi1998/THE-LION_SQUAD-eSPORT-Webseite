import { act, render } from "@testing-library/react";

// Zuschauer-Ping (#616): eine Minute sichtbar offen, einmal je Stream und Tag, nur mit Anmeldung.

const apiMock = { post: vi.fn() };
const auth = { user: { id: "u1" } };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/context/AuthContext", () => ({ useOptionalAuth: () => auth }));

const { STORAGE_KEY, WATCH_AFTER_MS, alreadyReported, streamKey, useStreamWatched, viennaDay } = await import("./streamWatch");

function Player({ watchKey, playing = true }) {
  useStreamWatched(watchKey, playing);
  return null;
}

function setVisibility(state) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-03T18:00:00Z") });
  vi.clearAllMocks();
  apiMock.post.mockResolvedValue({ data: { watched: true, total: 1 } });
  auth.user = { id: "u1" };
  localStorage.clear();
  setVisibility("visible");
});

afterEach(() => {
  vi.useRealTimers();
});

test("Kennung: Plattform und Kanal klein geschrieben, ohne @ - was nicht passt, bleibt leer", () => {
  expect(streamKey("Twitch", "@The_Lion_Squad")).toBe("twitch:the_lion_squad");
  expect(streamKey("youtube", "dQw4w9WgXcQ")).toBe("youtube:dqw4w9wgxcq");
  expect(streamKey("kick", "lion.squad")).toBe("kick:lion.squad");
  expect(streamKey("vimeo", "kanal")).toBe("");
  expect(streamKey("twitch", "")).toBe("");
  expect(streamKey("twitch", "a b")).toBe("");
  expect(streamKey("twitch", "x".repeat(65))).toBe("");
});

test("der Tag gilt in Wien - auch kurz nach Mitternacht und nach der Zeitumstellung", () => {
  expect(viennaDay(new Date("2026-07-31T22:30:00Z"))).toBe("2026-08-01");
  expect(viennaDay(new Date("2026-07-31T21:30:00Z"))).toBe("2026-07-31");
  expect(viennaDay(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  expect(viennaDay(new Date("2026-12-31T22:30:00Z"))).toBe("2026-12-31");
});

test("nach einer Minute geht genau eine Meldung hinaus - beim nächsten Besuch am selben Tag keine mehr", async () => {
  const first = render(<Player watchKey="twitch:paula" />);
  await act(async () => { vi.advanceTimersByTime(WATCH_AFTER_MS - 1); });
  expect(apiMock.post).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(apiMock.post).toHaveBeenCalledTimes(1);
  expect(apiMock.post).toHaveBeenCalledWith("/streams/watch", { key: "twitch:paula" }, { skipInvalidation: true });
  expect(alreadyReported("u1", "twitch:paula")).toBe(true);
  first.unmount();

  render(<Player watchKey="twitch:paula" />);
  await act(async () => { vi.advanceTimersByTime(WATCH_AFTER_MS * 2); });
  expect(apiMock.post).toHaveBeenCalledTimes(1);

  // Ein anderer Stream zählt für sich, der nächste Tag auch.
  render(<Player watchKey="twitch:kai" />);
  await act(async () => { vi.advanceTimersByTime(WATCH_AFTER_MS); });
  expect(apiMock.post).toHaveBeenCalledTimes(2);
  vi.setSystemTime(new Date("2026-10-04T18:00:00Z"));
  expect(alreadyReported("u1", "twitch:paula")).toBe(false);
});

test("ohne Anmeldung, ohne Player oder ohne Kennung bleibt es still", async () => {
  auth.user = null;
  render(<Player watchKey="twitch:paula" />);
  auth.user = { id: "u1" };
  render(<Player watchKey="twitch:paula" playing={false} />);
  render(<Player watchKey="" />);
  await act(async () => { vi.advanceTimersByTime(WATCH_AFTER_MS * 3); });
  expect(apiMock.post).not.toHaveBeenCalled();
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});

test("im verdeckten Tab bleibt die Uhr stehen und läuft danach weiter", async () => {
  render(<Player watchKey="twitch:paula" />);
  await act(async () => { vi.advanceTimersByTime(40000); });
  await act(async () => { setVisibility("hidden"); });
  await act(async () => { vi.advanceTimersByTime(10 * 60000); });
  expect(apiMock.post).not.toHaveBeenCalled();
  await act(async () => { setVisibility("visible"); });
  await act(async () => { vi.advanceTimersByTime(19999); });
  expect(apiMock.post).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(apiMock.post).toHaveBeenCalledTimes(1);
});

test("wer vor der Minute geht, wird nicht gezählt", async () => {
  const view = render(<Player watchKey="twitch:paula" />);
  await act(async () => { vi.advanceTimersByTime(30000); });
  view.unmount();
  await act(async () => { vi.advanceTimersByTime(WATCH_AFTER_MS); });
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("kommt die Meldung nicht an, versucht es der nächste Besuch noch einmal", async () => {
  apiMock.post.mockRejectedValueOnce(new Error("offline"));
  const view = render(<Player watchKey="twitch:paula" />);
  await act(async () => { vi.advanceTimersByTime(WATCH_AFTER_MS); });
  expect(apiMock.post).toHaveBeenCalledTimes(1);
  expect(alreadyReported("u1", "twitch:paula")).toBe(false);
  view.unmount();

  render(<Player watchKey="twitch:paula" />);
  await act(async () => { vi.advanceTimersByTime(WATCH_AFTER_MS); });
  expect(apiMock.post).toHaveBeenCalledTimes(2);
  expect(alreadyReported("u1", "twitch:paula")).toBe(true);
});

test("am geteilten Rechner zählt jede Person für sich", async () => {
  render(<Player watchKey="twitch:paula" />);
  await act(async () => { vi.advanceTimersByTime(WATCH_AFTER_MS); });
  auth.user = { id: "u2" };
  render(<Player watchKey="twitch:paula" />);
  await act(async () => { vi.advanceTimersByTime(WATCH_AFTER_MS); });
  expect(apiMock.post).toHaveBeenCalledTimes(2);
});
