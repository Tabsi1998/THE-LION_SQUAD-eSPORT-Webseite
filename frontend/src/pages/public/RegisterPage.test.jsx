import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Registrieren mit Ziel (#1225): oben steht, wofür; das geprüfte Ziel geht mit zum Server und weiter zur Seite der
// Mail-Bestätigung; der Login-Link und Google nehmen es mit. Ein fremdes Ziel geht nicht mit.

const apiMock = { get: vi.fn() };
const authState = { register: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/Logo", () => ({ Logo: () => <div /> }));
vi.mock("@/components/tls/GoogleAuthButton", () => ({ GoogleAuthButton: ({ returnPath }) => <div data-testid="google" data-return={returnPath} /> }));
vi.mock("@/components/tls/GermanDateField", () => ({ GermanDateField: () => null }));
vi.mock("@/hooks/usePublicSiteSettings", () => ({ usePublicSiteSettings: () => ({ registration_enabled: true }) }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const RegisterPage = (await import("./RegisterPage")).default;

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillAndSubmit(user) {
  await user.type(screen.getByTestId("register-username"), "neonfalke");
  await user.type(screen.getByTestId("register-email"), "neonfalke@lionsquad-test.at");
  await user.type(screen.getByTestId("register-password"), "testtest-42");
  await user.click(screen.getByTestId("register-accept"));
  await user.click(screen.getByTestId("register-accept-terms"));
  await user.click(screen.getByTestId("register-submit"));
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockImplementation(async (url) => (url === "/tournaments/mk-cup" ? { data: { title: "Mario Kart Cup" } } : { data: {} }));
  authState.register.mockResolvedValue({ ok: true, data: { verification_required: true, email: "neonfalke@lionsquad-test.at" } });
});

test("vom Turnier: Satz, Ziel zum Server und weiter zur Mail-Bestätigung, Login-Link und Google mit Ziel", async () => {
  const user = userEvent.setup();
  renderAt("/register?next=%2Ftournaments%2Fmk-cup");
  expect(await screen.findByTestId("register-purpose")).toHaveTextContent("Erstelle ein Konto, um dich für „Mario Kart Cup“ anzumelden.");
  expect(screen.getByTestId("register-login-link")).toHaveAttribute("href", "/login?next=%2Ftournaments%2Fmk-cup");
  expect(screen.getByTestId("google")).toHaveAttribute("data-return", "/tournaments/mk-cup");
  await fillAndSubmit(user);
  await waitFor(() => expect(authState.register).toHaveBeenCalledWith(expect.objectContaining({ next: "/tournaments/mk-cup" })));
  expect(await screen.findByTestId("where")).toHaveTextContent("/verify-email?sent=1&email=neonfalke%40lionsquad-test.at&next=%2Ftournaments%2Fmk-cup");
});

test("Spamschutz (#2067): Token wird geholt und mitgeschickt, das unsichtbare Feld ist da, aber nicht zu sehen", async () => {
  apiMock.get.mockImplementation(async (url) => (url === "/spam-guard/token"
    ? { data: { token: "register.1700000000.0123456789abcdef.sig", honeypot: "hp_fax", min_seconds: 0, max_age_seconds: 7200, turnstile: null } }
    : { data: {} }));
  const user = userEvent.setup();
  renderAt("/register");
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/spam-guard/token", { params: { form: "register" } }));
  expect(screen.getByTestId("register-honeypot")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByTestId("register-honeypot-input")).toHaveAttribute("tabindex", "-1");
  expect(screen.queryByRole("textbox", { name: /Fax/ })).toBeNull();
  await fillAndSubmit(user);
  await waitFor(() => expect(authState.register).toHaveBeenCalledWith(expect.objectContaining({
    form_token: "register.1700000000.0123456789abcdef.sig", hp_fax: "", username: "neonfalke",
  })));
});

test("ein fremdes Ziel geht nicht mit", async () => {
  const user = userEvent.setup();
  renderAt("/register?next=%2F%2Ffremd.example");
  expect(screen.queryByTestId("register-purpose")).toBeNull();
  expect(screen.getByTestId("register-login-link")).toHaveAttribute("href", "/login");
  await fillAndSubmit(user);
  await waitFor(() => expect(authState.register).toHaveBeenCalled());
  expect(authState.register.mock.calls[0][0]).not.toHaveProperty("next");
  expect(await screen.findByTestId("where")).toHaveTextContent("/verify-email?sent=1&email=neonfalke%40lionsquad-test.at");
  expect(screen.getByTestId("where")).not.toHaveTextContent("next=");
});

test("Passwortvertrag (#1033): dieselbe Regel wie der Server, vor dem Absenden gemeldet", async () => {
  const user = userEvent.setup();
  renderAt("/register");
  await user.type(screen.getByTestId("register-username"), "neonfalke");
  await user.type(screen.getByTestId("register-email"), "neonfalke@lionsquad-test.at");
  await user.type(screen.getByTestId("register-password"), "ä".repeat(37));
  await user.click(screen.getByTestId("register-accept"));
  await user.click(screen.getByTestId("register-accept-terms"));
  await user.click(screen.getByTestId("register-submit"));
  expect(await screen.findByText(/höchstens 72 Byte\. Umlaute zählen doppelt/)).toBeInTheDocument();
  expect(authState.register).not.toHaveBeenCalled();
});
