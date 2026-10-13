import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ConfirmDialogProvider } from "@/components/tls/ConfirmDialog";

// Das Profil ist die Seite, die jedes Mitglied selbst bearbeitet. Getestet wird
// der Speicherpfad: es darf nur schicken, was wirklich geaendert wurde, und die
// Sichtbarkeitseinstellung muss verlaesslich mitgehen - ein Fehler dort macht
// ein privates Profil oeffentlich.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn() };
const refreshMock = vi.fn();

const USER = {
  id: "u-1",
  username: "lionfan",
  display_name: "Lion Fan",
  email: "fan@lionsquad.at",
  bio: "Kurze Vorstellung.",
  privacy_public_profile: false,
  favorite_games: ["rocket_league"],
  main_platforms: [],
  input_devices: [],
  gaming_subscriptions: [],
  game_ids: {},
};

vi.mock("@/lib/api", () => ({
  api: apiMock,
  formatRequestError: (error, fallback) => fallback || String(error),
  resolveMediaUrl: (value) => value || "",
}));
// Das angemeldete Konto ist veränderlich, damit ein Kontowechsel geprüft werden kann (#1048).
const authState = { user: USER };
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: authState.user, refresh: refreshMock, isClubMember: true }),
}));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/usePublicSiteSettings", () => ({ usePublicSiteSettings: () => ({ settings: {}, loading: false }) }));
vi.mock("@/components/tls/PublicLayout", () => ({
  PublicLayout: ({ children }) => <div data-testid="public-layout">{children}</div>,
}));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/MultiSelect", () => ({ MultiSelect: () => <div data-testid="multi-select" /> }));
vi.mock("@/components/tls/AchievementGroups", () => ({ AchievementGroupsView: () => <div data-testid="achievement-groups" /> }));
vi.mock("@/components/tls/AchievementUnlockOverlay", () => ({ AchievementUnlockOverlay: () => null }));
vi.mock("@/components/tls/GermanDateField", () => ({ GermanDateField: () => <div data-testid="german-date" /> }));
vi.mock("@/components/tls/GoogleAuthButton", () => ({ GoogleAuthButton: () => <div data-testid="google-auth" /> }));
vi.mock("@/components/tls/MfaSetupPanel", () => ({ MfaSetupPanel: () => <div data-testid="mfa-panel" /> }));
vi.mock("@/components/tls/PasskeysPanel", () => ({ PasskeysPanel: () => <div data-testid="passkeys-panel" /> }));
vi.mock("sonner", () => ({ toast: toastMock }));

const ProfilePage = (await import("./ProfilePage")).default;
const { FriendsPanel } = await import("./profile/FriendsPanel");

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe" data-path={location.pathname} data-search={location.search} />;
}

function pageTree(entries) {
  return (
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={entries}>
        <ProfilePage />
      </MemoryRouter>
    </ConfirmDialogProvider>
  );
}

function renderPage(entries = ["/profile"]) {
  const view = render(pageTree(entries));
  return { ...view, rerenderPage: () => view.rerender(pageTree(entries)) };
}

// Eine Anfrage, die erst antwortet, wenn der Test es sagt.
function deferredPatch() {
  const call = {};
  apiMock.patch.mockImplementationOnce((url, body, config) => new Promise((resolve, reject) => {
    Object.assign(call, { url, body, config, resolve: (data) => resolve({ data }), reject });
  }));
  return call;
}

beforeEach(() => {
  authState.user = USER;
  apiMock.get.mockResolvedValue({ data: [] });
  apiMock.post.mockResolvedValue({ data: {} });
  apiMock.patch.mockImplementation((_url, body) => Promise.resolve({ data: { ...USER, ...body } }));
});

async function waitForForm() {
  await waitFor(() => expect(screen.getByTestId("profile-bio")).toHaveValue("Kurze Vorstellung."));
}

async function openPrivacyTab(user) {
  await user.click(screen.getByRole("button", { name: /Privatsphäre/i }));
  return screen.findByTestId("profile-privacy");
}

test("laedt die eigenen Profildaten in das Formular", async () => {
  const user = userEvent.setup();
  renderPage();

  await waitForForm();
  expect(await openPrivacyTab(user)).not.toBeChecked();
});

