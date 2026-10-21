import { act, render, screen, waitFor } from "@testing-library/react";
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

// #1520: Kann der Browser Passkeys im E-Mail-Feld vorschlagen, läuft das still im Hintergrund. Der Knopf „Mit Passkey
// anmelden“ steht trotzdem immer da (FIDO-Empfehlung): nicht jeder Browser zeigt jeden Passkey im Feld.
function autofillStarted() {
  const stop = vi.fn();
  passkeys.passkeyAutofillAvailable.mockResolvedValue(true);
  passkeys.startPasskeyAutofill.mockReturnValue(stop);
  return stop;
}
const autofillArgs = () => passkeys.startPasskeyAutofill.mock.calls.at(-1)[0];

test("kann der Browser Passkeys vorschlagen, startet das beim Laden – und der Knopf steht trotzdem da", async () => {
  autofillStarted();
  renderPage();
  await waitFor(() => expect(passkeys.startPasskeyAutofill).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId("login-email")).toHaveAttribute("autocomplete", "username webauthn");
  const button = await screen.findByTestId("login-passkey");
  expect(button).toHaveTextContent("Mit Passkey anmelden");
  expect(button.className).toMatch(/tls-btn/);
  expect(screen.getByText(/schlägt dein Browser ihn hier vor/)).toBeInTheDocument();
  expect(autofillArgs().remember()).toBe(true);
});

test("der Vorschlag wartet nicht auf den Status des Servers; sagt der Server nein, endet er und kein Knopf erscheint", async () => {
  const stop = autofillStarted();
  let answer;
  apiMock.get.mockImplementation((url) => (url === "/auth/passkeys/status" ? new Promise((resolve) => { answer = resolve; }) : Promise.resolve({ data: [] })));
  renderPage();
  await waitFor(() => expect(passkeys.startPasskeyAutofill).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId("login-passkey")).toBeNull();
  await act(async () => answer({ data: { enabled: false } }));
  expect(stop).toHaveBeenCalled();
  expect(screen.queryByTestId("login-passkey")).toBeNull();
  expect(passkeys.startPasskeyAutofill).toHaveBeenCalledTimes(1);
});

test("der Knopf beendet erst den Vorschlag, öffnet dann den Dialog; ein Abbruch startet den Vorschlag neu", async () => {
  const stop = autofillStarted();
  passkeys.signInWithPasskey.mockRejectedValue(Object.assign(new Error("Abgebrochen"), { name: "NotAllowedError" }));
  const user = userEvent.setup();
  renderPage();
  await waitFor(() => expect(passkeys.startPasskeyAutofill).toHaveBeenCalledTimes(1));
  await user.click(await screen.findByTestId("login-passkey"));
  expect(stop).toHaveBeenCalled();
  expect(stop.mock.invocationCallOrder[0]).toBeLessThan(passkeys.signInWithPasskey.mock.invocationCallOrder[0]);
  expect(passkeys.signInWithPasskey).toHaveBeenCalledWith({ remember: true });
  expect(await screen.findByText("Abgebrochen")).toBeInTheDocument();
  await waitFor(() => expect(passkeys.startPasskeyAutofill).toHaveBeenCalledTimes(2));
});

test("der Knopf öffnet den Dialog erst, wenn der Browser die stille Anfrage abgeschlossen hat", async () => {
  let settled;
  const stop = vi.fn(() => new Promise((resolve) => { settled = resolve; }));
  passkeys.passkeyAutofillAvailable.mockResolvedValue(true);
  passkeys.startPasskeyAutofill.mockReturnValue(stop);
  passkeys.signInWithPasskey.mockResolvedValue({ id: "u1" });
  const user = userEvent.setup();
  renderPage();
  await waitFor(() => expect(passkeys.startPasskeyAutofill).toHaveBeenCalledTimes(1));
  await user.click(await screen.findByTestId("login-passkey"));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(passkeys.signInWithPasskey).not.toHaveBeenCalled();
  await act(async () => settled());
  await waitFor(() => expect(passkeys.signInWithPasskey).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByText("mitgliederbereich")).toBeInTheDocument());
});

