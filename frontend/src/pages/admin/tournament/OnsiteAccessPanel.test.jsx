import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Vor-Ort-Zugang (#1592): an/aus, erneuern, Zeitfenster - der Code selbst steht nur auf dem Aushang.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
let confirmAnswer = true;
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => confirmAnswer }));

const { OnsiteAccessPanel, OnsiteMark } = await import("./OnsiteAccessPanel");

const STATE = {
  enabled: true, default: true, explicit: null, open_now: true,
  window: { from: "2026-10-31T08:00:00+00:00", until: "2026-10-31T20:00:00+00:00" }, path: "/vor-ort#geheimer-code",
};

const renderPanel = () => render(<MemoryRouter><OnsiteAccessPanel tournamentId="t1" /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  confirmAnswer = true;
  apiMock.get.mockResolvedValue({ data: STATE });
});

test("zeigt Zustand und Zeitfenster, aber nie den Code", async () => {
  renderPanel();
  const state = await screen.findByTestId("onsite-access-state");
  expect(state).toHaveTextContent("An");
  expect(state).toHaveTextContent("gilt gerade");
  expect(screen.getByTestId("onsite-access-window")).toHaveTextContent("31.10.");
  expect(document.body).not.toHaveTextContent("geheimer-code");
  expect(screen.getByTestId("onsite-access-poster")).toHaveAttribute("href", "/admin/tournaments/t1/aushang");
});

test("abschalten schreibt die Einstellung", async () => {
  const user = userEvent.setup();
  apiMock.put.mockResolvedValue({ data: { ...STATE, enabled: false, explicit: false, open_now: false } });
  renderPanel();
  await user.click(await screen.findByTestId("onsite-access-toggle"));
  expect(apiMock.put).toHaveBeenCalledWith("/tournaments/t1/onsite-access", { enabled: false });
  await waitFor(() => expect(screen.getByTestId("onsite-access-state")).toHaveTextContent("Aus"));
});

test("erneuern nur nach Rückfrage", async () => {
  const user = userEvent.setup();
  confirmAnswer = false;
  renderPanel();
  await user.click(await screen.findByTestId("onsite-access-renew"));
  expect(apiMock.post).not.toHaveBeenCalled();
  confirmAnswer = true;
  apiMock.post.mockResolvedValue({ data: STATE });
  await user.click(screen.getByTestId("onsite-access-renew"));
  expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/onsite-access/renew");
});

test("Teilnehmerliste: Anmeldungen über den Vor-Ort-Zugang sind gekennzeichnet", () => {
  const { rerender } = render(<OnsiteMark via="onsite" />);
  expect(screen.getByTestId("onsite-mark")).toHaveTextContent("Vor Ort");
  rerender(<OnsiteMark via="web" />);
  expect(screen.queryByTestId("onsite-mark")).toBeNull();
});
