import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Kontakt vorbelegt (#1252, #1254): „Interesse melden“ an einer offenen Vorstandsfunktion und „Unterlagen anfordern“
// bringen Thema und Betreff über die Adresse mit.

const apiMock = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/usePublicSiteSettings", () => ({ usePublicSiteSettings: () => ({}) }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const { default: ContactPage } = await import("./ContactPage");

beforeEach(() => {
  apiMock.get.mockResolvedValue({ data: [{ value: "general", label: "Allgemeine Anfrage" }, { value: "volunteer", label: "Mitarbeit im Verein" }, { value: "sponsorship", label: "Sponsoring" }] });
});

test("Thema und Betreff kommen aus der Adresse", async () => {
  render(<MemoryRouter initialEntries={[`/contact?topic=volunteer&subject=${encodeURIComponent("Interesse: Jugendreferent:in")}`]}><ContactPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("contact-topic")).toHaveValue("volunteer"));
  expect(screen.getByTestId("contact-subject")).toHaveValue("Interesse: Jugendreferent:in");
});

// Spamschutz (#2067): Token beim Laden holen, unsichtbares Feld mitschicken, Turnstile nur bei Bedarf.
const TOKEN = { token: "contact.1700000000.0123456789abcdef.sig", honeypot: "hp_fax", min_seconds: 0, max_age_seconds: 7200, turnstile: null };
const TOPICS = [{ value: "general", label: "Allgemeine Anfrage" }];

function serveToken(token = TOKEN) {
  apiMock.get.mockImplementation(async (url) => (url === "/spam-guard/token" ? { data: token } : { data: TOPICS }));
}

async function fillContact(user) {
  await user.type(screen.getByTestId("contact-name"), "Jürgen Müller-Lüdenscheidt");
  await user.type(screen.getByTestId("contact-email-input"), "juergen@lionsquad-test.at");
  await user.type(screen.getByTestId("contact-subject"), "Turnier");
  await user.type(screen.getByTestId("contact-message"), "Hallo, wann ist das nächste Turnier?");
  await user.click(screen.getByTestId("contact-privacy"));
}

test("Spamschutz: Token wird geholt und mitgeschickt, das unsichtbare Feld ist da, aber nicht zu sehen", async () => {
  const { default: userEvent } = await import("@testing-library/user-event");
  serveToken();
  apiMock.post.mockResolvedValue({ data: { ok: true, id: "c1" } });
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/contact"]}><ContactPage /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/spam-guard/token", { params: { form: "contact" } }));

  const trap = screen.getByTestId("contact-honeypot");
  expect(trap).toHaveAttribute("aria-hidden", "true");
  expect(trap).toHaveStyle({ position: "absolute", left: "-10000px", height: "1px", overflow: "hidden" });
  const input = screen.getByTestId("contact-honeypot-input");
  expect(input).toHaveAttribute("name", "hp_fax");
  expect(input).toHaveAttribute("tabindex", "-1");
  expect(input).toHaveAttribute("autocomplete", "off");
  // Für Screenreader nicht vorhanden.
  expect(screen.queryByRole("textbox", { name: /Fax/ })).toBeNull();
  // Ohne Turnstile wird kein Skript von Cloudflare geladen.
  expect(screen.queryByTestId("contact-turnstile")).toBeNull();
  expect(document.getElementById("cf-turnstile-script")).toBeNull();

  await fillContact(user);
  await user.click(screen.getByTestId("contact-submit"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/contact/submit", expect.objectContaining({
    form_token: TOKEN.token, hp_fax: "", name: "Jürgen Müller-Lüdenscheidt",
  })));
  expect(apiMock.post.mock.calls[0][1]).not.toHaveProperty("turnstile_token");
  expect(await screen.findByTestId("contact-success")).toBeInTheDocument();
});

test("Spamschutz „nur bei Verdacht“: der Server verlangt Turnstile, das Widget erscheint und die Antwort geht mit", async () => {
  const { default: userEvent } = await import("@testing-library/user-event");
  serveToken();
  const render_ = vi.fn((element, options) => { options.callback("cf-antwort"); return "widget-1"; });
  window.turnstile = { render: render_, remove: vi.fn() };
  apiMock.post
    .mockRejectedValueOnce({ response: { status: 428, data: { detail: { code: "turnstile_required", msg: "Bitte bestätige kurz, dass du kein Bot bist.",
      turnstile: { site_key: "0x4AAAAAAAoeffentlich", mode: "suspect", action: "contact" } } } } })
    .mockResolvedValueOnce({ data: { ok: true, id: "c2" } });
  const user = userEvent.setup();
  try {
    render(<MemoryRouter initialEntries={["/contact"]}><ContactPage /></MemoryRouter>);
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/spam-guard/token", { params: { form: "contact" } }));
    await fillContact(user);
    await user.click(screen.getByTestId("contact-submit"));
    expect(await screen.findByText("Bitte bestätige kurz, dass du kein Bot bist.")).toBeInTheDocument();
    await waitFor(() => expect(render_).toHaveBeenCalled());
    expect(render_.mock.calls[0][1]).toEqual(expect.objectContaining({ sitekey: "0x4AAAAAAAoeffentlich", action: "contact", theme: "dark" }));
    await user.click(screen.getByTestId("contact-submit"));
    await waitFor(() => expect(apiMock.post).toHaveBeenLastCalledWith("/contact/submit", expect.objectContaining({ turnstile_token: "cf-antwort" })));
  } finally {
    delete window.turnstile;
  }
});

test("ohne Angaben bleibt es bei „Allgemeine Anfrage“ und leerem Betreff; Unsinn im Thema zählt nicht", async () => {
  render(<MemoryRouter initialEntries={["/contact?topic=<script>"]}><ContactPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("contact-topic")).toHaveValue("general"));
  expect(screen.getByTestId("contact-subject")).toHaveValue("");
});