test("prüft der Server gerade einen Passkey aus dem Vorschlag, startet der Knopf keine zweite Anmeldung", async () => {
  autofillStarted();
  const user = userEvent.setup();
  renderPage();
  await waitFor(() => expect(passkeys.startPasskeyAutofill).toHaveBeenCalled());
  const button = await screen.findByTestId("login-passkey");
  let finish;
  let running;
  act(() => { running = autofillArgs().exclusive(() => new Promise((resolve) => { finish = resolve; })); });
  await waitFor(() => expect(button).toBeDisabled());
  await user.click(button);
  expect(passkeys.signInWithPasskey).not.toHaveBeenCalled();
  await act(async () => finish({ id: "u1" }));
  expect(await running).toEqual({ started: true, value: { id: "u1" } });
});

test("ein gewählter Passkey meldet an und folgt dem Ziel; verlangt der Server einen Code, kommt der Schritt", async () => {
  autofillStarted();
  renderPage();
  await waitFor(() => expect(passkeys.startPasskeyAutofill).toHaveBeenCalled());
  autofillArgs().onSignedIn({ mfa_required: true, mfa_ticket: "ticket-1" });
  expect(authState.setMfaTicket).toHaveBeenCalledWith("ticket-1");
  autofillArgs().onSignedIn({ id: "u1" });
  expect(authState.setUser).toHaveBeenCalledWith({ id: "u1" });
  await waitFor(() => expect(screen.getByText("mitgliederbereich")).toBeInTheDocument());
});

test("Absenden des Passworts bricht den Vorschlag ab; scheitert das Passwort, schlägt der Browser wieder vor", async () => {
  const stop = autofillStarted();
  authState.login.mockResolvedValue({ ok: false, error: "Falsches Passwort" });
  const user = userEvent.setup();
  renderPage();
  await waitFor(() => expect(passkeys.startPasskeyAutofill).toHaveBeenCalledTimes(1));
  await fillAndSubmit(user);
  expect(stop).toHaveBeenCalled();
  expect(authState.login).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("Falsches Passwort")).toBeInTheDocument();
  await waitFor(() => expect(passkeys.startPasskeyAutofill).toHaveBeenCalledTimes(2));
});

test("prüft der Server gerade einen Passkey, startet das Passwort keine zweite Anmeldung", async () => {
  autofillStarted();
  const user = userEvent.setup();
  renderPage();
  await waitFor(() => expect(passkeys.startPasskeyAutofill).toHaveBeenCalled());
  let finish;
  const running = autofillArgs().exclusive(() => new Promise((resolve) => { finish = resolve; }));
  await user.type(screen.getByTestId("login-email"), "paula@lionsquad-test.at");
  await user.type(screen.getByTestId("login-password"), "geheim-geheim-42");
  await user.click(screen.getByTestId("login-submit"));
  expect(authState.login).not.toHaveBeenCalled();
  finish({ id: "u1" });
  expect(await running).toEqual({ started: true, value: { id: "u1" } });
});

test("beim Verlassen der Seite endet der Vorschlag", async () => {
  const stop = autofillStarted();
  const { unmount } = renderPage();
  await waitFor(() => expect(passkeys.startPasskeyAutofill).toHaveBeenCalled());
  unmount();
  expect(stop).toHaveBeenCalled();
});

test("ohne Vorschlag im Browser bleibt der Knopf mit dem Dialog des Browsers", async () => {
  passkeys.signInWithPasskey.mockResolvedValue({ id: "u1" });
  const user = userEvent.setup();
  renderPage();
  const link = await screen.findByTestId("login-passkey");
  expect(link).toHaveTextContent("Mit Passkey anmelden");
  expect(passkeys.startPasskeyAutofill).not.toHaveBeenCalled();
  await user.click(link);
  await waitFor(() => expect(passkeys.signInWithPasskey).toHaveBeenCalledWith({ remember: true }));
  await waitFor(() => expect(screen.getByText("mitgliederbereich")).toBeInTheDocument());
});

test("endet der Vorschlag von selbst, verschwindet der Hinweis am Feld; der Knopf bleibt", async () => {
  autofillStarted();
  renderPage();
  await waitFor(() => expect(passkeys.startPasskeyAutofill).toHaveBeenCalled());
  expect(await screen.findByTestId("login-passkey")).toBeInTheDocument();
  act(() => autofillArgs().onEnd());
  expect(screen.queryByText(/schlägt dein Browser ihn hier vor/)).toBeNull();
  expect(screen.getByTestId("login-passkey")).toBeInTheDocument();
});

