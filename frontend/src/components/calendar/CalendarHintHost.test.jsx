import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Der Abo-Hinweis nach einer Anmeldung (#1788): der Server sagt, ob er fällig ist (nur ohne Abo, nur einmal); erscheint
// er, meldet der Host „gesehen“. Schließen, „Nicht jetzt“ und Escape blenden ihn aus, „Einmal abonnieren“ führt zum Abo.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const { CalendarHintHost } = await import("./CalendarHintHost");
const { offerCalendarHint } = await import("@/lib/calendarHint");

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { due: false } });
});

function renderHost() {
  render(<MemoryRouter><CalendarHintHost /></MemoryRouter>);
}

test("fällig: erscheint einmal, wird am Server gemerkt und führt zum Abo", async () => {
  apiMock.get.mockResolvedValue({ data: { due: true } });
  renderHost();
  expect(screen.queryByTestId("calendar-hint")).toBeNull();
  await act(async () => { expect(await offerCalendarHint()).toBe(true); });
  expect(apiMock.get).toHaveBeenCalledWith("/calendar/hint");
  const hint = screen.getByTestId("calendar-hint");
  expect(hint).toHaveTextContent("Deine Termine automatisch im Kalender?");
  expect(hint.className).toContain("tls-cal-hint");
  expect(apiMock.post).toHaveBeenCalledWith("/calendar/hint");
  expect(screen.getByTestId("calendar-hint-go")).toHaveAttribute("href", "/calendar/mine#abo");
  await userEvent.click(screen.getByTestId("calendar-hint-go"));
  expect(screen.queryByTestId("calendar-hint")).toBeNull();
});

test("nicht fällig (Abo aktiv oder schon gesehen) oder Fehler: nichts", async () => {
  renderHost();
  apiMock.get.mockResolvedValue({ data: { due: false } });
  await act(async () => { expect(await offerCalendarHint()).toBe(false); });
  apiMock.get.mockRejectedValue(new Error("offline"));
  await act(async () => { expect(await offerCalendarHint()).toBe(false); });
  expect(screen.queryByTestId("calendar-hint")).toBeNull();
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("wegklicken: Schließen, Nicht jetzt und Escape", async () => {
  apiMock.get.mockResolvedValue({ data: { due: true } });
  renderHost();
  for (const close of [() => userEvent.click(screen.getByTestId("calendar-hint-close")), () => userEvent.click(screen.getByTestId("calendar-hint-later")), () => userEvent.keyboard("{Escape}")]) {
    await act(async () => { await offerCalendarHint(); });
    expect(screen.getByTestId("calendar-hint")).toBeInTheDocument();
    await close();
    expect(screen.queryByTestId("calendar-hint")).toBeNull();
  }
});
