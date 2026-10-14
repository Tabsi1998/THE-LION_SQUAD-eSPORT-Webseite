import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ConfirmDialogProvider } from "@/components/tls/ConfirmDialog";

// Das Profil ist die Seite, die jedes Mitglied selbst bearbeitet. Getestet wird
// der Speicherpfad: es darf nur schicken, was wirklich geaendert wurde, und die
// Sichtbarkeitseinstellung muss verlaesslich mitgehen - ein Fehler dort macht
// ein privates Profil oeffentlich.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
const keepaliveMock = vi.fn();
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn() };
const refreshMock = vi.fn();
const logoutMock = vi.fn();

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
  keepaliveRequest: (...args) => keepaliveMock(...args),
  resolveMediaUrl: (value) => value || "",
}));
// Das angemeldete Konto ist veränderlich, damit ein Kontowechsel geprüft werden kann (#1048).
const authState = { user: USER };
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: authState.user, refresh: refreshMock, logout: logoutMock, isClubMember: true }),
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
  let stored = USER;
  apiMock.patch.mockImplementation((_url, body) => {
    stored = { ...stored, ...body };
    return Promise.resolve({ data: stored });
  });
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

// Ursache „Autosave geht nicht“ (#1048, nach #1528): Textfelder, Auswahlfelder und Bilder auf Grunddaten, Gaming und
// Socials speicherten nur mit dem Knopf „Speichern“ - von selbst speicherten allein Privatsphäre und Benachrichtigungen.
test("Grunddaten: Bio tippen speichert nach kurzer Pause von selbst - ohne Knopf", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();
  expect(screen.queryByTestId("profile-save")).toBeNull();

  await user.clear(screen.getByTestId("profile-bio"));
  await user.type(screen.getByTestId("profile-bio"), "Von selbst.");
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1), { timeout: 2500 });
  const [, payload, config] = apiMock.patch.mock.calls.at(-1);
  // Nur das geänderte Feld, und der Server prüft, dass noch dasselbe Konto angemeldet ist.
  expect(payload).toEqual({ bio: "Von selbst." });
  expect(config.headers["X-Expected-User-Id"]).toBe("u-1");
  expect(await screen.findByTestId("profile-autosave-status")).toHaveTextContent("Gespeichert ✓");
});

test("kein Knopf Speichern mehr - in keinem Reiter", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();
  for (const name of [/Grunddaten/i, /Gaming/i, /Socials/i, /Privatsphäre/i, /Benachrichtigungen/i]) {
    await user.click(screen.getByRole("button", { name }));
    expect(screen.queryByTestId("profile-save")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Speicher/i })).toBeNull();
    expect(screen.getByTestId("profile-autosave-status")).toBeInTheDocument();
  }
});

test("Feld verlassen speichert sofort, ohne die Pause abzuwarten", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();

  await user.type(screen.getByTestId("profile-bio"), " Mehr.");
  await user.tab();
  // Gleich nach dem Verlassen - lange vor dem Ende der Tipp-Pause.
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1), { timeout: 600 });
  expect(apiMock.patch.mock.calls[0][1]).toEqual({ bio: "Kurze Vorstellung. Mehr." });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(apiMock.patch).toHaveBeenCalledTimes(1);
});

test("ein Auswahlfeld speichert sofort", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();

  await user.selectOptions(screen.getByTestId("profile-country"), "AT");
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1), { timeout: 600 });
  expect(apiMock.patch.mock.calls[0][1]).toEqual({ country: "AT" });
});

