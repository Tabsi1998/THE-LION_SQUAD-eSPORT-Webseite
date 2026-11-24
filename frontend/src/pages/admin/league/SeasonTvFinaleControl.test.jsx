import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Saisonfinale am TV (#1641): Weiter blättert je Liga N, Ende bringt das gewohnte Bild zurück; ohne Recht nur der Stand, und warum der
// TV gegebenenfalls nichts zeigt.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const live = { callback: null, resources: null, options: null };
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (callback, resources, options) => { live.callback = callback; live.resources = resources; live.options = options; } }));

const { SeasonTvFinaleControl, finaleStatus } = await import("./SeasonTvFinaleControl");

const STATE = { step: 0, count: 2, labels: ["Liga 1", "Liga 2"], closed: 2, reason: null };

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
});

test("Weiter und Ende schalten den TV, auf der letzten Liga N bleibt nur Ende", async () => {
  apiMock.get.mockResolvedValue({ data: STATE });
  apiMock.post.mockImplementation(async (_url, body) => ({ data: { ...STATE, step: body.action === "end" ? 0 : 2 } }));
  render(<SeasonTvFinaleControl seasonId="s1" canSteer />);
  expect(await screen.findByTestId("tv-finale-status")).toHaveTextContent("gewohnte Bild");
  expect(screen.getByTestId("tv-finale-end")).toBeDisabled();
  fireEvent.click(screen.getByTestId("tv-finale-next"));
  // „Weiter“ schickt den Stand mit, den dieses Fenster zeigt (zwei Leitungs-Tabs).
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/tv-finale", { action: "next", from_step: 0 }));
  expect(await screen.findByTestId("tv-finale-status")).toHaveTextContent("Der TV zeigt Liga 2 (2 von 2).");
  expect(screen.getByTestId("tv-finale-next")).toBeDisabled();
  expect(screen.getByTestId("tv-finale-last")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("tv-finale-end"));
  await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith("/admin/leagues/seasons/s1/tv-finale", { action: "end" }));
  expect(await screen.findByTestId("tv-finale-status")).toHaveTextContent("gewohnte Bild");
});

test("ohne Recht nur der Stand; nicht öffentlich: kein Weiter", async () => {
  apiMock.get.mockResolvedValue({ data: { ...STATE, reason: "season_hidden", step: 0 } });
  render(<SeasonTvFinaleControl seasonId="s1" />);
  expect(await screen.findByTestId("tv-finale-status")).toHaveTextContent("nur bei öffentlichen Seasons");
  expect(screen.getByTestId("tv-finale-readonly")).toBeInTheDocument();
  expect(screen.queryByTestId("tv-finale-next")).toBeNull();
});

test("Fehler des Servers am Kasten", async () => {
  apiMock.get.mockResolvedValue({ data: STATE });
  apiMock.post.mockRejectedValue({ response: { data: { detail: "Dafür fehlt dir in dieser Liga die Zuständigkeit." } } });
  render(<SeasonTvFinaleControl seasonId="s1" canSteer />);
  fireEvent.click(await screen.findByTestId("tv-finale-next"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Zuständigkeit");
});

test("finaleStatus: Gründe und Stand in einem Satz", () => {
  expect(finaleStatus({ ...STATE, reason: "no_movers" })).toContain("niemand auf oder ab");
  expect(finaleStatus({ ...STATE, reason: "none_closed" })).toContain("Noch keine Staffel");
  expect(finaleStatus({ ...STATE, step: 1 })).toBe("Der TV zeigt Liga 1 (1 von 2).");
});

test("zwei Leitungs-Fenster: hat ein anderes schon weitergeschaltet (409), lädt dieses den Stand neu und sagt es", async () => {
  apiMock.get.mockResolvedValueOnce({ data: STATE }).mockResolvedValue({ data: { ...STATE, step: 1 } });
  apiMock.post.mockRejectedValue({ response: { status: 409, data: { detail: "Der Stand hat sich geändert – neu geladen." } } });
  render(<SeasonTvFinaleControl seasonId="s1" canSteer />);
  fireEvent.click(await screen.findByTestId("tv-finale-next"));
  expect(await screen.findByTestId("tv-finale-status")).toHaveTextContent("Der TV zeigt Liga 1 (1 von 2).");
  expect(apiMock.get).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("tv-finale-stale")).toHaveTextContent("Der Stand hat sich geändert – neu geladen.");
  expect(screen.queryByTestId("tv-finale-error")).toBeNull();
});

test("K-b: der Kasten lädt live nach - schließt während des Finales eine Liga N ab, steht sie ohne Klick in der Reihenfolge", async () => {
  apiMock.get.mockResolvedValueOnce({ data: { ...STATE, step: 1 } });
  render(<SeasonTvFinaleControl seasonId="s1" canSteer />);
  expect(await screen.findByTestId("tv-finale-status")).toHaveTextContent("Der TV zeigt Liga 1 (1 von 2).");
  expect(live.callback).toBeTypeOf("function");
  expect(live.resources).toContain("tournaments");
  expect(live.options.fallbackMs).toBeGreaterThan(0);
  apiMock.get.mockResolvedValueOnce({ data: { ...STATE, step: 2, count: 3, labels: ["Liga 1", "Liga 2", "Liga 3"] } });
  await live.callback();
  expect(await screen.findByTestId("tv-finale-status")).toHaveTextContent("Der TV zeigt Liga 2 (2 von 3).");
});
