import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Map in einem Schritt sperren (#2207). Erfundene Maps.
const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
let confirmAnswer = true;
const confirmMock = vi.fn(async () => confirmAnswer);
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));

const { PoolMapLock } = await import("./PoolMapLock");

const POOL = { id: "p1", version: 4, modes: [
  { mode: "stellung", label: "Stellung", maps: [{ map_id: "h", name: "Hafenkante" }, { map_id: "t", name: "Turmblick" }] },
  { mode: "suchen", label: "Suchen", maps: [{ map_id: "h", name: "Hafenkante" }] },
] };
const URL = "/admin/leagues/seasons/s1/map-pool/remove-map";

beforeEach(() => {
  apiMock.post.mockReset();
  confirmMock.mockClear();
  confirmAnswer = true;
  Object.values(toastMock).forEach((fn) => fn.mockReset());
  apiMock.post.mockResolvedValue({ data: { pool: { version: 5 }, warnings: ["Stellung braucht mindestens 2 Maps im Pool, hat 1."],
    staffeln: [{ tournament_id: "a", title: "Staffel A", applied: true, notes: [] }, { tournament_id: "b", title: "Staffel B", applied: false, notes: ["Gesperrt."] }] } });
});

test("ohne Grund geht nichts, mit Grund und Rückfrage wird gesperrt und übertragen", async () => {
  const done = vi.fn();
  render(<PoolMapLock endpoint={URL} pool={POOL} onDone={done} />);

  fireEvent.change(screen.getByTestId("pool-lock-map"), { target: { value: "h" } });
  expect(screen.getByTestId("pool-lock-run")).toBeDisabled();
  fireEvent.change(screen.getByTestId("pool-lock-mode"), { target: { value: "suchen" } });
  fireEvent.change(screen.getByTestId("pool-lock-reason"), { target: { value: "Fehler im Spiel" } });
  fireEvent.click(screen.getByTestId("pool-lock-run"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(URL, { map_id: "h", mode: "suchen", reason: "Fehler im Spiel", expected_version: 4 }));
  expect(confirmMock.mock.calls[0][0].title).toBe("„Hafenkante“ aus Suchen sperren?");
  expect(await screen.findByTestId("pool-lock-result")).toHaveTextContent("Staffel A: übertragen");
  expect(screen.getByTestId("pool-lock-result")).toHaveTextContent("Staffel B: nicht übertragen – Gesperrt.");
  expect(toastMock.warning).toHaveBeenCalledWith("Stellung braucht mindestens 2 Maps im Pool, hat 1.");
  expect(done).toHaveBeenCalled();
});

test("aus allen Modi ist die Vorgabe, abbrechen schickt nichts", async () => {
  confirmAnswer = false;
  render(<PoolMapLock endpoint={URL} pool={POOL} />);
  fireEvent.change(screen.getByTestId("pool-lock-map"), { target: { value: "t" } });
  fireEvent.change(screen.getByTestId("pool-lock-reason"), { target: { value: "Vom Hersteller gesperrt" } });
  fireEvent.click(screen.getByTestId("pool-lock-run"));

  await waitFor(() => expect(confirmMock).toHaveBeenCalled());
  expect(confirmMock.mock.calls[0][0].title).toBe("„Turmblick“ sperren?");
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("ohne Pool bleibt der Baustein weg", () => {
  const { container } = render(<PoolMapLock endpoint={URL} pool={null} />);
  expect(container).toBeEmptyDOMElement();
});