test("ungültig speichert nicht: leerer Anzeigename hat den Hinweis am Feld, die Bio geht trotzdem", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();

  await user.clear(screen.getByTestId("profile-display-name"));
  expect(await screen.findByTestId("profile-display-name-error")).toHaveTextContent("Bitte gib einen Anzeigenamen ein");
  expect(screen.getByTestId("profile-autosave-status")).toHaveTextContent("Nicht gespeichert");
  expect(screen.getByTestId("profile-autosave-status")).toHaveAttribute("data-status", "invalid");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  expect(apiMock.patch).not.toHaveBeenCalled();
  // Die Eingabe bleibt stehen; ein anderes, gültiges Feld speichert ohne den Anzeigenamen.
  expect(screen.getByTestId("profile-display-name")).toHaveValue("");
  await user.type(screen.getByTestId("profile-bio"), " Mehr.");
  await user.tab();
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  expect(apiMock.patch.mock.calls[0][1]).toEqual({ bio: "Kurze Vorstellung. Mehr." });
  // Die Antwort des Servers (mit dem alten Namen) überschreibt die offene Eingabe nicht.
  await waitFor(() => expect(screen.getByTestId("profile-autosave-status")).toHaveAttribute("data-status", "invalid"));
  expect(screen.getByTestId("profile-display-name")).toHaveValue("");

  // Wieder gültig: jetzt geht der Name mit.
  await user.type(screen.getByTestId("profile-display-name"), "Neuer Name");
  await user.tab();
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(2));
  expect(apiMock.patch.mock.calls[1][1]).toEqual({ display_name: "Neuer Name" });
  expect(screen.queryByTestId("profile-display-name-error")).toBeNull();
});

test("ungültige Website speichert nicht und zeigt den Hinweis", async () => {
  const user = userEvent.setup();
  renderPage(["/profile?tab=socials"]);
  const field = await screen.findByTestId("profile-website");

  await user.type(field, "keine adresse");
  await user.tab();
  expect(await screen.findByTestId("profile-website-error")).toHaveTextContent("https://lionsquad.at");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(apiMock.patch).not.toHaveBeenCalled();

  await user.clear(field);
  await user.type(field, "https://lionsquad.at/team");
  await user.tab();
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1));
  expect(apiMock.patch.mock.calls[0][1]).toEqual({ website: "https://lionsquad.at/team" });
});

test("ein Schalter auf Privatsphaere speichert sofort, Gespeichert blendet wieder aus", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();

  await user.click(await openPrivacyTab(user));
  expect(screen.queryByTestId("profile-save")).toBeNull();

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1), { timeout: 600 });
  const [, payload] = apiMock.patch.mock.calls.at(-1);
  expect(payload).toEqual({ privacy_public_profile: true });
  const status = screen.getByTestId("profile-autosave-status");
  await waitFor(() => expect(status).toHaveTextContent("Gespeichert ✓"));
  expect(screen.getByTestId("profile-privacy")).toBeChecked();
  // Nach gut zwei Sekunden wird der Hinweis wieder ruhig.
  await waitFor(() => expect(status).toHaveTextContent("Änderungen speichern von selbst."), { timeout: 3500 });
});

test("die Schnellwahl Verein setzt alle Felder der Gruppe und speichert sie zusammen mit der Direktnachrichten-Wahl", async () => {
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

  await waitFor(() => expect(apiMock.patch.mock.calls.length).toBeGreaterThan(0), { timeout: 600 });
  await new Promise((resolve) => setTimeout(resolve, 900));
  // Jeder Klick speichert sofort; zusammen ergibt das genau diese Änderung - und nichts doppelt.
  const sent = Object.assign({}, ...apiMock.patch.mock.calls.map(([, body]) => body));
  expect(sent).toEqual({
    profile_visibility: { email: "members", discord: "members", city: "members", country: "members" },
    dm_privacy: "friends",
  });
  expect(apiMock.patch.mock.calls.length).toBeLessThanOrEqual(2);
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

test("ohne Aenderung wird nicht gespeichert, auch nicht beim Verlassen eines Felds", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();

  await user.click(screen.getByTestId("profile-bio"));
  await user.tab();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(apiMock.patch).not.toHaveBeenCalled();
});

test("nach dem Speichern wird die Sitzung aktualisiert", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();

  await user.type(screen.getByTestId("profile-bio"), " Ergaenzung.");
  await user.tab();

  await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  expect(toastMock.success).not.toHaveBeenCalled();
});

