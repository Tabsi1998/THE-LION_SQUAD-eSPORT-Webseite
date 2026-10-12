import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// „Stimmt“ direkt in der Glocke (#1159): die Meldung der Gegenseite mit einem Klick bestätigen. Namen sind erfunden.

const apiMock = { post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (value) => value }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { NotificationRow } = await import("./NotificationRow");

const RESULTS = [{ registration_id: "r1", rank: 1, score: 2 }, { registration_id: "r2", rank: 2, score: 1 }];
const bundle = {
  id: "n1", kind: "match_report", title: "Ergebnis gemeldet – bitte bestätigen", body: "Frostbiss meldet 2:1 für dich. Stimmt das?",
  created_at: "2026-10-10T18:00:00Z", read: false, count: 1, target: "/matches/m1", meta: { match_id: "m1", confirm_results: RESULTS },
};

test("ein Klick auf „Stimmt“ schickt dieselbe Meldung und markiert gelesen", async () => {
  apiMock.post.mockResolvedValue({ data: { awaiting_confirmation: false } });
  const opened = vi.fn();
  render(<MemoryRouter><NotificationRow bundle={bundle} onOpen={opened} /></MemoryRouter>);
  await act(async () => { fireEvent.click(screen.getByTestId("notification-row-confirm-n1")); });
  expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/report", { results: RESULTS, screenshot_url: null, note: null });
  expect(opened).toHaveBeenCalledWith(bundle);
});

test("ohne Meldung, schon gelesen oder andere Art: kein Knopf", () => {
  render(<MemoryRouter><NotificationRow bundle={{ ...bundle, read: true }} /></MemoryRouter>);
  expect(screen.queryByTestId("notification-row-confirm-n1")).toBeNull();
});
