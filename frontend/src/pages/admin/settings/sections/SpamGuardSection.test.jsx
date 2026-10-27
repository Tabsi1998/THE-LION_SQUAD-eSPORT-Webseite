import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Einstellungen → Spamschutz (#2067): Schwellen mit Pflicht-Grund, nur Änderungen gehen zum Server; Turnstile mit
// Secret Key, der nie angezeigt wird, und dem Knopf „Testen“.

const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { SpamGuardSection } = await import("./SpamGuardSection");

const CONFIG = {
  enabled: true, min_seconds: 3, max_age_minutes: 120, token_max_uses: 5, suspect_score: 5, random_min_length: 12, gmail_dots_min: 3,
  links_min: 3, peak_per_hour: 30, weights: { random_text: 6, gmail_dots: 2, links: 3, spam_words: 3, word_filter_hold: 3, word_filter_flag: 1 },
  spam_words: ["casino", "viagra"],
  limits: { contact: { ip_limit: 5, ip_window_minutes: 15, email_limit: 5, email_window_minutes: 60 } },
};

function view(turnstile = {}) {
  return {
    config: CONFIG,
    bounds: { numbers: { min_seconds: { min: 0, max: 60 } }, weights: { min: 0, max: 50 }, limits: { ip_limit: { min: 1, max: 1000 } } },
    forms: [{ key: "contact", label: "Kontaktformular", turnstile: true, limits: true }, { key: "register", label: "Registrierung", turnstile: true, limits: false }],
    turnstile: {
      enabled: false, ready: false, mode: "always", modes: [{ key: "always", label: "Immer" }, { key: "suspect", label: "Nur bei Verdacht" }],
      site_key: "", forms: { contact: true, register: true }, secret: { state: "missing" }, last_test: null,
      sample_percent: 10, sample_bounds: { min: 0, max: 100 }, ...turnstile,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (url) => (url === "/spam-guard/stats"
    ? { data: { today: { caught: 2 }, week: { caught: 9 }, quote_week: 40, peak_24h: { count: 0 } } }
    : { data: view() }));
});

test("speichert nur Änderungen und nur mit Grund", async () => {
  apiMock.put.mockResolvedValue({ data: { ...view(), config: { ...CONFIG, min_seconds: 5 } } });
  const user = userEvent.setup();
  render(<SpamGuardSection />);
  expect(await screen.findByTestId("spam-guard-stats")).toHaveTextContent("2 abgefangen heute");
  const minSeconds = screen.getByTestId("spam-guard-min_seconds");
  expect(minSeconds).toHaveValue(3);
  await user.clear(minSeconds);
  await user.type(minSeconds, "5");
  await user.click(screen.getByTestId("spam-guard-save"));
  expect(toastMock.error).toHaveBeenCalledWith("Bitte einen Grund angeben.");
  expect(apiMock.put).not.toHaveBeenCalled();
  await user.type(screen.getByTestId("spam-guard-reason"), "Bots werden schneller");
  await user.click(screen.getByTestId("spam-guard-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/spam-guard/settings", { changes: { min_seconds: 5 }, reason: "Bots werden schneller" }));
});

test("Turnstile: Secret Key nie vorbelegt, zuerst gespeichert, dann einschalten; Testen meldet das Ergebnis", async () => {
  apiMock.put.mockImplementation(async (url) => ({ data: url.endsWith("/secret") ? view({ secret: { state: "ok" } }) : view({ enabled: true, site_key: "0x4AAAAAAAoeffentlich", secret: { state: "ok" } }) }));
  apiMock.post.mockResolvedValue({ data: { ok: true, detail: "Verbindung steht, der Secret Key wird angenommen." } });
  const user = userEvent.setup();
  render(<SpamGuardSection />);
  const secret = await screen.findByTestId("turnstile-secret");
  expect(secret).toHaveValue("");
  expect(secret).toHaveAttribute("type", "password");
  expect(screen.getByTestId("turnstile-test")).toBeDisabled();
  await user.click(screen.getByTestId("turnstile-enabled"));
  await user.type(screen.getByTestId("turnstile-site-key"), "0x4AAAAAAAoeffentlich");
  await user.type(secret, "0x4AAAAAAAgeheim");
  await user.type(screen.getByTestId("turnstile-reason"), "Turnstile einschalten");
  await user.click(screen.getByTestId("turnstile-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledTimes(2));
  expect(apiMock.put.mock.calls[0]).toEqual(["/spam-guard/turnstile/secret", { secret: "0x4AAAAAAAgeheim", reason: "Turnstile einschalten" }]);
  expect(apiMock.put.mock.calls[1]).toEqual(["/spam-guard/turnstile", { enabled: true, site_key: "0x4AAAAAAAoeffentlich", reason: "Turnstile einschalten" }]);
  await waitFor(() => expect(screen.getByTestId("turnstile-secret")).toHaveValue(""));
  await user.click(screen.getByTestId("turnstile-test"));
  expect(await screen.findByTestId("turnstile-test-result")).toHaveTextContent("Verbindung steht");
});

test("„Nur bei Verdacht“ warnt und fragt den Zufallsanteil ab", async () => {
  apiMock.put.mockResolvedValue({ data: view({ mode: "suspect", sample_percent: 20 }) });
  const user = userEvent.setup();
  render(<SpamGuardSection />);
  const mode = await screen.findByTestId("turnstile-mode");
  expect(screen.queryByTestId("turnstile-suspect-warning")).toBeNull();
  await user.selectOptions(mode, "suspect");
  expect(screen.getByTestId("turnstile-suspect-warning")).toHaveTextContent("Bots können");
  const sample = screen.getByTestId("turnstile-sample-percent");
  await user.clear(sample);
  await user.type(sample, "20");
  await user.type(screen.getByTestId("turnstile-reason"), "weniger Rückfragen");
  await user.click(screen.getByTestId("turnstile-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/spam-guard/turnstile", { mode: "suspect", sample_percent: 20, reason: "weniger Rückfragen" }));
});
