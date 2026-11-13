import { render, waitFor } from "@testing-library/react";

// Persönliches Kalender-Abo (#937): der Stand wird einmal geladen und an den aktuellen Rückruf der Seite gemeldet -
// auch wenn die Seite ihn inzwischen neu gesetzt hat.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "" }));

const { PersonalFeedCard } = await import("./PersonalFeedCard");

test("der geladene Stand geht an den aktuellen Rückruf, geladen wird nur einmal", async () => {
  let answer;
  apiMock.get.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  const first = vi.fn();
  const latest = vi.fn();
  const { rerender } = render(<PersonalFeedCard origin="https://example.test" onStatus={first} />);
  rerender(<PersonalFeedCard origin="https://example.test" onStatus={latest} />);
  answer({ data: { active: true, created_at: "2026-11-01T10:00:00Z", last_used_at: null } });
  await waitFor(() => expect(latest).toHaveBeenCalledWith({ active: true, created_at: "2026-11-01T10:00:00Z", last_used_at: null }));
  expect(first).not.toHaveBeenCalled();
  expect(apiMock.get).toHaveBeenCalledTimes(1);
});
