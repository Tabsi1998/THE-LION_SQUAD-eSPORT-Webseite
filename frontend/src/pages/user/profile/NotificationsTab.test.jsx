import { render, screen, waitFor } from "@testing-library/react";

// Discord als Benachrichtigungskanal (#567): die Spalte unter „Weitere Wege“ gibt es nur mit verknüpftem Discord-Konto;
// nach einer abgelehnten Direktnachricht steht der Klickweg dabei. Push, Nur App und Aus stehen je Thema oben (#1204).

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const { NotificationsTab } = await import("./NotificationsTab");

function renderTab() {
  const props = {
    form: { newsletter_consent: false, notification_preferences: {} },
    set: vi.fn(),
    setNotificationPreference: vi.fn(),
    setNotificationPreferences: vi.fn(),
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
  expect(screen.getByTestId("profile-notification-column-discord")).toHaveTextContent("Weg aus");
  expect(screen.getByTestId("profile-notification-discord-hint")).toHaveTextContent("Servermitgliedern");
  expect(screen.getByTestId("profile-notification-discord-match_reminders")).toBeDisabled();
  // Erfolge (#568): kein E-Mail-Weg, aber Push (in der Themen-Liste) und Discord.
  expect(screen.getByTestId("profile-notification-email-achievements-none")).toHaveTextContent("–");
  expect(screen.getByTestId("notification-topic-achievements-push")).toBeInTheDocument();
  expect(screen.getByTestId("profile-notification-discord-achievements")).toBeInTheDocument();
  // Wochenrückblick (#622): nur per E-Mail - kein Thema der Liste, kein Discord-Weg.
  expect(screen.getByTestId("profile-notification-email-achievement_recap")).toBeInTheDocument();
  expect(screen.getByTestId("profile-notification-discord-achievement_recap-none")).toHaveTextContent("–");
  expect(screen.queryByTestId("notification-topic-achievement_recap")).toBeNull();
  // Rechnungen (#841): Postfach, Push und Mail - Beträge nie über Discord.
  expect(screen.getByTestId("profile-notification-email-billing_updates")).toBeInTheDocument();
  expect(screen.getByTestId("notification-topic-billing_updates-push")).toBeInTheDocument();
  expect(screen.getByTestId("profile-notification-discord-billing_updates-none")).toHaveTextContent("–");
});

test("Zeremonien: Ton, Lautstärke und „dezent“ stehen in der Karte und schreiben über set()", async () => {
  apiMock.get.mockResolvedValue({ data: { discord: { linked: false } } });
  const set = vi.fn();
  const props = {
    form: { newsletter_consent: false, notification_preferences: {}, ceremony_sound: true, ceremony_volume: 60, ceremony_mode: "full" },
    set,
    setNotificationPreference: vi.fn(),
    setNotificationPreferences: vi.fn(),
    notificationEnabled: () => true,
    notificationTopicEnabled: () => true,
    autosave: { status: "idle", message: "" },
  };
  const { fireEvent } = await import("@testing-library/react");
  render(<NotificationsTab {...props} />);
  expect(screen.getByTestId("profile-ceremony-card")).toBeInTheDocument();
  expect(screen.getByTestId("profile-ceremony-sound")).toHaveAttribute("aria-checked", "true");
  expect(screen.getByTestId("profile-ceremony-subtle")).toHaveAttribute("aria-checked", "false");
  expect(screen.getByTestId("profile-ceremony-volume-value")).toHaveTextContent("60 %");
  fireEvent.click(screen.getByTestId("profile-ceremony-subtle"));
  expect(set).toHaveBeenCalledWith("ceremony_mode", "subtle");
  fireEvent.change(screen.getByTestId("profile-ceremony-volume"), { target: { value: "25" } });
  expect(set).toHaveBeenCalledWith("ceremony_volume", 25);
  fireEvent.click(screen.getByTestId("profile-ceremony-sound"));
  expect(set).toHaveBeenCalledWith("ceremony_sound", false);
});

// Browser-Benachrichtigungen (#1163): der Kanal „Browser“ und der Kasten „Dieser Browser“ nur, wenn der Server Web-Push
// eingerichtet hat - sonst kein Knopf. Je Thema gilt „Push“ auch für den Browser (#1204).
test("ohne Web-Push am Server gibt es keinen Kanal Browser", async () => {
  apiMock.get.mockImplementation(async (url) => ({ data: url === "/web-push/config" ? { enabled: false, public_key: null } : { discord: { linked: false } } }));
  renderTab();
  await waitFor(() => expect(screen.getByTestId("profile-notification-discord-unlinked")).toBeInTheDocument());
  expect(screen.queryByTestId("profile-notification-channel-browser")).toBeNull();
  expect(screen.queryByTestId("profile-notification-column-browser")).toBeNull();
  expect(screen.queryByTestId("profile-browser-push")).toBeNull();
});

test("mit Web-Push: Kanal, Push je Thema auch im Browser und „Dieser Browser“", async () => {
  apiMock.get.mockImplementation(async (url) => ({ data: url === "/web-push/config" ? { enabled: true, public_key: "BQQ", subscriptions: 2 } : { discord: { linked: false } } }));
  renderTab();
  await waitFor(() => expect(screen.getByTestId("profile-notification-channel-browser")).toBeInTheDocument());
  // Eine Spalte „Browser“ je Thema gibt es nicht mehr - „Push“ in der Liste gilt für App und Browser.
  expect(screen.queryByTestId("profile-notification-column-browser")).toBeNull();
  expect(screen.getByTestId("notification-topic-tournament_updates-push")).toBeInTheDocument();
  expect(screen.getByText(/in den Browser, wenn du ihn angemeldet hast/)).toBeInTheDocument();
  const card = screen.getByTestId("profile-browser-push");
  expect(card).toHaveTextContent("Dieser Browser");
  expect(screen.getByTestId("profile-browser-push-count")).toHaveTextContent("2 Browser");
  // jsdom kann kein Web-Push - der Kasten sagt das ehrlich.
  await waitFor(() => expect(card).toHaveAttribute("data-status", "unsupported"));
});