test("ein Speicherfehler zeigt Nicht gespeichert mit Erneut versuchen - die Eingabe bleibt", async () => {
  const user = userEvent.setup();
  apiMock.patch.mockImplementationOnce(() => Promise.reject(new Error("Serverfehler")));
  renderPage();
  await waitForForm();

  await user.clear(screen.getByTestId("profile-bio"));
  await user.type(screen.getByTestId("profile-bio"), "Bleibt erhalten.");
  await user.tab();

  const status = screen.getByTestId("profile-autosave-status");
  await waitFor(() => expect(status).toHaveAttribute("data-status", "error"));
  expect(status).toHaveTextContent("Nicht gespeichert.");
  expect(status).toHaveClass("text-warn");
  expect(screen.getByTestId("profile-bio")).toHaveValue("Bleibt erhalten.");
  await user.click(screen.getByTestId("profile-autosave-retry"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(2));
  expect(apiMock.patch.mock.calls[1][1]).toEqual({ bio: "Bleibt erhalten." });
  await waitFor(() => expect(status).toHaveTextContent("Gespeichert ✓"));
  expect(screen.queryByTestId("profile-autosave-retry")).toBeNull();
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

// Speicher-Warteschlange (#1048): alle Läufe gehen hintereinander, nie gleichzeitig.
test("ein zweiter Schalter wartet, bis der laufende Lauf fertig ist - nie zwei PATCH gleichzeitig", async () => {
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
  await waitFor(() => expect(screen.getByTestId("profile-autosave-status")).toHaveTextContent("Gespeichert ✓"));
  expect(screen.getByTestId("profile-privacy")).toBeChecked();
  expect(screen.getByTestId("profile-privacy-achievements")).toHaveAttribute("aria-checked", "false");
});

test("Text während eines laufenden Laufs geht im nächsten mit - nur der Rest", async () => {
  const user = userEvent.setup();
  const first = deferredPatch();
  renderPage();
  await waitForForm();
  await user.click(await openPrivacyTab(user));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(1), { timeout: 2500 });

  await user.click(screen.getByRole("button", { name: /Grunddaten/i }));
  await user.clear(screen.getByTestId("profile-bio"));
  await user.type(screen.getByTestId("profile-bio"), "Neu.");
  await user.tab();
  expect(apiMock.patch).toHaveBeenCalledTimes(1);

  first.resolve({ ...USER, privacy_public_profile: true });
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(2));
  expect(apiMock.patch.mock.calls[1][1]).toEqual({ bio: "Neu." });
  expect(screen.getByTestId("profile-bio")).toHaveValue("Neu.");
  await new Promise((resolve) => setTimeout(resolve, 900));
  expect(apiMock.patch).toHaveBeenCalledTimes(2);
});

test("Enter im Feld speichert sofort; zweimal hintereinander schickt einen PATCH", async () => {
  const user = userEvent.setup();
  const first = deferredPatch();
  renderPage();
  await waitForForm();
  await user.type(screen.getByTestId("profile-display-name"), " X");
  const form = screen.getByTestId("profile-display-name").closest("form");
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(apiMock.patch).toHaveBeenCalledTimes(1);
  first.resolve({ ...USER, display_name: "Lion Fan X" });
  await waitFor(() => expect(screen.getByTestId("profile-autosave-status")).toHaveTextContent("Gespeichert ✓"));
  expect(apiMock.patch).toHaveBeenCalledTimes(1);
});

test("Kontowechsel während des Speicherns: die alte Antwort landet nicht im neuen Konto", async () => {
  const user = userEvent.setup();
  const first = deferredPatch();
  const view = renderPage();
  await waitForForm();
  await user.clear(screen.getByTestId("profile-bio"));
  await user.type(screen.getByTestId("profile-bio"), "Von Konto eins.");
  await user.tab();
  expect(apiMock.patch).toHaveBeenCalledTimes(1);

  authState.user = { ...USER, id: "u-2", username: "zweites", bio: "Konto zwei." };
  view.rerenderPage();
  await waitFor(() => expect(screen.getByTestId("profile-bio")).toHaveValue("Konto zwei."));

  first.resolve({ ...USER, bio: "Von Konto eins." });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.getByTestId("profile-bio")).toHaveValue("Konto zwei.");
  await new Promise((resolve) => setTimeout(resolve, 900));
  expect(apiMock.patch).toHaveBeenCalledTimes(1);
});