test("speichert nur das tatsaechlich geaenderte Feld", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();

  await user.clear(screen.getByTestId("profile-bio"));
  await user.type(screen.getByTestId("profile-bio"), "Neue Vorstellung.");
  await user.click(screen.getByTestId("profile-save"));

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/users/me", expect.anything(), expect.anything()));
  const [, payload, config] = apiMock.patch.mock.calls.at(-1);
  expect(payload).toEqual({ bio: "Neue Vorstellung." });
  // Der Server prüft, dass noch dasselbe Konto angemeldet ist (#1048).
  expect(config.headers["X-Expected-User-Id"]).toBe("u-1");
});

test("ein Schalter auf Privatsphaere speichert von selbst, ohne Speichern-Knopf", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();

  await user.click(await openPrivacyTab(user));
  expect(screen.queryByTestId("profile-save")).toBeNull();

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1), { timeout: 2500 });
  const [, payload] = apiMock.patch.mock.calls.at(-1);
  expect(payload).toEqual({ privacy_public_profile: true });
  await screen.findByText("Gespeichert.");
  expect(screen.getByTestId("profile-privacy")).toBeChecked();
});

test("die Schnellwahl Verein setzt alle Felder der Gruppe und schickt genau einen PATCH", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();
  await openPrivacyTab(user);

  await user.click(screen.getByTestId("profile-vis-group-contact-members"));
  await user.selectOptions(screen.getByTestId("profile-dm-privacy"), "friends");

  for (const key of ["email", "discord", "city", "country"]) {
    expect(screen.getByTestId(`profile-vis-${key}`)).toHaveValue("members");
  }
  expect(screen.getByTestId("profile-vis-group-contact-members")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("profile-vis-steam")).toHaveValue("public");

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1), { timeout: 2500 });
  const [, payload] = apiMock.patch.mock.calls.at(-1);
  expect(payload).toEqual({
    profile_visibility: { email: "members", discord: "members", city: "members", country: "members" },
    dm_privacy: "friends",
  });
  // Nach der Entprellung kommt kein zweiter Aufruf mehr.
  await new Promise((resolve) => setTimeout(resolve, 900));
  expect(apiMock.patch).toHaveBeenCalledTimes(1);
});

test("ein einzelnes Feld anders als seine Gruppe zeigt die Gruppe als gemischt", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();
  await openPrivacyTab(user);

  await user.selectOptions(screen.getByTestId("profile-vis-email"), "private");

  expect(screen.getByTestId("profile-vis-group-contact-mixed")).toBeInTheDocument();
  expect(screen.getByTestId("profile-vis-group-contact-public")).toHaveAttribute("aria-pressed", "false");
});

test("der Reiter Benachrichtigungen schaltet Kanaele und graut die Spalte aus", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();

  await user.click(screen.getByRole("button", { name: /Benachrichtigungen/i }));
  const push = await screen.findByTestId("profile-notification-channel-push");
  expect(push).toBeChecked();
  await user.click(push);

  expect(screen.getByTestId("profile-notification-push-match_reminders")).toBeDisabled();
  expect(screen.getByTestId("profile-notification-column-push")).toHaveTextContent("Kanal aus");
  expect(screen.getByTestId("profile-newsletter")).not.toBeChecked();

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1), { timeout: 2500 });
  const [, payload] = apiMock.patch.mock.calls.at(-1);
  expect(payload).toEqual({ notification_preferences: { push: false } });
});

test("ohne Aenderung wird nicht gespeichert", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();

  await user.click(screen.getByTestId("profile-save"));

  await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith("Keine Änderungen zum Speichern."));
  expect(apiMock.patch).not.toHaveBeenCalled();
});

test("nach dem Speichern wird die Sitzung aktualisiert", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();

  await user.type(screen.getByTestId("profile-bio"), " Ergaenzung.");
  await user.click(screen.getByTestId("profile-save"));

  await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  expect(toastMock.success).toHaveBeenCalledWith("Profil gespeichert.");
});

test("ein Speicherfehler meldet sich und laesst die Eingabe stehen", async () => {
  const user = userEvent.setup();
  apiMock.patch.mockRejectedValue(new Error("Serverfehler"));
  renderPage();
  await waitForForm();

  await user.clear(screen.getByTestId("profile-bio"));
  await user.type(screen.getByTestId("profile-bio"), "Bleibt erhalten.");
  await user.click(screen.getByTestId("profile-save"));

  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Profil konnte nicht gespeichert werden."));
  expect(screen.getByTestId("profile-bio")).toHaveValue("Bleibt erhalten.");
});

