import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { averageLabel, feedbackTagPrompt, parseFeedbackTarget } from "@/lib/feedback";

// Rückmeldung (#1196): ein bis fünf Sterne, Stichworte, ein Satz - „Lieber nicht“ beendet die Frage. Und die
// Auswertung der Verwaltung: ohne Namen, Einzelheiten erst ab drei. Erfundene Daten.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { FeedbackDialog } = await import("./FeedbackDialog");
const { FeedbackReport } = await import("@/pages/admin/feedback/FeedbackReport");

const OPEN = {
  items: [{ kind: "tournament", target_id: "t-old", title: "Herbst-Cup", question: "Wie war der Herbst-Cup?", day: "2026-10-17" }],
  tags: ["Ablauf", "Zeitplan", "Stimmung", "Technik", "Essen"],
  text_max: 280,
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
});

test("Helfer: Ziel aus der Adresse, Stichwort-Frage je nach Sternen, Schnitt mit Komma", () => {
  expect(parseFeedbackTarget("tournament:t-old")).toEqual({ kind: "tournament", id: "t-old" });
  expect(parseFeedbackTarget("event:e-1")).toEqual({ kind: "event", id: "e-1" });
  expect(parseFeedbackTarget("news:x")).toBeNull();
  expect(feedbackTagPrompt(0)).toBe("Was war gut?");
  expect(feedbackTagPrompt(5)).toBe("Was war gut?");
  expect(feedbackTagPrompt(2)).toBe("Was hat gestört?");
  expect(averageLabel(3.7)).toBe("3,7");
});

test("Sterne, Stichworte und ein Satz - abschicken erst mit Sternen", async () => {
  apiMock.get.mockResolvedValue({ data: OPEN });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  const onDone = vi.fn();
  render(<FeedbackDialog target="tournament:t-old" onClose={() => {}} onDone={onDone} />);
  expect(await screen.findByText("Wie war der Herbst-Cup?")).toBeInTheDocument();
  expect(screen.getByText(/Das sieht nur der Verein/)).toBeInTheDocument();
  expect(screen.getByTestId("feedback-submit")).toBeDisabled();
  fireEvent.click(screen.getByTestId("feedback-star-2"));
  expect(screen.getByText("Was hat gestört?")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("feedback-star-4"));
  expect(screen.getByText("Was war gut?")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("feedback-tag-Ablauf"));
  fireEvent.click(screen.getByTestId("feedback-tag-Stimmung"));
  fireEvent.click(screen.getByTestId("feedback-tag-Ablauf"));
  fireEvent.change(screen.getByTestId("feedback-text"), { target: { value: "Schnelle Aufrufe." } });
  fireEvent.click(screen.getByTestId("feedback-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/feedback/tournament/t-old", { stars: 4, tags: ["Stimmung"], text: "Schnelle Aufrufe." }));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
});

test("„Lieber nicht“ beendet die Frage; schon erledigt sagt der Dialog", async () => {
  apiMock.get.mockResolvedValueOnce({ data: OPEN });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  const { unmount } = render(<FeedbackDialog target="tournament:t-old" onClose={() => {}} onDone={() => {}} />);
  fireEvent.click(await screen.findByTestId("feedback-decline"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/feedback/tournament/t-old/decline"));
  unmount();
  apiMock.get.mockResolvedValueOnce({ data: { ...OPEN, items: [] } });
  render(<FeedbackDialog target="tournament:t-old" onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByTestId("feedback-missing")).toBeInTheDocument();
});

test("Auswertung: unter drei nur die Zahl, ab drei Schnitt, Stichworte und Sätze - ohne Namen", async () => {
  apiMock.get.mockResolvedValueOnce({ data: { title: "Herbst-Cup", count: 2, declined: 0, min_for_details: 3, details: false } });
  const { unmount } = render(<FeedbackReport kind="tournament" targetId="t-old" />);
  expect(await screen.findByTestId("feedback-report-few")).toHaveTextContent("Erst 2 Rückmeldungen. Schnitt, Stichworte und Sätze erscheinen ab 3");
  expect(screen.queryByTestId("feedback-report-average")).toBeNull();
  unmount();
  apiMock.get.mockResolvedValueOnce({ data: {
    title: "Herbst-Cup", count: 3, declined: 1, min_for_details: 3, details: true, average: 3.7,
    distribution: { 1: 0, 2: 1, 3: 0, 4: 1, 5: 1 }, praised: { Ablauf: 2 }, criticised: { Zeitplan: 1 },
    texts: [{ text: "Top organisiert", stars: 5 }, { text: "Zu lange Pausen", stars: 2 }],
  } });
  render(<FeedbackReport kind="tournament" targetId="t-old" />);
  expect(await screen.findByTestId("feedback-report-average")).toHaveTextContent("3,7");
  expect(screen.getByText("1 wollten lieber nicht")).toBeInTheDocument();
  expect(screen.getByTestId("feedback-report-texts")).toHaveTextContent("Top organisiert");
  expect(apiMock.get).toHaveBeenLastCalledWith("/admin/feedback/tournament/t-old");
});