test("ein Fehler bei einem Schalter zeigt den Hinweis mit Erneut versuchen - die Stellung bleibt", async () => {
  const user = userEvent.setup();
  apiMock.patch.mockImplementationOnce(() => Promise.reject(new Error("Serverfehler")));
  renderPage();
  await waitForForm();
  const toggle = await openPrivacyTab(user);
  await user.click(toggle);

  await screen.findByText("Änderung konnte nicht gespeichert werden.", {}, { timeout: 2500 });
  expect(screen.getByTestId("profile-autosave-status")).toHaveTextContent("Nicht gespeichert.");
  expect(toggle).toBeChecked();
  await user.click(screen.getByTestId("profile-autosave-retry"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledTimes(2));
  expect(apiMock.patch.mock.calls[1][1]).toEqual({ privacy_public_profile: true });
  await waitFor(() => expect(screen.getByTestId("profile-autosave-status")).toHaveTextContent("Gespeichert ✓"));
  expect(screen.queryByTestId("profile-autosave-retry")).toBeNull();
});

// Tab schließen oder neu laden (#1048, nach Codex-Prüfung): was noch in der Tipp-Pause wartet, geht sofort per
// keepalive-fetch; nur was danach noch offen ist (gescheitert oder ungültig), löst die Warnung des Browsers aus.
test("Tab wird verborgen: Text in der Tipp-Pause geht sofort per keepalive, nicht per axios", async () => {
  const user = userEvent.setup();
  keepaliveMock.mockResolvedValueOnce({ ...USER, bio: "Kurze Vorstellung. Mehr." });
  renderPage();
  await waitForForm();
  await user.type(screen.getByTestId("profile-bio"), " Mehr.");
  expect(keepaliveMock).not.toHaveBeenCalled();

  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  expect(keepaliveMock).toHaveBeenCalledTimes(1);
  expect(keepaliveMock).toHaveBeenCalledWith("PATCH", "/users/me", { bio: "Kurze Vorstellung. Mehr." }, { "X-Expected-User-Id": "u-1" });
  await waitFor(() => expect(screen.getByTestId("profile-autosave-status")).toHaveTextContent("Gespeichert ✓"));
  await new Promise((resolve) => setTimeout(resolve, 900));
  expect(apiMock.patch).not.toHaveBeenCalled();
});

test("pagehide schickt Text in der Tipp-Pause ebenfalls per keepalive", async () => {
  const user = userEvent.setup();
  keepaliveMock.mockResolvedValueOnce({ ...USER, bio: "Kurze Vorstellung. Mehr." });
  renderPage();
  await waitForForm();
  await user.type(screen.getByTestId("profile-bio"), " Mehr.");
  window.dispatchEvent(new Event("pagehide"));
  expect(keepaliveMock).toHaveBeenCalledTimes(1);
});

test("beforeunload warnt nur, wenn wirklich etwas offen bleibt", async () => {
  const user = userEvent.setup();
  renderPage();
  await waitForForm();
  const clean = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);

  // Text in der Tipp-Pause: geht per keepalive mit, keine Warnung.
  keepaliveMock.mockReturnValueOnce(new Promise(() => {}));
  await user.type(screen.getByTestId("profile-bio"), " Mehr.");
  const pending = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(pending);
  expect(keepaliveMock).toHaveBeenCalledTimes(1);
  expect(pending.defaultPrevented).toBe(false);
});