test("Grunddaten: ein Anzeigename statt zwei Namen, Land als Auswahl, Sicherheit nicht mehr hier", async () => {
  renderPage();
  await waitForForm();

  expect(screen.getByTestId("profile-display-name")).toBeInTheDocument();
  expect(screen.queryByText(/Nickname/i)).toBeNull();
  expect(screen.getByTestId("profile-country").tagName).toBe("SELECT");
  expect(screen.getByRole("option", { name: "Österreich" })).toHaveValue("AT");
  expect(screen.queryByTestId("profile-google-link")).toBeNull();
  expect(screen.queryByTestId("passkeys-panel")).toBeNull();
});

test("der Reiter Sicherheit buendelt Passwort, Passkeys, Zwei-Faktor, Google und Geraete; ?tab=sessions landet dort", async () => {
  renderPage(["/profile?tab=sessions"]);

  expect(await screen.findByTestId("profile-password-panel")).toBeInTheDocument();
  expect(screen.getByTestId("profile-tab-security")).toHaveAttribute("aria-current", "page");
  expect(screen.getByTestId("passkeys-panel")).toBeInTheDocument();
  // Zwei-Faktor kann seit #348 jedes Konto einrichten - für Spieler freiwillig.
  expect(screen.getByTestId("mfa-panel")).toBeInTheDocument();
  expect(screen.queryByTestId("profile-mfa-required")).toBeNull();
  expect(screen.getByTestId("profile-google-link")).toBeInTheDocument();
  expect(await screen.findByTestId("profile-sessions-panel")).toBeInTheDocument();
  expect(screen.queryByTestId("profile-save")).toBeNull();
});

test("Passwort aendern schickt aktuelles und neues Passwort und meldet den Wechsel", async () => {
  const user = userEvent.setup();
  renderPage(["/profile?tab=security"]);
  await screen.findByTestId("profile-password-panel");

  expect(screen.getByTestId("profile-password-submit")).toBeDisabled();
  await user.type(screen.getByTestId("profile-password-current"), "altes-passwort");
  await user.type(screen.getByTestId("profile-password-new"), "neues-passwort-123");
  await user.type(screen.getByTestId("profile-password-repeat"), "neues-passwort-123");
  await user.click(screen.getByTestId("profile-password-submit"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/auth/change-password", {
    current_password: "altes-passwort",
    new_password: "neues-passwort-123",
  }));
  expect(toastMock.success).toHaveBeenCalledWith(expect.stringContaining("Passwort geändert"));
});

test("Passwort aendern: zu kurz zeigt denselben Regeltext wie Server und uebrige Formulare (#1033)", async () => {
  const user = userEvent.setup();
  renderPage(["/profile?tab=security"]);
  await screen.findByTestId("profile-password-panel");

  await user.type(screen.getByTestId("profile-password-new"), "kurz");
  expect(screen.getByText("Das Passwort braucht mindestens 10 Zeichen. Noch 6 Zeichen.")).toBeInTheDocument();
  expect(screen.getByTestId("profile-password-submit")).toBeDisabled();
});

test("Socials: eine eingefuegte Adresse wird zum Nutzernamen mit Vorschau-Link", async () => {
  const user = userEvent.setup();
  renderPage(["/profile?tab=socials"]);
  const field = await screen.findByTestId("profile-instagram");

  await user.click(field);
  await user.paste("https://www.instagram.com/tabsi.98");

  expect(field).toHaveValue("tabsi.98");
  expect(screen.getByTestId("profile-instagram-preview")).toHaveAttribute("href", "https://instagram.com/tabsi.98");
});

test("?tab=inbox leitet zur eigenen Nachrichten-Seite weiter, mit to= direkt ins Gespraech", async () => {
  render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={["/profile?tab=inbox&to=u-9"]}>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/messages/:userId" element={<div data-testid="messages-page-stub" />} />
        </Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>
  );

  expect(await screen.findByTestId("messages-page-stub")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Inbox/i })).toBeNull();
});

