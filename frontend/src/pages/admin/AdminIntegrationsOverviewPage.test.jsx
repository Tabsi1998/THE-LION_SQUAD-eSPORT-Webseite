import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Alle Verbindungen (#546): Zeilen je Gruppe mit Zustand, Zähler oben, und der Hinweis, wenn Zugangsdaten
// zwar gespeichert, aber mit dem aktuellen Schlüssel nicht lesbar sind.

const apiMock = { get: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (e, f) => f }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const AdminIntegrationsOverviewPage = (await import("./AdminIntegrationsOverviewPage")).default;

const OVERVIEW = {
  groups: ["Anmeldung und E-Mail", "Plattformen zum Verknüpfen", "Discord", "Weitere Dienste"],
  summary: { active: 2, off: 1, missing: 1, unreadable: 1, error: 0 },
  items: [
    { key: "google", label: "Google", group: "Anmeldung und E-Mail", to: "/admin/settings/google", state: "missing", detail: "keine Web-Client-ID" },
    { key: "resend", label: "Resend", group: "Anmeldung und E-Mail", to: "/admin/settings/resend", state: "off", detail: "Versand läuft über SMTP" },
    { key: "smtp", label: "SMTP", group: "Anmeldung und E-Mail", to: "/admin/settings/smtp", state: "active", detail: "mail.example.test" },
    { key: "discord", label: "Discord", group: "Plattformen zum Verknüpfen", to: "/admin/integrations/discord", state: "active", detail: "Mitglieder können verknüpfen" },
    { key: "twitch", label: "Twitch", group: "Plattformen zum Verknüpfen", to: "/admin/integrations/twitch", state: "unreadable", detail: "Secret gespeichert, aber nicht lesbar" },
  ],
  platforms: [
    { key: "discord", label: "Discord", field: "discord_name", group: "social", linkable: true, enabled: true },
    { key: "twitch", label: "Twitch", field: "twitch_handle", group: "social", linkable: true, enabled: false },
    { key: "steam", label: "Steam", field: "steam_id", group: "game", linkable: true, enabled: true },
    { key: "psn", label: "PlayStation Network", field: "psn_id", group: "game", linkable: false, enabled: true },
  ],
};

beforeEach(() => {
  apiMock.get.mockResolvedValue({ data: OVERVIEW });
});

test("zeigt Gruppen, Zustände, Zähler und den Hinweis zu nicht lesbaren Zugangsdaten", async () => {
  render(<MemoryRouter><AdminIntegrationsOverviewPage /></MemoryRouter>);
  expect(await screen.findByTestId("integration-state-twitch")).toHaveTextContent("nicht lesbar");
  expect(screen.getByTestId("integration-state-smtp")).toHaveTextContent("aktiv");
  expect(screen.getByTestId("integration-state-resend")).toHaveTextContent("aus");
  expect(screen.getByTestId("integration-state-google")).toHaveTextContent("fehlt");
  expect(screen.getByTestId("integration-row-google")).toHaveAttribute("href", "/admin/settings/google");
  expect(screen.getByTestId("integration-detail-resend")).toHaveTextContent("Versand läuft über SMTP");
  expect(screen.getByTestId("integrations-count-unreadable")).toHaveTextContent("1");
  expect(screen.getByTestId("integrations-unreadable-hint")).toHaveTextContent("Twitch");
  expect(screen.getByTestId("integrations-unreadable-hint")).toHaveTextContent("SETTINGS_ENCRYPTION_KEY");
  // Leere Gruppen fallen weg.
  expect(screen.queryByTestId("integrations-group-Discord")).toBeNull();
  expect(screen.getByTestId("integrations-group-Anmeldung und E-Mail")).toBeInTheDocument();
});

test("ohne nicht lesbare Zugangsdaten gibt es keinen Hinweis", async () => {
  apiMock.get.mockResolvedValue({ data: { ...OVERVIEW, summary: { active: 1 }, items: OVERVIEW.items.filter((item) => item.state !== "unreadable") } });
  render(<MemoryRouter><AdminIntegrationsOverviewPage /></MemoryRouter>);
  expect(await screen.findByTestId("integration-state-smtp")).toBeInTheDocument();
  expect(screen.queryByTestId("integrations-unreadable-hint")).toBeNull();
});

// Haken je Plattform (#558): Alle an / Alle aus / einzeln; gespeichert wird die Liste der abgehakten.
test("Plattformen abhaken, alle an, alle aus – gespeichert wird disabled_platforms", async () => {
  const user = userEvent.setup();
  apiMock.put.mockResolvedValue({ data: {} });
  render(<MemoryRouter><AdminIntegrationsOverviewPage /></MemoryRouter>);
  expect(await screen.findByTestId("platforms-off-count")).toHaveTextContent("1 von 4 aus");
  expect(screen.getByTestId("platform-toggle-twitch")).not.toBeChecked();
  expect(screen.getByTestId("platform-toggle-psn-row")).toHaveTextContent("getippt");
  expect(screen.getByTestId("platforms-save")).toBeDisabled();
  await user.click(screen.getByTestId("platform-toggle-psn"));
  expect(screen.getByTestId("platforms-off-count")).toHaveTextContent("2 von 4 aus");
  await user.click(screen.getByTestId("platforms-save"));
  expect(apiMock.put).toHaveBeenCalledWith("/settings/branding", { disabled_platforms: ["psn", "twitch"] });
  await user.click(screen.getByTestId("platforms-enable-all"));
  expect(screen.getByTestId("platforms-off-count")).toHaveTextContent("0 von 4 aus");
  await user.click(screen.getByTestId("platforms-disable-all"));
  expect(screen.getByTestId("platforms-off-count")).toHaveTextContent("4 von 4 aus");
});
