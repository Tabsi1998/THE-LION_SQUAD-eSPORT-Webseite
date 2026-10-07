import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { FeedbackSheet } from "./FeedbackSheet";
import { feedbackTagPrompt, parseFeedbackTarget } from "../lib/feedback";
import { targetFromNotification, targetFromUrl } from "../navigation/rootNavigation";

// Rückmeldung (#1196) in der App: Sterne, Stichworte, ein Satz, „Lieber nicht“ - und die Meldung öffnet Home mit dem
// Bewerten. Erfundene Daten.

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../lib/api", () => ({
  api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
  errorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../seasons/anchors", () => ({ useSeasonOverlay: () => null }));

const OPEN = {
  items: [{ kind: "tournament", target_id: "t-old", title: "Herbst-Cup", question: "Wie war der Herbst-Cup?", day: "2026-10-17" }],
  tags: ["Ablauf", "Zeitplan", "Stimmung", "Technik", "Essen"],
  text_max: 280,
};

beforeEach(() => {
  jest.clearAllMocks();
});

test("Helfer und Wege: Ziel aus der Meldung und aus der Adresse", () => {
  expect(parseFeedbackTarget("event:e-1")).toEqual({ kind: "event", id: "e-1" });
  expect(feedbackTagPrompt(2)).toBe("Was hat gestört?");
  expect(targetFromNotification({ id: "n1", kind: "feedback_request", title: "Wie war …?", meta: { kind: "tournament", target_id: "t-old" } } as never))
    .toEqual({ kind: "tab", tab: "HomeTab", screen: "Dashboard", params: { feedback: "tournament:t-old" } });
  expect(targetFromUrl("/dashboard?bewerten=event:e-1")).toEqual({ kind: "tab", tab: "HomeTab", screen: "Dashboard", params: { feedback: "event:e-1" } });
});

test("Sterne, Stichworte und ein Satz - abschicken erst mit Sternen", async () => {
  mockGet.mockResolvedValue({ data: OPEN });
  mockPost.mockResolvedValue({ data: { ok: true } });
  const onDone = jest.fn();
  await render(<FeedbackSheet target="tournament:t-old" onClose={() => {}} onDone={onDone} />);
  await waitFor(() => expect(screen.getByText("Wie war der Herbst-Cup?")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("feedback-submit"));
  expect(mockPost).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId("feedback-star-5"));
  await fireEvent.press(screen.getByTestId("feedback-tag-Stimmung"));
  await fireEvent.changeText(screen.getByTestId("feedback-text"), "Tolle Stimmung.");
  await fireEvent.press(screen.getByTestId("feedback-submit"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/feedback/tournament/t-old", { stars: 5, tags: ["Stimmung"], text: "Tolle Stimmung." }));
  expect(onDone).toHaveBeenCalledWith("Danke! Das hilft beim nächsten Mal.");
});

test("„Lieber nicht“ und schon erledigt", async () => {
  mockGet.mockResolvedValueOnce({ data: OPEN });
  mockPost.mockResolvedValue({ data: { ok: true } });
  const onDone = jest.fn();
  const view = await render(<FeedbackSheet target="tournament:t-old" onClose={() => {}} onDone={onDone} />);
  await waitFor(() => expect(screen.getByTestId("feedback-decline")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("feedback-decline"));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/feedback/tournament/t-old/decline"));
  expect(onDone).toHaveBeenCalledWith("Alles klar – wir fragen nicht mehr.");
  await view.unmount();
  mockGet.mockResolvedValueOnce({ data: { ...OPEN, items: [] } });
  await render(<FeedbackSheet target="tournament:t-old" onClose={() => {}} onDone={onDone} />);
  await waitFor(() => expect(screen.getByTestId("feedback-missing")).toBeTruthy());
});