test("nach einer Server-Ablehnung des stillen Vorschlags steht keine Meldung; er startet erst beim Fokus wieder – höchstens einmal (#1242)", async () => {
  autofillStarted();
  const user = userEvent.setup();
  renderPage();
  await waitFor(() => expect(passkeys.startPasskeyAutofill).toHaveBeenCalledTimes(1));
  act(() => {
    autofillArgs().onError?.(new Error("Diesen Passkey kennt der Server nicht."));
    autofillArgs().onEnd();
  });
  expect(await screen.findByTestId("login-passkey")).toBeInTheDocument();
  // Der stille Vorschlag zeigt nie eine Meldung (#1242); Fehler gibt es nur nach einem Klick auf den Knopf.
  expect(screen.queryByText("Diesen Passkey kennt der Server nicht.")).not.toBeInTheDocument();
  expect(screen.queryByTestId("login-error")).not.toBeInTheDocument();
  expect(passkeys.startPasskeyAutofill).toHaveBeenCalledTimes(1);

  await user.click(screen.getByTestId("login-email"));
  await waitFor(() => expect(passkeys.startPasskeyAutofill).toHaveBeenCalledTimes(2));
  act(() => autofillArgs().onEnd());
  await user.click(screen.getByTestId("login-password"));
  await user.click(screen.getByTestId("login-email"));
  expect(screen.getByTestId("login-passkey")).toBeInTheDocument();
  expect(passkeys.startPasskeyAutofill).toHaveBeenCalledTimes(2);
});

// Ziel nach dem Anmelden (#1225): „Registrieren“ nimmt das Ziel mit, oben steht, wofür man sich anmeldet, und ein Ziel
// auf einer fremden Adresse führt zum Dashboard.
function renderAt(entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<div>dashboard</div>} />
        <Route path="/tournaments/:slug" element={<div>turnierseite</div>} />
      </Routes>
    </MemoryRouter>
  );
}

test("vom Turnier: Satz mit dem Turnier, „Registrieren“ trägt das Ziel", async () => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/auth/passkeys/status") return { data: { enabled: false } };
    if (url === "/tournaments/mk-cup") return { data: { id: "t1", title: "Mario Kart Cup" } };
    return { data: [] };
  });
  renderAt("/login?next=%2Ftournaments%2Fmk-cup");
  expect(await screen.findByTestId("login-purpose")).toHaveTextContent("Melde dich an, um dich für „Mario Kart Cup“ anzumelden.");
  expect(screen.getByTestId("login-register-link")).toHaveAttribute("href", "/register?next=%2Ftournaments%2Fmk-cup");
});

test("ohne Ziel kein Satz, „Registrieren“ ohne Anhang", async () => {
  apiMock.get.mockImplementation(async (url) => (url === "/auth/passkeys/status" ? { data: { enabled: false } } : { data: [] }));
  renderAt("/login");
  expect(screen.getByTestId("login-register-link")).toHaveAttribute("href", "/register");
  expect(screen.queryByTestId("login-purpose")).toBeNull();
});

test("ein fremdes Ziel führt nach dem Anmelden zum Dashboard", async () => {
  const user = userEvent.setup();
  apiMock.get.mockImplementation(async (url) => (url === "/auth/passkeys/status" ? { data: { enabled: false } } : { data: [] }));
  renderAt("/login?next=https%3A%2F%2Ffremd.example%2Fx");
  expect(screen.queryByTestId("login-purpose")).toBeNull();
  await fillAndSubmit(user);
  await waitFor(() => expect(screen.getByText("dashboard")).toBeInTheDocument());
});

// „← Zurück zur Website“ (#1242): zur Seite, von der man kam, sonst zur Startseite.
test("„Zurück zur Website“ führt ohne Vorseite zur Startseite", async () => {
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>startseite</div>} />
      </Routes>
    </MemoryRouter>
  );
  await userEvent.setup().click(screen.getByTestId("login-back"));
  expect(await screen.findByText("startseite")).toBeInTheDocument();
});

test("„Zurück zur Website“ führt zur Seite, von der man kam", async () => {
  render(
    <MemoryRouter initialEntries={["/news", "/login"]} initialIndex={1}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/news" element={<div>newsseite</div>} />
        <Route path="/" element={<div>startseite</div>} />
      </Routes>
    </MemoryRouter>
  );
  await userEvent.setup().click(screen.getByTestId("login-back"));
  expect(await screen.findByText("newsseite")).toBeInTheDocument();
});

// Überall „Anmelden“ (#1242): Überschrift, Knopf und der Weg über Google.
test("Überschrift, Knopf und Google-Weg heißen Anmelden", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { level: 1, name: "Anmelden" })).toBeInTheDocument();
  expect(screen.getByTestId("login-submit")).toHaveTextContent("Anmelden");
});
