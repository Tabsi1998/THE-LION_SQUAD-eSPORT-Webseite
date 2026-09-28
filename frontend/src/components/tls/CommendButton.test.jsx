import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// GG (#616): nur Beteiligte nach dem Ende sehen den Knopf; einmal gegeben bleibt „GG gegeben“ stehen.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { CommendButton } = await import("./CommendButton");

beforeEach(() => {
  vi.clearAllMocks();
});

test("Beteiligte nach dem Ende können GG geben, danach steht GG gegeben", async () => {
  const user = userEvent.setup();
  apiMock.get.mockResolvedValue({ data: { participant: true, completed: true, can_commend: true, given: false, received: 0 } });
  apiMock.post.mockResolvedValue({ data: { participant: true, completed: true, can_commend: false, given: true, received: 0, already: false } });
  render(<CommendButton matchId="m1" completed />);
  await user.click(await screen.findByTestId("commend-button"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/commend"));
  expect(await screen.findByTestId("commend-given")).toHaveTextContent("GG gegeben");
  expect(toastMock.success).toHaveBeenCalledWith("GG! Danke fürs faire Spiel.");
});

test("Unbeteiligte und laufende Matches sehen nichts", async () => {
  apiMock.get.mockResolvedValue({ data: { participant: false, completed: true, can_commend: false, given: false, received: 0 } });
  const { rerender } = render(<CommendButton matchId="m1" completed />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(screen.queryByTestId("commend-button")).toBeNull();
  apiMock.get.mockClear();
  rerender(<CommendButton matchId="m1" completed={false} />);
  expect(apiMock.get).not.toHaveBeenCalled();
  expect(screen.queryByTestId("commend-button")).toBeNull();
});
