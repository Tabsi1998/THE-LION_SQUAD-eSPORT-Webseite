import { act, render, screen, waitFor } from "@testing-library/react";

// Hinweis der Turnierleitung (#1166): das Banner zeigt Text und Zeit, nie eine Person, den neuesten zuerst - und
// verschwindet von selbst, sobald der Hinweis abläuft.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API_BASE: "", formatApiError: (value) => value }));
const live = { options: null };
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (_load, _resources, options) => { live.options = options; } }));
const { NoticeBanner, useNotices } = await import("./NoticeBanner");

const NOW = Date.parse("2026-11-14T13:07:00Z");
const notice = (id, text, created, expires, extra = {}) => ({ id, text, created_at: created, expires_at: expires, target: "tournament", tv: false, ...extra });

afterEach(() => {
  vi.useRealTimers();
  apiMock.get.mockReset();
});

it("zeigt Text, Uhrzeit und Restzeit - ohne Person", () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
  render(<NoticeBanner items={[
    notice("a", "Bitte zum Check-in", "2026-11-14T12:30:00Z", "2026-11-14T14:30:00Z"),
    notice("b", "Pause bis 14:30", "2026-11-14T13:00:00Z", "2026-11-14T15:00:00Z", { author: "Schiri Sam" }),
  ]} />);
  const texts = screen.getAllByTestId("notice-text").map((node) => node.textContent);
  expect(texts).toEqual(["Pause bis 14:30", "Bitte zum Check-in"]);
  expect(screen.getAllByTestId("notice-meta")[0].textContent).toBe("14:00 Uhr · noch 1 Std. 53 Min.");
  expect(screen.getByTestId("notice-banner")).toHaveAttribute("role", "status");
  expect(screen.queryByText(/Schiri Sam/)).toBeNull();
});

it("verschwindet, sobald der Hinweis abläuft", () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
  render(<NoticeBanner items={[notice("a", "Finale an PC 1", "2026-11-14T13:00:00Z", "2026-11-14T13:08:00Z")]} />);
  expect(screen.getByTestId("notice-a")).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(61000); });
  expect(screen.queryByTestId("notice-a")).toBeNull();
  act(() => { vi.advanceTimersByTime(400); });
  expect(screen.queryByTestId("notice-banner")).toBeNull();
});

it("zeigt nichts ohne stehenden Hinweis", () => {
  const { container } = render(<NoticeBanner items={[notice("x", "Alt", "2020-01-01T10:00:00Z", "2020-01-01T12:00:00Z")]} />);
  expect(container).toBeEmptyDOMElement();
});

it("nennt auf der Event-Seite das Turnier eines Turnier-Hinweises", () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  render(<NoticeBanner showTournament items={[notice("t", "Finale an PC 1", "2026-11-14T13:00:00Z", "2026-11-14T15:00:00Z", { tournament_title: "Kart-Cup" })]} />);
  expect(screen.getByText(/Kart-Cup/)).toBeInTheDocument();
});

it("lädt die Hinweise über den Pfad und hält still, wenn das nicht klappt", async () => {
  apiMock.get.mockResolvedValueOnce({ data: { items: [notice("a", "Pause bis 14:30", new Date().toISOString(), new Date(Date.now() + 3600000).toISOString())] } });
  function Probe({ path }) {
    return <NoticeBanner items={useNotices(path)} />;
  }
  const { rerender } = render(<Probe path="/tournaments/t1/notices" />);
  await waitFor(() => expect(screen.getByText("Pause bis 14:30")).toBeInTheDocument());
  expect(apiMock.get).toHaveBeenCalledWith("/tournaments/t1/notices");
  apiMock.get.mockRejectedValueOnce(new Error("offline"));
  rerender(<Probe path="/tournaments/t2/notices" />);
  await waitFor(() => expect(screen.queryByText("Pause bis 14:30")).toBeNull());
});

it("lädt auch nach, wenn ein anderes Turnier desselben Events einen Hinweis ans ganze Event schreibt (Review M2)", () => {
  apiMock.get.mockResolvedValue({ data: { items: [] } });
  function Probe() {
    return <NoticeBanner items={useNotices("/tournaments/t1/notices", { tournamentId: "t1", eventId: "e1" })} />;
  }
  render(<Probe />);
  expect(live.options).toEqual(expect.objectContaining({ tournamentId: "t1", eventId: "e1", wholeEvent: true }));
});
