import { act, render, renderHook, screen, waitFor } from "@testing-library/react";

// Spamschutz (#2067): Token beim Laden holen, nie zu früh senden, abgelaufene Token neu holen, Turnstile nur bei Bedarf.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const { useSpamGuard } = await import("./useSpamGuard");
const { SpamGuardFields } = await import("@/components/tls/SpamGuardFields");

function token(overrides = {}) {
  return { token: "register.1700000000.0123456789abcdef.sig", honeypot: "hp_fax", min_seconds: 0, max_age_seconds: 7200, turnstile: null, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.getElementById("cf-turnstile-script")?.remove();
  delete window.turnstile;
});

test("holt das Token für genau dieses Formular", async () => {
  apiMock.get.mockResolvedValue({ data: token() });
  const { result } = renderHook(() => useSpamGuard("register"));
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(apiMock.get).toHaveBeenCalledWith("/spam-guard/token", { params: { form: "register" } });
  let fields;
  await act(async () => { fields = await result.current.prepare(); });
  expect(fields).toEqual({ form_token: "register.1700000000.0123456789abcdef.sig", hp_fax: "" });
});

test("sendet nie vor der Mindestzeit - wartet sie ab statt still zu scheitern", async () => {
  apiMock.get.mockResolvedValue({ data: token({ min_seconds: 1 }) });
  const { result } = renderHook(() => useSpamGuard("register"));
  await waitFor(() => expect(result.current.ready).toBe(true));
  const started = Date.now();
  await act(async () => { await result.current.prepare(); });
  expect(Date.now() - started).toBeGreaterThanOrEqual(900);
});

test("ohne Token beim Laden holt prepare es nach", async () => {
  apiMock.get.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ data: token() });
  const { result } = renderHook(() => useSpamGuard("register"));
  let fields;
  await act(async () => { fields = await result.current.prepare(); });
  expect(fields.form_token).toBe("register.1700000000.0123456789abcdef.sig");
  expect(apiMock.get).toHaveBeenCalledTimes(2);
});

test("ein zu altes Token wird vor dem Senden erneuert", async () => {
  apiMock.get.mockResolvedValueOnce({ data: token({ token: "alt", max_age_seconds: 600 }) }).mockResolvedValue({ data: token({ token: "neu" }) });
  const now = Date.now();
  const spy = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    const { result } = renderHook(() => useSpamGuard("register"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    spy.mockReturnValue(now + 6 * 60 * 1000);
    let fields;
    await act(async () => { fields = await result.current.prepare(); });
    expect(fields.form_token).toBe("neu");
  } finally {
    spy.mockRestore();
  }
});

test("nach jedem Absenden - Erfolg oder Fehler - kommt ein neues Token", async () => {
  apiMock.get.mockResolvedValueOnce({ data: token({ token: "erstes" }) }).mockResolvedValue({ data: token({ token: "zweites" }) });
  const { result } = renderHook(() => useSpamGuard("register"));
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => { result.current.afterAttempt(); });
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  let fields;
  await act(async () => { fields = await result.current.prepare(); });
  expect(fields.form_token).toBe("zweites");
});

test("nach der Turnstile-Rückfrage (428) bleibt das Token - der Server erkennt die Wiederholung", async () => {
  apiMock.get.mockResolvedValueOnce({ data: token({ token: "erstes" }) }).mockResolvedValue({ data: token({ token: "zweites" }) });
  const { result } = renderHook(() => useSpamGuard("contact"));
  await waitFor(() => expect(result.current.ready).toBe(true));
  const challenge = { response: { status: 428, data: { detail: { code: "turnstile_required", turnstile: { site_key: "0x4AAAAAAAoeffentlich", mode: "suspect", action: "contact" } } } } };
  await act(async () => { result.current.afterAttempt(challenge); });
  let fields;
  await act(async () => { fields = await result.current.prepare(); });
  expect(fields.form_token).toBe("erstes");
  expect(apiMock.get).toHaveBeenCalledTimes(1);
});

function Form({ form }) {
  const guard = useSpamGuard(form);
  return <form><SpamGuardFields guard={guard} idPrefix="test" /></form>;
}

test("Turnstile „immer“: Skript erst dann, Widget im dunklen Stil, Antwort geht mit", async () => {
  apiMock.get.mockResolvedValue({ data: token({ turnstile: { site_key: "0x4AAAAAAAoeffentlich", mode: "always", action: "register" } }) });
  const renderWidget = vi.fn((element, options) => { setTimeout(() => options.callback("cf-antwort"), 0); return "w1"; });
  window.turnstile = { render: renderWidget, remove: vi.fn() };
  render(<Form form="register" />);
  expect(await screen.findByTestId("test-turnstile")).toBeInTheDocument();
  await waitFor(() => expect(renderWidget).toHaveBeenCalled());
  expect(renderWidget.mock.calls[0][1]).toEqual(expect.objectContaining({ sitekey: "0x4AAAAAAAoeffentlich", action: "register", theme: "dark" }));
});

test("Turnstile „nur bei Verdacht“: zuerst kein Widget", async () => {
  apiMock.get.mockResolvedValue({ data: token({ turnstile: { site_key: "0x4AAAAAAAoeffentlich", mode: "suspect", action: "register" } }) });
  render(<Form form="register" />);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  expect(screen.queryByTestId("test-turnstile")).toBeNull();
  expect(document.getElementById("cf-turnstile-script")).toBeNull();
});

test("lässt sich das Widget nicht laden, sagt das Formular es und sendet trotzdem", async () => {
  apiMock.get.mockResolvedValue({ data: token({ turnstile: { site_key: "0x4AAAAAAAoeffentlich", mode: "always", action: "register" } }) });
  render(<Form form="register" />);
  const script = await waitFor(() => {
    const element = document.getElementById("cf-turnstile-script");
    expect(element).not.toBeNull();
    return element;
  });
  expect(script.getAttribute("src")).toBe("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
  act(() => { script.dispatchEvent(new Event("error")); });
  expect(await screen.findByText(/lässt sich gerade nicht laden/)).toBeInTheDocument();
});
