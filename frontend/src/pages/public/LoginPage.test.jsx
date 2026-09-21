import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Login (#348): der Haken „Angemeldet bleiben“ geht mit, und nach einer Anmeldung mit Passwort
// wird einmal ein Passkey angeboten – mit „Später“ und „Nicht mehr fragen“.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
const authState = { login: vi.fn(), completeMfa: vi.fn(), setUser: vi.fn(), mfaTicket: "", setMfaTicket: vi.fn() };
const passkeys = {
  passkeysSupported: vi.fn(() => true),
  passkeyAutofillAvailable: vi.fn(async () => false),
  startPasskeyAutofill: vi.fn(() => () => {}),
  signInWithPasskey: vi.fn(),
  enrollPasskey: vi.fn(async () => {}),
  passkeyError: (error) => error?.message || "Fehler",
};

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/lib/passkeys", () => passkeys);
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/Logo", () => ({ Logo: () => <div /> }));
vi.mock("@/components/tls/GoogleAuthButton", () => ({ GoogleAuthButton: ({ remember }) => <div data-testid="google" data-remember={String(remember)} /> }));
vi.mock("@/hooks/usePublicSiteSettings", () => ({ usePublicSiteSettings: () => ({ password_login_enabled: true, registration_enabled: true }) }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const LoginPage = (await import("./LoginPage")).default;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/login?next=/members/area"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/members/area" element={<div>mitgliederbereich</div>} />
      </Routes>
    </MemoryRouter>
  );
}

async function fillAndSubmit(user) {
  await user.type(screen.getByTestId("login-email"), "paula@lionsquad-test.at");
  await user.type(screen.getByTestId("login-password"), "geheim-geheim-42");
  await user.click(screen.getByTestId("login-submit"));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  passkeys.passkeysSupported.mockReturnValue(true);
  passkeys.passkeyAutofillAvailable.mockResolvedValue(false);
  authState.login.mockResolvedValue({ ok: true });
  apiMock.get.mockImplementation(async (url) => (url === "/auth/passkeys/status" ? { data: { enabled: true } } : { data: [] }));
});

test("der Haken ist an, geht beim Anmelden mit – auch an Google – und wird gemerkt", async () => {
  const user = userEvent.setup();
  apiMock.get.mockImplementation(async (url) => (url === "/auth/passkeys/status" ? { data: { enabled: false } } : { data: [] }));
  renderPage();
  expect(screen.getByTestId("login-remember")).toBeChecked();
  expect(screen.getByTestId("google")).toHaveAttribute("data-remember", "true");

  await user.click(screen.getByTestId("login-remember"));
  expect(screen.getByTestId("google")).toHaveAttribute("data-remember", "false");
  expect(screen.getByText(/sobald du den Browser schließt/)).toBeInTheDocument();
  await fillAndSubmit(user);
  await waitFor(() => expect(authState.login).toHaveBeenCalledWith("paula@lionsquad-test.at", "geheim-geheim-42", { remember: false }));
  await waitFor(() => expect(screen.getByText("mitgliederbereich")).toBeInTheDocument());
  expect(window.localStorage.getItem("tls_remember_me")).toBe("0");
});

test("nach der Anmeldung mit Passwort wird einmal ein Passkey angeboten und eingerichtet", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/auth/passkeys/status"));
  await fillAndSubmit(user);
  expect(await screen.findByTestId("passkey-offer")).toHaveTextContent("Nächstes Mal ohne Passwort?");
  await user.click(screen.getByTestId("passkey-offer-setup"));
  await waitFor(() => expect(passkeys.enrollPasskey).toHaveBeenCalledWith(expect.any(String), "geheim-geheim-42"));
  await waitFor(() => expect(screen.getByText("mitgliederbereich")).toBeInTheDocument());
});

test("„Nicht mehr fragen“ gilt – und wer schon einen Passkey hat, wird gar nicht gefragt", async () => {
  const user = userEvent.setup();
  const { unmount } = renderPage();
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/auth/passkeys/status"));
  await fillAndSubmit(user);
  await user.click(await screen.findByTestId("passkey-offer-never"));
  await waitFor(() => expect(screen.getByText("mitgliederbereich")).toBeInTheDocument());
  expect(passkeys.enrollPasskey).not.toHaveBeenCalled();
  unmount();

  renderPage();
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/auth/passkeys/status"));
  await fillAndSubmit(user);
  await waitFor(() => expect(screen.getByText("mitgliederbereich")).toBeInTheDocument());
  expect(screen.queryByTestId("passkey-offer")).toBeNull();
});

test("kann der Browser Passkeys vorschlagen, startet das im Hintergrund und endet vor dem Knopf", async () => {
  const stop = vi.fn();
  passkeys.passkeyAutofillAvailable.mockResolvedValue(true);
  passkeys.startPasskeyAutofill.mockReturnValue(stop);
  passkeys.signInWithPasskey.mockResolvedValue({ id: "u1" });
  const user = userEvent.setup();
  renderPage();
  await waitFor(() => expect(passkeys.startPasskeyAutofill).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId("login-email")).toHaveAttribute("autocomplete", "username webauthn");
  await user.click(await screen.findByTestId("login-passkey"));
  expect(stop).toHaveBeenCalled();
  await waitFor(() => expect(passkeys.signInWithPasskey).toHaveBeenCalledWith({ remember: true }));
});
