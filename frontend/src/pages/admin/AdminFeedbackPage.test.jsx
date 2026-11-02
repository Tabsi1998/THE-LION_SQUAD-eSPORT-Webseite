import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Alle Rückmeldungen auf einen Blick (#2131): Zahl und Schnitt je Veranstaltung, unter drei Antworten nur die Zahl.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));

const { default: AdminFeedbackPage } = await import("./AdminFeedbackPage");

const OVERVIEW = {
  min_for_details: 3, total: 2,
  summary: { targets: 2, answers: 7, average: 4.2 },
  items: [
    { kind: "tournament", target_id: "t1", title: "Winter Cup", day: "2026-10-20", count: 5, declined: 1, details: true, average: 4.2 },
    { kind: "event", target_id: "e1", title: "Herbst-LAN", day: "2026-10-01", count: 2, declined: 0, details: false, average: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (url) => (url === "/admin/feedback/overview" ? { data: OVERVIEW } : { data: { title: "Winter Cup", count: 5, details: true, average: 4.2, distribution: {}, praised: {}, criticised: {}, texts: [] } }));
});

test("Schnitt und Zahl je Veranstaltung, unter drei Antworten nur die Zahl", async () => {
  render(<AdminFeedbackPage />);
  expect(await screen.findByTestId("feedback-overview-average")).toHaveTextContent("4,2");
  expect(screen.getByTestId("feedback-overview-answers")).toHaveTextContent("7");
  expect(screen.getByTestId("feedback-average-t1")).toHaveTextContent("4,2");
  expect(screen.getByTestId("feedback-row-t1")).toHaveTextContent("1 wollten nichts sagen");
  expect(screen.getByTestId("feedback-few-e1")).toHaveTextContent("zu wenige");
  expect(screen.queryByTestId("feedback-open-e1")).toBeNull();
  expect(screen.getByTestId("feedback-row-e1")).toHaveTextContent("2 Antworten");
});

test("die Auswertung klappt auf, der Filter fragt den Server", async () => {
  const user = userEvent.setup();
  render(<AdminFeedbackPage />);
  await user.click(await screen.findByTestId("feedback-open-t1"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/feedback/tournament/t1"));
  await user.click(screen.getByTestId("feedback-filter-event"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/feedback/overview", { params: { kind: "event" } }));
});

test("ohne Antworten steht das auch da", async () => {
  apiMock.get.mockResolvedValue({ data: { items: [], total: 0, min_for_details: 3, summary: { targets: 0, answers: 0, average: null } } });
  render(<AdminFeedbackPage />);
  expect(await screen.findByTestId("feedback-overview-empty")).toHaveTextContent("Noch keine Rückmeldungen");
  expect(screen.getByTestId("feedback-overview-average")).toHaveTextContent("–");
});

test("scheitert das Laden, sagt die Seite es", async () => {
  apiMock.get.mockRejectedValue(new Error("kaputt"));
  render(<AdminFeedbackPage />);
  expect(await screen.findByTestId("feedback-overview-error")).toHaveTextContent("konnten nicht geladen werden");
});
