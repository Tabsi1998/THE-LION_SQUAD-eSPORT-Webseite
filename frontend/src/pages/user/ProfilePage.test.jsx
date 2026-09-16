import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
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
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: USER, refresh: refreshMock, isClubMember: true }),
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

function renderPage() {
  return render(
    <ConfirmDialogProvider>
      <MemoryRouter initialEntries={["/profile"]}>
        <ProfilePage />
      </MemoryRouter>
    </ConfirmDialogProvider>
  );
}

beforeEach(() => {
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

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/users/me", expect.anything()));
  const [, payload] = apiMock.patch.mock.calls.at(-1);
  expect(payload).toEqual({ bio: "Neue Vorstellung." });
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