// Speicher-Warteschlange (#1048): Autosave und „Speichern“ laufen hintereinander, nie gleichzeitig.
test("ein zweiter Schalter wartet, bis der laufende Autosave fertig ist - nie zwei PATCH gleichzeitig", async () => {
  const user = userEvent.setup();
  const first = deferredPatch();
  renderPage();
  await waitForForm();
  const toggle = await openPrivacyTab(user);

  await user.click(toggle);
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1), { timeout: 2500 });
  expect(first.body).toEqual({ privacy_public_profile: true });
  // Ein zweiter Schalter, solange die erste Anfrage läuft: seine Anfrage darf die erste nicht überholen.
  await user.click(screen.getByTestId("profile-privacy-achievements"));
  await new Promise((resolve) => setTimeout(resolve, 900));
  expect(apiMock.patch).toHaveBeenCalledTimes(1);

  // Der Server kennt nach der ersten Anfrage das öffentliche Profil.
  apiMock.patch.mockImplementationOnce((_url, body) => Promise.resolve({ data: { ...USER, privacy_public_profile: true, ...body } }));
  first.resolve({ ...USER, privacy_public_profile: true });
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(2), { timeout: 2500 });
  expect(apiMock.patch.mock.calls[1][1]).toEqual({ privacy_achievements_public: false });
  await screen.findByText("Gespeichert.");
  expect(screen.getByTestId("profile-privacy")).toBeChecked();
  expect(screen.getByTestId("profile-privacy-achievements")).toHaveAttribute("aria-checked", "false");
});

test("Speichern während eines Autosaves reiht sich ein und schickt danach nur den Rest", async () => {
  const user = userEvent.setup();
  const first = deferredPatch();
  renderPage();
  await waitForForm();
  await user.click(await openPrivacyTab(user));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1), { timeout: 2500 });

  await user.click(screen.getByRole("button", { name: /Grunddaten/i }));
  await user.clear(screen.getByTestId("profile-bio"));
  await user.type(screen.getByTestId("profile-bio"), "Neu.");
  await user.click(screen.getByTestId("profile-save"));
  expect(apiMock.patch).toHaveBeenCalledTimes(1);

  first.resolve({ ...USER, privacy_public_profile: true });
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(2));
  expect(apiMock.patch.mock.calls[1][1]).toEqual({ bio: "Neu." });
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Profil gespeichert."));
  expect(toastMock.success).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("profile-bio")).toHaveValue("Neu.");
  expect(apiMock.patch).toHaveBeenCalledTimes(2);
});

test("Doppelklick auf Speichern schickt genau einen PATCH", async () => {
  const user = userEvent.setup();
  const first = deferredPatch();
  renderPage();
  await waitForForm();
  await user.type(screen.getByTestId("profile-bio"), " Mehr.");
  const form = screen.getByTestId("profile-save").closest("form");
  // Zweimal abschicken, bevor React neu zeichnet - der Knopf ist dann noch nicht gesperrt.
  fireEvent.submit(form);
  fireEvent.submit(form);
  first.resolve({ ...USER, bio: "Kurze Vorstellung. Mehr." });
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Profil gespeichert."));
  expect(apiMock.patch).toHaveBeenCalledTimes(1);
  expect(toastMock.info).not.toHaveBeenCalled();
});

test("Kontowechsel während des Speicherns: die alte Antwort landet nicht im neuen Konto", async () => {
  const user = userEvent.setup();
  const first = deferredPatch();
  const view = renderPage();
  await waitForForm();
  await user.clear(screen.getByTestId("profile-bio"));
  await user.type(screen.getByTestId("profile-bio"), "Von Konto eins.");
  await user.click(screen.getByTestId("profile-save"));
  expect(apiMock.patch).toHaveBeenCalledTimes(1);

  authState.user = { ...USER, id: "u-2", username: "zweites", bio: "Konto zwei." };
  view.rerenderPage();
  await waitFor(() => expect(screen.getByTestId("profile-bio")).toHaveValue("Konto zwei."));

  first.resolve({ ...USER, bio: "Von Konto eins." });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.getByTestId("profile-bio")).toHaveValue("Konto zwei.");
  expect(screen.queryByTestId("profile-unsaved")).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 900));
  expect(apiMock.patch).toHaveBeenCalledTimes(1);
});

