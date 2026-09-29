import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Jahreszeiten-Bühne (#634): Stärke wird nur leiser, nie lauter; Vorschau-Token aus dieser Sitzung geht
// mit; die persönliche Wahl kommt aus dem Konto oder dem Browser und wird angemeldet gespeichert.

const apiMock = { get: vi.fn(), patch: vi.fn() };
const authState = { user: null };
let reduced = false;
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/useLiveChanges", () => ({ useReducedMotion: () => reduced }));

const { SeasonProvider, useSeason, effectiveIntensity, refreshDelayFor, PREVIEW_STORAGE_KEY, PREFERENCE_STORAGE_KEY, REFRESH_MS, FAST_REFRESH_MS } = await import("./SeasonContext");

function Probe() {
  const { seasons, preference, setPreference, ready, preview, scaresAllowed } = useSeason();
  return (
    <div>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="preview">{String(preview)}</span>
      <span data-testid="scares">{String(scaresAllowed)}</span>
      <span data-testid="keys">{seasons.map((s) => `${s.key}:${s.effective}`).join(",")}</span>
      <span data-testid="pref">{preference}</span>
      <button type="button" onClick={() => setPreference("subtle")}>dezent</button>
    </div>
  );
}

const PAYLOAD = { now: "2026-10-28T12:00:00+01:00", enabled: true, preview: false, seasons: [
  { key: "halloween", phase: "deko", intensity: "full", channels: ["web", "app"], texts: {}, data: { night: false }, starts_at: "", ends_at: "" },
  { key: "snow", phase: "schnee", intensity: "normal", channels: ["app"], texts: {}, data: {}, starts_at: "", ends_at: "" },
] };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  authState.user = null;
  reduced = false;
  apiMock.get.mockResolvedValue({ data: PAYLOAD });
  apiMock.patch.mockResolvedValue({ data: {} });
});

test("Stärke: Person und System machen nur leiser", () => {
  const season = { intensity: "full" };
  expect(effectiveIntensity(season, "on", false)).toBe("full");
  expect(effectiveIntensity(season, "on", true)).toBe("subtle");
  expect(effectiveIntensity(season, "subtle", false)).toBe("subtle");
  expect(effectiveIntensity(season, "off", false)).toBe("off");
  expect(effectiveIntensity({ intensity: "subtle" }, "on", false)).toBe("subtle");
});

test("Nachfrage-Takt: zehn Minuten, um Mitternacht am 31.12. alle 30 Sekunden", () => {
  expect(refreshDelayFor([])).toBe(REFRESH_MS);
  expect(refreshDelayFor([{ key: "new_year", phase: "countdown" }])).toBe(FAST_REFRESH_MS);
  expect(refreshDelayFor([{ key: "new_year", phase: "show" }])).toBe(FAST_REFRESH_MS);
  const soon = new Date(Date.now() + 60_000).toISOString();
  const delay = refreshDelayFor([{ key: "new_year", phase: "evening_31", ends_at: soon }]);
  expect(delay).toBeGreaterThanOrEqual(FAST_REFRESH_MS);
  expect(delay).toBeLessThanOrEqual(62_000);
});

test("nur Saisonen des eigenen Kanals, Stärke nach Wahl, Wahl aus dem Browser", async () => {
  localStorage.setItem(PREFERENCE_STORAGE_KEY, "subtle");
  render(<MemoryRouter><SeasonProvider><Probe /></SeasonProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));
  expect(apiMock.get).toHaveBeenCalledWith("/seasonal/active", { params: {}, skipInvalidation: true });
  expect(screen.getByTestId("keys")).toHaveTextContent("halloween:subtle");
  expect(screen.getByTestId("pref")).toHaveTextContent("subtle");
});

test("Bewegung reduzieren macht alles dezent; angemeldet zählt das Konto und die Wahl wird gespeichert", async () => {
  reduced = true;
  authState.user = { id: "u1", seasonal_decorations: "on" };
  const user = userEvent.setup();
  render(<MemoryRouter><SeasonProvider><Probe /></SeasonProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("keys")).toHaveTextContent("halloween:subtle"));
  expect(screen.getByTestId("pref")).toHaveTextContent("on");
  await user.click(screen.getByText("dezent"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/users/me", { seasonal_decorations: "subtle" }));
  expect(localStorage.getItem(PREFERENCE_STORAGE_KEY)).toBe("subtle");
});

test("Vorschau-Token aus dieser Sitzung geht mit, abgelaufene werden verworfen", async () => {
  sessionStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify({ token: "halloween.1.2.abc", expires: Date.now() + 30_000 }));
  apiMock.get.mockResolvedValue({ data: { ...PAYLOAD, preview: true } });
  render(<MemoryRouter><SeasonProvider><Probe /></SeasonProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("preview")).toHaveTextContent("true"));
  expect(apiMock.get).toHaveBeenCalledWith("/seasonal/active", { params: { preview: "halloween.1.2.abc" }, skipInvalidation: true });
  sessionStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify({ token: "alt", expires: Date.now() - 1 }));
  apiMock.get.mockClear();
  render(<MemoryRouter><SeasonProvider><Probe /></SeasonProvider></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/seasonal/active", { params: {}, skipInvalidation: true }));
  expect(sessionStorage.getItem(PREVIEW_STORAGE_KEY)).toBeNull();
});

test("Serverfehler: die Seite läuft ohne Deko weiter", async () => {
  apiMock.get.mockRejectedValue(new Error("down"));
  render(<MemoryRouter><SeasonProvider><Probe /></SeasonProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));
  expect(screen.getByTestId("keys")).toHaveTextContent("");
});

test("Jumpscares (#680): ob jemand welche bekommen darf, fragt der Client nur angemeldet beim Server nach", async () => {
  render(<MemoryRouter><SeasonProvider><Probe /></SeasonProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));
  expect(screen.getByTestId("scares")).toHaveTextContent("false");
  expect(apiMock.get.mock.calls.some(([url]) => url === "/seasonal/me")).toBe(false);
  authState.user = { id: "u-18", seasonal_decorations: "on" };
  apiMock.get.mockImplementation(async (url) => (url === "/seasonal/me" ? { data: { scares_allowed: true } } : { data: PAYLOAD }));
  render(<MemoryRouter><SeasonProvider><Probe /></SeasonProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getAllByTestId("scares")[1]).toHaveTextContent("true"));
  expect(apiMock.get).toHaveBeenCalledWith("/seasonal/me", { skipInvalidation: true });
});