// Stufen (#1204): ohne Antwort des Servers stehen Platzhalter, die Themen schon da; mit Antwort die drei Stufen.
test("Stufen kommen vom Server - eine Stufe schickt alle Themen auf einmal", async () => {
  const { fireEvent } = await import("@testing-library/react");
  const topics = ["match_reminders", "tournament_updates", "prize_updates", "achievements", "billing_updates",
    "membership_updates", "community_messages", "news_events", "club_internal", "helper_shifts"];
  const modes = (pushed) => Object.fromEntries(topics.map((topic) => [topic, pushed.includes(topic) ? "push" : "app"]));
  apiMock.get.mockImplementation(async (url) => ({ data: url === "/web-push/config" ? { enabled: false } : {
    discord: { linked: false }, topics,
    levels: [
      { key: "all", label: "Alles", description: "Alles per Push.", modes: modes(topics) },
      { key: "important", label: "Wichtiges", description: "Wichtiges per Push.", modes: modes(["match_reminders"]) },
      { key: "few", label: "Wenig", description: "Wenig per Push.", modes: modes([]) },
    ],
  } }));
  const setNotificationPreferences = vi.fn();
  render(<NotificationsTab
    form={{ newsletter_consent: true, notification_preferences: {} }}
    set={vi.fn()}
    setNotificationPreference={vi.fn()}
    setNotificationPreferences={setNotificationPreferences}
    notificationEnabled={() => true}
    notificationTopicEnabled={() => true}
    autosave={{ status: "idle", message: "" }}
  />);
  expect(screen.getByTestId("notification-topic-match_reminders")).toHaveAttribute("data-mode", "push");
  await waitFor(() => expect(screen.getByTestId("notification-level-all")).toHaveAttribute("aria-checked", "true"));
  expect(screen.getByTestId("notification-level-description")).toHaveTextContent("Alles per Push.");
  fireEvent.click(screen.getByTestId("notification-level-important"));
  const patch = setNotificationPreferences.mock.calls.at(-1)[0];
  expect(patch["push:match_reminders"]).toBe(true);
  expect(patch["push:achievements"]).toBe(false);
  expect(patch["browser:achievements"]).toBe(false);
  expect(patch["in_app:achievements"]).toBe(true);
  // Pfeiltaste: weiter zur nächsten Stufe.
  fireEvent.keyDown(screen.getByTestId("notification-level-all"), { key: "ArrowRight" });
  expect(setNotificationPreferences).toHaveBeenCalledTimes(2);
});

// Barrierefreiheit (#1204): ein Tab-Stopp je Thema, Pfeiltasten wählen die nächste Stellung.
test("Themen: nur die gewählte Stellung ist ein Tab-Stopp, Pfeiltasten wechseln", async () => {
  const { fireEvent } = await import("@testing-library/react");
  apiMock.get.mockImplementation(async (url) => ({ data: url === "/web-push/config" ? { enabled: false } : { discord: { linked: false } } }));
  const setNotificationPreferences = vi.fn();
  render(<NotificationsTab
    form={{ newsletter_consent: true, notification_preferences: {} }}
    set={vi.fn()}
    setNotificationPreference={vi.fn()}
    setNotificationPreferences={setNotificationPreferences}
    notificationEnabled={() => true}
    notificationTopicEnabled={() => true}
    autosave={{ status: "idle", message: "" }}
  />);
  expect(screen.getByTestId("notification-topic-prize_updates-push")).toHaveAttribute("tabindex", "0");
  expect(screen.getByTestId("notification-topic-prize_updates-app")).toHaveAttribute("tabindex", "-1");
  expect(screen.getByTestId("notification-topic-prize_updates-off")).toHaveAttribute("tabindex", "-1");
  fireEvent.keyDown(screen.getByTestId("notification-topic-prize_updates-push"), { key: "ArrowRight" });
  expect(setNotificationPreferences).toHaveBeenLastCalledWith({ "in_app:prize_updates": true, "push:prize_updates": false, "browser:prize_updates": false });
  expect(document.activeElement).toBe(screen.getByTestId("notification-topic-prize_updates-app"));
  fireEvent.keyDown(screen.getByTestId("notification-topic-prize_updates-push"), { key: "ArrowLeft" });
  expect(setNotificationPreferences).toHaveBeenLastCalledWith({ "in_app:prize_updates": false, "push:prize_updates": false, "browser:prize_updates": false });
});

// Laden gescheitert (#1204): Hinweis mit „Erneut versuchen“ statt leerer Stufen-Karte; der zweite Versuch zeigt die Stufen.
test("Laden gescheitert: Hinweis und „Erneut versuchen“", async () => {
  const { fireEvent } = await import("@testing-library/react");
  let fail = true;
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/web-push/config") return { data: { enabled: false } };
    if (fail) throw new Error("weg");
    return { data: { discord: { linked: false }, topics: ["match_reminders"], levels: [{ key: "all", label: "Alles", description: "Alles per Push.", modes: { match_reminders: "push" } }] } };
  });
  renderTab();
  expect(await screen.findByTestId("notification-load-failed")).toHaveTextContent("nicht geladen");
  expect(screen.queryByTestId("notification-levels-loading")).toBeNull();
  fail = false;
  fireEvent.click(screen.getByTestId("notification-load-retry"));
  expect(await screen.findByTestId("notification-level-all")).toBeInTheDocument();
  expect(screen.queryByTestId("notification-load-failed")).toBeNull();
});
