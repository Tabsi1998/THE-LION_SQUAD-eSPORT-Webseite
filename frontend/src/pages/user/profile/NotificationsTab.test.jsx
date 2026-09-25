import { render, screen, waitFor } from "@testing-library/react";

// Discord als Benachrichtigungskanal (#567): die Spalte gibt es nur mit verknüpftem Discord-Konto;
// nach einer abgelehnten Direktnachricht steht der Klickweg dabei. Alles andere bleibt, wie es war.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const { NotificationsTab } = await import("./NotificationsTab");

function renderTab() {
  const props = {
    form: { newsletter_consent: false, notification_preferences: {} },
    set: vi.fn(),
    setNotificationPreference: vi.fn(),
    notificationEnabled: (key) => key !== "discord",
    notificationTopicEnabled: () => true,
    autosave: { status: "idle", message: "" },
  };
  return render(<NotificationsTab {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("ohne Discord-Verknüpfung gibt es keine Discord-Spalte, nur den Hinweis, wo man verknüpft", async () => {
  apiMock.get.mockResolvedValue({ data: { discord: { linked: false, blocked_at: null, hint: null } } });
  renderTab();
  await waitFor(() => expect(screen.getByTestId("profile-notification-discord-unlinked")).toBeInTheDocument());
  expect(screen.queryByTestId("profile-notification-channel-discord")).toBeNull();
  expect(screen.queryByTestId("profile-notification-column-discord")).toBeNull();
  expect(screen.getByTestId("profile-notification-channel-push")).toBeInTheDocument();
});

test("mit Verknüpfung steht Discord als Kanal da; eine abgelehnte Direktnachricht nennt den Klickweg", async () => {
  apiMock.get.mockResolvedValue({ data: { discord: { linked: true, blocked_at: "2026-09-25T10:00:00+00:00", hint: "Discord lässt keine Direktnachricht zu – in Discord unter Einstellungen → Datenschutz „Direktnachrichten von Servermitgliedern erlauben“." } } });
  renderTab();
  await waitFor(() => expect(screen.getByTestId("profile-notification-channel-discord")).toBeInTheDocument());
  expect(screen.getByTestId("profile-notification-column-discord")).toHaveTextContent("Kanal aus");
  expect(screen.getByTestId("profile-notification-discord-hint")).toHaveTextContent("Servermitgliedern");
  expect(screen.getByTestId("profile-notification-discord-match_reminders")).toBeDisabled();
  // Erfolge (#568): kein E-Mail-Weg, aber Push und Discord.
  expect(screen.getByTestId("profile-notification-email-achievements-none")).toHaveTextContent("–");
  expect(screen.getByTestId("profile-notification-push-achievements")).toBeInTheDocument();
  expect(screen.getByTestId("profile-notification-discord-achievements")).toBeInTheDocument();
});