test("beforeunload warnt bei einem gescheiterten Lauf und bei ungültiger Eingabe", async () => {
  const user = userEvent.setup();
  apiMock.patch.mockImplementationOnce(() => Promise.reject(new Error("Serverfehler")));
  renderPage();
  await waitForForm();
  await user.type(screen.getByTestId("profile-bio"), " Mehr.");
  await user.tab();
  await waitFor(() => expect(screen.getByTestId("profile-autosave-status")).toHaveAttribute("data-status", "error"));
  const failed = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(failed);
  expect(failed.defaultPrevented).toBe(true);
  expect(keepaliveMock).not.toHaveBeenCalled();

  await user.click(screen.getByTestId("profile-autosave-retry"));
  await waitFor(() => expect(screen.getByTestId("profile-autosave-status")).toHaveTextContent("Gespeichert ✓"));
  await user.clear(screen.getByTestId("profile-display-name"));
  await waitFor(() => expect(screen.getByTestId("profile-autosave-status")).toHaveAttribute("data-status", "invalid"));
  const invalid = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(invalid);
  expect(invalid.defaultPrevented).toBe(true);
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


// Seite verlassen mit offener Eingabe (#1048, nach Codex-Prüfung von #1535): beforeunload greift nur beim Entladen -
// Links, Zurück und Abmelden in der Webseite halten an und fragen im Dialog der Seite.
function renderWithRoutes() {
  return render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={["/profile"]}>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/u/:username" element={<div data-testid="own-profile-stub" />} />
        </Routes>
      </MemoryRouter>
    </ConfirmDialogProvider>
  );
}

test("Verlassen mit leerem Namen fragt im Dialog: Zurück zum Feld bleibt, Verwerfen geht weiter", async () => {
  const user = userEvent.setup();
  renderWithRoutes();
  await waitForForm();
  await user.clear(screen.getByTestId("profile-display-name"));

  await user.click(screen.getByTestId("settings-to-profile"));
  const dialog = await screen.findByTestId("confirm-dialog");
  expect(dialog).toHaveTextContent("Nicht gespeicherte Änderungen: Name ist leer. Verwerfen und weiter?");
  expect(screen.getByTestId("confirm-dialog-confirm")).toHaveTextContent("Verwerfen und weiter");
  await user.click(screen.getByTestId("confirm-dialog-cancel"));
  expect(screen.queryByTestId("own-profile-stub")).toBeNull();
  await waitFor(() => expect(screen.getByTestId("profile-display-name")).toHaveFocus());
  expect(screen.getByTestId("profile-display-name")).toHaveValue("");

  await user.click(screen.getByTestId("settings-to-profile"));
  await user.click(await screen.findByTestId("confirm-dialog-confirm"));
  expect(await screen.findByTestId("own-profile-stub")).toBeInTheDocument();
  expect(apiMock.patch).not.toHaveBeenCalled();
});

test("Verlassen mit nur wartendem, gültigem Text speichert sofort und fragt nicht", async () => {
  const user = userEvent.setup();
  renderWithRoutes();
  await waitForForm();
  await user.type(screen.getByTestId("profile-bio"), " Mehr.");

  await user.click(screen.getByTestId("settings-to-profile"));
  expect(await screen.findByTestId("own-profile-stub")).toBeInTheDocument();
  expect(screen.queryByTestId("confirm-dialog")).toBeNull();
  expect(apiMock.patch).toHaveBeenCalledTimes(1);
  expect(apiMock.patch.mock.calls[0][1]).toEqual({ bio: "Kurze Vorstellung. Mehr." });
});

test("Verlassen nach gescheitertem Speichern fragt ebenfalls", async () => {
  const user = userEvent.setup();
  // Der Server bleibt weg - auch der neue Versuch beim Verlassen des Felds scheitert.
  apiMock.patch.mockImplementation(() => Promise.reject(new Error("Serverfehler")));
  renderWithRoutes();
  await waitForForm();
  await user.type(screen.getByTestId("profile-bio"), " Mehr.");
  await user.tab();
  await waitFor(() => expect(screen.getByTestId("profile-autosave-status")).toHaveAttribute("data-status", "error"));

  await user.click(screen.getByTestId("settings-to-profile"));
  expect(await screen.findByTestId("confirm-dialog")).toHaveTextContent("Das Speichern ist fehlgeschlagen.");
  await user.click(screen.getByTestId("confirm-dialog-confirm"));
  expect(await screen.findByTestId("own-profile-stub")).toBeInTheDocument();
});

test("ein anderer Reiter mit leerem Namen ist kein Verlassen - kein Dialog, der Entwurf bleibt", async () => {
  const user = userEvent.setup();
  renderWithRoutes();
  await waitForForm();
  await user.clear(screen.getByTestId("profile-display-name"));
  await user.click(screen.getByRole("button", { name: /Socials/i }));
  expect(screen.queryByTestId("confirm-dialog")).toBeNull();
  await user.click(screen.getByRole("button", { name: /Grunddaten/i }));
  expect(screen.getByTestId("profile-display-name")).toHaveValue("");
});

test("Abmelden mit leerem Namen fragt erst; Zurück zum Feld meldet nicht ab", async () => {
  const user = userEvent.setup();
  logoutMock.mockResolvedValue(true);
  renderWithRoutes();
  await waitForForm();
  await user.clear(screen.getByTestId("profile-display-name"));

  await user.click(screen.getByTestId("settings-logout"));
  await user.click(await screen.findByTestId("confirm-dialog-cancel"));
  expect(logoutMock).not.toHaveBeenCalled();

  await user.click(screen.getByTestId("settings-logout"));
  await user.click(await screen.findByTestId("confirm-dialog-confirm"));
  await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
  expect(apiMock.patch).not.toHaveBeenCalled();
});
