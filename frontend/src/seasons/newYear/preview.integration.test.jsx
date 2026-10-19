import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Silvester-Vorschau aus der Verwaltung (#1838): Token in dieser Sitzung → die Abfrage schickt es mit → der Server
// antwortet mit der Probe-Show → im Admin (sonst still) erscheinen Countdown und Feuerwerks-Ebene. Bei „Bewegung
// reduzieren“ bleibt der Countdown, die Ebene nicht - das ist gewollt, und die Verwaltung sagt es dazu.

const apiMock = { get: vi.fn(), patch: vi.fn() };
let reduced = false;
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/useLiveChanges", () => ({ useReducedMotion: () => reduced }));
vi.mock("../signals", () => ({ recordSignal: () => {} }));

const { SeasonProvider, PREVIEW_STORAGE_KEY } = await import("../SeasonContext");
const { SeasonStage } = await import("../SeasonStage");
const { resetLiveNewYear } = await import("./index.jsx");

const TOKEN = "new_year.9999999999..abc";

function demoPayload() {
  const now = new Date();
  const showStart = new Date(now.getTime() + 15000);
  return {
    now: now.toISOString(), enabled: true, preview: true,
    seasons: [{
      key: "new_year", label: "Silvester", phase: "countdown", intensity: "normal", channels: ["web", "app"],
      texts: { greeting: "Frohes neues Jahr wünscht THE LION SQUAD" }, starts_at: "2026-12-29T18:00:00+01:00", ends_at: "2026-12-29T23:59:59+01:00", forced: true,
      data: { seed: 1, salvos: [1, 2, 4], show_start: showStart.toISOString(), salvo_seconds: [0, 12, 24], new_year: 2027, demo: true },
    }],
  };
}

function startPreview() {
  sessionStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify({ token: TOKEN, expires: Date.now() + 60000 }));
  window.dispatchEvent(new CustomEvent("tls:season-preview"));
}

beforeEach(() => {
  reduced = false;
  sessionStorage.clear();
  localStorage.clear();
  resetLiveNewYear();
  apiMock.get.mockReset();
  apiMock.get.mockImplementation(async (url, options) => {
    if (url === "/seasonal/active") return { data: options?.params?.preview === TOKEN ? demoPayload() : { now: new Date().toISOString(), enabled: true, preview: false, seasons: [] } };
    return { data: {} };
  });
});

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={["/admin/settings/jahreszeiten"]}>
      <SeasonProvider><SeasonStage /></SeasonProvider>
    </MemoryRouter>,
  );
}

test("Vorschau Silvester aus dem Admin: Token geht mit, Countdown und Feuerwerks-Ebene erscheinen", async () => {
  renderAdmin();
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/seasonal/active", { params: {}, skipInvalidation: true }));
  // Ohne Vorschau bleibt der Admin still.
  expect(screen.queryByTestId("season-sky")).toBeNull();
  await act(async () => startPreview());
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/seasonal/active", { params: { preview: TOKEN }, skipInvalidation: true }));
  expect(await screen.findByTestId("new-year-countdown")).toBeTruthy();
  expect(await screen.findByTestId("season-sky")).toBeTruthy();
  expect(document.documentElement.dataset.season).toBe("new_year");
});

test("Vorschau Silvester bei „Bewegung reduzieren“: Countdown ja, Feuerwerks-Ebene nein", async () => {
  reduced = true;
  renderAdmin();
  await act(async () => startPreview());
  expect(await screen.findByTestId("new-year-countdown")).toBeTruthy();
  expect(screen.queryByTestId("season-sky")).toBeNull();
});