test("ein Fehler beim Autosave zeigt den Hinweis mit Erneut versuchen - die Eingabe bleibt", async () => {
  const user = userEvent.setup();
  apiMock.patch.mockImplementationOnce(() => Promise.reject(new Error("Serverfehler")));
  renderPage();
  await waitForForm();
  const toggle = await openPrivacyTab(user);
  await user.click(toggle);

  await screen.findByText("Änderung konnte nicht gespeichert werden.", {}, { timeout: 2500 });
  expect(toggle).toBeChecked();
  await user.click(screen.getByTestId("profile-autosave-retry"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(2));
  expect(apiMock.patch.mock.calls[1][1]).toEqual({ privacy_public_profile: true });
  await screen.findByText("Gespeichert.");
  expect(screen.queryByTestId("profile-autosave-retry")).toBeNull();
});

test("ein Fehler beim Speichern zeigt in der Leiste Erneut versuchen", async () => {
  const user = userEvent.setup();
  apiMock.patch.mockImplementationOnce(() => Promise.reject(new Error("Serverfehler")));
  renderPage();
  await waitForForm();
  await user.type(screen.getByTestId("profile-bio"), " Mehr.");
  await user.click(screen.getByTestId("profile-save"));

  expect(await screen.findByTestId("profile-save-error")).toHaveTextContent("Profil konnte nicht gespeichert werden.");
  expect(screen.getByTestId("profile-bio")).toHaveValue("Kurze Vorstellung. Mehr.");
  await user.click(screen.getByTestId("profile-save-retry"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Profil gespeichert."));
  expect(apiMock.patch.mock.calls[1][1]).toEqual({ bio: "Kurze Vorstellung. Mehr." });
  expect(screen.queryByTestId("profile-save-error")).toBeNull();
});

// Freunde stehen seit #1143 unter Community → Spieler (/players); die Tafel ist dieselbe.
test("Freunde: suchen, Anfrage senden, Eintrag unter Gesendet", async () => {
  const user = userEvent.setup();
  const bob = { id: "u-2", username: "bob", display_name: "Bob", avatar_url: "" };
  let outgoing = [];
  apiMock.get.mockImplementation((url) => {
    if (url === "/friends") return Promise.resolve({ data: { friends: [{ id: "f-1", status: "accepted", user: { id: "u-3", username: "anna", display_name: "Anna" } }], incoming: [], outgoing } });
    if (String(url).startsWith("/messages/users?q=")) return Promise.resolve({ data: [bob] });
    return Promise.resolve({ data: [] });
  });
  apiMock.post.mockImplementation((url) => {
    if (url === "/friends/u-2/request") {
      outgoing = [{ id: "f-2", status: "pending", outgoing: true, user: bob }];
      return Promise.resolve({ data: { status: "pending_outgoing" } });
    }
    return Promise.resolve({ data: {} });
  });
  render(
    <ConfirmDialogProvider>
      <MemoryRouter>
        <FriendsPanel />
      </MemoryRouter>
    </ConfirmDialogProvider>
  );

  expect(await screen.findByTestId("friends-friend-f-1")).toBeInTheDocument();
  await user.type(screen.getByTestId("profile-friends-search"), "bo");
  await user.click(await screen.findByTestId("friends-request-u-2"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/friends/u-2/request"));
  expect(await screen.findByTestId("friends-outgoing-f-2")).toBeInTheDocument();
  expect(screen.getByTestId("friends-candidate-u-2")).toHaveTextContent("Anfrage gesendet");
  expect(screen.getByTestId("friends-friend-f-1")).toHaveTextContent("Anna");
});

// Was keine Einstellung ist, hat seinen Ort woanders (#1146, #1150) - alte Links leiten dorthin weiter.
test("alte Reiter leiten weiter: Ehrungen und Erfolge ins eigene Profil, Teams und Freunde zu Community, Rechnungen auf ihre Adresse", async () => {
  const cases = [
    ["/profile?tab=honours", "/u/lionfan", "honours"],
    ["/profile?tab=achievements", "/u/lionfan", "achievements"],
    ["/profile?tab=teams", "/teams", ""],
    ["/profile?tab=friends", "/players", ""],
    ["/profile?tab=invoices&invoice=d-501", "/account/invoices", "invoice=d-501"],
  ];
  for (const [from, path, query] of cases) {
    const { unmount } = render(
      <ConfirmDialogProvider>
        <MemoryRouter initialEntries={[from]}>
          <Routes>
            <Route path="/profile" element={<ProfilePage />} />
            <Route path={path} element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </ConfirmDialogProvider>
    );
    const probe = await screen.findByTestId("location-probe");
    expect([from, probe.getAttribute("data-path")]).toEqual([from, path]);
    if (query) expect(probe.getAttribute("data-search")).toContain(query);
    unmount();
  }
});

test("Darstellung: Saison-Deko und Töne stehen in den Einstellungen", async () => {
  renderPage(["/profile?tab=appearance"]);
  expect(await screen.findByTestId("settings-appearance")).toBeInTheDocument();
  expect(screen.getByTestId("settings-deco-on")).toBeInTheDocument();
  expect(screen.getByTestId("settings-sound-off")).toBeInTheDocument();
  expect(screen.getByTestId("profile-tab-appearance")).toHaveAttribute("aria-current", "page");
});

